import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { GoogleConnectionStatus } from "@rankos/shared";

import { db } from "../db/client";
import { googleAccountsTable } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { isGoogleConfigured, refreshAccessToken, revokeToken } from "./oauth";
import { decryptToken, encryptToken, hasTokenKey } from "./token-crypto";

/**
 * RankOS connects exactly one Google account — the agency account that already
 * has access to every client property. A single row keeps that explicit; there
 * is no per-client auth to reconcile.
 */
const SINGLETON_ID = "primary";

type CachedAccessToken = { token: string; expiresAt: number };

// Access tokens live ~1h. Caching in memory avoids a token round-trip before
// every API call while a long backfill runs.
let cachedAccessToken: CachedAccessToken | null = null;

// Refresh 60s early so a token cannot expire mid-request.
const EXPIRY_SKEW_MS = 60_000;

export class GoogleAccountRepository {
  getRow() {
    return db.select().from(googleAccountsTable).where(eq(googleAccountsTable.id, SINGLETON_ID)).get() ?? null;
  }

  isConnected(): boolean {
    return this.getRow() !== null;
  }

  /** Store the connection, replacing any previous one. */
  connect(input: { email: string; refreshToken: string; scope: string }): void {
    const encrypted = encryptToken(input.refreshToken);
    const connectedAt = new Date().toISOString();

    db.delete(googleAccountsTable).where(eq(googleAccountsTable.id, SINGLETON_ID)).run();
    db.insert(googleAccountsTable)
      .values({
        id: SINGLETON_ID,
        email: input.email,
        refreshTokenEnc: encrypted,
        scope: input.scope,
        connectedAt,
        lastErrorAt: null,
        lastErrorMessage: null
      })
      .run();

    cachedAccessToken = null;
  }

  async disconnect(): Promise<void> {
    const row = this.getRow();
    if (row) {
      // Best-effort: drop Google's side of the grant too, so a stale token
      // cannot be reused from a database copy.
      try {
        await revokeToken(decryptToken(row.refreshTokenEnc));
      } catch {
        // An undecryptable token is exactly the case where we still want the
        // local row gone.
      }
    }

    db.delete(googleAccountsTable).where(eq(googleAccountsTable.id, SINGLETON_ID)).run();
    cachedAccessToken = null;
  }

  /** Record a failure so the UI can show why sync stopped. */
  recordError(message: string): void {
    db.update(googleAccountsTable)
      .set({ lastErrorAt: new Date().toISOString(), lastErrorMessage: message })
      .where(eq(googleAccountsTable.id, SINGLETON_ID))
      .run();
  }

  clearError(): void {
    db.update(googleAccountsTable)
      .set({ lastErrorAt: null, lastErrorMessage: null })
      .where(eq(googleAccountsTable.id, SINGLETON_ID))
      .run();
  }

  /**
   * A valid access token, refreshing if needed.
   *
   * On `invalid_grant` the stored refresh token is dead and no retry will help,
   * so the error is recorded and rethrown — the caller turns that into the
   * "Reconnect Google" banner rather than a silent no-op sync.
   */
  async getAccessToken(): Promise<string> {
    const row = this.getRow();
    if (!row) {
      throw new ApiError("Google is not connected.", 400, "GOOGLE_NOT_CONNECTED");
    }

    if (cachedAccessToken && cachedAccessToken.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
      return cachedAccessToken.token;
    }

    try {
      const refreshed = await refreshAccessToken(decryptToken(row.refreshTokenEnc));
      cachedAccessToken = { token: refreshed.accessToken, expiresAt: refreshed.expiresAt };
      if (row.lastErrorAt) {
        this.clearError();
      }
      return refreshed.accessToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Google auth failure.";
      this.recordError(message);
      cachedAccessToken = null;
      throw error;
    }
  }

  getStatus(): GoogleConnectionStatus {
    const row = this.getRow();

    if (!row) {
      const reason = !isGoogleConfigured()
        ? "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, then connect."
        : !hasTokenKey()
          ? "Set GOOGLE_TOKEN_KEY in .env (64 hex characters) before connecting."
          : null;

      return {
        connected: false,
        email: null,
        connectedAt: null,
        lastErrorAt: null,
        lastErrorMessage: reason,
        needsReconnect: false
      };
    }

    // A dead refresh token is the one failure that cannot resolve itself, so
    // it gets its own flag rather than being folded into a generic error.
    const needsReconnect = Boolean(
      row.lastErrorMessage &&
        (row.lastErrorMessage.includes("invalid_grant") ||
          row.lastErrorMessage.toLowerCase().includes("reconnect") ||
          row.lastErrorMessage.toLowerCase().includes("decrypt"))
    );

    return {
      connected: true,
      email: row.email,
      connectedAt: row.connectedAt,
      lastErrorAt: row.lastErrorAt,
      lastErrorMessage: row.lastErrorMessage,
      needsReconnect
    };
  }
}

/**
 * Short-lived CSRF state for the OAuth round trip, held in memory. Entries
 * expire so an abandoned connect attempt cannot be replayed later.
 */
const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map<string, number>();

export function rememberState(state: string): void {
  const now = Date.now();
  for (const [key, createdAt] of pendingStates) {
    if (now - createdAt > STATE_TTL_MS) {
      pendingStates.delete(key);
    }
  }
  pendingStates.set(state, now);
}

export function consumeState(state: string): boolean {
  const createdAt = pendingStates.get(state);
  if (createdAt === undefined) {
    return false;
  }
  // Single use, so a leaked callback URL cannot be replayed.
  pendingStates.delete(state);
  return Date.now() - createdAt <= STATE_TTL_MS;
}

export function newRunId(): string {
  return randomUUID();
}
