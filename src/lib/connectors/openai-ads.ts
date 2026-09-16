import { bearer, request } from "./http";
import type { AdsConnector, ConnectorContext, EntitySnapshot, RemoteAccount } from "./types";
import type { DateRange, MetricRow } from "../types";
import { stableId } from "../util";

/**
 * OpenAI Ads — PROVISIONAL.
 *
 * Read this before wiring it to a live account. At the time this connector was
 * written there is no publicly documented, stable OpenAI advertising API whose
 * request and response shapes I can verify, so the mapping below is written
 * against a declared contract rather than against published docs. Everything
 * platform-specific is therefore configurable:
 *
 *   OPENAI_ADS_API_BASE   base URL (default https://api.openai.com/v1/ads)
 *   OPENAI_ADS_API_KEY    bearer token
 *
 * The connector expects these four endpoints and the field names in
 * `EXPECTED_SHAPE` below. When the real API ships, the only work is renaming
 * fields in the three `map*` functions — the rest of the portal is unaffected
 * because it only ever sees the normalised `MetricRow`.

 */

const API_BASE = process.env.OPENAI_ADS_API_BASE ?? "https://api.openai.com/v1/ads";

/** The contract this connector is written against. Kept next to the code it drives. */
export const EXPECTED_SHAPE = {
  accounts: "GET /accounts -> { data: [{ id, name, currency, timezone }] }",
  campaigns:
    "GET /accounts/{id}/campaigns -> { data: [{ id, name, status, objective, daily_budget, start_date, end_date }] }",
  creatives:
    "GET /accounts/{id}/creatives -> { data: [{ id, campaign_id, ad_group_id, name, status, headline, body, cta, landing_page, format }] }",
  reporting:
    "GET /accounts/{id}/reports?start_date&end_date&granularity=daily&breakdown=creative " +
    "-> { data: [{ date, campaign_id, ad_group_id, creative_id, impressions, clicks, spend, conversions, conversion_value, currency }] }",
} as const;

function headers(ctx: ConnectorContext): Record<string, string> {
  const key = (ctx.credentials.apiKey as string) ?? process.env.OPENAI_ADS_API_KEY;
  return bearer(key ?? ctx.credentials.accessToken);
}

function accountId(ctx: ConnectorContext): string {
  const id = ctx.externalAccountId;
  if (!id) throw new Error("No OpenAI Ads account selected for this connection");
  return id;
}

const STATUS_MAP: Record<string, "active" | "paused" | "ended" | "draft"> = {
  active: "active",
  running: "active",
  paused: "paused",
  ended: "ended",
  completed: "ended",
  draft: "draft",
};

function mapStatus(value: string | undefined): "active" | "paused" | "ended" | "draft" {
  return STATUS_MAP[(value ?? "").toLowerCase()] ?? "paused";
}

interface Envelope<T> {
  data?: T[];
}

export const openAiAdsConnector: AdsConnector = {
  platform: "openai_ads",
  kind: "ads",
  displayName: "OpenAI Ads",
  summary: "Sponsored placements inside assistant conversations and search surfaces.",
  docsUrl: "https://platform.openai.com/docs",
  authType: "api_key",
  requiredEnv: [],
  manualSetup: {
    help:
      "Provisional connector — verify the field names in EXPECTED_SHAPE against the live API " +
      "before trusting these numbers. Set OPENAI_ADS_API_BASE if the base URL differs.",
    fields: [
      { key: "apiKey", label: "API key", placeholder: "sk-...", secret: true, target: "credentials", required: true },
      { key: "account", label: "Account ID", placeholder: "acct_...", target: "account", required: true },
    ],
  },
  provisional: true,
  provisionalNote:
    "Written against a declared contract, not published documentation. Verify the field names in " +
    "EXPECTED_SHAPE against the live API before trusting production numbers.",

  async listAccounts(ctx): Promise<RemoteAccount[]> {
    const response = await request<
      Envelope<{ id: string; name?: string; currency?: string; timezone?: string }>
    >(`${API_BASE}/accounts`, { headers: headers(ctx) });
    return (response.data ?? []).map((a) => ({
      id: a.id,
      name: a.name ?? a.id,
      currency: a.currency ?? "USD",
      timezone: a.timezone,
    }));
  },

  async fetchEntities(ctx): Promise<EntitySnapshot> {
    const id = accountId(ctx);
    const currency = (ctx.config.currency as string) ?? "USD";

    const campaignResponse = await request<
      Envelope<{
        id: string;
        name: string;
        status?: string;
        objective?: string;
        daily_budget?: number;
        start_date?: string;
        end_date?: string;
      }>
    >(`${API_BASE}/accounts/${id}/campaigns`, { headers: headers(ctx) });

    const campaigns = (campaignResponse.data ?? []).map((c) => ({
      connectionId: ctx.connectionId,
      platform: "openai_ads" as const,
      externalId: c.id,
      name: c.name,
      status: mapStatus(c.status),
      objective: c.objective ?? null,
      dailyBudget: c.daily_budget ?? null,
      currency,
      startDate: c.start_date ?? null,
      endDate: c.end_date ?? null,
    }));

    const creativeResponse = await request<
      Envelope<{
        id: string;
        campaign_id: string;
        ad_group_id?: string;
        name?: string;
        status?: string;
        headline?: string;
        body?: string;
        cta?: string;
        landing_page?: string;
        format?: string;
      }>
    >(`${API_BASE}/accounts/${id}/creatives`, { headers: headers(ctx) });

    const creatives = creativeResponse.data ?? [];

    // The contract treats ad groups as optional; when absent, each campaign gets
    // a single implicit group so the entity tree stays uniform.
    const groupKeys = new Map<string, { campaignExternalId: string; externalId: string }>();
    for (const creative of creatives) {
      const groupExternalId = creative.ad_group_id ?? `${creative.campaign_id}-default`;
      groupKeys.set(`${creative.campaign_id}:${groupExternalId}`, {
        campaignExternalId: creative.campaign_id,
        externalId: groupExternalId,
      });
    }

    const adGroups = [...groupKeys.values()].map((g) => ({
      connectionId: ctx.connectionId,
      campaignId: stableId("cmp", ctx.connectionId, g.campaignExternalId),
      externalId: g.externalId,
      name: g.externalId.endsWith("-default") ? "All placements" : g.externalId,
      status: "active" as const,
    }));

    const ads = creatives.map((creative) => {
      const campaignId = stableId("cmp", ctx.connectionId, creative.campaign_id);
      const groupExternalId = creative.ad_group_id ?? `${creative.campaign_id}-default`;
      return {
        adGroupId: stableId("adg", campaignId, groupExternalId),
        campaignId,
        externalId: creative.id,
        name: creative.name ?? creative.headline ?? creative.id,
        format: (creative.format === "video" ? "video" : "conversational") as
          | "video"
          | "conversational",
        status: mapStatus(creative.status),
        headline: creative.headline ?? null,
        body: creative.body ?? null,
        callToAction: creative.cta ?? null,
        landingPage: creative.landing_page ?? null,
        previewUrl: null,
      };
    });

    return { campaigns, adGroups, ads };
  },

  async fetchMetrics(ctx, range: DateRange): Promise<MetricRow[]> {
    const id = accountId(ctx);
    const response = await request<
      Envelope<{
        date: string;
        campaign_id: string;
        ad_group_id?: string;
        creative_id?: string;
        impressions?: number;
        clicks?: number;
        spend?: number;
        conversions?: number;
        conversion_value?: number;
        currency?: string;
      }>
    >(`${API_BASE}/accounts/${id}/reports`, {
      headers: headers(ctx),
      query: {
        start_date: range.start,
        end_date: range.end,
        granularity: "daily",
        breakdown: "creative",
      },
    });

    return (response.data ?? []).map((row) => ({
      date: row.date,
      connectionId: ctx.connectionId,
      platform: "openai_ads" as const,
      campaignExternalId: row.campaign_id,
      adGroupExternalId: row.ad_group_id ?? null,
      adExternalId: row.creative_id ?? null,
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      spend: Number(row.spend ?? 0),
      platformConversions: Number(row.conversions ?? 0),
      platformRevenue: Number(row.conversion_value ?? 0),
      videoViews: 0,
      frequency: 0,
      currency: row.currency ?? "USD",
    }));
  },

  async pauseCampaign(ctx, externalCampaignId) {
    await request(`${API_BASE}/accounts/${accountId(ctx)}/campaigns/${externalCampaignId}`, {
      method: "PATCH",
      headers: headers(ctx),
      body: { status: "paused" },
    });
    return { ok: true, detail: `Campaign ${externalCampaignId} paused in OpenAI Ads` };
  },

  async setCampaignBudget(ctx, externalCampaignId, dailyBudget) {
    await request(`${API_BASE}/accounts/${accountId(ctx)}/campaigns/${externalCampaignId}`, {
      method: "PATCH",
      headers: headers(ctx),
      body: { daily_budget: dailyBudget },
    });
    return { ok: true, detail: `Daily budget set to ${dailyBudget} for ${externalCampaignId}` };
  },
};
