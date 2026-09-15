import { request } from "../connectors/http";
import { InspirationSourceError, type ExternalCreative, type InspirationSource } from "./types";

/**
 * Meta Ad Library — the `ads_archive` Graph API endpoint.
 *
 * The single most important thing to know before using this, and the reason
 * `EU_UK_COUNTRIES` exists:
 *
 *   `ad_type=ALL` returns ordinary commercial ads **only when
 *   `ad_reached_countries` names EU member states or the UK.** Anywhere else,
 *   the archive returns ads about social issues, elections and politics and
 *   nothing more.
 *
 * That is a consequence of the DSA ad-repository rules rather than a quirk of
 * the API, and it has a practical consequence for a US or APAC retailer: you can
 * still research any competitor who also advertises in Europe (most large ones
 * do), but a purely domestic rival will return nothing. The connector detects
 * that case and says so, instead of returning an empty list that looks like
 * "this brand runs no ads".
 *
 * Retention for non-political ads is roughly twelve months from last impression.
 */

const API_VERSION = process.env.META_ADS_API_VERSION ?? "v21.0";
const ENDPOINT = `https://graph.facebook.com/${API_VERSION}/ads_archive`;

/** Where `ad_type=ALL` actually returns commercial ads. */
export const EU_UK_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE", "GB",
];

const EU_UK = new Set(EU_UK_COUNTRIES);

export function hasCommercialCoverage(countries: string[]): boolean {
  return countries.some((code) => EU_UK.has(code.toUpperCase()));
}

interface ArchiveAd {
  id: string;
  page_name?: string;
  page_id?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_captions?: string[];
  ad_snapshot_url?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  publisher_platforms?: string[];
  languages?: string[];
  eu_total_reach?: number;
  impressions?: { lower_bound?: string; upper_bound?: string };
  target_locations?: { name?: string }[];
}

function token(): string {
  const value = process.env.META_AD_LIBRARY_TOKEN ?? process.env.META_ADS_ACCESS_TOKEN;
  if (!value) {
    throw new InspirationSourceError(
      "meta_ad_library",
      "Set META_AD_LIBRARY_TOKEN to search the Meta Ad Library. It needs a user access token " +
        "from an app whose owner has completed Meta's identity confirmation.",
      true,
    );
  }
  return value;
}

export const metaAdLibrarySource: InspirationSource = {
  id: "meta_ad_library",
  displayName: "Meta Ad Library",
  summary: "Every ad a brand runs on Facebook and Instagram, with delivery dates.",
  docsUrl: "https://www.facebook.com/ads/library/api/",
  requiredEnv: ["META_AD_LIBRARY_TOKEN"],
  capabilities: {
    creativeText: true,
    media: false, // The snapshot URL is a rendered page, not a downloadable asset.
    deliveryDates: true,
    reach: true,
    keywordSearch: true,
    coverage:
      "Commercial ads are returned only for EU and UK delivery; elsewhere the archive is " +
      "limited to political and social-issue ads. Non-political ads are retained about 12 months.",
  },
  caveat:
    "Requires a Meta access token from an identity-confirmed app. A competitor who never " +
    "advertises in the EU or UK will legitimately return no results.",

  async search(query): Promise<ExternalCreative[]> {
    const countries = query.countries.length ? query.countries : EU_UK_COUNTRIES.slice(0, 8);

    if (!hasCommercialCoverage(countries)) {
      throw new InspirationSourceError(
        "meta_ad_library",
        `Meta only returns commercial ads for EU/UK delivery. Searching ${countries.join(", ")} ` +
          "would return political ads only — add at least one EU country or GB to this search.",
      );
    }

    const terms = query.advertiser ?? query.keywords;
    if (!terms && !query.handle) {
      throw new InspirationSourceError("meta_ad_library", "Give an advertiser name, a page id, or keywords.");
    }

    const page = await request<{ data?: ArchiveAd[]; error?: { message: string } }>(ENDPOINT, {
      query: {
        access_token: token(),
        ad_type: "ALL",
        ad_reached_countries: JSON.stringify(countries),
        ad_active_status: "ALL",
        // A page id is exact; a name is a guess, so prefer the id when we have one.
        ...(query.handle
          ? { search_page_ids: JSON.stringify([query.handle]) }
          : { search_terms: terms }),
        limit: Math.min(query.limit, 100),
        fields: [
          "id",
          "page_name",
          "page_id",
          "ad_creative_bodies",
          "ad_creative_link_titles",
          "ad_creative_link_descriptions",
          "ad_creative_link_captions",
          "ad_snapshot_url",
          "ad_delivery_start_time",
          "ad_delivery_stop_time",
          "publisher_platforms",
          "languages",
          "eu_total_reach",
          "impressions",
          "target_locations",
        ].join(","),
      },
    });

    if (page.error) {
      throw new InspirationSourceError("meta_ad_library", page.error.message);
    }

    return (page.data ?? []).map((ad) => {
      const reach = ad.eu_total_reach ?? null;
      return {
        source: "meta_ad_library" as const,
        platform: "meta_ads" as const,
        externalId: ad.id,
        advertiser: ad.page_name ?? query.advertiser ?? "Unknown advertiser",
        headline: ad.ad_creative_link_titles?.[0] ?? null,
        body: ad.ad_creative_bodies?.[0] ?? null,
        callToAction: ad.ad_creative_link_captions?.[0] ?? null,
        format: ad.publisher_platforms?.join(", ") ?? null,
        landingPage: null,
        mediaUrl: null,
        permalink: ad.ad_snapshot_url ?? null,
        firstSeen: ad.ad_delivery_start_time?.slice(0, 10) ?? null,
        // No stop time means it is still delivering — which is the whole signal.
        lastSeen: ad.ad_delivery_stop_time?.slice(0, 10) ?? null,
        isLive: !ad.ad_delivery_stop_time,
        reachLower: reach ?? (ad.impressions?.lower_bound ? Number(ad.impressions.lower_bound) : null),
        reachUpper: reach ?? (ad.impressions?.upper_bound ? Number(ad.impressions.upper_bound) : null),
        countries,
        raw: ad as unknown as Record<string, unknown>,
      };
    });
  },
};
