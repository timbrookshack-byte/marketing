import { clamp, safeDiv } from "../util";
import type { AnalysisSettings, CampaignPerformance } from "./metrics";

/**
 * Budget reallocation.
 *
 * The question "where should the next dollar go?" is not answered by ranking
 * campaigns on ROAS. ROAS is an *average*; budget decisions are made at the
 * *margin*. A campaign returning 6x on its last dollar deserves more money than
 * one averaging 8x whose next dollar returns 2x, and average ROAS cannot tell
 * those apart.
 *
 * So each campaign gets a response curve — revenue = k * spend^alpha, with
 * alpha below 1 encoding diminishing returns — fitted through its observed
 * point. Budget is then allocated so the *marginal* return is equal everywhere,
 * which is the allocation that maximises total profit. The solver is a
 * bisection on the marginal-return level, which is well behaved because total
 * spend decreases monotonically as the required marginal return rises.
 */

/**
 * Response curve exponent. 0.7 is the conservative middle of the range usually
 * measured in paid media: doubling spend buys roughly 1.6x the volume. Lower is
 * more pessimistic about scaling.
 */
const DEFAULT_ALPHA = 0.7;

export interface ReallocationLine {
  campaignId: string;
  campaignName: string;
  platform: string;
  currentDailySpend: number;
  proposedDailySpend: number;
  changePct: number;
  currentRoas: number;
  /** Return on the next dollar at the current spend level, not the average. */
  marginalRoas: number;
  projectedMonthlyProfitDelta: number;
  reason: string;
  locked: boolean;
}

export interface ReallocationPlan {
  lines: ReallocationLine[];
  totalDailyBudget: number;
  /** Extra gross profit per month if the plan is followed, after diminishing returns. */
  projectedMonthlyProfitDelta: number;
  /** Dollars per month moved out of losing campaigns. */
  monthlyWasteFreed: number;
  assumptions: string[];
}

interface Curve {
  item: CampaignPerformance;
  dailySpend: number;
  /** revenue = k * spend^alpha */
  k: number;
  eligible: boolean;
  reason: string;
}

/** Revenue at a given daily spend, per the fitted curve. */
function revenueAt(curve: Curve, dailySpend: number, alpha: number): number {
  if (dailySpend <= 0) return 0;
  return curve.k * Math.pow(dailySpend, alpha);
}

/** Spend that makes the marginal profit per dollar equal `lambda`. */
function spendForMarginal(curve: Curve, lambda: number, alpha: number, grossMargin: number): number {
  // d(profit)/d(spend) = grossMargin * alpha * k * s^(alpha-1) - 1 = lambda
  const numerator = grossMargin * alpha * curve.k;
  const target = lambda + 1;
  if (numerator <= 0 || target <= 0) return 0;
  return Math.pow(numerator / target, 1 / (1 - alpha));
}

export interface OptimizeOptions {
  settings: AnalysisSettings;
  windowDays: number;
  /** Total daily budget to allocate. Defaults to what is being spent today. */
  totalDailyBudget?: number;
  /** Cap on how far any one campaign may move in a single step. */
  maxChangePct?: number;
  alpha?: number;
}

export function optimiseBudgets(
  campaigns: CampaignPerformance[],
  options: OptimizeOptions,
): ReallocationPlan {
  const { settings, windowDays } = options;
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const maxChangePct = options.maxChangePct ?? 0.4;
  const breakEvenRoas = safeDiv(1, settings.grossMargin, 1);

  const curves: Curve[] = campaigns.map((item) => {
    const dailySpend = safeDiv(item.totals.spend, windowDays);
    const dailyRevenue = safeDiv(item.totals.attributedRevenue, windowDays);

    // Campaigns without enough evidence keep their current budget rather than
    // being moved on a number we do not believe.
    let eligible = true;
    let reason = "";

    if (dailySpend <= 0) {
      eligible = false;
      reason = "No spend in the window";
    } else if (item.campaign.status !== "active") {
      eligible = false;
      reason = "Not currently running";
    } else if (item.totals.attributedOrders < settings.minOrdersForConfidence && dailyRevenue > 0) {
      eligible = false;
      reason = `Only ${item.totals.attributedOrders} attributed orders — too few to reallocate on`;
    }

    const k = dailySpend > 0 ? dailyRevenue / Math.pow(dailySpend, alpha) : 0;
    return { item, dailySpend, k, eligible, reason };
  });

  // Three outcomes per campaign, decided before any maths runs:
  //   optimise — resize it on its response curve
  //   hold     — leave the budget alone (not enough evidence to move it)
  //   stop     — no budget level makes it work, so it goes to zero and its
  //              money becomes the pool everyone else competes for
  const stopped = new Set<string>();

  for (const curve of curves) {
    if (!curve.eligible) continue;

    const { derived, totals } = curve.item;
    const enoughEvidence = totals.attributedOrders >= settings.minOrdersForConfidence;

    // A campaign whose sales mostly cannot be traced looks unprofitable whether
    // or not it is. Cutting it would be acting on a measurement failure, so it
    // holds its budget until the tracking is fixed.
    if (derived.claimRatio > 3) {
      curve.eligible = false;
      curve.reason = `Only a fraction of its sales are traceable (platform claims ${derived.claimRatio.toFixed(1)}x the tracked revenue) — fix attribution before resizing`;
      continue;
    }

    if (enoughEvidence && derived.roas < breakEvenRoas) {
      curve.eligible = false;
      curve.reason = `ROAS ${derived.roas.toFixed(2)} is below break-even ${breakEvenRoas.toFixed(2)} — stop it, do not resize it`;
      curve.k = 0;
      stopped.add(curve.item.campaign.id);
      continue;
    }

    // Zero orders is its own kind of evidence once the click volume is large
    // enough. This mirrors the rule-of-three test the diagnostics use, so the
    // optimiser and the findings never disagree about the same campaign.
    if (totals.attributedOrders === 0 && derived.clicks >= 100) {
      curve.eligible = false;
      curve.reason = `${derived.clicks.toLocaleString()} clicks and no attributed orders — stop it, there is no budget level that fixes this`;
      curve.k = 0;
      stopped.add(curve.item.campaign.id);
    }
  }

  const lockedSpend = curves
    .filter((c) => !c.eligible && c.k > 0)
    .reduce((acc, c) => acc + c.dailySpend, 0);
  const currentTotal = curves.reduce((acc, c) => acc + c.dailySpend, 0);
  const totalBudget = options.totalDailyBudget ?? currentTotal;
  const poolBudget = Math.max(0, totalBudget - lockedSpend);

  const eligible = curves.filter((c) => c.eligible && c.k > 0);

  // Bisect on lambda: higher required marginal profit means less total spend.
  let low = -0.99;
  let high = 50;
  let allocation = new Map<string, number>();

  for (let i = 0; i < 80; i += 1) {
    const lambda = (low + high) / 2;
    let total = 0;
    allocation = new Map();
    for (const curve of eligible) {
      const raw = spendForMarginal(curve, lambda, alpha, settings.grossMargin);
      // Never move a campaign more than one step in one go: these are estimates,
      // and the platforms' own learning phases punish large jumps.
      const bounded = clamp(
        raw,
        curve.dailySpend * (1 - maxChangePct),
        curve.dailySpend * (1 + maxChangePct),
      );
      allocation.set(curve.item.campaign.id, bounded);
      total += bounded;
    }
    if (Math.abs(total - poolBudget) < Math.max(1, poolBudget * 0.001)) break;
    if (total > poolBudget) low = lambda;
    else high = lambda;
  }

  const lines: ReallocationLine[] = curves.map((curve) => {
    const proposed = stopped.has(curve.item.campaign.id)
      ? 0
      : curve.eligible
        ? (allocation.get(curve.item.campaign.id) ?? curve.dailySpend)
        : curve.dailySpend;

    const currentRevenue = revenueAt(curve, curve.dailySpend, alpha);
    const proposedRevenue = revenueAt(curve, proposed, alpha);
    const profitDelta =
      (proposedRevenue - currentRevenue) * settings.grossMargin - (proposed - curve.dailySpend);

    // Marginal ROAS: revenue from the next dollar at today's spend level.
    const marginalRoas =
      curve.dailySpend > 0 ? alpha * curve.k * Math.pow(curve.dailySpend, alpha - 1) : 0;

    const changePct = safeDiv(proposed - curve.dailySpend, curve.dailySpend);

    let reason: string;
    if (!curve.eligible) {
      reason = curve.reason;
    } else if (changePct > 0.02) {
      reason = `Next dollar returns ${marginalRoas.toFixed(2)} — above the portfolio's clearing rate`;
    } else if (changePct < -0.02) {
      reason = `Next dollar returns only ${marginalRoas.toFixed(2)} — below what the same dollar earns elsewhere`;
    } else {
      reason = "Already at its efficient level";
    }

    return {
      campaignId: curve.item.campaign.id,
      campaignName: curve.item.campaign.name,
      platform: curve.item.campaign.platform,
      currentDailySpend: curve.dailySpend,
      proposedDailySpend: proposed,
      changePct,
      currentRoas: curve.item.derived.roas,
      marginalRoas,
      projectedMonthlyProfitDelta: profitDelta * 30,
      reason,
      locked: !curve.eligible,
    };
  });

  const monthlyWasteFreed = lines
    .filter((line) => line.proposedDailySpend === 0 && line.currentDailySpend > 0)
    .reduce((acc, line) => acc + line.currentDailySpend * 30, 0);

  return {
    lines: lines.sort((a, b) => b.projectedMonthlyProfitDelta - a.projectedMonthlyProfitDelta),
    totalDailyBudget: totalBudget,
    projectedMonthlyProfitDelta: lines.reduce((acc, l) => acc + l.projectedMonthlyProfitDelta, 0),
    monthlyWasteFreed,
    assumptions: [
      `Response curves use revenue = k x spend^${alpha}, so a doubling of spend is assumed to return about ${Math.pow(2, alpha).toFixed(2)}x the revenue, not 2x.`,
      `Gross margin ${(settings.grossMargin * 100).toFixed(0)}%, so break-even ROAS is ${breakEvenRoas.toFixed(2)}.`,
      `No campaign moves more than ${Math.round(maxChangePct * 100)}% in one step — these are estimates, and large jumps reset platform learning.`,
      `Campaigns with fewer than ${settings.minOrdersForConfidence} attributed orders are held at their current budget rather than resized on thin data.`,
      `Curves are fitted through a single observed point per campaign. They are directionally useful, not a forecast — re-run after each change.`,
    ],
  };
}
