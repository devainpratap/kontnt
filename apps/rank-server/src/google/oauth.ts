import { rankConfig } from "../config";
import { ApiError } from "../lib/api-error";

/**
 * Google OAuth 2.0, spoken directly over fetch rather than via googleapis.
 * The flow needs three endpoints and no SDK, and staying dependency-free keeps
 * the whole auth path readable in one file.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

/** Read-only is all RankOS ever needs; email identifies the connected account. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/userinfo.email"
];

export type TokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
};

export function isGoogleConfigured(): boolean {
  return Boolean(rankConfig.googleClientId && rankConfig.googleClientSecret);
}

function assertConfigured(): void {
  if (!isGoogleConfigured()) {
    throw new ApiError(
      "Google is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.",
      400,
      "GOOGLE_NOT_CONFIGURED"
    );
  }
}

/**
 * Build the consent URL.
 *
 * `access_type=offline` plus `prompt=consent` is what makes Google return a
 * refresh token. Without prompt=consent a second authorisation returns only an
 * access token, and the sync silently loses the ability to run unattended.
 */
export function buildAuthUrl(state: string): string {
  assertConfigured();

  const params = new URLSearchParams({
    client_id: rankConfig.googleClientId,
    redirect_uri: rankConfig.googleRedirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

type GoogleTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postToken(body: URLSearchParams): Promise<GoogleTokenPayload> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleTokenPayload;

  if (!response.ok) {
    // invalid_grant means the refresh token is dead — revoked, expired (the
    // 7-day Testing-mode trap), or issued under different credentials. It is
    // never retryable, so it is surfaced with its own code and drives the
    // "Reconnect Google" banner rather than a generic failure.
    const code = payload.error === "invalid_grant" ? "GOOGLE_INVALID_GRANT" : "GOOGLE_TOKEN_ERROR";
    const detail = payload.error_description || payload.error || `HTTP ${response.status}`;
    throw new ApiError(`Google token request failed: ${detail}`, 401, code);
  }

  return payload;
}

/** Exchange the one-time authorisation code for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  assertConfigured();

  const payload = await postToken(
    new URLSearchParams({
      code,
      client_id: rankConfig.googleClientId,
      client_secret: rankConfig.googleClientSecret,
      redirect_uri: rankConfig.googleRedirectUri,
      grant_type: "authorization_code"
    })
  );

  if (!payload.access_token) {
    throw new ApiError("Google did not return an access token.", 502, "GOOGLE_TOKEN_ERROR");
  }

  if (!payload.refresh_token) {
    // Without this the connection cannot survive a restart. Usually means the
    // account previously authorised the app and Google suppressed a second
    // refresh token; revoking at myaccount.google.com/permissions fixes it.
    throw new ApiError(
      "Google did not return a refresh token. Remove RankOS at myaccount.google.com/permissions and connect again.",
      502,
      "GOOGLE_NO_REFRESH_TOKEN"
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    scope: payload.scope ?? GOOGLE_SCOPES.join(" ")
  };
}

/** Trade the stored refresh token for a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  assertConfigured();

  const payload = await postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: rankConfig.googleClientId,
      client_secret: rankConfig.googleClientSecret,
      grant_type: "refresh_token"
    })
  );

  if (!payload.access_token) {
    throw new ApiError("Google did not return an access token.", 502, "GOOGLE_TOKEN_ERROR");
  }

  return {
    accessToken: payload.access_token,
    // A refresh grant does not reissue the refresh token; the caller keeps the
    // one it already has.
    refreshToken: payload.refresh_token ?? null,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    scope: payload.scope ?? GOOGLE_SCOPES.join(" ")
  };
}

export async function fetchAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    return "unknown";
  }

  const payload = (await response.json().catch(() => ({}))) as { email?: string };
  return payload.email ?? "unknown";
}

/** Best-effort revocation, so disconnecting actually drops Google's grant. */
export async function revokeToken(token: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token })
  }).catch(() => undefined);
}
