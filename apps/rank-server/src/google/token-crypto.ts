import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

import { rankConfig } from "../config";
import { ApiError } from "../lib/api-error";

/**
 * Encryption for the Google refresh token at rest.
 *
 * The refresh token is long-lived and grants read access to every Search
 * Console property the connected account can see. Stored as plaintext it would
 * travel with any copy of data/rank.sqlite — a backup, a synced folder, a
 * machine handed on. AES-256-GCM keeps the ciphertext useless without the key
 * in .env, and the auth tag means a tampered value fails loudly rather than
 * decrypting to garbage.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const KEY_BYTES = 32;
const VERSION = "v1";

function loadKey(): Buffer {
  const raw = rankConfig.googleTokenKey.trim();

  if (!raw) {
    throw new ApiError(
      "GOOGLE_TOKEN_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      500,
      "TOKEN_KEY_MISSING"
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new ApiError(
      "GOOGLE_TOKEN_KEY must be 64 hex characters (32 bytes).",
      500,
      "TOKEN_KEY_INVALID"
    );
  }

  return Buffer.from(raw, "hex");
}

/** True when a usable key is configured, for surfacing setup state in the UI. */
export function hasTokenKey(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a token. Output is `v1.<iv>.<authTag>.<ciphertext>`, all base64url.
 * The version prefix leaves room to rotate the scheme later without having to
 * guess at the format of existing rows.
 */
export function encryptToken(plaintext: string): string {
  if (!plaintext) {
    throw new ApiError("Refusing to encrypt an empty token.", 500, "TOKEN_EMPTY");
  }

  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64url"), authTag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/**
 * Decrypt a token produced by encryptToken.
 *
 * Throws on a wrong key, a tampered payload, or a malformed value. Callers
 * treat any failure as "reconnect required" rather than retrying, because none
 * of these states resolve on their own.
 */
export function decryptToken(payload: string): string {
  const parts = payload.split(".");

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new ApiError("Stored Google token is malformed. Reconnect Google.", 500, "TOKEN_MALFORMED");
  }

  const key = loadKey();
  const iv = Buffer.from(parts[1], "base64url");
  const authTag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");

  if (iv.length !== IV_BYTES || authTag.length !== 16) {
    throw new ApiError("Stored Google token is malformed. Reconnect Google.", 500, "TOKEN_MALFORMED");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // A changed GOOGLE_TOKEN_KEY lands here. Say so plainly — silently
    // returning nothing would look like "never connected".
    throw new ApiError(
      "Could not decrypt the stored Google token. If GOOGLE_TOKEN_KEY changed, reconnect Google.",
      500,
      "TOKEN_UNDECRYPTABLE"
    );
  }
}

/**
 * Constant-time comparison for the OAuth `state` parameter. A plain === leaks
 * timing information about how many leading characters matched, which is the
 * standard way CSRF-token comparisons are weakened.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

export function createStateToken(): string {
  return randomBytes(32).toString("base64url");
}
