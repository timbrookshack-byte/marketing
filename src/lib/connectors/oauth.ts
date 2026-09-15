import { ConnectorError, request } from "./http";
import type { OAuthConfig } from "./types";
import type { Credentials, PlatformId } from "../types";

/**
 * Generic OAuth 2.0 authorization-code flow. Each connector supplies its URLs
 * and scopes; the mechanics — state, PKCE, refresh — live here once.
 */

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/**
 * Per-platform client credentials come from the environment, named
 * predictably so adding a platform needs no wiring: GOOGLE_ADS_CLIENT_ID /
 * GOOGLE_ADS_CLIENT_SECRET for `google_ads`, and so on.
 */
export function envPrefix(platform: PlatformId): string {
  return platform.toUpperCase();
}

export function getOAuthClient(platform: PlatformId): OAuthClient | null {
  const prefix = envPrefix(platform);
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function callbackUrl(platform: PlatformId): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/connectors/${platform}/callback`;
}

export function buildAuthorizeUrl(
  platform: PlatformId,
  config: OAuthConfig,
  client: OAuthClient,
  state: string,
  codeChallenge?: string,
): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", callbackUrl(platform));
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  for (const [key, value] of Object.entries(config.extraAuthParams ?? {})) {
    url.searchParams.set(key, value);
  }
  if (config.usePkce && codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  [key: string]: unknown;
}

function toCredentials(response: TokenResponse, previous?: Credentials): Credentials {
  return {
    ...previous,
    accessToken: response.access_token,
    // Some platforms only return a refresh token on the first grant.
    refreshToken: response.refresh_token ?? previous?.refreshToken,
    expiresAt: response.expires_in ? Date.now() + response.expires_in * 1000 : undefined,
  };
}

function authHeaders(config: OAuthConfig, client: OAuthClient): Record<string, string> {
  if (config.clientAuth !== "basic") return {};
  const encoded = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64");
  return { authorization: `Basic ${encoded}` };
}

export async function exchangeCode(
  platform: PlatformId,
  config: OAuthConfig,
  client: OAuthClient,
  code: string,
  codeVerifier?: string | null,
): Promise<Credentials> {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(platform),
  };
  if (config.clientAuth !== "basic") {
    form.client_id = client.clientId;
    form.client_secret = client.clientSecret;
  }
  if (codeVerifier) form.code_verifier = codeVerifier;

  const response = await request<TokenResponse>(config.tokenUrl, {
    method: "POST",
    form,
    headers: authHeaders(config, client),
  });
  return toCredentials(response);
}

export async function refreshAccessToken(
  config: OAuthConfig,
  client: OAuthClient,
  credentials: Credentials,
): Promise<Credentials> {
  if (!credentials.refreshToken) {
    throw new ConnectorError("No refresh token stored — reconnect this account", 401, "");
  }
  const form: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
  };
  if (config.clientAuth !== "basic") {
    form.client_id = client.clientId;
    form.client_secret = client.clientSecret;
  }
  const response = await request<TokenResponse>(config.tokenUrl, {
    method: "POST",
    form,
    headers: authHeaders(config, client),
  });
  return toCredentials(response, credentials);
}

/** True when the stored token is expired or about to be, with a minute of slack. */
export function isExpired(credentials: Credentials): boolean {
  if (!credentials.expiresAt) return false;
  return credentials.expiresAt - Date.now() < 60_000;
}
