import type { Recommendation } from "../types";
import { clamp, safeDiv } from "../util";
import type {
  AdPerformance,
  AnalysisSettings,
  CampaignPerformance,
  ChannelPerformance,
  Derived,
} from "./metrics";
import { trend } from "./metrics";

/**
 * Deterministic findings. Everything here is arithmetic — the same inputs always
 * give the same answers, which is what makes it safe to act on money.
 *
 * The AI layer reads these findings; it does not replace them. Rules decide
 * *what* is wrong and how confident we are; the model explains it, weighs the
 * trade-offs across channels, and proposes the creative response.
 */

type Finding = Omit<Recommendation, "id" | "createdAt" | "status">;

/** Days of data the findings are computed over. */
export interface DiagnosticsInput {
  campaigns: CampaignPerformance[];
  channels: ChannelPerformance[];
  ads: AdPerformance[];
  portfolio: { derived: Derived };
  settings: AnalysisSettings;
  windowDays: number;
}

const toMonthly = (value: number, windowDays: number): number =>
  windowDays > 0 ? (value / windowDays) * 30 : 0;

/** Break-even ROAS: below this a sale costs more than the margin it earns. */
export function breakEvenRoas(settings: AnalysisSettings): number {
  return safeDiv(1, settings.grossMargin, 1);
}

/**
 * Upper bound on the true conversion rate after seeing zero conversions in
 * `clicks` trials — the rule of three, the 95% one-sided bound for a binomial
 * with no successes. If even that optimistic ceiling cannot cover the cost of a
 * click, the campaign is not unlucky, it is uneconomic.
 */
function zeroConversionCeiling(clicks: number): number {
  return clicks > 0 ? 3 / clicks : 1;
}

/** Conversion rate a campaign must hit to break even at its current CPC. */
function breakEvenConversionRate(cpc: number, aov: number, grossMargin: number): number {
  const contributionPerOrder = aov * grossMargin;
  return contributionPerOrder > 0 ? cpc / contributionPerOrder : 1;
}

export function runDiagnostics(input: DiagnosticsInput): Finding[] {
  const { campaigns, channels, ads, portfolio, settings, windowDays } = input;
  const findings: Finding[] = [];
  const breakEven = breakEvenRoas(settings);

  // A portfolio-wide AOV is the fallback for campaigns that have no orders of
  // their own — without it every zero-conversion test would divide by zero.
  const portfolioAov = portfolio.derived.aov > 0 ? portfolio.derived.aov : settings.targetCpa * 2.5;

  for (const item of campaigns) {
    const { campaign, derived, series } = item;
    if (derived.spend < settings.minSpendForAction) continue;

    const monthlySpend = toMonthly(derived.spend, windowDays);
    const aov = derived.aov > 0 ? derived.aov : portfolioAov;

    // ---- 1. Spending with nothing to show for it -------------------------
    if (derived.attributedOrders === 0) {
      const ceiling = zeroConversionCeiling(derived.clicks);
      const needed = breakEvenConversionRate(derived.cpc, aov, settings.grossMargin);
      // Statistically ruled out only when the optimistic ceiling is still below
      // what the campaign would need to break even.
      const ruledOut = derived.clicks >= 100 && ceiling < needed;
      const trackingSuspect = derived.platformConversions > 3;

      findings.push({
        source: "rules",
        scope: "campaign",
        targetId: campaign.id,
        targetName: campaign.name,
        platform: campaign.platform,
        type: trackingSuspect ? "fix_tracking" : "pause",
        severity: ruledOut ? "critical" : "serious",
        title: trackingSuspect
          ? `${campaign.name}: platform reports sales the store cannot see`
          : `${campaign.name}: no attributed orders on ${Math.round(derived.spend).toLocaleString()} of spend`,
        rationale: trackingSuspect
          ? `The platform claims ${derived.platformConversions.toFixed(0)} conversions but no store order carries this campaign's click id or UTM. ` +
            `That is a tracking break far more often than it is a real gap — fix attribution before judging the campaign, because right now it cannot be judged at all.`
          : `${derived.clicks.toLocaleString()} clicks and not one attributed order. ` +
            (ruledOut
              ? `With that many clicks the true conversion rate is below ${(ceiling * 100).toFixed(2)}% with 95% confidence, and this campaign needs ${(needed * 100).toFixed(2)}% just to break even. It cannot get there.`
              : `That is not yet conclusive at this click volume, but the spend is real. Cap it while it proves itself.`),
        expectedMonthlyImpact: monthlySpend,
        confidence: ruledOut ? 0.92 : clamp(derived.clicks / 400, 0.25, 0.7),
        evidence: {
          spend: derived.spend,
          clicks: derived.clicks,
          cpc: derived.cpc,
          platformConversions: derived.platformConversions,
          conversionRateCeiling: ceiling,
          breakEvenConversionRate: needed,
          windowDays,
        },
      });
      continue;
    }

    // ---- 2. Measurement is broken, so nothing else can be judged ---------
    // This has to come before the profitability test. A campaign whose orders
    // mostly fail to carry a click id will always look unprofitable, and
    // pausing it would be acting on a measurement failure rather than a
    // business one.
    if (derived.claimRatio > 3 && derived.spend >= settings.minSpendForAction) {
      const impliedRevenue = derived.platformRevenue * 0.5;
      const impliedRoas = safeDiv(impliedRevenue, derived.spend);
      findings.push({
        source: "rules",
        scope: "campaign",
        targetId: campaign.id,
        targetName: campaign.name,
        platform: campaign.platform,
        type: "fix_tracking",
        severity: "serious",
        title: `${campaign.name}: cannot be judged — only a fraction of its sales are traceable`,
        rationale:
          `The platform reports ${Math.round(derived.platformRevenue).toLocaleString()} in conversion value against ${Math.round(derived.attributedRevenue).toLocaleString()} of matched store orders — a ${derived.claimRatio.toFixed(1)}x gap. ` +
          `On tracked revenue alone this campaign reads at ${derived.roas.toFixed(2)} ROAS and looks like something to cut. ` +
          `Even halving the platform's claim would put it near ${impliedRoas.toFixed(2)}, which changes the decision entirely. ` +
          `Fix the UTM template and check the click id survives every redirect before deciding anything about this campaign — and do not pause it in the meantime.`,
        // Not counted as recoverable money: the value here is avoiding a wrong
        // decision, not a measurable saving.
        expectedMonthlyImpact: 0,
        confidence: 0.8,
        evidence: {
          claimRatio: derived.claimRatio,
          platformRevenue: derived.platformRevenue,
          attributedRevenue: derived.attributedRevenue,
          trackedRoas: derived.roas,
          roasIfHalfTheClaimIsReal: impliedRoas,
          spend: derived.spend,
        },
      });
      continue;
    }

    // ---- 3. Selling, but at a loss ---------------------------------------
    if (derived.roas < breakEven && derived.attributedOrders >= settings.minOrdersForConfidence) {
      const monthlyLoss = toMonthly(-derived.grossProfit, windowDays);
      findings.push({
        source: "rules",
        scope: "campaign",
        targetId: campaign.id,
        targetName: campaign.name,
        platform: campaign.platform,
        type: "pause",
        severity: "critical",
        title: `${campaign.name}: every sale loses money`,
        rationale:
          `ROAS of ${derived.roas.toFixed(2)} against a break-even of ${breakEven.toFixed(2)} at a ${(settings.grossMargin * 100).toFixed(0)}% margin. ` +
          `${derived.attributedOrders} orders is enough to say this is the campaign, not noise. ` +
          `Gross profit over the window is ${Math.round(derived.grossProfit).toLocaleString()} — the campaign is converting and still destroying margin.`,
        expectedMonthlyImpact: monthlyLoss,
        confidence: clamp(0.6 + derived.attributedOrders / 100, 0.6, 0.95),
        evidence: {
          roas: derived.roas,
          breakEvenRoas: breakEven,
          orders: derived.attributedOrders,
          grossProfit: derived.grossProfit,
          spend: derived.spend,
          windowDays,
        },
      });
      continue;
    }

    // ---- 4. Profitable but drifting the wrong way ------------------------
    if (derived.roas < settings.targetRoas && derived.attributedOrders >= settings.minOrdersForConfidence) {
      const spendTrend = trend(series, (d) => d.spend);
      const revenueTrend = trend(series, (d) => d.attributedRevenue);
      const recentRoas = safeDiv(revenueTrend.recent, spendTrend.recent);
      const priorRoas = safeDiv(revenueTrend.previous, spendTrend.previous);
      const deteriorating = priorRoas > 0 && recentRoas < priorRoas * 0.8;

      findings.push({
        source: "rules",
        scope: "campaign",
        targetId: campaign.id,
        targetName: campaign.name,
        platform: campaign.platform,
        type: "reduce_budget",
        severity: deteriorating ? "serious" : "warning",
        title: deteriorating
          ? `${campaign.name}: efficiency falling fast`
          : `${campaign.name}: below target return`,
        rationale: deteriorating
          ? `ROAS has dropped from ${priorRoas.toFixed(2)} to ${recentRoas.toFixed(2)} across the window while spend ${spendTrend.changePct >= 0 ? "rose" : "fell"} ${Math.abs(spendTrend.changePct * 100).toFixed(0)}%. ` +
            `It still clears break-even at ${breakEven.toFixed(2)}, so this is a trim rather than a kill — but the trend, not the level, is the problem.`
          : `ROAS of ${derived.roas.toFixed(2)} against a ${settings.targetRoas.toFixed(1)} target. Profitable but not competitive with the best use of the same dollar.`,
        expectedMonthlyImpact: toMonthly(derived.spend * 0.25 * (settings.targetRoas - derived.roas) / settings.targetRoas, windowDays),
        confidence: deteriorating ? 0.75 : 0.55,
        evidence: {
          roas: derived.roas,
          targetRoas: settings.targetRoas,
          recentRoas,
          priorRoas,
          spendChangePct: spendTrend.changePct,
          orders: derived.attributedOrders,
        },
      });
    }

    // ---- 5. Winners held back by their own budget ------------------------
    const dailySpend = safeDiv(derived.spend, windowDays);
    const budgetCapped =
      campaign.dailyBudget !== null &&
      campaign.dailyBudget > 0 &&
      dailySpend >= campaign.dailyBudget * 0.92;

    if (
      derived.roas >= settings.targetRoas * 1.15 &&
      derived.attributedOrders >= settings.minOrdersForConfidence &&
      campaign.status === "active"
    ) {
      // Extra spend does not return at the current rate. A square-root response
      // curve is the conservative standard assumption: doubling spend buys about
      // 1.41x the volume, so efficiency decays as you scale.
      const scaleFactor = budgetCapped ? 0.35 : 0.2;
      const extraSpend = monthlySpend * scaleFactor;
      const extraRevenue = extraSpend * derived.roas * Math.sqrt(1 / (1 + scaleFactor));
      const extraProfit = extraRevenue * settings.grossMargin - extraSpend;

      findings.push({
        source: "rules",
        scope: "campaign",
        targetId: campaign.id,
        targetName: campaign.name,
        platform: campaign.platform,
        type: "scale_budget",
        severity: "good",
        title: budgetCapped
          ? `${campaign.name}: winning and capped by its budget`
          : `${campaign.name}: room to scale`,
        rationale:
          `ROAS of ${derived.roas.toFixed(2)} on ${derived.attributedOrders} orders, comfortably above the ${settings.targetRoas.toFixed(1)} target. ` +
          (budgetCapped
            ? `Daily spend is sitting at ${Math.round(dailySpend).toLocaleString()} against a ${Math.round(campaign.dailyBudget!).toLocaleString()} cap, so demand is being turned away. Raise the cap ${Math.round(scaleFactor * 100)}% and watch CPA for a week.`
            : `Add ${Math.round(scaleFactor * 100)}% budget in one step, not three — and re-measure before the next increase.`) +
          ` The estimate below already discounts for diminishing returns.`,
        expectedMonthlyImpact: extraProfit,
        confidence: clamp(0.5 + derived.attributedOrders / 120, 0.5, 0.85),
        evidence: {
          roas: derived.roas,
          dailySpend,
          dailyBudget: campaign.dailyBudget,
          budgetCapped,
          proposedIncreasePct: scaleFactor,
          estimatedExtraProfit: extraProfit,
        },
      });
    }

    // ---- 6. Numbers that disagree, but not badly enough to block judgement
    if (
      derived.claimRatio > 2.5 &&
      derived.claimRatio <= 3 &&
      derived.attributedRevenue > 0 &&
      derived.spend > settings.minSpendForAction
    ) {
      findings.push({
        source: "rules",
        scope: "campaign",
        targetId: campaign.id,
        targetName: campaign.name,
        platform: campaign.platform,
        type: "fix_tracking",
        severity: "warning",
        title: `${campaign.name}: platform claims ${derived.claimRatio.toFixed(1)}x the revenue the store recorded`,
        rationale:
          `The network reports ${Math.round(derived.platformRevenue).toLocaleString()} in conversion value; matched store orders total ${Math.round(derived.attributedRevenue).toLocaleString()}. ` +
          `Some gap is normal — view-through windows and cross-device do real work — but ${derived.claimRatio.toFixed(1)}x usually means a broken UTM template or a click id that is being stripped at redirect. ` +
          `Until it is closed, every decision on this campaign is being made on two different sets of books.`,
        expectedMonthlyImpact: 0,
        confidence: 0.7,
        evidence: {
          claimRatio: derived.claimRatio,
          platformRevenue: derived.platformRevenue,
          attributedRevenue: derived.attributedRevenue,
        },
      });
    }
  }

  // ---- 7. Creative fatigue, at ad level ----------------------------------
  const campaignCtr = new Map<string, number>();
  for (const item of campaigns) campaignCtr.set(item.campaign.id, item.derived.ctr);

  for (const item of ads) {
    if (item.totals.spend < settings.minSpendForAction / 2) continue;
    const peerCtr = campaignCtr.get(item.ad.campaignId) ?? 0;
    if (peerCtr <= 0) continue;

    const ratio = safeDiv(item.derived.ctr, peerCtr);
    if (ratio < 0.6 && item.derived.clicks > 50) {
      findings.push({
        source: "rules",
        scope: "ad",
        targetId: item.ad.id,
        targetName: item.ad.name,
        platform: item.platform,
        type: "test_creative",
        severity: "warning",
        title: `${item.ad.name}: ${Math.round((1 - ratio) * 100)}% below its campaign's click-through rate`,
        rationale:
          `CTR of ${(item.derived.ctr * 100).toFixed(2)}% against ${(peerCtr * 100).toFixed(2)}% for the rest of ${item.campaignName}. ` +
          `It is taking ${Math.round(item.totals.spend).toLocaleString()} of budget to deliver worse engagement than the ads beside it. ` +
          `Retire it and put the impressions behind a variant built on a different angle.`,
        expectedMonthlyImpact: toMonthly(item.totals.spend * 0.5, windowDays),
        confidence: clamp(0.4 + item.derived.clicks / 500, 0.4, 0.8),
        evidence: {
          adCtr: item.derived.ctr,
          campaignCtr: peerCtr,
          spend: item.totals.spend,
          clicks: item.derived.clicks,
          note: "Ad-level revenue is apportioned from the campaign by share of clicks.",
        },
      });
    }
  }

  // ---- 8. Concentration risk across channels -----------------------------
  const totalSpend = channels.reduce((acc, c) => acc + c.totals.spend, 0);
  for (const channel of channels) {
    const share = safeDiv(channel.totals.spend, totalSpend);
    if (share > 0.5 && channel.derived.roas < portfolio.derived.roas) {
      findings.push({
        source: "rules",
        scope: "channel",
        targetId: channel.platform,
        targetName: channel.platform,
        platform: channel.platform,
        type: "reallocate",
        severity: "warning",
        title: `${Math.round(share * 100)}% of spend sits in the weakest large channel`,
        rationale:
          `This channel takes ${Math.round(share * 100)}% of the budget and returns ${channel.derived.roas.toFixed(2)} against a portfolio average of ${portfolio.derived.roas.toFixed(2)}. ` +
          `Concentration is only a problem when it is concentration in the below-average option — which it is here.`,
        expectedMonthlyImpact: toMonthly(
          channel.totals.spend * 0.15 * (portfolio.derived.roas - channel.derived.roas) * settings.grossMargin,
          windowDays,
        ),
        confidence: 0.6,
        evidence: {
          spendShare: share,
          channelRoas: channel.derived.roas,
          portfolioRoas: portfolio.derived.roas,
        },
      });
    }
  }

  return findings.sort((a, b) => b.expectedMonthlyImpact - a.expectedMonthlyImpact);
}
