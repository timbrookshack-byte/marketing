import { ConnectorError, bearer, request } from "./http";
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

const HOST = "https://googleads.googleapis.com";

const MICROS = 1_000_000;

/**
 * Resolving the API version.
 *
 * Google ships roughly monthly, promotes four major versions a year, and sunsets
 * each about a year after release. A version pinned in source is therefore a bug
 * with a delivery date, so the version is discovered instead.
 *
 * Two different 404s have to be told apart, because they look identical from the
 * outside and only one of them is about the version:
 *
 *  - The frontend does not recognise the version prefix at all and answers with
 *    an HTML error page. That version is gone, or not yet routed.
 *  - The frontend routes the prefix but the service behind it does not serve
 *    that version yet, and answers `NOT_FOUND: Method not found.` as JSON once
 *    the caller is authenticated. Google provisions the next version's route
 *    ahead of launching it, so the newest prefix that answers unauthenticated
 *    is regularly one that no real request can use.
 *
 * Both mean "try an older version", so both are treated the same way and the
 * loop keeps going. A 401 or 403 is the opposite: the method resolved and only
 * the caller was refused, so that version is live and the problem is auth.
 *
 * GOOGLE_ADS_API_VERSION pins the first version tried. It is a starting point
 * rather than a promise — if it turns out not to serve, discovery carries on
 * from the rest of the list instead of failing, since a pin that has gone stale
 * is exactly the situation this is here to survive.
 */
const CANDIDATE_VERSIONS = ["v26", "v25", "v24", "v23", "v22"];

/** Set only once a version has actually answered, so a failure is never cached. */
let resolvedVersion: string | null = null;

/**
 * listAccessibleCustomers takes no arguments and needs no account, so nothing
 * about the request can be wrong. A 404 from it is always about the version.
 */
function versionNotServed(error: unknown): boolean {
  return error instanceof ConnectorError && error.status === 404;
}

async function apiBase(ctx: ConnectorContext): Promise<string> {
  if (resolvedVersion) return `${HOST}/${resolvedVersion}`;

  const pinned = process.env.GOOGLE_ADS_API_VERSION?.trim();
  const candidates = pinned
    ? [pinned, ...CANDIDATE_VERSIONS.filter((v) => v !== pinned)]
    : CANDIDATE_VERSIONS;

  const rejected: string[] = [];
  for (const version of candidates) {
    try {
      await request(`${HOST}/${version}/customers:listAccessibleCustomers`, {
        headers: headers(ctx),
        retries: 1,
      });
      resolvedVersion = version;
      return `${HOST}/${version}`;
    } catch (error) {
      if (versionNotServed(error)) {
        rejected.push(version);
        continue;
      }
      // Reached the method and got a real answer — including a refusal. The
      // version is live and whatever went wrong is the caller's to fix.
      resolvedVersion = version;
      return `${HOST}/${version}`;
    }
  }

  throw new Error(
    `None of the Google Ads API versions this connector knows about are serving requests ` +
      `(tried ${rejected.join(", ")}). Google has moved on again — set GOOGLE_ADS_API_VERSION ` +
      "to the current one from developers.google.com/google-ads/api/docs/sunset-dates.",
  );
}

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
  const base = await apiBase(ctx);
  const chunks = await request<SearchStreamChunk[]>(
    `${base}/customers/${customerId(ctx)}/googleAds:searchStream`,
    { method: "POST", headers: headers(ctx), body: { query } },
  );
  return (chunks ?? []).flatMap((chunk) => (chunk.results ?? []) as unknown as T[]);
}

/**
 * Every GAQL query this connector runs, in one place.
 *
 * Exported so the doctor script can execute exactly what a sync executes. A
 * query that only lives inside the function that uses it gets copied into the
 * diagnostic and then quietly drifts, which turns the diagnostic into a second
 * thing that needs diagnosing.
 */
export const GAQL = {
  customer: `
    SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone
    FROM customer
    LIMIT 1
  `,
  // campaign.start_date and campaign.end_date were dropped from the resource;
  // v25 rejects the whole query for naming them. Nothing here depends on the
  // dates, so they are simply not requested — see the note above the connector
  // about finding what replaced them.
  campaigns: `
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign_budget.amount_micros, customer.currency_code
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `,
  adGroups: `
    SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id
    FROM ad_group
    WHERE ad_group.status != 'REMOVED'
  `,
  ads: `
    SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
           ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines,
           ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status,
           ad_group.id, campaign.id
    FROM ad_group_ad
    WHERE ad_group_ad.status != 'REMOVED'
  `,
  // metrics.video_views is likewise gone. Google Ads video views are not used
  // by any analysis here, so the column is reported as zero rather than held up
  // waiting for its replacement.
  metrics: (range: DateRange) => `
    SELECT segments.date, campaign.id, ad_group.id, ad_group_ad.ad.id,
           customer.currency_code,
           metrics.impressions, metrics.clicks, metrics.cost_micros,
           metrics.conversions, metrics.conversions_value
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${range.start}' AND '${range.end}'
  `,
} as const;

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
    const base = await apiBase(ctx);
    const listed = await request<{ resourceNames?: string[] }>(
      `${base}/customers:listAccessibleCustomers`,
      { headers: headers(ctx) },
    );
    const ids = (listed.resourceNames ?? []).map((name) => name.split("/")[1]);

    // An empty list is not "this login has no ads" — it usually means the Cloud
    // project is not yet cleared to call the API, or the ad account sits under a
    // manager account that this login reaches indirectly. Guessing wastes an
    // afternoon, so name all three possibilities.
    if (ids.length === 0) {
      throw new Error(
        "Google returned no accessible ad accounts for this login. Usually one of: " +
          "(1) the Google Ads API is not enabled on the Cloud project behind these OAuth " +
          "credentials; (2) Basic access has not been granted to that project yet — apply from " +
          "its Google Ads API page, brand verification approves in minutes; or (3) your ad " +
          "account sits under a manager (MCC) account, in which case set the customer ID by hand " +
          "on the connection and give the manager's ID as the login customer ID.",
      );
    }

    // listAccessibleCustomers returns ids only; ask each one for its name.
    const accounts: RemoteAccount[] = [];
    for (const id of ids) {
      try {
        const rows = await gaql<{
          customer: { id: string; descriptiveName?: string; currencyCode?: string; timeZone?: string };
        }>({ ...ctx, externalAccountId: id }, GAQL.customer);
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
      };
      campaignBudget?: { amountMicros?: string };
      customer?: { currencyCode?: string };
    }>(ctx, GAQL.campaigns);

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
      startDate: null,
      endDate: null,
    }));

    const groupRows = await gaql<{
      adGroup: { id: string; name: string; status: string };
      campaign: { id: string };
    }>(ctx, GAQL.adGroups);

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
    }>(ctx, GAQL.ads);

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
      };
    }>(ctx, GAQL.metrics(range));

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
      videoViews: 0,
      frequency: 0,
      currency: row.customer?.currencyCode ?? "USD",
    }));
  },

  async pauseCampaign(ctx, externalCampaignId) {
    await request(`${await apiBase(ctx)}/customers/${customerId(ctx)}/campaigns:mutate`, {
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
    await request(`${await apiBase(ctx)}/customers/${customerId(ctx)}/campaignBudgets:mutate`, {
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
