import { request } from "./http";
import type { AdsConnector, ConnectorContext, EntitySnapshot, RemoteAccount } from "./types";
import type { DateRange, MetricRow } from "../types";
import { stableId } from "../util";

/**
 * TikTok Ads — Business API.
 *
 * TikTok authenticates with an `Access-Token` header rather than a bearer, and
 * wraps every payload in { code, message, data }, where a non-zero `code` is an
 * error even though the HTTP status is 200 — so we unwrap and check it here.
 */

const API_BASE = `https://business-api.tiktok.com/open_api/${process.env.TIKTOK_ADS_API_VERSION ?? "v1.3"}`;

function headers(ctx: ConnectorContext): Record<string, string> {
  const token = ctx.credentials.accessToken;
  if (!token) throw new Error("Missing TikTok access token");
  return { "Access-Token": token };
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

async function call<T>(
  ctx: ConnectorContext,
  path: string,
  query: Record<string, string | number | undefined>,
): Promise<T> {
  const response = await request<Envelope<T>>(`${API_BASE}${path}`, {
    headers: headers(ctx),
    query,
  });
  if (response.code !== 0) {
    throw new Error(`TikTok API error ${response.code}: ${response.message}`);
  }
  return response.data;
}

function advertiserId(ctx: ConnectorContext): string {
  const id = ctx.externalAccountId;
  if (!id) throw new Error("No TikTok advertiser selected for this connection");
  return id;
}

const STATUS_MAP: Record<string, "active" | "paused" | "ended"> = {
  CAMPAIGN_STATUS_ENABLE: "active",
  CAMPAIGN_STATUS_DISABLE: "paused",
  CAMPAIGN_STATUS_DELETE: "ended",
  ENABLE: "active",
  DISABLE: "paused",
};

export const tiktokAdsConnector: AdsConnector = {
  platform: "tiktok_ads",
  kind: "ads",
  displayName: "TikTok Ads",
  summary: "In-feed video, Spark Ads and TopView placements.",
  docsUrl: "https://business-api.tiktok.com/portal/docs",
  authType: "oauth2",
  requiredEnv: ["TIKTOK_ADS_CLIENT_ID", "TIKTOK_ADS_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://business-api.tiktok.com/portal/auth",
    tokenUrl: `${API_BASE}/oauth2/access_token/`,
    scopes: ["ads.read", "ads.management", "reporting"],
  },

  async listAccounts(ctx): Promise<RemoteAccount[]> {
    const data = await call<{ list?: { advertiser_id: string; advertiser_name?: string }[] }>(
      ctx,
      "/oauth2/advertiser/get/",
      { app_id: process.env.TIKTOK_ADS_CLIENT_ID, secret: process.env.TIKTOK_ADS_CLIENT_SECRET },
    );
    return (data.list ?? []).map((a) => ({
      id: a.advertiser_id,
      name: a.advertiser_name ?? a.advertiser_id,
      currency: "USD",
    }));
  },

  async fetchEntities(ctx): Promise<EntitySnapshot> {
    const id = advertiserId(ctx);
    const currency = (ctx.config.currency as string) ?? "USD";

    const campaignData = await call<{
      list?: {
        campaign_id: string;
        campaign_name: string;
        operation_status?: string;
        objective_type?: string;
        budget?: number;
        budget_mode?: string;
      }[];
    }>(ctx, "/campaign/get/", { advertiser_id: id, page_size: 1000 });

    const campaigns = (campaignData.list ?? []).map((c) => ({
      connectionId: ctx.connectionId,
      platform: "tiktok_ads" as const,
      externalId: c.campaign_id,
      name: c.campaign_name,
      status: STATUS_MAP[c.operation_status ?? ""] ?? "paused",
      objective: c.objective_type ?? null,
      dailyBudget: c.budget_mode === "BUDGET_MODE_DAY" ? (c.budget ?? null) : null,
      currency,
      startDate: null,
      endDate: null,
    }));

    const groupData = await call<{
      list?: { adgroup_id: string; adgroup_name: string; campaign_id: string; operation_status?: string }[];
    }>(ctx, "/adgroup/get/", { advertiser_id: id, page_size: 1000 });

    const adGroups = (groupData.list ?? []).map((g) => ({
      connectionId: ctx.connectionId,
      campaignId: stableId("cmp", ctx.connectionId, g.campaign_id),
      externalId: g.adgroup_id,
      name: g.adgroup_name,
      status: STATUS_MAP[g.operation_status ?? ""] ?? "paused",
    }));

    const adData = await call<{
      list?: {
        ad_id: string;
        ad_name: string;
        adgroup_id: string;
        campaign_id: string;
        operation_status?: string;
        ad_text?: string;
        call_to_action?: string;
        landing_page_url?: string;
      }[];
    }>(ctx, "/ad/get/", { advertiser_id: id, page_size: 1000 });

    const ads = (adData.list ?? []).map((a) => {
      const campaignId = stableId("cmp", ctx.connectionId, a.campaign_id);
      return {
        adGroupId: stableId("adg", campaignId, a.adgroup_id),
        campaignId,
        externalId: a.ad_id,
        name: a.ad_name,
        format: "video" as const,
        status: STATUS_MAP[a.operation_status ?? ""] ?? "paused",
        headline: null,
        body: a.ad_text ?? null,
        callToAction: a.call_to_action ?? null,
        landingPage: a.landing_page_url ?? null,
        previewUrl: null,
      };
    });

    return { campaigns, adGroups, ads };
  },

  async fetchMetrics(ctx, range: DateRange): Promise<MetricRow[]> {
    const data = await call<{
      list?: {
        dimensions: { ad_id?: string; stat_time_day?: string };
        metrics: {
          campaign_id?: string;
          adgroup_id?: string;
          impressions?: string;
          clicks?: string;
          spend?: string;
          conversion?: string;
          total_purchase_value?: string;
          video_play_actions?: string;
          frequency?: string;
        };
      }[];
    }>(ctx, "/report/integrated/get/", {
      advertiser_id: advertiserId(ctx),
      report_type: "BASIC",
      data_level: "AUCTION_AD",
      dimensions: JSON.stringify(["ad_id", "stat_time_day"]),
      metrics: JSON.stringify([
        "campaign_id",
        "adgroup_id",
        "impressions",
        "clicks",
        "spend",
        "conversion",
        "total_purchase_value",
        "video_play_actions",
        "frequency",
      ]),
      start_date: range.start,
      end_date: range.end,
      page_size: 1000,
    });

    return (data.list ?? []).map((row) => ({
      date: (row.dimensions.stat_time_day ?? range.start).slice(0, 10),
      connectionId: ctx.connectionId,
      platform: "tiktok_ads" as const,
      campaignExternalId: row.metrics.campaign_id ?? "unknown",
      adGroupExternalId: row.metrics.adgroup_id ?? null,
      adExternalId: row.dimensions.ad_id ?? null,
      impressions: Number(row.metrics.impressions ?? 0),
      clicks: Number(row.metrics.clicks ?? 0),
      spend: Number(row.metrics.spend ?? 0),
      platformConversions: Number(row.metrics.conversion ?? 0),
      platformRevenue: Number(row.metrics.total_purchase_value ?? 0),
      videoViews: Number(row.metrics.video_play_actions ?? 0),
      frequency: Number(row.metrics.frequency ?? 0),
      currency: (ctx.config.currency as string) ?? "USD",
    }));
  },

  async pauseCampaign(ctx, externalCampaignId) {
    await request(`${API_BASE}/campaign/status/update/`, {
      method: "POST",
      headers: { ...headers(ctx) },
      body: {
        advertiser_id: advertiserId(ctx),
        campaign_ids: [externalCampaignId],
        operation_status: "DISABLE",
      },
    });
    return { ok: true, detail: `Campaign ${externalCampaignId} paused in TikTok Ads` };
  },
};
