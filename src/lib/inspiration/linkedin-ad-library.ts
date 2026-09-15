import { request } from "../connectors/http";
import { InspirationSourceError, type ExternalCreative, type InspirationSource } from "./types";

/**
 * LinkedIn Ad Library.
 *
 * Narrow but high-signal for B2B: LinkedIn advertisers iterate slowly and run
 * ads for long stretches, which makes the longevity signal unusually clean here.
 * It reuses the LinkedIn Ads OAuth client already configured for the reporting
 * connector rather than asking for a second set of credentials.
 */

const API_BASE = "https://api.linkedin.com/rest/adLibrary";
const VERSION = process.env.LINKEDIN_ADS_API_VERSION ?? "202411";

interface LibraryAd {
  adId?: string;
  advertiserName?: string;
  headline?: string;
  description?: string;
  callToAction?: string;
  landingPageUrl?: string;
  thumbnailUrl?: string;
  adUrl?: string;
  firstImpressionAt?: number;
  latestImpressionAt?: number;
  isActive?: boolean;
  countries?: string[];
}

export const linkedInAdLibrarySource: InspirationSource = {
  id: "linkedin_ad_library",
  displayName: "LinkedIn Ad Library",
  summary: "What B2B competitors are running, by company and date range.",
  docsUrl: "https://www.linkedin.com/help/linkedin/answer/a1517918",
  requiredEnv: ["LINKEDIN_AD_LIBRARY_TOKEN"],
  capabilities: {
    creativeText: true,
    media: true,
    deliveryDates: true,
    reach: false,
    keywordSearch: true,
    coverage:
      "B2B only in practice. No impression or reach figures outside EU disclosures, so " +
      "traction here rests entirely on how long an ad has run.",
  },

  async search(query): Promise<ExternalCreative[]> {
    const token = process.env.LINKEDIN_AD_LIBRARY_TOKEN;
    if (!token) {
      throw new InspirationSourceError(
        "linkedin_ad_library",
        "Set LINKEDIN_AD_LIBRARY_TOKEN — an access token with r_ads_library scope.",
        true,
      );
    }

    const response = await request<{ elements?: LibraryAd[] }>(API_BASE, {
      headers: {
        authorization: `Bearer ${token}`,
        "LinkedIn-Version": VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      query: {
        q: "criteria",
        ...(query.handle ? { advertiser: query.handle } : {}),
        ...(query.advertiser ? { advertiserName: query.advertiser } : {}),
        ...(query.keywords ? { keyword: query.keywords } : {}),
        countries: query.countries.join(","),
        count: Math.min(query.limit, 100),
      },
    });

    return (response.elements ?? []).map((ad) => ({
      source: "linkedin_ad_library" as const,
      platform: "linkedin_ads" as const,
      externalId: String(ad.adId ?? ""),
      advertiser: ad.advertiserName ?? query.advertiser ?? "Unknown advertiser",
      headline: ad.headline ?? null,
      body: ad.description ?? null,
      callToAction: ad.callToAction ?? null,
      format: "native",
      landingPage: ad.landingPageUrl ?? null,
      mediaUrl: ad.thumbnailUrl ?? null,
      permalink: ad.adUrl ?? null,
      firstSeen: ad.firstImpressionAt
        ? new Date(ad.firstImpressionAt).toISOString().slice(0, 10)
        : null,
      lastSeen:
        ad.latestImpressionAt && !ad.isActive
          ? new Date(ad.latestImpressionAt).toISOString().slice(0, 10)
          : null,
      isLive: Boolean(ad.isActive),
      reachLower: null,
      reachUpper: null,
      countries: ad.countries ?? query.countries,
      raw: ad as unknown as Record<string, unknown>,
    }));
  },
};
