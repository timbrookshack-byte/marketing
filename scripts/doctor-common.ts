/**
 * Shared plumbing for the connection doctors.
 *
 * Each doctor prints the URL, the status and the platform's own response body
 * for every call a sync makes, using plain fetch rather than the connector's
 * HTTP client: nothing retried, wrapped or summarised, so what is printed is
 * what the platform sent. No secret is ever printed.
 */

import { readFileSync } from "node:fs";

import { getConnector } from "../src/lib/connectors/registry";
import { getOAuthClient, isExpired, refreshAccessToken } from "../src/lib/connectors/oauth";
import { CredentialsUnreadableError, findConnectionByPlatform, loadCredentials, saveCredentials } from "../src/lib/repo";
import type { Connection, Credentials, PlatformId } from "../src/lib/types";

/**
 * Next.js reads .env for us; a plain tsx script does not, and without
 * CREDENTIALS_KEY the stored credentials cannot be decrypted.
 */
export function loadEnvFile(): void {
  let contents: string;
  try {
    contents = readFileSync(".env", "utf8");
  } catch {
    return;
  }
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

export function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/** Enough of the body to name the cause, without pasting an HTML error page. */
export function summarise(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "(empty body)";
  if (/^<|<!doctype/i.test(trimmed)) return "(HTML error page — the frontend did not route this path)";
  return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}…` : trimmed;
}

export interface CallResult {
  status: number;
  body: string;
}

export async function call(label: string, url: string, init: RequestInit = {}): Promise<CallResult> {
  // The query string can carry a token on some platforms, so it is never shown.
  const shown = url.split("?")[0];
  process.stdout.write(`${label}\n  ${init.method ?? "GET"} ${shown}\n`);
  try {
    const response = await fetch(url, init);
    const body = await response.text();
    console.log(`  → ${response.status} ${response.statusText}`);
    console.log(`  ${summarise(body).split("\n").join("\n  ")}`);
    return { status: response.status, body };
  } catch (error) {
    console.log(`  → network failure: ${(error as Error).message}`);
    return { status: 0, body: "" };
  }
}

/** How many items came back, when the body is a list. Useful on its own. */
export function countOf(body: string, key = "data"): number | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const list = parsed[key];
    return Array.isArray(list) ? list.length : null;
  } catch {
    return null;
  }
}

export interface Ready {
  connection: Connection;
  credentials: Credentials;
}

/**
 * Loads a connection and gets its token into a usable state, explaining and
 * bailing out when it cannot — an expired token or an unreadable one makes
 * every call below it fail for a reason that has nothing to do with the query.
 */
export async function prepare(platform: PlatformId): Promise<Ready | null> {
  heading("Connection");

  const connection = findConnectionByPlatform(platform);
  if (!connection) {
    console.log(`No ${platform} connection in the database. Connect it on /connections first.`);
    return null;
  }

  console.log(`id                 ${connection.id}`);
  console.log(`name               ${connection.displayName}`);
  console.log(`status             ${connection.status}`);
  console.log(`account id         ${connection.externalAccountId ?? "NOT SET — set it on the connection card"}`);

  heading("Credentials");

  let credentials: Credentials;
  try {
    credentials = loadCredentials(connection.id) ?? {};
  } catch (error) {
    if (error instanceof CredentialsUnreadableError) {
      console.log(
        "Stored credentials could not be decrypted. CREDENTIALS_KEY has changed since they " +
          "were saved — reconnect this account to store them under the current key.",
      );
      return null;
    }
    throw error;
  }

  console.log(`access token       ${credentials.accessToken ? "present" : "MISSING"}`);
  console.log(`refresh token      ${credentials.refreshToken ? "present" : "none stored"}`);
  console.log(
    `expires            ${
      credentials.expiresAt
        ? `${new Date(credentials.expiresAt).toLocaleString()}${isExpired(credentials) ? " (EXPIRED)" : ""}`
        : "unknown"
    }`,
  );

  const connector = getConnector(platform);
  if (connector.oauth && isExpired(credentials)) {
    const client = getOAuthClient(platform);
    if (!client) {
      console.log("\nToken is expired and this platform's client id/secret are not set, so it cannot be renewed.");
      return null;
    }
    console.log("\nToken is expired — renewing before testing.");
    credentials = await refreshAccessToken(connector.oauth, client, credentials);
    saveCredentials(connection.id, credentials);
    console.log("Renewed and saved.");
  }

  if (!credentials.accessToken) {
    console.log("\nNo access token to test with. Reconnect this account on /connections.");
    return null;
  }

  return { connection, credentials };
}
