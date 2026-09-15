import { getJsonSetting } from "../db";
import { listAds, listCampaigns, metricsDateBounds, queryMetrics, queryOrders } from "../repo";
import { trailingWindow } from "../util";
import type { DateRange } from "../types";
import {
  DEFAULT_SETTINGS,
  buildPerformance,
  type AdPerformance,
  type AnalysisSettings,
  type AttributedOrder,
  type CampaignPerformance,
  type ChannelPerformance,
  type DayPoint,
  type Derived,
  type Totals,
} from "./metrics";
import { runDiagnostics } from "./diagnostics";
import { optimiseBudgets, type ReallocationPlan } from "./optimizer";
import type { Recommendation } from "../types";

export * from "./metrics";
export * from "./diagnostics";
export * from "./optimizer";

export const SETTINGS_KEY = "analysis_settings";

export function loadSettings(): AnalysisSettings {
  return { ...DEFAULT_SETTINGS, ...getJsonSetting<Partial<AnalysisSettings>>(SETTINGS_KEY, {}) };
}

export interface PortfolioSnapshot {
  range: DateRange;
  windowDays: number;
  settings: AnalysisSettings;
  portfolio: { totals: Totals; derived: Derived; series: DayPoint[] };
  channels: ChannelPerformance[];
  campaigns: CampaignPerformance[];
  ads: AdPerformance[];
  attribution: AttributedOrder[];
  findings: Omit<Recommendation, "id" | "createdAt" | "status">[];
  plan: ReallocationPlan;
  /** True when there is no data at all — the UI shows the empty state instead of zeros. */
  isEmpty: boolean;
}

/**
 * Resolves the window to analyse. Defaults to the last 30 complete days, but
 * falls back to whatever data actually exists so a freshly seeded or partially
 * synced portal still shows something real.
 */
export function resolveRange(days = 30, explicit?: Partial<DateRange>): DateRange {
  if (explicit?.start && explicit?.end) return { start: explicit.start, end: explicit.end };
  const bounds = metricsDateBounds();
  const window = trailingWindow(days);
  if (!bounds.max) return window;
  const end = bounds.max < window.end ? bounds.max : window.end;
  const start = bounds.min && bounds.min > window.start ? bounds.min : window.start;
  // Guard against a window that inverted because the only data is very old.
  return start <= end ? { start, end } : { start: bounds.min ?? window.start, end: bounds.max };
}

export function buildSnapshot(days = 30, explicitRange?: Partial<DateRange>): PortfolioSnapshot {
  const range = resolveRange(days, explicitRange);
  const settings = loadSettings();

  const metrics = queryMetrics(range);
  const campaigns = listCampaigns();
  const ads = listAds();
  const orders = queryOrders(range);

  const performance = buildPerformance({ metrics, campaigns, ads, orders, settings });

  const windowDays = Math.max(
    1,
    Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1,
  );

  const findings = runDiagnostics({
    campaigns: performance.campaigns,
    channels: performance.channels,
    ads: performance.ads,
    portfolio: performance.portfolio,
    settings,
    windowDays,
  });

  const plan = optimiseBudgets(performance.campaigns, { settings, windowDays });

  return {
    range,
    windowDays,
    settings,
    portfolio: performance.portfolio,
    channels: performance.channels,
    campaigns: performance.campaigns,
    ads: performance.ads,
    attribution: performance.attribution,
    findings,
    plan,
    isEmpty: metrics.length === 0 && orders.length === 0,
  };
}

/**
 * A compact, token-cheap view of the snapshot for the AI layer. Sending the raw
 * snapshot would be mostly redundant series data; this keeps the parts a
 * strategist would actually reason over.
 */
export function summariseForModel(snapshot: PortfolioSnapshot, limits = { campaigns: 40, ads: 25 }) {
  const round = (value: number, digits = 2) => Number(value.toFixed(digits));

  return {
    window: { ...snapshot.range, days: snapshot.windowDays },
    settings: {
      grossMarginPct: round(snapshot.settings.grossMargin * 100, 0),
      targetRoas: snapshot.settings.targetRoas,
      targetCpa: snapshot.settings.targetCpa,
      breakEvenRoas: round(1 / snapshot.settings.grossMargin),
      currency: snapshot.settings.currency,
    },
    portfolio: {
      spend: round(snapshot.portfolio.totals.spend, 0),
      attributedRevenue: round(snapshot.portfolio.totals.attributedRevenue, 0),
      platformClaimedRevenue: round(snapshot.portfolio.totals.platformRevenue, 0),
      orders: snapshot.portfolio.totals.attributedOrders,
      roas: round(snapshot.portfolio.derived.roas),
      cpa: round(snapshot.portfolio.derived.cpa),
      grossProfit: round(snapshot.portfolio.derived.grossProfit, 0),
    },
    channels: snapshot.channels.map((channel) => ({
      platform: channel.platform,
      spend: round(channel.totals.spend, 0),
      attributedRevenue: round(channel.totals.attributedRevenue, 0),
      orders: channel.totals.attributedOrders,
      roas: round(channel.derived.roas),
      cpa: round(channel.derived.cpa),
      ctr: round(channel.derived.ctr * 100),
      grossProfit: round(channel.derived.grossProfit, 0),
      claimRatio: round(channel.derived.claimRatio),
      activeCampaigns: channel.activeCampaignCount,
    })),
    campaigns: snapshot.campaigns.slice(0, limits.campaigns).map((item) => ({
      id: item.campaign.id,
      name: item.campaign.name,
      platform: item.campaign.platform,
      status: item.campaign.status,
      objective: item.campaign.objective,
      dailyBudget: item.campaign.dailyBudget,
      spend: round(item.totals.spend, 0),
      attributedRevenue: round(item.totals.attributedRevenue, 0),
      orders: item.totals.attributedOrders,
      newCustomers: round(item.totals.attributedNewCustomers, 0),
      roas: round(item.derived.roas),
      cpa: round(item.derived.cpa),
      ctr: round(item.derived.ctr * 100),
      cpc: round(item.derived.cpc),
      grossProfit: round(item.derived.grossProfit, 0),
      claimRatio: round(item.derived.claimRatio),
    })),
    topAdsBySpend: snapshot.ads.slice(0, limits.ads).map((item) => ({
      id: item.ad.id,
      name: item.ad.name,
      campaign: item.campaignName,
      platform: item.platform,
      format: item.ad.format,
      headline: item.ad.headline,
      body: item.ad.body?.slice(0, 200) ?? null,
      spend: round(item.totals.spend, 0),
      ctr: round(item.derived.ctr * 100),
      cpa: round(item.derived.cpa),
      roas: round(item.derived.roas),
    })),
    ruleFindings: snapshot.findings.map((finding) => ({
      type: finding.type,
      severity: finding.severity,
      target: finding.targetName,
      targetId: finding.targetId,
      platform: finding.platform,
      title: finding.title,
      expectedMonthlyImpact: round(finding.expectedMonthlyImpact, 0),
      confidence: round(finding.confidence),
      evidence: finding.evidence,
    })),
    reallocationPlan: {
      projectedMonthlyProfitDelta: round(snapshot.plan.projectedMonthlyProfitDelta, 0),
      monthlyWasteFreed: round(snapshot.plan.monthlyWasteFreed, 0),
      moves: snapshot.plan.lines
        .filter((line) => Math.abs(line.changePct) > 0.02)
        .slice(0, 20)
        .map((line) => ({
          campaign: line.campaignName,
          platform: line.platform,
          currentDaily: round(line.currentDailySpend, 0),
          proposedDaily: round(line.proposedDailySpend, 0),
          changePct: round(line.changePct * 100, 0),
          marginalRoas: round(line.marginalRoas),
          reason: line.reason,
        })),
      assumptions: snapshot.plan.assumptions,
    },
    attributionCoverage: (() => {
      const total = snapshot.attribution.length;
      const byMethod = { click_id: 0, utm_campaign: 0, utm_source: 0, unattributed: 0 };
      for (const item of snapshot.attribution) byMethod[item.method] += 1;
      return {
        orders: total,
        ...byMethod,
        // The share of revenue we cannot trace is the honest ceiling on how
        // confident any of this analysis can be.
        unattributedPct: total ? round((byMethod.unattributed / total) * 100, 0) : 0,
      };
    })(),
  };
}

export type ModelSummary = ReturnType<typeof summariseForModel>;
