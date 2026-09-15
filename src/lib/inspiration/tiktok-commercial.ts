import { request } from "../connectors/http";
import { InspirationSourceError, type ExternalCreative, type InspirationSource } from "./types";

/**
 * TikTok Commercial Content API.
 *
 * TikTok's official transparency surface, built for researchers and regulators
 * rather than for competitive research, which shows in two ways:
 *
 *   - it returns metadata only, with no downloadable video or image asset, so
 *     you learn what a brand is saying but not how it looks;
 *   - coverage started with EU data and expands from there, so non-EU delivery
 *     is patchy.
 *
 * It is still worth having, because ad text plus first/last-seen dates is
 * exactly what the angle analysis needs. TikTok's Creative Center "Top Ads"
 * is the richer browsing experience but has no API, so it is not wired here.
 */

const API_BASE = "https://open.tiktokapis.com/v2/research/adlib";

interface TikTokAd {
  ad_id?: string;
  advertiser_business_name?: string;
  ad_group?: { ad_group_name?: string };
  first_shown_date?: string;
  last_shown_date?: string;
  status?: string;
  videos?: { url?: string }[];
  image_urls?: string[];
  ad_text?: string;
  landing_page?: string;
  reach?: { unique_users_seen?: number };
}

/**
 * Commercial Content API calls need a client-credentials token rather than a
 * long-lived key, so it is fetched on demand and cached for its lifetime.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const clientKey = process.env.TIKTOK_RESEARCH_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_RESEARCH_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new InspirationSourceError(
      "tiktok_commercial_content",
      "Set TIKTOK_RESEARCH_CLIENT_KEY and TIKTOK_RESEARCH_CLIENT_SECRET. Access is granted " +
        "through TikTok's research application, not the normal advertiser login.",
      true,
    );
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const response = await request<{ access_token?: string; expires_in?: number; error?: string }>(
    "https://open.tiktokapis.com/v2/oauth/token/",
    {
      method: "POST",
      form: {
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      },
    },
  );

  if (!response.access_token) {
    throw new InspirationSourceError(
      "tiktok_commercial_content",
      `TikTok refused the credentials${response.error ? `: ${response.error}` : ""}`,
    );
  }

  cachedToken = {
    value: response.access_token,
    expiresAt: Date.now() + (response.expires_in ?? 7200) * 1000,
  };
  return cachedToken.value;
}

export const tiktokCommercialSource: InspirationSource = {
  id: "tiktok_commercial_content",
  displayName: "TikTok Commercial Content Library",
  summary: "Ad text and delivery dates for brands advertising on TikTok.",
  docsUrl: "https://developers.tiktok.com/products/commercial-content-api",
  requiredEnv: ["TIKTOK_RESEARCH_CLIENT_KEY", "TIKTOK_RESEARCH_CLIENT_SECRET"],
  capabilities: {
    creativeText: true,
    media: false,
    deliveryDates: true,
    reach: true,
    keywordSearch: true,
    coverage:
      "Metadata only — no downloadable video. Coverage began with EU delivery and is still " +
      "expanding, so results outside the EU are incomplete.",
  },
  caveat:
    "Access is granted through TikTok's research programme rather than an advertiser account, " +
    "and approval is not automatic.",

  async search(query): Promise<ExternalCreative[]> {
    const token = await accessToken();
    const advertiser = query.advertiser ?? query.handle;

    if (!advertiser && !query.keywords) {
      throw new InspirationSourceError("tiktok_commercial_content", "Give an advertiser name or keywords.");
    }

    const response = await request<{
      data?: { ads?: TikTokAd[] };
      error?: { message?: string; code?: string };
    }>(`${API_BASE}/ad/query/`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      query: {
        fields: [
          "ad_id",
          "advertiser_business_name",
          "first_shown_date",
          "last_shown_date",
          "status",
          "videos",
          "image_urls",
          "ad_text",
          "landing_page",
          "reach",
        ].join(","),
      },
      body: {
        filters: {
          advertiser_business_ids: [],
          ad_published_date_range: {},
          ...(advertiser ? { search_term: advertiser } : { search_term: query.keywords }),
          country_code: query.countries[0] ?? "GB",
        },
        max_count: Math.min(query.limit, 50),
      },
    });

    if (response.error?.message && response.error.code !== "ok") {
      throw new InspirationSourceError("tiktok_commercial_content", response.error.message);
    }

    return (response.data?.ads ?? []).map((ad) => ({
      source: "tiktok_commercial_content" as const,
      platform: "tiktok_ads" as const,
      externalId: String(ad.ad_id ?? ""),
      advertiser: ad.advertiser_business_name ?? advertiser ?? "Unknown advertiser",
      headline: null,
      body: ad.ad_text ?? null,
      callToAction: null,
      format: "video",
      landingPage: ad.landing_page ?? null,
      mediaUrl: ad.videos?.[0]?.url ?? ad.image_urls?.[0] ?? null,
      permalink: null,
      firstSeen: ad.first_shown_date?.slice(0, 10) ?? null,
      lastSeen: ad.last_shown_date?.slice(0, 10) ?? null,
      isLive: (ad.status ?? "").toLowerCase() === "active" || !ad.last_shown_date,
      reachLower: ad.reach?.unique_users_seen ?? null,
      reachUpper: ad.reach?.unique_users_seen ?? null,
      countries: query.countries,
      raw: ad as unknown as Record<string, unknown>,
    }));
  },
};
