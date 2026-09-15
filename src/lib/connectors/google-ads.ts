import { bearer, request } from "./http";
import type { AdsConnector, ConnectorContext, EntitySnapshot, RemoteAccount } from "./types";
import type { DateRange, MetricRow } from "../types";
import { stableId } from "../util";

/**
 * Google Ads — REST interface to the Google Ads API.
 *
 * Two things make this connector different from the others:
 *  - access is granted to the Google Cloud project behind the OAuth credentials
 *    (see the note on `headers` below), and reaching an account through a
 *    manager account needs a `login-customer-id` header;
 *  - reporting is a GAQL query against `searchStream`, which returns a stream of
 *    JSON chunks rather than one object.
 *
 * Money arrives in micros (1/1,000,000 of the account currency) and is
 * normalised here so nothing downstream has to remember that.
 */

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? "v21";
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;

const MICROS = 1_000_000;

/**
 * Google sunset developer tokens on 9 September 2026. Access is now decided by
 * the Google Cloud project you authenticate with, and the `developer-token`
 * header is optional and ignored — though Google has said it will be rejected
 * in some future major version it has not yet named.
 *
 * So the token is sent when one is configured (harmless today, and keeps
 * working for anyone still on an older API version) and omitted otherwise,
 * rather than being required. Requiring it would block every account set up
 * after the sunset, since new projects are no longer issued one.
 */
function headers(ctx: ConnectorContext): Record<string, string> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCustomerId =
    (ctx.config.loginCustomerId as string) ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  return {
    ...bearer(ctx.credentials.accessToken),
    ...(developerToken ? { "developer-token": developerToken } : {}),
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId.replace(/-/g, "") } : {}),
  };
}

function customerId(ctx: ConnectorContext): string {
  const id = ctx.externalAccountId;
  if (!id) throw new Error("No Google Ads customer ID selected for this connection");
  return id.replace(/-/g, "");
}

interface SearchStreamChunk {
  results?: Record<string, never>[];
}

/**
 * searchStream returns a JSON array of chunks, each holding a page of results.
 * We flatten it into plain rows.
 */
async function gaql<T>(ctx: ConnectorContext, query: string): Promise<T[]> {
  const chunks = await request<SearchStreamChunk[]>(
    `${API_BASE}/customers/${customerId(ctx)}/googleAds:searchStream`,
    { method: "POST", headers: headers(ctx), body: { query } },
  );
  return (chunks ?? []).flatMap((chunk) => (chunk.results ?? []) as unknown as T[]);
}

const STATUS_MAP: Record<string, "active" | "paused" | "ended"> = {
  ENABLED: "active",
  PAUSED: "paused",
  REMOVED: "ended",
};

export const googleAdsConnector: AdsConnector = {
  platform: "google_ads",
  kind: "ads",
  displayName: "Google Ads",
  summary: "Search, Performance Max, Display, YouTube and Shopping spend and conversions.",
  docsUrl: "https://developers.google.com/google-ads/api/docs/start",
  authType: "oauth2",
  // No developer token: since the 9 September 2026 sunset, access is granted to
  // the Google Cloud project behind these OAuth credentials.
  requiredEnv: ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/adwords"],
    // Google only issues a refresh token when it is asked to, every time.
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },

  async listAccounts(ctx): Promise<RemoteAccount[]> {
    const listed = await request<{ resourceNames?: string[] }>(
      `${API_BASE}/customers:listAccessibleCustomers`,
      { headers: headers(ctx) },
    );
    const ids = (listed.resourceNames ?? []).map((name) => name.split("/")[1]);

    // listAccessibleCustomers returns ids only; ask each one for its name.
    const accounts: RemoteAccount[] = [];
    for (const id of ids) {
      try {
        const rows = await gaql<{
          customer: { id: string; descriptiveName?: string; currencyCode?: string; timeZone?: string };
        }>({ ...ctx, externalAccountId: id }, `
          SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone
          FROM customer
          LIMIT 1
        `);
        const customer = rows[0]?.customer;
        accounts.push({
          id,
          name: customer?.descriptiveName ?? `Customer ${id}`,
          currency: customer?.currencyCode ?? "USD",
          timezone: customer?.timeZone,
        });
      } catch {
        // A manager account we can list but not query is not an error worth
        // failing the whole picker over.
        accounts.push({ id, name: `Customer ${id}`, currency: "USD" });
      }
    }
    return accounts;
  },

  async fetchEntities(ctx): Promise<EntitySnapshot> {
    const campaignRows = await gaql<{
      campaign: {
        id: string;
        name: string;
        status: string;
        advertisingChannelType?: string;
        startDate?: string;
        endDate?: string;
      };
      campaignBudget?: { amountMicros?: string };
      customer?: { currencyCode?: string };
    }>(ctx, `
      SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
             campaign.start_date, campaign.end_date, campaign_budget.amount_micros,
             customer.currency_code
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `);

    const currency = campaignRows[0]?.customer?.currencyCode ?? ctx.config.currency ?? "USD";

    const campaigns = campaignRows.map((row) => ({
      connectionId: ctx.connectionId,
      platform: "google_ads" as const,
      externalId: row.campaign.id,
      name: row.campaign.name,
      status: STATUS_MAP[row.campaign.status] ?? "paused",
      objective: row.campaign.advertisingChannelType ?? null,
      dailyBudget: row.campaignBudget?.amountMicros
        ? Number(row.campaignBudget.amountMicros) / MICROS
        : null,
      currency: currency as string,
      startDate: row.campaign.startDate ?? null,
      endDate: row.campaign.endDate ?? null,
    }));

    const groupRows = await gaql<{
      adGroup: { id: string; name: string; status: string };
      campaign: { id: string };
    }>(ctx, `
      SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id
      FROM ad_group
      WHERE ad_group.status != 'REMOVED'
    `);

    const adGroups = groupRows.map((row) => ({
      connectionId: ctx.connectionId,
      campaignId: stableId("cmp", ctx.connectionId, row.campaign.id),
      externalId: row.adGroup.id,
      name: row.adGroup.name,
      status: STATUS_MAP[row.adGroup.status] ?? "paused",
    }));

    const adRows = await gaql<{
      adGroupAd: {
        ad: {
          id: string;
          name?: string;
          type?: string;
          finalUrls?: string[];
          responsiveSearchAd?: {
            headlines?: { text: string }[];
            descriptions?: { text: string }[];
          };
        };
        status: string;
      };
      adGroup: { id: string };
      campaign: { id: string };
    }>(ctx, `
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
             ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines,
             ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status,
             ad_group.id, campaign.id
      FROM ad_group_ad
      WHERE ad_group_ad.status != 'REMOVED'
    `);

    const ads = adRows.map((row) => {
      const ad = row.adGroupAd.ad;
      const headlines = ad.responsiveSearchAd?.headlines?.map((h) => h.text) ?? [];
      const descriptions = ad.responsiveSearchAd?.descriptions?.map((d) => d.text) ?? [];
      return {
        adGroupId: stableId("adg", stableId("cmp", ctx.connectionId, row.campaign.id), row.adGroup.id),
        campaignId: stableId("cmp", ctx.connectionId, row.campaign.id),
        externalId: ad.id,
        name: ad.name ?? headlines[0] ?? `Ad ${ad.id}`,
        format: (ad.type === "RESPONSIVE_SEARCH_AD" ? "responsive_search" : "search_text") as
          | "responsive_search"
          | "search_text",
        status: STATUS_MAP[row.adGroupAd.status] ?? "paused",
        headline: headlines.join(" | ") || null,
        body: descriptions.join(" | ") || null,
        callToAction: null,
        landingPage: ad.finalUrls?.[0] ?? null,
        previewUrl: null,
      };
    });

    return { campaigns, adGroups, ads };
  },

  async fetchMetrics(ctx, range: DateRange): Promise<MetricRow[]> {
    const rows = await gaql<{
      segments: { date: string };
      campaign: { id: string };
      adGroup?: { id: string };
      adGroupAd?: { ad: { id: string } };
      customer?: { currencyCode?: string };
      metrics: {
        impressions?: string;
        clicks?: string;
        costMicros?: string;
        conversions?: number;
        conversionsValue?: number;
        videoViews?: string;
      };
    }>(ctx, `
      SELECT segments.date, campaign.id, ad_group.id, ad_group_ad.ad.id,
             customer.currency_code,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.conversions, metrics.conversions_value, metrics.video_views
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${range.start}' AND '${range.end}'
    `);

    return rows.map((row) => ({
      date: row.segments.date,
      connectionId: ctx.connectionId,
      platform: "google_ads" as const,
      campaignExternalId: row.campaign.id,
      adGroupExternalId: row.adGroup?.id ?? null,
      adExternalId: row.adGroupAd?.ad.id ?? null,
      impressions: Number(row.metrics.impressions ?? 0),
      clicks: Number(row.metrics.clicks ?? 0),
      spend: Number(row.metrics.costMicros ?? 0) / MICROS,
      platformConversions: Number(row.metrics.conversions ?? 0),
      platformRevenue: Number(row.metrics.conversionsValue ?? 0),
      videoViews: Number(row.metrics.videoViews ?? 0),
      frequency: 0,
      currency: row.customer?.currencyCode ?? "USD",
    }));
  },

  async pauseCampaign(ctx, externalCampaignId) {
    await request(`${API_BASE}/customers/${customerId(ctx)}/campaigns:mutate`, {
      method: "POST",
      headers: headers(ctx),
      body: {
        operations: [
          {
            update: {
              resourceName: `customers/${customerId(ctx)}/campaigns/${externalCampaignId}`,
              status: "PAUSED",
            },
            updateMask: "status",
          },
        ],
      },
    });
    return { ok: true, detail: `Campaign ${externalCampaignId} paused in Google Ads` };
  },

  async setCampaignBudget(ctx, externalCampaignId, dailyBudget) {
    // The budget lives on the shared campaign_budget resource, so look it up first.
    const rows = await gaql<{ campaignBudget: { resourceName: string } }>(ctx, `
      SELECT campaign_budget.resource_name
      FROM campaign
      WHERE campaign.id = ${Number(externalCampaignId)}
      LIMIT 1
    `);
    const resourceName = rows[0]?.campaignBudget?.resourceName;
    if (!resourceName) {
      return { ok: false, detail: `No budget resource found for campaign ${externalCampaignId}` };
    }
    await request(`${API_BASE}/customers/${customerId(ctx)}/campaignBudgets:mutate`, {
      method: "POST",
      headers: headers(ctx),
      body: {
        operations: [
          {
            update: { resourceName, amountMicros: String(Math.round(dailyBudget * MICROS)) },
            updateMask: "amount_micros",
          },
        ],
      },
    });
    return { ok: true, detail: `Daily budget set to ${dailyBudget} for ${externalCampaignId}` };
  },
};
