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
 *
 * This has to accept everything Next.js accepts, or a script reports a problem
 * the app does not have: a byte order mark from an editor, CRLF line endings, a
 * leading `export`, quoted values, and lower-case names.
 */
export function loadEnvFile(): { found: boolean; keys: string[]; duplicated: string[] } {
  let contents: string;
  try {
    contents = readFileSync(".env", "utf8");
  } catch {
    return { found: false, keys: [], duplicated: [] };
  }

  // Last occurrence wins, which is what dotenv and therefore Next.js do: the
  // file is parsed into an object, so a later line overwrites an earlier one.
  // Taking the first instead is a real difference — a key left blank by the
  // template and set properly further down reads as blank here and correct in
  // the app, and nothing in either output says why they disagree.
  const parsed = new Map<string, string>();
  const keys: string[] = [];
  const duplicated = new Set<string>();

  for (const line of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (/^\s*[#;]/.test(line)) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (parsed.has(key)) duplicated.add(key);
    keys.push(key);
    parsed.set(key, rawValue.trim().replace(/^(["'])(.*)\1$/, "$2"));
  }

  // A real environment variable still outranks the file, as dotenv has it.
  for (const [key, value] of parsed) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return { found: true, keys, duplicated: [...duplicated] };
}

/**
 * What the environment looks like from here.
 *
 * Reported rather than assumed: a script that cannot decrypt credentials the
 * app reads perfectly well is usually a .env line neither of them agrees about,
 * and there is no way to tell that apart from a genuinely changed key without
 * saying which names were actually parsed.
 */
export function reportEnv(env: { found: boolean; keys: string[]; duplicated: string[] }): void {
  const key = process.env.CREDENTIALS_KEY?.trim();
  console.log(`.env file          ${env.found ? "found" : "NOT FOUND in this directory"}`);
  console.log(
    `CREDENTIALS_KEY    ${
      key
        ? `set, ${key.length} characters`
        : env.found && env.keys.includes("CREDENTIALS_KEY")
          ? "present in .env but empty"
          : env.found
            ? `not among the ${env.keys.length} names in .env`
            : "not set"
    }`,
  );
  if (env.duplicated.length > 0) {
    console.log(
      `duplicated in .env ${env.duplicated.join(", ")} — the last line wins, and an earlier ` +
        "blank one is easy to mistake for the setting that applies. Worth deleting the spares.",
    );
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
export async function prepare(
  platform: PlatformId,
  env?: { found: boolean; keys: string[]; duplicated: string[] },
): Promise<Ready | null> {
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

  if (env) reportEnv(env);

  let credentials: Credentials;
  try {
    credentials = loadCredentials(connection.id) ?? {};
  } catch (error) {
    if (error instanceof CredentialsUnreadableError) {
      console.log(
        "Stored credentials could not be decrypted, so they were saved under a different key " +
          "than the one in force here.\n\n" +
          "If the line above says CREDENTIALS_KEY is set, and the app itself works, then this " +
          "script and the app are reading .env differently — send the two lines above and it can " +
          "be fixed.\n\n" +
          "If it says not set, .env is missing the key the account was connected under. Restore " +
          "that line if you kept a copy; otherwise reconnect the account to store its token under " +
          "the current key.",
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
