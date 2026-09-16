/**
 * Google Ads connection doctor.
 *
 * Every Google Ads failure so far has arrived as a bare status code, and each
 * one has cost a round trip to work out which call produced it. This runs the
 * three calls the connector makes — version probe, account list, report query —
 * against the credentials actually stored in the database, and prints the URL,
 * the status and Google's own response body for each.
 *
 * It uses plain fetch rather than the connector's HTTP client on purpose:
 * nothing is retried, wrapped or summarised, so what you see is what Google
 * sent. Run it with `npm run doctor:google`.
 *
 * No secret is ever printed. Credentials are reported as present or missing.
 */

import { readFileSync } from "node:fs";

import { getOAuthClient, isExpired, refreshAccessToken } from "../src/lib/connectors/oauth";
import { GAQL, googleAdsConnector } from "../src/lib/connectors/google-ads";
import {
  CredentialsUnreadableError,
  findConnectionByPlatform,
  loadCredentials,
  saveCredentials,
} from "../src/lib/repo";
import type { Credentials } from "../src/lib/types";
import { trailingWindow } from "../src/lib/util";

/**
 * Next.js reads .env for us; a plain tsx script does not, and without
 * CREDENTIALS_KEY the stored credentials cannot be decrypted. Ten lines here
 * beats a dependency for one file.
 */
function loadEnvFile(): void {
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

loadEnvFile();

const HOST = "https://googleads.googleapis.com";
const VERSIONS = ["v26", "v25", "v24", "v23", "v22"];

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/** Enough of the body to name the cause, without pasting an HTML error page. */
function summarise(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "(empty body)";
  if (/^<|<!doctype/i.test(trimmed)) return "(HTML error page — the frontend did not route this path)";
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}…` : trimmed;
}

async function call(
  label: string,
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: string }> {
  process.stdout.write(`${label}\n  ${init.method ?? "GET"} ${url}\n`);
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

async function main(): Promise<void> {
  heading("Connection");

  const connection = findConnectionByPlatform("google_ads");
  if (!connection) {
    console.log("No Google Ads connection in the database. Connect it on /connections first.");
    return;
  }

  const loginCustomerId =
    (connection.config.loginCustomerId as string | undefined) ??
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

  console.log(`id                 ${connection.id}`);
  console.log(`status             ${connection.status}`);
  console.log(`customer id        ${connection.externalAccountId ?? "NOT SET — set it on the connection card"}`);
  console.log(`manager (MCC) id   ${loginCustomerId ?? "not set"}`);
  console.log(`developer token    ${process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? "present" : "not set (fine — sunset 9 Sep 2026)"}`);
  console.log(`pinned version     ${process.env.GOOGLE_ADS_API_VERSION?.trim() || "none (discovered)"}`);

  heading("Credentials");

  let credentials: Credentials;
  try {
    credentials = loadCredentials(connection.id) ?? {};
  } catch (error) {
    if (error instanceof CredentialsUnreadableError) {
      console.log(
        "Stored credentials could not be decrypted. CREDENTIALS_KEY has changed since they " +
          "were saved — reconnect Google Ads to store them under the current key.",
      );
      return;
    }
    throw error;
  }

  console.log(`access token       ${credentials.accessToken ? "present" : "MISSING"}`);
  console.log(`refresh token      ${credentials.refreshToken ? "present" : "MISSING — reconnect to obtain one"}`);
  console.log(
    `expires            ${
      credentials.expiresAt
        ? `${new Date(credentials.expiresAt).toLocaleString()}${isExpired(credentials) ? " (EXPIRED)" : ""}`
        : "unknown"
    }`,
  );

  if (credentials.refreshToken && isExpired(credentials)) {
    const client = getOAuthClient("google_ads");
    if (!client) {
      console.log("\nToken is expired and GOOGLE_ADS_CLIENT_ID/SECRET are not set, so it cannot be refreshed.");
      return;
    }
    console.log("\nToken is expired — refreshing before testing.");
    credentials = await refreshAccessToken(googleAdsConnector.oauth!, client, credentials);
    saveCredentials(connection.id, credentials);
    console.log("Refreshed and saved.");
  }

  if (!credentials.accessToken) {
    console.log("\nNo access token to test with. Reconnect Google Ads on /connections.");
    return;
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${credentials.accessToken}`,
    ...(process.env.GOOGLE_ADS_DEVELOPER_TOKEN
      ? { "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN }
      : {}),
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId.replace(/-/g, "") } : {}),
  };

  heading("Which API version serves this account");

  let live: string | null = null;
  for (const version of VERSIONS) {
    const { status } = await call(
      `${version}:`,
      `${HOST}/${version}/customers:listAccessibleCustomers`,
      { headers },
    );
    // A 404 means the version is not being served. Anything else — including a
    // refusal — means the method resolved, so the version is live.
    if (status !== 404 && status !== 0) {
      live = version;
      break;
    }
  }

  if (!live) {
    console.log("\nNo version answered. Google has moved past every version this build knows about.");
    return;
  }

  console.log(`\nUsing ${live}.`);

  if (!connection.externalAccountId) {
    console.log("\nNo customer ID set, so the report query cannot be tested. Set it on the connection card.");
    return;
  }

  heading("The queries a sync runs");

  // Every query, not just one that is known to work: a sync stops at the first
  // failure, so running them all is the difference between "something is wrong"
  // and "this field, in this query".
  const range = trailingWindow(90);
  const url = `${HOST}/${live}/customers/${connection.externalAccountId.replace(/-/g, "")}/googleAds:searchStream`;
  const failures: string[] = [];

  for (const [name, query] of [
    ["customer", GAQL.customer],
    ["campaigns", GAQL.campaigns],
    ["ad groups", GAQL.adGroups],
    ["ads", GAQL.ads],
    [`metrics (${range.start} to ${range.end})`, GAQL.metrics(range)],
  ] as const) {
    const { status } = await call(`${name}:`, url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (status !== 200) failures.push(name);
    console.log("");
  }

  console.log(
    failures.length === 0
      ? "All queries succeeded. A sync should now work."
      : `Failed: ${failures.join(", ")}. The message above each one names the cause.`,
  );
  console.log("\nDone. Paste everything above — no secrets are printed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
