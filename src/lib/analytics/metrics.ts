import type { Ad, Campaign, MetricRow, PlatformId, SalesOrder } from "../types";
import { safeDiv, sum } from "../util";

/**
 * Rollups and derived economics.
 *
 * Two revenue numbers travel side by side everywhere in this app and they are
 * deliberately never merged:
 *
 *   platformRevenue   — what the ad network says it drove, using its own
 *                       attribution window. Networks mark their own homework,
 *                       and two networks will happily claim the same sale.
 *   attributedRevenue — real orders from the store, matched back to a campaign
 *                       by click id or UTM. Smaller, later, and the one to
 *                       spend money against.
 *
 * Where a single "truth" is needed we use attributed revenue and say so.
 */

export interface Totals {
  impressions: number;
  clicks: number;
  spend: number;
  platformConversions: number;
  platformRevenue: number;
  attributedRevenue: number;
  attributedOrders: number;
  attributedNewCustomers: number;
  videoViews: number;
}

export interface Derived extends Totals {
  ctr: number;
  cpc: number;
  cpm: number;
  /** Cost per attributed order. */
  cpa: number;
  /** Attributed revenue per dollar of spend. */
  roas: number;
  /** What the ad platform claims, for comparison against roas. */
  platformRoas: number;
  aov: number;
  /** Attributed orders per click. */
  conversionRate: number;
  /** Revenue x margin - spend. The number that actually pays the bills. */
  grossProfit: number;
  /** Gross profit per dollar of spend. Above 0 means the channel pays for itself. */
  profitPerDollar: number;
  /**
   * How much more the platform claims than the store can see, as a ratio.
   * Above ~2 usually means double-counting or broken tracking, not genius.
   */
  claimRatio: number;
}

export interface AnalysisSettings {
  /** Gross margin as a fraction, e.g. 0.62 for a 62% margin business. */
  grossMargin: number;
  /** Break-even is 1/grossMargin; a target above that is the profit goal. */
  targetRoas: number;
  /** Max acceptable cost per order, when the business thinks in CPA not ROAS. */
  targetCpa: number;
  /**
   * Below this many attributed orders in the window, a campaign's rate metrics
   * are treated as noise and no pause is recommended on them alone.
   */
  minOrdersForConfidence: number;
  /** Spend below this in the window is too small to be worth an action. */
  minSpendForAction: number;
  currency: string;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  grossMargin: 0.6,
  targetRoas: 3,
  targetCpa: 60,
  minOrdersForConfidence: 8,
  minSpendForAction: 250,
  currency: "USD",
};

export function emptyTotals(): Totals {
  return {
    impressions: 0,
    clicks: 0,
    spend: 0,
    platformConversions: 0,
    platformRevenue: 0,
    attributedRevenue: 0,
    attributedOrders: 0,
    attributedNewCustomers: 0,
    videoViews: 0,
  };
}

export function addTotals(a: Totals, b: Partial<Totals>): Totals {
  return {
    impressions: a.impressions + (b.impressions ?? 0),
    clicks: a.clicks + (b.clicks ?? 0),
    spend: a.spend + (b.spend ?? 0),
    platformConversions: a.platformConversions + (b.platformConversions ?? 0),
    platformRevenue: a.platformRevenue + (b.platformRevenue ?? 0),
    attributedRevenue: a.attributedRevenue + (b.attributedRevenue ?? 0),
    attributedOrders: a.attributedOrders + (b.attributedOrders ?? 0),
    attributedNewCustomers: a.attributedNewCustomers + (b.attributedNewCustomers ?? 0),
    videoViews: a.videoViews + (b.videoViews ?? 0),
  };
}

export function derive(totals: Totals, settings: AnalysisSettings): Derived {
  const grossProfit = totals.attributedRevenue * settings.grossMargin - totals.spend;
  return {
    ...totals,
    ctr: safeDiv(totals.clicks, totals.impressions),
    cpc: safeDiv(totals.spend, totals.clicks),
    cpm: safeDiv(totals.spend * 1000, totals.impressions),
    cpa: safeDiv(totals.spend, totals.attributedOrders),
    roas: safeDiv(totals.attributedRevenue, totals.spend),
    platformRoas: safeDiv(totals.platformRevenue, totals.spend),
    aov: safeDiv(totals.attributedRevenue, totals.attributedOrders),
    conversionRate: safeDiv(totals.attributedOrders, totals.clicks),
    grossProfit,
    profitPerDollar: safeDiv(grossProfit, totals.spend),
    claimRatio: safeDiv(totals.platformRevenue, totals.attributedRevenue),
  };
}

// ---------------------------------------------------------------- attribution

/**
 * How a store order is traced back to the campaign that paid for it.
 * Ordered by how much we trust each signal.
 */
export type AttributionMethod = "click_id" | "utm_campaign" | "utm_source" | "unattributed";

export interface AttributedOrder {
  order: SalesOrder;
  platform: PlatformId | null;
  campaignId: string | null;
  method: AttributionMethod;
}

/** utm_source values in the wild, mapped to the platform that owns them. */
export const SOURCE_ALIASES: Record<string, PlatformId> = {
  google: "google_ads",
  adwords: "google_ads",
  googleads: "google_ads",
  "google-ads": "google_ads",
  gdn: "google_ads",
  youtube: "google_ads",
  facebook: "meta_ads",
  fb: "meta_ads",
  meta: "meta_ads",
  instagram: "meta_ads",
  ig: "meta_ads",
  openai: "openai_ads",
  chatgpt: "openai_ads",
  "openai-ads": "openai_ads",
  linkedin: "linkedin_ads",
  li: "linkedin_ads",
  tiktok: "tiktok_ads",
  "tiktok-ads": "tiktok_ads",
  bing: "microsoft_ads",
  microsoft: "microsoft_ads",
  msn: "microsoft_ads",
  reddit: "reddit_ads",
  twitter: "x_ads",
  x: "x_ads",
  amazon: "amazon_ads",
  pinterest: "pinterest_ads",
  snapchat: "snapchat_ads",
};

const CLICK_ID_PLATFORMS: Record<string, PlatformId> = {
  google: "google_ads",
  meta: "meta_ads",
  openai: "openai_ads",
  linkedin: "linkedin_ads",
  tiktok: "tiktok_ads",
  microsoft: "microsoft_ads",
  reddit: "reddit_ads",
  x: "x_ads",
  pinterest: "pinterest_ads",
  snapchat: "snapchat_ads",
};

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Matches each order to a campaign.
 *
 * A click id names the platform with certainty but not the campaign, so we
 * still need the UTM to land on one. When the campaign cannot be identified the
 * order is attributed to the platform only, and when even that fails it lands in
 * the unattributed bucket rather than being spread around — guessing here is
 * how dashboards start lying.
 */
export function attributeOrders(orders: SalesOrder[], campaigns: Campaign[]): AttributedOrder[] {
  // Two lookups: by the platform's own campaign id, and by a normalised name,
  // since UTMs carry names far more often than ids.
  const byExternalId = new Map<string, Campaign>();
  const byName = new Map<string, Campaign>();
  for (const campaign of campaigns) {
    byExternalId.set(`${campaign.platform}:${campaign.externalId}`, campaign);
    byExternalId.set(normalise(campaign.externalId), campaign);
    byName.set(normalise(campaign.name), campaign);
  }

  const resolveCampaign = (
    utmCampaign: string | null,
    platform: PlatformId | null,
  ): Campaign | null => {
    if (!utmCampaign) return null;
    const key = normalise(utmCampaign);
    if (platform) {
      const direct = byExternalId.get(`${platform}:${utmCampaign}`);
      if (direct) return direct;
    }
    return byExternalId.get(key) ?? byName.get(key) ?? null;
  };

  return orders.map((order) => {
    const clickPlatform = order.clickIdType ? CLICK_ID_PLATFORMS[order.clickIdType] : undefined;
    const sourcePlatform = order.utmSource ? SOURCE_ALIASES[normalise(order.utmSource)] : undefined;
    const platform = clickPlatform ?? sourcePlatform ?? null;
    const campaign = resolveCampaign(order.utmCampaign, platform);

    if (order.clickId && clickPlatform) {
      return {
        order,
        platform: clickPlatform,
        campaignId: campaign?.id ?? null,
        method: "click_id" as const,
      };
    }
    if (campaign) {
      return { order, platform: campaign.platform, campaignId: campaign.id, method: "utm_campaign" as const };
    }
    if (platform) {
      return { order, platform, campaignId: null, method: "utm_source" as const };
    }
    return { order, platform: null, campaignId: null, method: "unattributed" as const };
  });
}

// ------------------------------------------------------------------- rollups

export interface CampaignPerformance {
  campaign: Campaign;
  totals: Totals;
  derived: Derived;
  /** Daily spend and attributed revenue, oldest first. Drives the sparklines. */
  series: DayPoint[];
}

export interface DayPoint {
  date: string;
  spend: number;
  attributedRevenue: number;
  platformRevenue: number;
  clicks: number;
  impressions: number;
  attributedOrders: number;
}

export interface ChannelPerformance {
  platform: PlatformId;
  totals: Totals;
  derived: Derived;
  campaignCount: number;
  activeCampaignCount: number;
  series: DayPoint[];
}

export interface AdPerformance {
  ad: Ad;
  campaignName: string;
  platform: PlatformId;
  totals: Totals;
  derived: Derived;
}

function blankDay(date: string): DayPoint {
  return {
    date,
    spend: 0,
    attributedRevenue: 0,
    platformRevenue: 0,
    clicks: 0,
    impressions: 0,
    attributedOrders: 0,
  };
}

/**
 * The single pass that turns raw rows into everything the UI and the AI read.
 * Attribution is applied here so campaign, channel and ad views all agree.
 */
export function buildPerformance(input: {
  metrics: MetricRow[];
  campaigns: Campaign[];
  ads: Ad[];
  orders: SalesOrder[];
  settings: AnalysisSettings;
}): {
  campaigns: CampaignPerformance[];
  channels: ChannelPerformance[];
  ads: AdPerformance[];
  portfolio: { totals: Totals; derived: Derived; series: DayPoint[] };
  attribution: AttributedOrder[];
} {
  const { metrics, campaigns, ads, orders, settings } = input;

  const campaignByExternal = new Map<string, Campaign>();
  for (const campaign of campaigns) {
    campaignByExternal.set(`${campaign.connectionId}:${campaign.externalId}`, campaign);
  }

  const attribution = attributeOrders(orders, campaigns);

  // Revenue, order count and new-customer count per campaign and per day.
  const campaignRevenue = new Map<string, { revenue: number; orders: number; newCustomers: number }>();
  const campaignDayRevenue = new Map<string, number>();
  const campaignDayOrders = new Map<string, number>();
  const channelRevenueOnly = new Map<PlatformId, { revenue: number; orders: number; newCustomers: number }>();

  for (const item of attribution) {
    if (item.campaignId) {
      const bucket = campaignRevenue.get(item.campaignId) ?? { revenue: 0, orders: 0, newCustomers: 0 };
      bucket.revenue += item.order.revenue;
      bucket.orders += 1;
      if (item.order.isNewCustomer) bucket.newCustomers += 1;
      campaignRevenue.set(item.campaignId, bucket);

      const day = item.order.orderedAt.slice(0, 10);
      const key = `${item.campaignId}:${day}`;
      campaignDayRevenue.set(key, (campaignDayRevenue.get(key) ?? 0) + item.order.revenue);
      campaignDayOrders.set(key, (campaignDayOrders.get(key) ?? 0) + 1);
    } else if (item.platform) {
      // Known channel, unknown campaign: still counts at channel level.
      const bucket = channelRevenueOnly.get(item.platform) ?? { revenue: 0, orders: 0, newCustomers: 0 };
      bucket.revenue += item.order.revenue;
      bucket.orders += 1;
      if (item.order.isNewCustomer) bucket.newCustomers += 1;
      channelRevenueOnly.set(item.platform, bucket);
    }
  }

  // Ad spend per campaign / per ad / per day.
  const campaignTotals = new Map<string, Totals>();
  const campaignDays = new Map<string, Map<string, DayPoint>>();
  const adTotals = new Map<string, Totals>();

  const adByExternal = new Map<string, Ad>();
  for (const ad of ads) adByExternal.set(`${ad.campaignId}:${ad.externalId}`, ad);

  for (const row of metrics) {
    const campaign = campaignByExternal.get(`${row.connectionId}:${row.campaignExternalId}`);
    if (!campaign) continue;

    campaignTotals.set(
      campaign.id,
      addTotals(campaignTotals.get(campaign.id) ?? emptyTotals(), {
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        platformConversions: row.platformConversions,
        platformRevenue: row.platformRevenue,
        videoViews: row.videoViews,
      }),
    );

    const days = campaignDays.get(campaign.id) ?? new Map<string, DayPoint>();
    const day = days.get(row.date) ?? blankDay(row.date);
    day.spend += row.spend;
    day.platformRevenue += row.platformRevenue;
    day.clicks += row.clicks;
    day.impressions += row.impressions;
    days.set(row.date, day);
    campaignDays.set(campaign.id, days);

    if (row.adExternalId) {
      const ad = adByExternal.get(`${campaign.id}:${row.adExternalId}`);
      if (ad) {
        adTotals.set(
          ad.id,
          addTotals(adTotals.get(ad.id) ?? emptyTotals(), {
            impressions: row.impressions,
            clicks: row.clicks,
            spend: row.spend,
            platformConversions: row.platformConversions,
            platformRevenue: row.platformRevenue,
            videoViews: row.videoViews,
          }),
        );
      }
    }
  }

  const campaignPerformance: CampaignPerformance[] = campaigns.map((campaign) => {
    const revenue = campaignRevenue.get(campaign.id) ?? { revenue: 0, orders: 0, newCustomers: 0 };
    const totals: Totals = {
      ...(campaignTotals.get(campaign.id) ?? emptyTotals()),
      attributedRevenue: revenue.revenue,
      attributedOrders: revenue.orders,
      attributedNewCustomers: revenue.newCustomers,
    };

    const days = campaignDays.get(campaign.id) ?? new Map<string, DayPoint>();
    for (const [key, value] of campaignDayRevenue) {
      const [id, date] = key.split(":");
      if (id !== campaign.id) continue;
      const day = days.get(date) ?? blankDay(date);
      day.attributedRevenue += value;
      day.attributedOrders += campaignDayOrders.get(key) ?? 0;
      days.set(date, day);
    }

    const series = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { campaign, totals, derived: derive(totals, settings), series };
  });

  // Channels aggregate their campaigns, plus any revenue attributed to the
  // channel but not to a specific campaign.
  const channelMap = new Map<PlatformId, ChannelPerformance>();
  for (const item of campaignPerformance) {
    const platform = item.campaign.platform;
    const existing =
      channelMap.get(platform) ??
      ({
        platform,
        totals: emptyTotals(),
        derived: derive(emptyTotals(), settings),
        campaignCount: 0,
        activeCampaignCount: 0,
        series: [],
      } satisfies ChannelPerformance);

    existing.totals = addTotals(existing.totals, item.totals);
    existing.campaignCount += 1;
    if (item.campaign.status === "active") existing.activeCampaignCount += 1;

    const dayMap = new Map(existing.series.map((d) => [d.date, d]));
    for (const day of item.series) {
      const target = dayMap.get(day.date) ?? blankDay(day.date);
      target.spend += day.spend;
      target.attributedRevenue += day.attributedRevenue;
      target.platformRevenue += day.platformRevenue;
      target.clicks += day.clicks;
      target.impressions += day.impressions;
      target.attributedOrders += day.attributedOrders;
      dayMap.set(day.date, target);
    }
    existing.series = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    channelMap.set(platform, existing);
  }

  for (const [platform, bucket] of channelRevenueOnly) {
    const existing = channelMap.get(platform);
    if (!existing) continue;
    existing.totals = addTotals(existing.totals, {
      attributedRevenue: bucket.revenue,
      attributedOrders: bucket.orders,
      attributedNewCustomers: bucket.newCustomers,
    });
  }

  const channels = [...channelMap.values()]
    .map((channel) => ({ ...channel, derived: derive(channel.totals, settings) }))
    .sort((a, b) => b.totals.spend - a.totals.spend);

  const campaignNameById = new Map(campaigns.map((c) => [c.id, c.name]));
  const campaignPlatformById = new Map(campaigns.map((c) => [c.id, c.platform]));

  // Ad-level revenue is apportioned from its campaign by share of clicks: ad
  // platforms do not hand back order-level data at creative level, and clicks
  // are the closest honest proxy. Flagged as apportioned wherever it is shown.
  const clicksByCampaign = new Map<string, number>();
  for (const ad of ads) {
    const totals = adTotals.get(ad.id);
    if (!totals) continue;
    clicksByCampaign.set(ad.campaignId, (clicksByCampaign.get(ad.campaignId) ?? 0) + totals.clicks);
  }

  const adPerformance: AdPerformance[] = ads
    .map((ad) => {
      const base = adTotals.get(ad.id) ?? emptyTotals();
      const campaignClicks = clicksByCampaign.get(ad.campaignId) ?? 0;
      const share = safeDiv(base.clicks, campaignClicks);
      const campaignRev = campaignRevenue.get(ad.campaignId) ?? { revenue: 0, orders: 0, newCustomers: 0 };
      const totals: Totals = {
        ...base,
        attributedRevenue: campaignRev.revenue * share,
        attributedOrders: campaignRev.orders * share,
        attributedNewCustomers: campaignRev.newCustomers * share,
      };
      return {
        ad,
        campaignName: campaignNameById.get(ad.campaignId) ?? "Unknown campaign",
        platform: campaignPlatformById.get(ad.campaignId) ?? ("google_ads" as PlatformId),
        totals,
        derived: derive(totals, settings),
      };
    })
    .sort((a, b) => b.totals.spend - a.totals.spend);

  // Portfolio totals come from campaigns plus channel-only revenue, so no order
  // is counted twice and none is silently dropped.
  const portfolioTotals = channels.reduce((acc, channel) => addTotals(acc, channel.totals), emptyTotals());
  const portfolioDays = new Map<string, DayPoint>();
  for (const channel of channels) {
    for (const day of channel.series) {
      const target = portfolioDays.get(day.date) ?? blankDay(day.date);
      target.spend += day.spend;
      target.attributedRevenue += day.attributedRevenue;
      target.platformRevenue += day.platformRevenue;
      target.clicks += day.clicks;
      target.impressions += day.impressions;
      target.attributedOrders += day.attributedOrders;
      portfolioDays.set(day.date, target);
    }
  }

  return {
    campaigns: campaignPerformance.sort((a, b) => b.totals.spend - a.totals.spend),
    channels,
    ads: adPerformance,
    portfolio: {
      totals: portfolioTotals,
      derived: derive(portfolioTotals, settings),
      series: [...portfolioDays.values()].sort((a, b) => a.date.localeCompare(b.date)),
    },
    attribution,
  };
}

/** Splits a series in half to compare the recent period against the one before. */
export function trend(series: DayPoint[], pick: (day: DayPoint) => number): {
  recent: number;
  previous: number;
  changePct: number;
} {
  if (series.length < 4) return { recent: sum(series, pick), previous: 0, changePct: 0 };
  const midpoint = Math.floor(series.length / 2);
  const previous = sum(series.slice(0, midpoint), pick);
  const recent = sum(series.slice(midpoint), pick);
  return { recent, previous, changePct: previous === 0 ? 0 : (recent - previous) / previous };
}
