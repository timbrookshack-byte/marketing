import { bearer, request } from "./http";
import type { AdsConnector, ConnectorContext, EntitySnapshot, RemoteAccount } from "./types";
import type { DateRange, MetricRow } from "../types";
import { stableId } from "../util";

/**
 * Meta Ads (Facebook + Instagram) — Graph API.
 *
 * Conversions on Meta are not a single number: the API returns an `actions`
 * array where each entry is an action type. We pick the purchase-shaped ones,
 * which is what an advertiser means by "a conversion", and fall back to leads
 * when a campaign optimises for those instead.
 */

const API_VERSION = process.env.META_ADS_API_VERSION ?? "v21.0";
const API_BASE = `https://graph.facebook.com/${API_VERSION}`;

const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);
const LEAD_ACTIONS = new Set(["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"]);

interface ActionEntry {
  action_type: string;
  value: string;
}

function pickConversions(actions: ActionEntry[] | undefined): number {
  if (!actions) return 0;
  const purchases = actions
    .filter((a) => PURCHASE_ACTIONS.has(a.action_type))
    .reduce((total, a) => total + Number(a.value ?? 0), 0);
  if (purchases > 0) return purchases;
  return actions
    .filter((a) => LEAD_ACTIONS.has(a.action_type))
    .reduce((total, a) => total + Number(a.value ?? 0), 0);
}

function pickRevenue(actionValues: ActionEntry[] | undefined): number {
  if (!actionValues) return 0;
  return actionValues
    .filter((a) => PURCHASE_ACTIONS.has(a.action_type))
    .reduce((total, a) => total + Number(a.value ?? 0), 0);
}

const STATUS_MAP: Record<string, "active" | "paused" | "ended"> = {
  ACTIVE: "active",
  PAUSED: "paused",
  DELETED: "ended",
  ARCHIVED: "ended",
};

/** Graph API paginates with a cursor in `paging.next`; follow it to the end. */
async function paged<T>(url: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  let guard = 0;
  while (next && guard < 50) {
    const page: { data?: T[]; paging?: { next?: string } } = await request(next, {
      headers: bearer(token),
    });
    out.push(...(page.data ?? []));
    next = page.paging?.next;
    guard += 1;
  }
  return out;
}

function accountPath(ctx: ConnectorContext): string {
  const id = ctx.externalAccountId;
  if (!id) throw new Error("No Meta ad account selected for this connection");
  return id.startsWith("act_") ? id : `act_${id}`;
}

export const metaAdsConnector: AdsConnector = {
  platform: "meta_ads",
  kind: "ads",
  displayName: "Meta Ads",
  summary: "Facebook, Instagram, Messenger and Audience Network campaigns.",
  docsUrl: "https://developers.facebook.com/docs/marketing-apis",
  authType: "oauth2",
  requiredEnv: ["META_ADS_CLIENT_ID", "META_ADS_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: `https://www.facebook.com/${API_VERSION}/dialog/oauth`,
    tokenUrl: `${API_BASE}/oauth/access_token`,
    scopes: ["ads_read", "ads_management", "business_management"],
    /*
     * Meta issues no refresh token, and the token the code exchange returns
     * lasts a couple of hours. Left alone, a connection would die before the
     * first useful sync and the generic refresh path — which posts
     * grant_type=refresh_token — would fail with "no refresh token stored".
     *
     * `fb_exchange_token` swaps a valid token for a long-lived one of about
     * sixty days, and works on an already-long-lived token too, so the same
     * call serves both the initial upgrade and every later extension.
     */
    extendToken: async (credentials, client) => {
      const current = credentials.accessToken;
      if (!current) {
        throw new Error("No Meta token to extend — reconnect the account.");
      }

      const response = await request<{
        access_token?: string;
        expires_in?: number;
        error?: { message?: string };
      }>(`${API_BASE}/oauth/access_token`, {
        query: {
          grant_type: "fb_exchange_token",
          client_id: client.clientId,
          client_secret: client.clientSecret,
          fb_exchange_token: current,
        },
      });

      if (!response.access_token) {
        throw new Error(
          `Meta would not extend the access token${
            response.error?.message ? `: ${response.error.message}` : ""
          }. Reconnect the account.`,
        );
      }

      return {
        ...credentials,
        accessToken: response.access_token,
        // Meta omits expires_in on some long-lived tokens; treat that as the
        // documented sixty days rather than as "never expires".
        expiresAt: Date.now() + (response.expires_in ?? 60 * 24 * 3600) * 1000,
      };
    },
  },

  async listAccounts(ctx): Promise<RemoteAccount[]> {
    const accounts = await paged<{
      id: string;
      name?: string;
      account_id?: string;
      currency?: string;
      timezone_name?: string;
    }>(
      `${API_BASE}/me/adaccounts?fields=id,name,account_id,currency,timezone_name&limit=100`,
      ctx.credentials.accessToken!,
    );
    return accounts.map((a) => ({
      id: a.id,
      name: a.name ?? a.id,
      currency: a.currency ?? "USD",
      timezone: a.timezone_name,
    }));
  },

  async fetchEntities(ctx): Promise<EntitySnapshot> {
    const token = ctx.credentials.accessToken!;
    const account = accountPath(ctx);
    const currency = (ctx.config.currency as string) ?? "USD";

    const campaignData = await paged<{
      id: string;
      name: string;
      status: string;
      objective?: string;
      daily_budget?: string;
      start_time?: string;
      stop_time?: string;
    }>(
      `${API_BASE}/${account}/campaigns?fields=id,name,status,objective,daily_budget,start_time,stop_time&limit=200`,
      token,
    );

    const campaigns = campaignData.map((c) => ({
      connectionId: ctx.connectionId,
      platform: "meta_ads" as const,
      externalId: c.id,
      name: c.name,
      status: STATUS_MAP[c.status] ?? "paused",
      objective: c.objective ?? null,
      // Meta returns budgets in minor units of the account currency.
      dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
      currency,
      startDate: c.start_time?.slice(0, 10) ?? null,
      endDate: c.stop_time?.slice(0, 10) ?? null,
    }));

    const adSetData = await paged<{
      id: string;
      name: string;
      status: string;
      campaign_id: string;
    }>(`${API_BASE}/${account}/adsets?fields=id,name,status,campaign_id&limit=200`, token);

    const adGroups = adSetData.map((s) => ({
      connectionId: ctx.connectionId,
      campaignId: stableId("cmp", ctx.connectionId, s.campaign_id),
      externalId: s.id,
      name: s.name,
      status: STATUS_MAP[s.status] ?? "paused",
    }));

    const adData = await paged<{
      id: string;
      name: string;
      status: string;
      adset_id: string;
      campaign_id: string;
      preview_shareable_link?: string;
      creative?: {
        title?: string;
        body?: string;
        call_to_action_type?: string;
        object_story_spec?: {
          link_data?: { message?: string; name?: string; call_to_action?: { type?: string }; link?: string };
          video_data?: { message?: string; title?: string };
        };
      };
    }>(
      `${API_BASE}/${account}/ads?fields=id,name,status,adset_id,campaign_id,preview_shareable_link,` +
        `creative{title,body,call_to_action_type,object_story_spec}&limit=200`,
      token,
    );

    const ads = adData.map((a) => {
      const link = a.creative?.object_story_spec?.link_data;
      const video = a.creative?.object_story_spec?.video_data;
      return {
        adGroupId: stableId(
          "adg",
          stableId("cmp", ctx.connectionId, a.campaign_id),
          a.adset_id,
        ),
        campaignId: stableId("cmp", ctx.connectionId, a.campaign_id),
        externalId: a.id,
        name: a.name,
        format: (video ? "video" : "image") as "video" | "image",
        status: STATUS_MAP[a.status] ?? "paused",
        headline: a.creative?.title ?? link?.name ?? video?.title ?? null,
        body: a.creative?.body ?? link?.message ?? video?.message ?? null,
        callToAction: a.creative?.call_to_action_type ?? link?.call_to_action?.type ?? null,
        landingPage: link?.link ?? null,
        previewUrl: a.preview_shareable_link ?? null,
      };
    });

    return { campaigns, adGroups, ads };
  },

  async fetchMetrics(ctx, range: DateRange): Promise<MetricRow[]> {
    const token = ctx.credentials.accessToken!;
    const account = accountPath(ctx);

    const url = new URL(`${API_BASE}/${account}/insights`);
    url.searchParams.set("level", "ad");
    url.searchParams.set(
      "fields",
      [
        "date_start",
        "campaign_id",
        "adset_id",
        "ad_id",
        "impressions",
        "clicks",
        "spend",
        "frequency",
        "account_currency",
        "actions",
        "action_values",
        "video_thruplay_watched_actions",
      ].join(","),
    );
    url.searchParams.set("time_range", JSON.stringify({ since: range.start, until: range.end }));
    // One row per day per ad rather than one aggregate for the whole window.
    url.searchParams.set("time_increment", "1");
    url.searchParams.set("limit", "500");

    const rows = await paged<{
      date_start: string;
      campaign_id: string;
      adset_id?: string;
      ad_id?: string;
      impressions?: string;
      clicks?: string;
      spend?: string;
      frequency?: string;
      account_currency?: string;
      actions?: ActionEntry[];
      action_values?: ActionEntry[];
      video_thruplay_watched_actions?: ActionEntry[];
    }>(url.toString(), token);

    return rows.map((row) => ({
      date: row.date_start,
      connectionId: ctx.connectionId,
      platform: "meta_ads" as const,
      campaignExternalId: row.campaign_id,
      adGroupExternalId: row.adset_id ?? null,
      adExternalId: row.ad_id ?? null,
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      spend: Number(row.spend ?? 0),
      platformConversions: pickConversions(row.actions),
      platformRevenue: pickRevenue(row.action_values),
      videoViews: Number(row.video_thruplay_watched_actions?.[0]?.value ?? 0),
      frequency: Number(row.frequency ?? 0),
      currency: row.account_currency ?? "USD",
    }));
  },

  async pauseCampaign(ctx, externalCampaignId) {
    await request(`${API_BASE}/${externalCampaignId}`, {
      method: "POST",
      headers: bearer(ctx.credentials.accessToken),
      form: { status: "PAUSED" },
    });
    return { ok: true, detail: `Campaign ${externalCampaignId} paused in Meta Ads` };
  },

  async setCampaignBudget(ctx, externalCampaignId, dailyBudget) {
    await request(`${API_BASE}/${externalCampaignId}`, {
      method: "POST",
      headers: bearer(ctx.credentials.accessToken),
      // Minor units again on the way in.
      form: { daily_budget: String(Math.round(dailyBudget * 100)) },
    });
    return { ok: true, detail: `Daily budget set to ${dailyBudget} for ${externalCampaignId}` };
  },
};
