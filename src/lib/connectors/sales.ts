import { ConnectorError, bearer, request } from "./http";
import type { ConnectorContext, SalesConnector } from "./types";
import type { DateRange, SalesOrder } from "../types";

/**
 * Revenue-side connectors. These are what turn "we spent $40k" into "we spent
 * $40k and here is where the money came back", so the attribution fields —
 * UTMs and click identifiers — matter more here than the revenue total does.
 */

type OrderDraft = Omit<SalesOrder, "id">;

/** Pulls UTM parameters and ad-click ids out of a landing page URL. */
export function parseLandingPage(url: string | null | undefined): Partial<OrderDraft> {
  if (!url) return {};
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { landingPage: url };
  }
  const q = parsed.searchParams;
  const clickIdTypes: [string, string][] = [
    ["gclid", "google"],
    ["wbraid", "google"],
    ["gbraid", "google"],
    ["fbclid", "meta"],
    ["ttclid", "tiktok"],
    ["li_fat_id", "linkedin"],
    ["msclkid", "microsoft"],
    ["oaiclid", "openai"],
    ["rdt_cid", "reddit"],
    ["twclid", "x"],
    ["epik", "pinterest"],
    ["ScCid", "snapchat"],
  ];
  const found = clickIdTypes.find(([param]) => q.get(param));
  return {
    landingPage: `${parsed.origin}${parsed.pathname}`,
    utmSource: q.get("utm_source"),
    utmMedium: q.get("utm_medium"),
    utmCampaign: q.get("utm_campaign"),
    utmContent: q.get("utm_content"),
    utmTerm: q.get("utm_term"),
    clickId: found ? q.get(found[0]) : null,
    clickIdType: found ? found[1] : null,
  };
}

interface CustomerVisit {
  landingPage?: string;
  source?: string;
  sourceType?: string;
  occurredAt?: string;
  utmParameters?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
}

export interface CustomerJourney {
  firstVisit?: CustomerVisit;
  lastVisit?: CustomerVisit;
  moments?: CustomerVisit[];
}

/**
 * Which visit in a customer's journey should be credited with the sale.
 *
 * Reading only the last visit loses nearly every ad-driven sale that took more
 * than one session to close. Someone clicks a Google ad, browses, comes back
 * days later by typing the shop's name, and buys — the last visit carries no
 * click id, so a perfectly tracked sale is recorded as untraceable. The longer
 * the consideration, the more of them are lost, which means this fails worst on
 * exactly the expensive purchases that matter most.
 *
 * So the whole journey is searched for a visit carrying an ad click id, most
 * recent first, since that is the strongest evidence available and it does not
 * stop being true because the buyer returned by another route. Failing that, a
 * visit with campaign tagging. Failing that, the last visit as before.
 *
 * This still credits one visit rather than sharing between them. Splitting a
 * sale across touches needs a model of how much each contributed, and inventing
 * one here would produce numbers nobody could check against the platforms.
 */
export function chooseAttributingVisit(
  journey: CustomerJourney | undefined,
  fallbackLandingPage: string | undefined,
): CustomerVisit {
  const visits = [
    ...(journey?.moments ?? []),
    ...(journey?.lastVisit ? [journey.lastVisit] : []),
    ...(journey?.firstVisit ? [journey.firstVisit] : []),
  ].filter((visit) => visit.landingPage || visit.utmParameters);

  // Most recent first; visits with no timestamp sort last rather than winning.
  const ordered = [...visits].sort((a, b) =>
    (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""),
  );

  const withClickId = ordered.find((visit) => parseLandingPage(visit.landingPage).clickId);
  if (withClickId) return withClickId;

  const withCampaign = ordered.find(
    (visit) => visit.utmParameters?.campaign || parseLandingPage(visit.landingPage).utmCampaign,
  );
  if (withCampaign) return withCampaign;

  return journey?.lastVisit ?? journey?.firstVisit ?? { landingPage: fallbackLandingPage };
}

// --------------------------------------------------------------------- Shopify

/**
 * Resolving a Shopify access token.
 *
 * Shopify stopped issuing permanent custom-app tokens from the store admin on
 * 1 January 2026, so the current route is the client credentials grant: an app
 * registered in the Dev Dashboard exchanges its client id and secret for a
 * short-lived access token.
 *
 * Because those tokens expire, the connection stores the *credentials* rather
 * than a token, and one is minted per sync. The cache below just avoids paying
 * for that exchange twice in the same run; it is deliberately in-memory, so a
 * restart simply mints a fresh token rather than reviving a stale one.
 *
 * A legacy shpat_ token, if the operator still holds one, is used directly.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function shopifyAccessToken(ctx: ConnectorContext, shop: string): Promise<string> {
  const stored = (ctx.credentials.accessToken as string) ?? "";

  // A permanent token from before the change still works as-is.
  if (stored.startsWith("shpat_") || stored.startsWith("shpca_")) return stored;

  const clientId = ctx.credentials.clientId as string | undefined;
  const clientSecret = ctx.credentials.clientSecret as string | undefined;

  if (!clientId || !clientSecret) {
    // The single most common mistake: pasting the secret into the token field.
    if (stored.startsWith("shpss_")) {
      throw new Error(
        "That is the Client secret, not an access token. Put it in the Client secret field and " +
          "add the Client ID alongside it — the portal exchanges the pair for a token itself.",
      );
    }
    throw new Error(
      "Shopify needs a Client ID and Client secret from your Dev Dashboard app. Permanent " +
        "shpat_ tokens are no longer issued from the store admin.",
    );
  }

  const cacheKey = `${shop}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  interface TokenResponse {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  }

  let response: TokenResponse;
  try {
    response = await request<TokenResponse>(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      form: {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      },
    });
  } catch (error) {
    // Shopify puts the real reason in the response body, which the shared HTTP
    // client turns into a bare status. Dig it out — "responded 400" on its own
    // sends people hunting in the wrong place.
    if (error instanceof ConnectorError) {
      let detail = "";
      try {
        const parsed = JSON.parse(error.body) as TokenResponse;
        detail = parsed.error_description ?? parsed.error ?? "";
      } catch {
        // Shopify answers some failures with an HTML error page. Dumping that
        // into the message buries the useful part under a stylesheet, so only
        // a short plain-text body is worth passing on.
        const body = error.body.trim();
        const looksLikeHtml = /^<|<html|<!doctype/i.test(body);
        if (!looksLikeHtml && body.length <= 200) detail = body;
      }
      throw new Error(
        `Shopify rejected the client credentials for ${shop} (HTTP ${error.status}${detail ? `: ${detail}` : ""}). ` +
          "Check the Client ID and secret are from the app installed on this store, and that it " +
          "has the read_orders scope.",
      );
    }
    throw error;
  }

  if (!response.access_token) {
    throw new Error(
      `Shopify returned no access token for ${shop}${
        response.error_description ? `: ${response.error_description}` : response.error ? `: ${response.error}` : ""
      }. Check the app is installed on this store and has the read_orders scope.`,
    );
  }

  tokenCache.set(cacheKey, {
    token: response.access_token,
    // Treat an unstated lifetime as short: re-minting is one cheap call.
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
  });

  return response.access_token;
}

/**
 * Shopify — Admin GraphQL API. Orders carry `customerJourneySummary`, which is
 * the closest thing to a first-party attribution record any store gives us.
 */
export const shopifyConnector: SalesConnector = {
  platform: "shopify",
  kind: "sales",
  displayName: "Shopify",
  summary: "Store orders with landing pages and referrer data for attribution.",
  docsUrl: "https://shopify.dev/docs/api/admin-graphql",
  authType: "api_key",
  requiredEnv: [],
  /*
   * No OAuth block on purpose. Shopify's OAuth flow is built for apps serving
   * many merchants, and its authorize URL is per-shop — there is no single URL
   * to redirect to. A store owner connecting their own shop should create a
   * custom app in the admin instead, which issues an Admin API token directly
   * and takes about a minute.
   */
  manualSetup: {
    help:
      "Since 1 January 2026 the store admin no longer issues permanent custom-app tokens, so " +
      "this uses the Dev Dashboard instead: shopify.dev -> your app -> API credentials. Give the " +
      "app the read_orders, read_customers and read_products scopes, install it on your store, " +
      "then copy the Client ID and Client secret below. The portal exchanges them for an access " +
      "token on every sync, so nothing here expires on you.",
    fields: [
      {
        key: "shopDomain",
        label: "Shop domain",
        placeholder: "your-store.myshopify.com",
        target: "config",
        required: true,
      },
      {
        key: "clientId",
        label: "Client ID (API key)",
        placeholder: "abc123...",
        target: "credentials",
        required: true,
      },
      {
        key: "clientSecret",
        label: "Client secret",
        placeholder: "shpss_...",
        secret: true,
        target: "credentials",
        required: true,
      },
      {
        key: "accessToken",
        label: "Admin API access token (legacy, optional)",
        placeholder: "shpat_...",
        help:
          "Only if you still hold a permanent token from before the January 2026 change. Leave " +
          "blank otherwise — the Client ID and secret above are the current route.",
        secret: true,
        target: "credentials",
        required: false,
      },
    ],
  },

  async fetchOrders(ctx: ConnectorContext, range: DateRange): Promise<OrderDraft[]> {
    const shop = ctx.config.shopDomain as string;
    if (!shop) throw new Error("Shopify connection is missing its shop domain");

    const token = await shopifyAccessToken(ctx, shop);
    const version = (ctx.config.apiVersion as string) ?? "2025-01";
    const endpoint = `https://${shop}/admin/api/${version}/graphql.json`;

    /*
     * The full journey is not on every Shopify plan, and GraphQL validates the
     * whole document — an unavailable field fails the entire query rather than
     * returning null for that part. So the richer selection is tried first and
     * the narrower one is the fallback: a shop that can see its journey gets
     * proper attribution, and one that cannot still syncs.
     */
    const VISIT_FIELDS =
      "landingPage source sourceType occurredAt utmParameters { source medium campaign content term }";

    const buildQuery = (withJourney: boolean) => `
      query Orders($cursor: String, $filter: String!) {
        orders(first: 100, after: $cursor, query: $filter) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              name
              createdAt
              currentTotalPriceSet { shopMoney { amount currencyCode } }
              customer { id numberOfOrders }
              landingPageUrl
              customerJourneySummary {
                lastVisit { ${VISIT_FIELDS} }
                ${
                  withJourney
                    ? `firstVisit { ${VISIT_FIELDS} }
                       moments(first: 25) { ... on CustomerVisit { ${VISIT_FIELDS} } }`
                    : ""
                }
              }
            }
          }
        }
      }`;

    let query = buildQuery(true);
    let journeyAvailable = true;

    const orders: OrderDraft[] = [];
    let cursor: string | null = null;
    let guard = 0;

    while (guard < 50) {
      const response: {
        data?: {
          orders?: {
            pageInfo: { hasNextPage: boolean; endCursor: string };
            edges: { node: Record<string, never> }[];
          };
        };
        errors?: { message: string }[];
      } = await request(endpoint, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token },
        body: {
          query,
          variables: {
            cursor,
            filter: `created_at:>=${range.start} created_at:<=${range.end}`,
          },
        },
      });

      if (response.errors?.length) {
        const detail = response.errors.map((e) => e.message).join(" | ");

        // Retry once without the journey fields when they are what it objected
        // to. Losing multi-visit attribution is worth it to keep the orders.
        if (journeyAvailable && /moments|firstVisit|CustomerVisit|occurredAt/i.test(detail)) {
          console.warn(
            `Shopify does not expose the full customer journey on this plan, so orders will be ` +
              `attributed to their last visit only, and ad clicks followed by a later direct ` +
              `visit will look untracked. Shopify said: ${detail}`,
          );
          journeyAvailable = false;
          query = buildQuery(false);
          continue;
        }

        // GraphQL validates the whole document and returns every problem at
        // once. Surfacing only the first turns one schema drift into several
        // round trips.
        throw new Error(`Shopify GraphQL error: ${detail}`);
      }

      const page = response.data?.orders;
      if (!page) break;

      for (const edge of page.edges) {
        const node = edge.node as Record<string, unknown>;
        const money = (node.currentTotalPriceSet as { shopMoney?: { amount?: string; currencyCode?: string } })
          ?.shopMoney;
        const journey = node.customerJourneySummary as CustomerJourney | undefined;
        const attributing = chooseAttributingVisit(journey, node.landingPageUrl as string | undefined);
        const parsed = parseLandingPage(attributing.landingPage);
        const utm = attributing.utmParameters;
        const customer = node.customer as { id?: string; numberOfOrders?: string } | undefined;

        orders.push({
          connectionId: ctx.connectionId,
          platform: "shopify",
          externalId: String(node.id),
          orderedAt: String(node.createdAt),
          revenue: Number(money?.amount ?? 0),
          cogs: null,
          currency: money?.currencyCode ?? "USD",
          customerRef: customer?.id ?? null,
          isNewCustomer: Number(customer?.numberOfOrders ?? 1) <= 1,
          landingPage: parsed.landingPage ?? null,
          // Shopify's parsed UTM fields win over anything we scrape from the URL.
          utmSource: utm?.source ?? parsed.utmSource ?? null,
          utmMedium: utm?.medium ?? parsed.utmMedium ?? null,
          utmCampaign: utm?.campaign ?? parsed.utmCampaign ?? null,
          utmContent: utm?.content ?? parsed.utmContent ?? null,
          utmTerm: utm?.term ?? parsed.utmTerm ?? null,
          clickId: parsed.clickId ?? null,
          clickIdType: parsed.clickIdType ?? null,
        });
      }

      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
      guard += 1;
    }

    return orders;
  },
};

// ---------------------------------------------------------------------- Stripe

/**
 * Stripe — for subscription and invoice businesses where the "store" is the
 * billing system. Attribution rides along in payment intent metadata, which is
 * where most checkouts put their UTMs.
 */
export const stripeConnector: SalesConnector = {
  platform: "stripe",
  kind: "sales",
  displayName: "Stripe",
  summary: "Payments and subscriptions, with UTMs read from charge metadata.",
  docsUrl: "https://docs.stripe.com/api",
  authType: "api_key",
  requiredEnv: [],
  manualSetup: {
    help:
      "Stripe dashboard -> Developers -> API keys -> Create restricted key. It only needs read " +
      "access to Charges; do not paste a secret key with write access.",
    fields: [
      {
        key: "apiKey",
        label: "Restricted API key",
        placeholder: "rk_live_...",
        secret: true,
        target: "credentials",
        required: true,
      },
    ],
  },

  async fetchOrders(ctx: ConnectorContext, range: DateRange): Promise<OrderDraft[]> {
    const key = (ctx.credentials.apiKey as string) ?? process.env.STRIPE_API_KEY;
    if (!key) throw new Error("Stripe API key is not configured");

    const created = {
      gte: Math.floor(Date.parse(`${range.start}T00:00:00Z`) / 1000),
      lte: Math.floor(Date.parse(`${range.end}T23:59:59Z`) / 1000),
    };

    const orders: OrderDraft[] = [];
    let startingAfter: string | undefined;
    let guard = 0;

    while (guard < 50) {
      const page = await request<{
        data?: {
          id: string;
          amount: number;
          currency: string;
          created: number;
          customer?: string | null;
          paid: boolean;
          refunded: boolean;
          metadata?: Record<string, string>;
        }[];
        has_more?: boolean;
      }>("https://api.stripe.com/v1/charges", {
        headers: bearer(key),
        query: {
          limit: 100,
          "created[gte]": created.gte,
          "created[lte]": created.lte,
          starting_after: startingAfter,
        },
      });

      for (const charge of page.data ?? []) {
        if (!charge.paid || charge.refunded) continue;
        const meta = charge.metadata ?? {};
        const parsed = parseLandingPage(meta.landing_page ?? meta.landingPage);
        orders.push({
          connectionId: ctx.connectionId,
          platform: "stripe",
          externalId: charge.id,
          orderedAt: new Date(charge.created * 1000).toISOString(),
          // Stripe amounts are in the currency's smallest unit.
          revenue: charge.amount / 100,
          cogs: null,
          currency: charge.currency.toUpperCase(),
          customerRef: charge.customer ?? null,
          isNewCustomer: meta.is_new_customer !== "false",
          landingPage: parsed.landingPage ?? null,
          utmSource: meta.utm_source ?? parsed.utmSource ?? null,
          utmMedium: meta.utm_medium ?? parsed.utmMedium ?? null,
          utmCampaign: meta.utm_campaign ?? parsed.utmCampaign ?? null,
          utmContent: meta.utm_content ?? parsed.utmContent ?? null,
          utmTerm: meta.utm_term ?? parsed.utmTerm ?? null,
          clickId: meta.gclid ?? meta.fbclid ?? parsed.clickId ?? null,
          clickIdType: meta.gclid ? "google" : meta.fbclid ? "meta" : (parsed.clickIdType ?? null),
        });
      }

      const data = page.data ?? [];
      if (!page.has_more || data.length === 0) break;
      startingAfter = data[data.length - 1].id;
      guard += 1;
    }

    return orders;
  },
};

// ----------------------------------------------------------------- WooCommerce

export const wooCommerceConnector: SalesConnector = {
  platform: "woocommerce",
  kind: "sales",
  displayName: "WooCommerce",
  summary: "WordPress store orders over the REST API.",
  docsUrl: "https://woocommerce.github.io/woocommerce-rest-api-docs/",
  authType: "basic",
  requiredEnv: [],
  manualSetup: {
    help:
      "WordPress admin -> WooCommerce -> Settings -> Advanced -> REST API -> Add key, with Read " +
      "permission.",
    fields: [
      { key: "storeUrl", label: "Store URL", placeholder: "https://example.com", target: "config", required: true },
      { key: "consumerKey", label: "Consumer key", placeholder: "ck_...", secret: true, target: "credentials", required: true },
      { key: "consumerSecret", label: "Consumer secret", placeholder: "cs_...", secret: true, target: "credentials", required: true },
    ],
  },

  async fetchOrders(ctx: ConnectorContext, range: DateRange): Promise<OrderDraft[]> {
    const storeUrl = ctx.config.storeUrl as string;
    if (!storeUrl) throw new Error("WooCommerce connection is missing its store URL");
    const consumerKey = (ctx.credentials.consumerKey as string) ?? process.env.WOOCOMMERCE_CONSUMER_KEY;
    const consumerSecret =
      (ctx.credentials.consumerSecret as string) ?? process.env.WOOCOMMERCE_CONSUMER_SECRET;

    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
    const orders: OrderDraft[] = [];

    for (let page = 1; page <= 50; page += 1) {
      const batch = await request<
        {
          id: number;
          number: string;
          date_created_gmt: string;
          total: string;
          currency: string;
          customer_id: number;
          status: string;
          meta_data?: { key: string; value: string }[];
        }[]
      >(`${storeUrl.replace(/\/$/, "")}/wp-json/wc/v3/orders`, {
        headers: { authorization: `Basic ${auth}` },
        query: {
          after: `${range.start}T00:00:00`,
          before: `${range.end}T23:59:59`,
          per_page: 100,
          page,
          status: "completed,processing",
        },
      });

      if (!batch?.length) break;

      for (const order of batch) {
        const meta = Object.fromEntries((order.meta_data ?? []).map((m) => [m.key, m.value]));
        const parsed = parseLandingPage(meta._landing_page ?? meta.landing_page);
        orders.push({
          connectionId: ctx.connectionId,
          platform: "woocommerce",
          externalId: String(order.id),
          orderedAt: `${order.date_created_gmt}Z`,
          revenue: Number(order.total ?? 0),
          cogs: meta._cogs_total ? Number(meta._cogs_total) : null,
          currency: order.currency ?? "USD",
          customerRef: order.customer_id ? String(order.customer_id) : null,
          isNewCustomer: order.customer_id === 0,
          landingPage: parsed.landingPage ?? null,
          utmSource: meta._utm_source ?? parsed.utmSource ?? null,
          utmMedium: meta._utm_medium ?? parsed.utmMedium ?? null,
          utmCampaign: meta._utm_campaign ?? parsed.utmCampaign ?? null,
          utmContent: meta._utm_content ?? parsed.utmContent ?? null,
          utmTerm: meta._utm_term ?? parsed.utmTerm ?? null,
          clickId: parsed.clickId ?? null,
          clickIdType: parsed.clickIdType ?? null,
        });
      }

      if (batch.length < 100) break;
    }

    return orders;
  },
};

// ------------------------------------------------------------------------ GA4

/**
 * Google Analytics 4 — the runData endpoint. GA4 is the fallback revenue source
 * when there is no store API: it gives session-scoped source/medium/campaign
 * next to purchase revenue, which is enough to attribute at channel level even
 * though it cannot name an individual order.
 */
export const ga4Connector: SalesConnector = {
  platform: "ga4",
  kind: "analytics",
  displayName: "Google Analytics 4",
  summary: "Session-level source, medium and campaign against purchase revenue.",
  docsUrl: "https://developers.google.com/analytics/devguides/reporting/data/v1",
  authType: "oauth2",
  requiredEnv: ["GA4_CLIENT_ID", "GA4_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },

  async fetchOrders(ctx: ConnectorContext, range: DateRange): Promise<OrderDraft[]> {
    const propertyId = ctx.externalAccountId;
    if (!propertyId) throw new Error("No GA4 property selected for this connection");

    const response = await request<{
      rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
    }>(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: "POST",
      headers: bearer(ctx.credentials.accessToken),
      body: {
        dateRanges: [{ startDate: range.start, endDate: range.end }],
        dimensions: [
          { name: "date" },
          { name: "sessionSource" },
          { name: "sessionMedium" },
          { name: "sessionCampaignName" },
          { name: "landingPagePlusQueryString" },
        ],
        metrics: [{ name: "purchaseRevenue" }, { name: "transactions" }, { name: "newUsers" }],
        limit: 100000,
      },
    });

    // GA4 aggregates, so each row becomes one synthetic order representing that
    // day/source combination. Revenue and counts stay correct at every level we
    // report on; only per-order detail is unavailable.
    return (response.rows ?? []).flatMap((row) => {
      const [date, source, medium, campaign, landing] = row.dimensionValues.map((d) => d.value);
      const revenue = Number(row.metricValues[0]?.value ?? 0);
      const transactions = Number(row.metricValues[1]?.value ?? 0);
      if (transactions <= 0 && revenue <= 0) return [];
      const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      return [
        {
          connectionId: ctx.connectionId,
          platform: "ga4" as const,
          externalId: `${date}-${source}-${medium}-${campaign}`,
          orderedAt: `${iso}T12:00:00Z`,
          revenue,
          cogs: null,
          currency: (ctx.config.currency as string) ?? "USD",
          customerRef: null,
          isNewCustomer: Number(row.metricValues[2]?.value ?? 0) > 0,
          landingPage: landing ?? null,
          utmSource: source === "(direct)" ? null : source,
          utmMedium: medium === "(none)" ? null : medium,
          utmCampaign: campaign === "(not set)" ? null : campaign,
          utmContent: null,
          utmTerm: null,
          clickId: null,
          clickIdType: null,
        },
      ];
    });
  },
};

export const salesConnectors: SalesConnector[] = [
  shopifyConnector,
  stripeConnector,
  wooCommerceConnector,
  ga4Connector,
];
