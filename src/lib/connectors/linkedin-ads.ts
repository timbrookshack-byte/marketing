import { bearer, request } from "./http";
import type { AdsConnector, ConnectorContext, EntitySnapshot, RemoteAccount } from "./types";
import type { DateRange, MetricRow } from "../types";
import { stableId } from "../util";

/**
 * LinkedIn Ads — Marketing (Rest.li) API.
 *
 * Two quirks worth knowing: every request needs the `LinkedIn-Version` header,
 * and date ranges are expressed as nested (year, month, day) objects rather
 * than ISO strings, which `dateRangeParam` builds.
 */

const API_BASE = "https://api.linkedin.com/rest";
const VERSION = process.env.LINKEDIN_ADS_API_VERSION ?? "202411";

function headers(ctx: ConnectorContext): Record<string, string> {
  return {
    ...bearer(ctx.credentials.accessToken),
    "LinkedIn-Version": VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

function accountUrn(ctx: ConnectorContext): string {
  const id = ctx.externalAccountId;
  if (!id) throw new Error("No LinkedIn ad account selected for this connection");
  return id.startsWith("urn:") ? id : `urn:li:sponsoredAccount:${id}`;
}

function accountNumericId(ctx: ConnectorContext): string {
  return accountUrn(ctx).split(":").pop()!;
}

function dateRangeParam(range: DateRange): string {
  const [sy, sm, sd] = range.start.split("-").map(Number);
  const [ey, em, ed] = range.end.split("-").map(Number);
  return `(start:(year:${sy},month:${sm},day:${sd}),end:(year:${ey},month:${em},day:${ed}))`;
}

const STATUS_MAP: Record<string, "active" | "paused" | "ended" | "draft"> = {
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "ended",
  COMPLETED: "ended",
  CANCELED: "ended",
  DRAFT: "draft",
};

export const linkedInAdsConnector: AdsConnector = {
  platform: "linkedin_ads",
  kind: "ads",
  displayName: "LinkedIn Ads",
  summary: "B2B sponsored content, message ads and lead gen forms.",
  docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/",
  authType: "oauth2",
  requiredEnv: ["LINKEDIN_ADS_CLIENT_ID", "LINKEDIN_ADS_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["r_ads", "r_ads_reporting", "rw_ads"],
  },

  async listAccounts(ctx): Promise<RemoteAccount[]> {
    const response = await request<{
      elements?: { id: number; name?: string; currency?: string }[];
    }>(`${API_BASE}/adAccounts`, {
      headers: headers(ctx),
      query: { q: "search", "search.status.values[0]": "ACTIVE" },
    });
    return (response.elements ?? []).map((a) => ({
      id: String(a.id),
      name: a.name ?? `Account ${a.id}`,
      currency: a.currency ?? "USD",
    }));
  },

  async fetchEntities(ctx): Promise<EntitySnapshot> {
    const currency = (ctx.config.currency as string) ?? "USD";
    const id = accountNumericId(ctx);

    const groupResponse = await request<{
      elements?: { id: number; name?: string; status?: string; runSchedule?: { start?: number; end?: number } }[];
    }>(`${API_BASE}/adAccounts/${id}/adCampaignGroups`, {
      headers: headers(ctx),
      query: { q: "search" },
    });

    // LinkedIn's "campaign group" is the level advertisers budget at, so it maps
    // to our campaign, and its "campaign" maps to our ad group.
    const campaigns = (groupResponse.elements ?? []).map((g) => ({
      connectionId: ctx.connectionId,
      platform: "linkedin_ads" as const,
      externalId: String(g.id),
      name: g.name ?? `Campaign group ${g.id}`,
      status: STATUS_MAP[g.status ?? ""] ?? "paused",
      objective: null,
      dailyBudget: null,
      currency,
      startDate: g.runSchedule?.start ? new Date(g.runSchedule.start).toISOString().slice(0, 10) : null,
      endDate: g.runSchedule?.end ? new Date(g.runSchedule.end).toISOString().slice(0, 10) : null,
    }));

    const campaignResponse = await request<{
      elements?: {
        id: number;
        name?: string;
        status?: string;
        campaignGroup?: string;
        objectiveType?: string;
        dailyBudget?: { amount?: string };
      }[];
    }>(`${API_BASE}/adAccounts/${id}/adCampaigns`, {
      headers: headers(ctx),
      query: { q: "search" },
    });

    const adGroups = (campaignResponse.elements ?? []).map((c) => ({
      connectionId: ctx.connectionId,
      campaignId: stableId("cmp", ctx.connectionId, c.campaignGroup?.split(":").pop() ?? "0"),
      externalId: String(c.id),
      name: c.name ?? `Campaign ${c.id}`,
      status: STATUS_MAP[c.status ?? ""] ?? "paused",
    }));

    return { campaigns, adGroups, ads: [] };
  },

  async fetchMetrics(ctx, range): Promise<MetricRow[]> {
    const response = await request<{
      elements?: {
        dateRange?: { start?: { year: number; month: number; day: number } };
        pivotValues?: string[];
        impressions?: number;
        clicks?: number;
        costInLocalCurrency?: string;
        externalWebsiteConversions?: number;
        conversionValueInLocalCurrency?: string;
        videoViews?: number;
      }[];
    }>(`${API_BASE}/adAnalytics`, {
      headers: headers(ctx),
      query: {
        q: "analytics",
        pivot: "CAMPAIGN",
        timeGranularity: "DAILY",
        dateRange: dateRangeParam(range),
        accounts: `List(${encodeURIComponent(accountUrn(ctx))})`,
        fields: [
          "dateRange",
          "pivotValues",
          "impressions",
          "clicks",
          "costInLocalCurrency",
          "externalWebsiteConversions",
          "conversionValueInLocalCurrency",
          "videoViews",
        ].join(","),
      },
    });

    return (response.elements ?? []).flatMap((row) => {
      const start = row.dateRange?.start;
      if (!start) return [];
      const date = `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`;
      const campaignUrn = row.pivotValues?.[0] ?? "";
      return [
        {
          date,
          connectionId: ctx.connectionId,
          platform: "linkedin_ads" as const,
          // We pivot on LinkedIn campaigns, which are our ad groups; the parent
          // group is resolved from the entity tree at read time.
          campaignExternalId: campaignUrn.split(":").pop() ?? "unknown",
          adGroupExternalId: null,
          adExternalId: null,
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          spend: Number(row.costInLocalCurrency ?? 0),
          platformConversions: Number(row.externalWebsiteConversions ?? 0),
          platformRevenue: Number(row.conversionValueInLocalCurrency ?? 0),
          videoViews: Number(row.videoViews ?? 0),
          frequency: 0,
          currency: (ctx.config.currency as string) ?? "USD",
        },
      ];
    });
  },
};
