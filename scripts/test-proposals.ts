/**
 * Exercises the proposal lifecycle against a real database.
 *
 * Everything except the platform call itself: the point of these cases is the
 * logic around the call, and the most important of them — the re-check at
 * apply time — refuses before any connector is reached.
 *
 * Run with `npm run test:proposals`.
 */
import { installSqlite } from "../src/lib/sql/node";
import { getDatabase } from "../src/lib/sql";
import { approve, getProposal, listProposals, propose, reject, setCaps, expireStale } from "../src/lib/control/proposals";
import { nowISO } from "../src/lib/util";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`);
  }
  if (detail) console.log(`        ${detail}`);
}

async function seed(): Promise<void> {
  const db = getDatabase();
  await db
    .prepare(
      "INSERT INTO connections (id, platform, kind, display_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(["conn1", "meta_ads", "ads", "Meta Ads", "connected", nowISO()]);

  const rows: [string, string, string, number, string][] = [
    ["cmp_main", "1", "Toowoomba Sofas", 100, "active"],
    ["cmp_other", "2", "Brisbane Dining", 200, "active"],
    ["cmp_paused", "3", "Winter Clearance", 400, "paused"],
  ];
  for (const [id, externalId, name, budget, status] of rows) {
    await db
      .prepare(
        `INSERT INTO campaigns (id, connection_id, platform, external_id, name, status, daily_budget)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run([id, "conn1", "meta_ads", externalId, name, status, budget]);
  }
}

async function main(): Promise<void> {
  installSqlite();
  await seed();

  console.log("\nProposing\n");

  const good = await propose({
    campaignId: "cmp_main",
    action: "set_budget",
    dailyBudget: 120,
    rationale: "ROAS 4.2 over the last 14 days",
    createdBy: "mcp:test",
  });
  check("a change inside the caps is stored", good.proposal !== null && !good.blocked);
  check(
    "the before state is captured for review",
    good.proposal?.before.dailyBudget === 100,
    `before = ${JSON.stringify(good.proposal?.before)}`,
  );
  check("the rationale is kept", good.proposal?.rationale === "ROAS 4.2 over the last 14 days");
  check("it starts pending", good.proposal?.status === "pending");
  check("an expiry is set", typeof good.proposal?.expiresAt === "string");

  const blocked = await propose({
    campaignId: "cmp_main",
    action: "set_budget",
    dailyBudget: 5000,
    createdBy: "mcp:test",
  });
  check("a change over the caps is refused", blocked.blocked && blocked.proposal === null);
  check(
    "the refusal says which cap",
    (blocked.detail ?? "").includes("cap") || (blocked.detail ?? "").includes("limit"),
    blocked.detail,
  );

  const pendingNow = await listProposals("pending");
  check(
    "a refused change is not left on the pending list",
    pendingNow.length === 1,
    `${pendingNow.length} pending`,
  );

  console.log("\nPaused campaigns do not count toward the account total\n");

  // cmp_paused holds 400/day but is paused: active total is 100 + 200 = 300.
  await setCaps({ maxAccountDailyBudget: 350 });
  const withinActive = await propose({
    campaignId: "cmp_main",
    action: "set_budget",
    dailyBudget: 140,
    createdBy: "mcp:test",
  });
  check(
    "a paused campaign's budget is excluded from the ceiling",
    withinActive.proposal !== null,
    withinActive.detail,
  );
  await setCaps({ maxAccountDailyBudget: 5000 });

  console.log("\nThe account moving between proposal and approval\n");

  const standing = await propose({
    campaignId: "cmp_main",
    action: "set_budget",
    dailyBudget: 130,
    createdBy: "mcp:test",
  });
  check("a proposal is standing", standing.proposal !== null);

  // Someone raises another campaign while this one waits for approval.
  await getDatabase()
    .prepare("UPDATE campaigns SET daily_budget = ? WHERE id = ?")
    .run([4900, "cmp_other"]);

  const stale = await approve(standing.proposal!.id, "tim");
  check("approving is refused once the account no longer has room", !stale.ok, stale.detail);
  check(
    "the refusal explains that the account moved",
    (stale.detail ?? "").includes("moved"),
    stale.detail,
  );
  check("the proposal is marked rejected, not left pending", stale.proposal?.status === "rejected");
  check(
    "the re-check findings are stored on the proposal",
    (stale.proposal?.guardrails ?? []).some((f) => f.code === "account_ceiling"),
  );

  await getDatabase()
    .prepare("UPDATE campaigns SET daily_budget = ? WHERE id = ?")
    .run([200, "cmp_other"]);

  console.log("\nExpiry\n");

  const willExpire = await propose({
    campaignId: "cmp_main",
    action: "pause",
    createdBy: "mcp:test",
  });
  await getDatabase()
    .prepare("UPDATE change_proposals SET expires_at = ? WHERE id = ?")
    .run([new Date(Date.now() - 60_000).toISOString(), willExpire.proposal!.id]);

  const expired = await approve(willExpire.proposal!.id, "tim");
  check("an expired proposal cannot be approved", !expired.ok, expired.detail);
  check("it is marked expired", expired.proposal?.status === "expired");

  const swept = await expireStale();
  check("sweeping again finds nothing left to expire", swept === 0, `${swept} swept`);

  console.log("\nRejecting\n");

  const toReject = await propose({
    campaignId: "cmp_main",
    action: "pause",
    createdBy: "mcp:test",
  });
  const rejected = await reject(toReject.proposal!.id, "tim");
  check("rejecting records who decided", rejected?.status === "rejected" && rejected.decidedBy === "tim");

  const afterReject = await approve(toReject.proposal!.id, "tim");
  check("a rejected proposal cannot then be approved", !afterReject.ok, afterReject.detail);

  console.log("\nUnknown targets\n");

  const missing = await propose({ campaignId: "nope", action: "pause", createdBy: "mcp:test" });
  check("an unknown campaign is refused rather than thrown", missing.blocked && missing.proposal === null, missing.detail);

  const noSuch = await approve("prop_does_not_exist", "tim");
  check("approving something that does not exist is refused", !noSuch.ok, noSuch.detail);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();
