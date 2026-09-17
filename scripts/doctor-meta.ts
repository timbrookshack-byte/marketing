/**
 * Meta Ads connection doctor.
 *
 * A sync that succeeds with zero rows says nothing about why. There are three
 * different explanations and they need completely different fixes: the wrong ad
 * account is selected, the account is real but had no delivery in the window,
 * or the insights query itself is wrong. This separates them by asking the same
 * question three ways and printing what Meta answers.
 *
 * Run it with `npm run doctor:meta`. No secret is printed.
 */

import { call, countOf, heading, loadEnvFile, prepare } from "./doctor-common";
import { trailingWindow } from "../src/lib/util";

const env = loadEnvFile();

const HOST = "https://graph.facebook.com";
const CANDIDATE_VERSIONS = ["v23.0", "v22.0", "v21.0", "v20.0"];

async function main(): Promise<void> {
  const ready = await prepare("meta_ads", env);
  if (!ready) return;

  const { connection, credentials } = ready;
  const headers = { authorization: `Bearer ${credentials.accessToken}` };
  const pinned = process.env.META_ADS_API_VERSION?.trim();

  heading("Which Graph API version answers");

  let live: string | null = null;
  for (const version of pinned ? [pinned, ...CANDIDATE_VERSIONS] : CANDIDATE_VERSIONS) {
    const { status } = await call(`${version}:`, `${HOST}/${version}/me?fields=id`, { headers });
    if (status === 200) {
      live = version;
      break;
    }
    console.log("");
  }

  if (!live) {
    console.log("\nNo version answered. The token is probably no longer valid — reconnect Meta Ads.");
    return;
  }
  console.log(`\nUsing ${live}.`);

  // The decisive check. amount_spent is lifetime spend on the account, so an
  // account showing zero here has never run anything and no query will find
  // data in it — which is a different problem from a quiet 90 days.
  heading("Every ad account this login can see");
  const { body: accountsBody } = await call(
    "adaccounts:",
    `${HOST}/${live}/me/adaccounts?fields=id,name,account_id,currency,account_status,amount_spent&limit=100`,
    { headers },
  );
  console.log(`\nSelected on this connection: ${connection.externalAccountId ?? "(none)"}`);

  const account = connection.externalAccountId
    ? connection.externalAccountId.startsWith("act_")
      ? connection.externalAccountId
      : `act_${connection.externalAccountId}`
    : null;

  if (!account) {
    console.log("No account selected, so nothing below can run. Pick one on the connection card.");
    return;
  }

  heading("What the selected account contains");
  for (const [label, path] of [
    ["campaigns", `${account}/campaigns?fields=id,name,status&limit=5`],
    ["ad sets", `${account}/adsets?fields=id,name,status&limit=5`],
    ["ads", `${account}/ads?fields=id,name,status&limit=5`],
  ] as const) {
    const { body } = await call(`${label}:`, `${HOST}/${live}/${path}`, { headers });
    const n = countOf(body);
    if (n !== null) console.log(`  (${n} returned, showing at most 5)`);
    console.log("");
  }

  heading("Insights — the call that returned no rows");

  const range = trailingWindow(90);
  const fields = "date_start,campaign_id,adset_id,ad_id,impressions,clicks,spend";

  // Same window and shape the sync uses.
  const windowed = await call(
    `daily rows, ${range.start} to ${range.end} (what the sync asks for):`,
    `${HOST}/${live}/${account}/insights?level=ad&time_increment=1&limit=5` +
      `&fields=${fields}&time_range=${encodeURIComponent(JSON.stringify({ since: range.start, until: range.end }))}`,
    { headers },
  );
  console.log(`  (${countOf(windowed.body) ?? "?"} rows in this window)\n`);

  // Same account, no window and no daily split: has it ever spent anything?
  const lifetime = await call(
    "account totals, all time (has this account ever spent?):",
    `${HOST}/${live}/${account}/insights?level=account&date_preset=maximum&limit=5&fields=spend,impressions,clicks,date_start,date_stop`,
    { headers },
  );
  const lifetimeRows = countOf(lifetime.body) ?? 0;

  heading("Reading");
  if (windowed.status !== 200) {
    console.log("The windowed query failed outright. The message above names the cause.");
  } else if ((countOf(windowed.body) ?? 0) > 0) {
    console.log("Rows came back here, so the query works and the sync should be ingesting them.");
  } else if (lifetimeRows > 0) {
    console.log(
      "This account has spent money at some point, but nothing in the last 90 days. The\n" +
        "connection is working and there is genuinely nothing to pull for this window.",
    );
  } else {
    console.log(
      "This account has never spent anything, so no window will find data in it. Check the\n" +
        "account list above: the one you advertise from is whichever shows a non-zero\n" +
        "amount_spent. Set that account id on the connection card.",
    );
  }
  console.log("\nDone. Paste everything above — no secrets are printed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
