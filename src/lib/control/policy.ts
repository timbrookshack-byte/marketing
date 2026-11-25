/**
 * What a change is allowed to be.
 *
 * The portal could already pause a campaign and move a budget, with nothing
 * between the request and the ad account. A person clicking a button is its
 * own check; an assistant proposing a change is not, and the failure mode is
 * not a wrong number but a wrong number applied at four in the morning to the
 * campaign carrying most of the spend.
 *
 * So the limits live here, apart from both the thing that proposes a change
 * and the thing that applies it, and they are evaluated twice: when a proposal
 * is made, so the proposer is told immediately, and again at the moment of
 * applying, because an approval can sit for hours while the account moves
 * underneath it.
 *
 * Nothing here talks to a platform or a database. It takes the numbers and
 * returns a verdict, which is what makes it testable against the cases that
 * actually matter.
 */

export type ChangeAction = "pause" | "resume" | "set_budget";

export interface Caps {
  /** Hard ceiling for any one campaign's daily budget. */
  maxDailyBudget: number;
  /** Floor, so a campaign cannot be throttled to nothing by accident. */
  minDailyBudget: number;
  /** How far a single change may raise a budget, as a percentage of current. */
  maxIncreasePercent: number;
  /** How far a single change may cut a budget, as a percentage of current. */
  maxDecreasePercent: number;
  /** Ceiling for the sum of every active campaign's daily budget. */
  maxAccountDailyBudget: number;
  /** How many changes one campaign may receive in a rolling day. */
  maxChangesPerCampaignPerDay: number;
  /** Which actions may be proposed at all. */
  allow: Record<ChangeAction, boolean>;
  /** How long an approved-but-unapplied proposal stays valid, in hours. */
  proposalTtlHours: number;
}

/**
 * Deliberately conservative. These are what applies until someone sets their
 * own, and the cost of them being too tight is a refused proposal and a
 * message saying which cap refused it. The cost of them being too loose is
 * paid in spend.
 */
export const DEFAULT_CAPS: Caps = {
  maxDailyBudget: 500,
  minDailyBudget: 5,
  maxIncreasePercent: 50,
  maxDecreasePercent: 80,
  maxAccountDailyBudget: 5000,
  maxChangesPerCampaignPerDay: 3,
  allow: { pause: true, resume: true, set_budget: true },
  proposalTtlHours: 24,
};

export type Severity = "block" | "warn";

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
}

export interface ChangeRequest {
  action: ChangeAction;
  /** Required for set_budget; the proposed new daily budget. */
  dailyBudget?: number;
}

export interface ChangeContext {
  campaignName: string;
  /** The campaign's current daily budget, null when the platform reports none. */
  currentDailyBudget: number | null;
  currentStatus: string;
  /** Sum of daily budgets across active campaigns, this one included. */
  accountDailyBudget: number;
  /** Changes already applied to this campaign in the last 24 hours. */
  changesToday: number;
  /** Spend over the last 7 days, used only to warn about unusually large moves. */
  spendLast7Days?: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Evaluates a change against the caps.
 *
 * Returns every finding rather than the first, because a proposal that breaks
 * three limits should say so once instead of over three rejected attempts.
 */
export function evaluate(
  request: ChangeRequest,
  context: ChangeContext,
  caps: Caps = DEFAULT_CAPS,
): Finding[] {
  const findings: Finding[] = [];

  if (!caps.allow[request.action]) {
    findings.push({
      severity: "block",
      code: "action_not_allowed",
      message: `${request.action} is switched off in the change policy.`,
    });
    // No point judging the numbers on an action that cannot be made at all.
    return findings;
  }

  if (request.action === "pause") {
    if (context.currentStatus === "paused") {
      findings.push({
        severity: "warn",
        code: "already_paused",
        message: `${context.campaignName} is already paused.`,
      });
    }
    return findings;
  }

  if (request.action === "resume") {
    if (context.currentStatus !== "paused") {
      findings.push({
        severity: "warn",
        code: "not_paused",
        message: `${context.campaignName} is not paused, so resuming changes nothing.`,
      });
      return findings;
    }
    // Resuming puts this campaign's budget back into the account total.
    const restored = context.accountDailyBudget + (context.currentDailyBudget ?? 0);
    if (restored > caps.maxAccountDailyBudget) {
      findings.push({
        severity: "block",
        code: "account_ceiling",
        message:
          `Resuming would take the account to $${round(restored)} a day, over the ` +
          `$${caps.maxAccountDailyBudget} ceiling.`,
      });
    }
    return findings;
  }

  // set_budget from here down.
  const next = request.dailyBudget;

  if (next === undefined || !Number.isFinite(next)) {
    findings.push({
      severity: "block",
      code: "budget_missing",
      message: "A budget change needs a daily budget.",
    });
    return findings;
  }

  if (next <= 0) {
    findings.push({
      severity: "block",
      code: "budget_not_positive",
      message: "A daily budget must be greater than zero. To stop spend, pause instead.",
    });
    return findings;
  }

  if (next > caps.maxDailyBudget) {
    findings.push({
      severity: "block",
      code: "above_campaign_cap",
      message: `$${round(next)} a day is over the $${caps.maxDailyBudget} per-campaign cap.`,
    });
  }

  if (next < caps.minDailyBudget) {
    findings.push({
      severity: "block",
      code: "below_floor",
      message:
        `$${round(next)} a day is under the $${caps.minDailyBudget} floor. ` +
        `To stop spend, pause instead.`,
    });
  }

  const current = context.currentDailyBudget;

  if (current === null) {
    findings.push({
      severity: "warn",
      code: "no_current_budget",
      message:
        `No current daily budget is recorded for ${context.campaignName}, so the size of ` +
        `this change cannot be checked. It may be set at ad set level.`,
    });
  } else if (current > 0) {
    const delta = ((next - current) / current) * 100;

    if (delta > caps.maxIncreasePercent) {
      findings.push({
        severity: "block",
        code: "increase_too_large",
        message:
          `That raises the budget ${round(delta)}%, over the ${caps.maxIncreasePercent}% ` +
          `limit for one change ($${round(current)} to $${round(next)}).`,
      });
    }

    if (-delta > caps.maxDecreasePercent) {
      findings.push({
        severity: "block",
        code: "decrease_too_large",
        message:
          `That cuts the budget ${round(-delta)}%, over the ${caps.maxDecreasePercent}% ` +
          `limit for one change ($${round(current)} to $${round(next)}).`,
      });
    }
  }

  // The account total with this campaign's new budget swapped in.
  const projected = context.accountDailyBudget - (current ?? 0) + next;
  if (projected > caps.maxAccountDailyBudget) {
    findings.push({
      severity: "block",
      code: "account_ceiling",
      message:
        `That takes the account to $${round(projected)} a day, over the ` +
        `$${caps.maxAccountDailyBudget} ceiling.`,
    });
  }

  if (context.changesToday >= caps.maxChangesPerCampaignPerDay) {
    findings.push({
      severity: "block",
      code: "too_many_changes",
      message:
        `${context.campaignName} has already had ${context.changesToday} changes today, ` +
        `at the limit of ${caps.maxChangesPerCampaignPerDay}. Platforms need time to ` +
        `relearn after a budget move.`,
    });
  }

  // Not a limit, just worth saying out loud on the approval screen.
  if (context.spendLast7Days !== undefined && current !== null && next > current) {
    const weeklyAtNewRate = next * 7;
    if (context.spendLast7Days > 0 && weeklyAtNewRate > context.spendLast7Days * 2) {
      findings.push({
        severity: "warn",
        code: "large_step_up",
        message:
          `At $${round(next)} a day this campaign would spend about ` +
          `$${round(weeklyAtNewRate)} a week, against $${round(context.spendLast7Days)} ` +
          `over the last seven days.`,
      });
    }
  }

  return findings;
}

export function isBlocked(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "block");
}
