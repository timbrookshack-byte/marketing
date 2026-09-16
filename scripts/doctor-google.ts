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

import { call, heading, loadEnvFile, prepare } from "./doctor-common";
import { GAQL } from "../src/lib/connectors/google-ads";
import { trailingWindow } from "../src/lib/util";

loadEnvFile();

const HOST = "https://googleads.googleapis.com";
const VERSIONS = ["v26", "v25", "v24", "v23", "v22"];

async function main(): Promise<void> {
  const ready = await prepare("google_ads");
  if (!ready) return;

  const { connection, credentials } = ready;
  const loginCustomerId =
    (connection.config.loginCustomerId as string | undefined) ??
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

  console.log(`manager (MCC) id   ${loginCustomerId ?? "not set"}`);
  console.log(`developer token    ${process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? "present" : "not set (fine — sunset 9 Sep 2026)"}`);
  console.log(`pinned version     ${process.env.GOOGLE_ADS_API_VERSION?.trim() || "none (discovered)"}`);

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

  const retired = new Set<string>();

  for (const [name, query] of [
    ["customer", GAQL.customer],
    ["campaigns", GAQL.campaigns],
    ["ad groups", GAQL.adGroups],
    ["ads", GAQL.ads],
    [`metrics (${range.start} to ${range.end})`, GAQL.metrics(range)],
  ] as const) {
    const { status, body } = await call(`${name}:`, url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (status !== 200) {
      failures.push(name);
      // Google names the offending fields in quotes. Collect them so the next
      // section can go and ask what took their place.
      if (body.includes("UNRECOGNIZED_FIELD")) {
        for (const match of body.matchAll(/'([a-z][a-z_]*\.[a-z_.]+)'/g)) retired.add(match[1]);
      }
    }
    console.log("");
  }

  console.log(
    failures.length === 0
      ? "All queries succeeded. A sync should now work."
      : `Failed: ${failures.join(", ")}. The message above each one names the cause.`,
  );

  // Knowing a field is gone does not say what replaced it, and the reference
  // documentation only covers versions Google is still publishing. The API
  // will describe its own schema, which is the one answer that cannot be stale.
  if (retired.size > 0) {
    heading("What exists now, in place of the fields Google rejected");

    for (const field of retired) {
      const [resource, ...rest] = field.split(".");
      const keyword = rest[rest.length - 1].split("_").pop() ?? "";
      await call(
        `${field} is gone — other ${resource} fields matching "${keyword}":`,
        `${HOST}/${live}/googleAdsFields:search`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            query: `SELECT name, selectable, data_type FROM google_ads_field ` +
                   `WHERE name LIKE '${resource}.%${keyword}%'`,
          }),
        },
      );
      console.log("");
    }
  }
  console.log("\nDone. Paste everything above — no secrets are printed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
