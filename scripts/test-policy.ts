/**
 * Checks the change policy against the cases it exists for.
 *
 * Run with `npm run test:policy`. No framework: the project has none, and one
 * file that prints what it checked is easier to trust than a dependency.
 */
import {
  DEFAULT_CAPS,
  evaluate,
  isBlocked,
  type Caps,
  type ChangeContext,
  type ChangeRequest,
} from "../src/lib/control/policy";

const base: ChangeContext = {
  campaignName: "Toowoomba Sofas",
  currentDailyBudget: 100,
  currentStatus: "enabled",
  accountDailyBudget: 1000,
  changesToday: 0,
};

let passed = 0;
let failed = 0;

function check(
  label: string,
  request: ChangeRequest,
  context: Partial<ChangeContext>,
  expect: { blocked: boolean; code?: string },
  caps: Caps = DEFAULT_CAPS,
): void {
  const findings = evaluate(request, { ...base, ...context }, caps);
  const blocked = isBlocked(findings);
  const codes = findings.map((f) => f.code);

  const blockedOk = blocked === expect.blocked;
  const codeOk = expect.code === undefined || codes.includes(expect.code);

  if (blockedOk && codeOk) {
    passed += 1;
    console.log(`PASS  ${label}`);
    if (codes.length > 0) console.log(`        ${codes.join(", ")}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`);
    console.log(`        expected blocked=${expect.blocked}${expect.code ? ` code=${expect.code}` : ""}`);
    console.log(`        got      blocked=${blocked} codes=[${codes.join(", ")}]`);
    for (const f of findings) console.log(`        - ${f.severity}: ${f.message}`);
  }
}

console.log("\nBudget changes\n");

check("a modest rise is allowed", { action: "set_budget", dailyBudget: 120 }, {}, { blocked: false });

check(
  "a rise past the per-change limit is blocked",
  { action: "set_budget", dailyBudget: 200 },
  {},
  { blocked: true, code: "increase_too_large" },
);

check(
  "a rise past the per-campaign cap is blocked",
  { action: "set_budget", dailyBudget: 900 },
  { currentDailyBudget: 800 },
  { blocked: true, code: "above_campaign_cap" },
);

check(
  "a cut below the floor is blocked, and says to pause instead",
  { action: "set_budget", dailyBudget: 2 },
  {},
  { blocked: true, code: "below_floor" },
);

check(
  "zero is blocked rather than treated as a pause",
  { action: "set_budget", dailyBudget: 0 },
  {},
  { blocked: true, code: "budget_not_positive" },
);

check(
  "a negative budget is blocked",
  { action: "set_budget", dailyBudget: -50 },
  {},
  { blocked: true, code: "budget_not_positive" },
);

check(
  "a drastic cut is blocked",
  { action: "set_budget", dailyBudget: 10 },
  {},
  { blocked: true, code: "decrease_too_large" },
);

check(
  "a missing budget is blocked",
  { action: "set_budget" },
  {},
  { blocked: true, code: "budget_missing" },
);

check(
  "NaN is blocked rather than compared",
  { action: "set_budget", dailyBudget: Number.NaN },
  {},
  { blocked: true, code: "budget_missing" },
);

console.log("\nAccount ceiling\n");

// 4990 - 100 + 140 = 5030, over the 5000 ceiling, while +40% stays inside the
// per-change limit — so the ceiling is the only thing that can refuse this.
check(
  "a change that takes the account over its ceiling is blocked",
  { action: "set_budget", dailyBudget: 140 },
  { currentDailyBudget: 100, accountDailyBudget: 4990 },
  { blocked: true, code: "account_ceiling" },
);

check(
  "the campaign's own current budget is not double counted",
  { action: "set_budget", dailyBudget: 110 },
  { currentDailyBudget: 100, accountDailyBudget: 4990 },
  { blocked: false },
);

console.log("\nRate limiting\n");

check(
  "a fourth change in a day is blocked",
  { action: "set_budget", dailyBudget: 110 },
  { changesToday: 3 },
  { blocked: true, code: "too_many_changes" },
);

check("a third change in a day is allowed", { action: "set_budget", dailyBudget: 110 }, { changesToday: 2 }, { blocked: false });

console.log("\nPause and resume\n");

check("pausing is allowed", { action: "pause" }, {}, { blocked: false });

check(
  "pausing something already paused warns but is not blocked",
  { action: "pause" },
  { currentStatus: "paused" },
  { blocked: false, code: "already_paused" },
);

check(
  "resuming is allowed when there is room",
  { action: "resume" },
  { currentStatus: "paused", accountDailyBudget: 1000 },
  { blocked: false },
);

check(
  "resuming is blocked when it would breach the account ceiling",
  { action: "resume" },
  { currentStatus: "paused", currentDailyBudget: 200, accountDailyBudget: 4900 },
  { blocked: true, code: "account_ceiling" },
);

console.log("\nSwitches\n");

check(
  "an action switched off is blocked",
  { action: "set_budget", dailyBudget: 110 },
  {},
  { blocked: true, code: "action_not_allowed" },
  { ...DEFAULT_CAPS, allow: { ...DEFAULT_CAPS.allow, set_budget: false } },
);

console.log("\nUnknown current budget\n");

check(
  "an unknown current budget warns but does not block a change within the caps",
  { action: "set_budget", dailyBudget: 150 },
  { currentDailyBudget: null },
  { blocked: false, code: "no_current_budget" },
);

check(
  "an unknown current budget still cannot exceed the per-campaign cap",
  { action: "set_budget", dailyBudget: 900 },
  { currentDailyBudget: null },
  { blocked: true, code: "above_campaign_cap" },
);

console.log("\nWarnings that should not block\n");

check(
  "a large step up against recent spend warns only",
  { action: "set_budget", dailyBudget: 120 },
  { currentDailyBudget: 100, spendLast7Days: 200 },
  { blocked: false, code: "large_step_up" },
);

console.log("\nEvery breach is reported, not just the first\n");

{
  const findings = evaluate(
    { action: "set_budget", dailyBudget: 4000 },
    { ...base, currentDailyBudget: 100, accountDailyBudget: 4900, changesToday: 5 },
  );
  const codes = findings.map((f) => f.code).sort();
  const want = ["above_campaign_cap", "account_ceiling", "increase_too_large", "too_many_changes"].sort();
  const ok = want.every((c) => codes.includes(c));
  if (ok) {
    passed += 1;
    console.log(`PASS  four separate breaches all reported`);
    console.log(`        ${codes.join(", ")}`);
  } else {
    failed += 1;
    console.log(`FAIL  four separate breaches all reported`);
    console.log(`        want ${want.join(", ")}`);
    console.log(`        got  ${codes.join(", ")}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
