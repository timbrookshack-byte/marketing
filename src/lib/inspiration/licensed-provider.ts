import { request } from "../connectors/http";
import { InspirationSourceError, type ExternalCreative, type InspirationSource } from "./types";

/**
 * Licensed third-party ad-intelligence provider.
 *
 * This exists because of one specific hole: **Google's Ads Transparency Center
 * has no API.** It is a consumer web app with no developer surface, so the
 * largest ad platform in the world is the one you cannot query officially.
 * Google also exposes almost nothing beyond the creative itself — no
 * impressions, spend or engagement outside EU disclosures.
 *
 * The options are therefore to scrape it, or to pay someone who has licensed
 * access. This portal does not scrape: it breaks constantly, it violates terms,
 * and it quietly poisons your analysis when a selector changes and rows stop
 * arriving. Instead this adapter talks to a provider you subscribe to with your
 * own key, normalising SerpApi-shaped and SearchApi-shaped responses — the two
 * common formats — into the same `ExternalCreative` as everything else.
 *
 * Unset the key and the source simply reports itself as unconfigured; nothing
 * else in the module changes.
 */

type ProviderFlavour = "serpapi" | "searchapi" | "custom";

function config(): { url: string; key: string; flavour: ProviderFlavour } {
  const key = process.env.AD_INTEL_PROVIDER_KEY;
  if (!key) {
    throw new InspirationSourceError(
      "licensed_provider",
      "Google's Ads Transparency Center has no official API. To cover Google here, subscribe to " +
        "a licensed provider and set AD_INTEL_PROVIDER_KEY (and AD_INTEL_PROVIDER_URL if it is " +
        "not SerpApi). Meta, TikTok and LinkedIn work without this.",
      true,
    );
  }
  const url = process.env.AD_INTEL_PROVIDER_URL ?? "https://serpapi.com/search";
  const flavour = (process.env.AD_INTEL_PROVIDER_FLAVOUR as ProviderFlavour | undefined)
    ?? (url.includes("serpapi") ? "serpapi" : url.includes("searchapi") ? "searchapi" : "custom");
  return { url, key, flavour };
}

/** The union of the shapes the supported providers return. */
interface ProviderAd {
  advertiser_id?: string;
  advertiser?: string;
  advertiser_name?: string;
  ad_id?: string;
  id?: string;
  format?: string;
  target_domain?: string;
  link?: string;
  url?: string;
  image?: string;
  thumbnail?: string;
  text?: string;
  title?: string;
  description?: string;
  first_shown?: string;
  last_shown?: string;
  details_link?: string;
}

function normaliseDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

export const licensedProviderSource: InspirationSource = {
  id: "licensed_provider",
  displayName: "Google Ads Transparency (via licensed provider)",
  summary: "Covers the gap Google leaves: search, Display, YouTube and Shopping creatives.",
  docsUrl: "https://adstransparency.google.com/",
  requiredEnv: ["AD_INTEL_PROVIDER_KEY"],
  capabilities: {
    creativeText: true,
    media: true,
    deliveryDates: true,
    reach: false,
    keywordSearch: false,
    coverage:
      "Google publishes the creative and little else — no impressions, spend or engagement " +
      "outside EU disclosures. Search is by advertiser or domain, not by keyword.",
  },
  caveat:
    "Google has no official API for the Ads Transparency Center, so this routes through a paid " +
    "third party on your own subscription. Nothing here scrapes Google directly.",

  async search(query): Promise<ExternalCreative[]> {
    const { url, key, flavour } = config();
    const advertiser = query.advertiser ?? query.handle;
    if (!advertiser) {
      throw new InspirationSourceError(
        "licensed_provider",
        "Google's transparency data is indexed by advertiser or domain, not by keyword.",
      );
    }

    const response = await request<{
      ad_creatives?: ProviderAd[];
      ads?: ProviderAd[];
      error?: string;
    }>(url, {
      query: {
        engine: "google_ads_transparency_center",
        [flavour === "searchapi" ? "q" : "text"]: advertiser,
        region: query.countries[0] ?? "US",
        api_key: key,
        num: Math.min(query.limit, 100),
      },
    });

    if (response.error) throw new InspirationSourceError("licensed_provider", response.error);

    const ads = response.ad_creatives ?? response.ads ?? [];
    return ads.map((ad) => ({
      source: "licensed_provider" as const,
      platform: "google_ads" as const,
      externalId: String(ad.ad_id ?? ad.id ?? `${advertiser}-${ad.first_shown ?? ""}`),
      advertiser: ad.advertiser_name ?? ad.advertiser ?? advertiser,
      headline: ad.title ?? null,
      body: ad.text ?? ad.description ?? null,
      callToAction: null,
      format: ad.format ?? null,
      landingPage: ad.target_domain ?? ad.link ?? null,
      mediaUrl: ad.image ?? ad.thumbnail ?? null,
      permalink: ad.details_link ?? ad.url ?? null,
      firstSeen: normaliseDate(ad.first_shown),
      lastSeen: normaliseDate(ad.last_shown),
      // Providers report last-shown even for running ads, so "live" means seen
      // within the last week rather than an explicit flag.
      isLive: (() => {
        const last = normaliseDate(ad.last_shown);
        if (!last) return true;
        return Date.now() - Date.parse(last) < 7 * 86_400_000;
      })(),
      reachLower: null,
      reachUpper: null,
      countries: query.countries,
      raw: ad as unknown as Record<string, unknown>,
    }));
  },
};
