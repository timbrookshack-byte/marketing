import type { PlatformId } from "../types";

/**
 * Concept inspiration: what other brands are running, and which of it is
 * probably working.
 *
 * The honest constraint this whole module is built around: **no public source
 * exposes a competitor's performance.** There is no legal way to see another
 * retailer's ROAS, CTR or conversion rate, and any product claiming otherwise is
 * modelling, not measuring.
 *
 * What public ad libraries do expose is *how long an ad has been running* and
 * *how many variants of it exist*. That is the signal, because it is behavioural
 * rather than reported: advertisers kill losers within days. An ad still live
 * after three months has survived a decision to keep paying for it every one of
 * those days. See `traction.ts` for how that is scored — and for what it cannot
 * tell you.
 */

/** Where a creative was observed. */
export type InspirationSourceId =
  | "meta_ad_library"
  | "tiktok_commercial_content"
  | "linkedin_ad_library"
  | "licensed_provider"
  | "manual";

/** A creative someone else is running. */
export interface ExternalCreative {
  source: InspirationSourceId;
  platform: PlatformId | "unknown";
  externalId: string;
  advertiser: string;
  headline: string | null;
  body: string | null;
  callToAction: string | null;
  format: string | null;
  landingPage: string | null;
  mediaUrl: string | null;
  /** Link back to the public library entry, so every claim is checkable. */
  permalink: string | null;
  /** YYYY-MM-DD. The start of delivery as the library reports it. */
  firstSeen: string | null;
  /** YYYY-MM-DD, or null while the ad is still delivering. */
  lastSeen: string | null;
  isLive: boolean;
  /** EU/UK DSA reach disclosure. Null everywhere else — most of the world. */
  reachLower: number | null;
  reachUpper: number | null;
  countries: string[];
  raw: Record<string, unknown>;
}

/**
 * What a source can actually give you. The UI reads these rather than
 * pretending every library is equivalent, because they are very much not.
 */
export interface SourceCapabilities {
  /** Returns the ad's text. Without this a source is only useful for counting. */
  creativeText: boolean;
  /** Returns a usable image or video URL. */
  media: boolean;
  /** Returns delivery start and stop dates — required for traction scoring. */
  deliveryDates: boolean;
  /** Returns impressions or reach bands (EU/UK disclosures only). */
  reach: boolean;
  /** Can search by keyword rather than only by named advertiser. */
  keywordSearch: boolean;
  /** Plain-language description of what this source does not cover. */
  coverage: string;
}

export interface InspirationQuery {
  /** The brand to look up, as that source names it. */
  advertiser?: string;
  /** Source-specific identifier (a Meta page id, a LinkedIn company id…). */
  handle?: string;
  /** Free-text search, where the source supports it. */
  keywords?: string;
  /**
   * ISO country codes to search within. This is not cosmetic: on Meta it
   * decides whether you get commercial ads at all.
   */
  countries: string[];
  limit: number;
}

export interface InspirationSource {
  id: InspirationSourceId;
  displayName: string;
  /** One line explaining what this source is for. */
  summary: string;
  docsUrl: string;
  requiredEnv: string[];
  capabilities: SourceCapabilities;
  /**
   * Set when using this source means agreeing to someone's terms or paying a
   * third party. Surfaced in the UI before anything is fetched.
   */
  caveat?: string;
  search: (query: InspirationQuery) => Promise<ExternalCreative[]>;
}

export interface Competitor {
  id: string;
  name: string;
  domain: string | null;
  category: string | null;
  /** Per-source identifiers, because no two libraries name advertisers alike. */
  handles: Partial<Record<InspirationSourceId, string>>;
  origin: "user" | "suggested";
  notes: string | null;
  createdAt: string;
}

export class InspirationSourceError extends Error {
  readonly sourceId: InspirationSourceId;
  /** True when the fix is configuration rather than a bug. */
  readonly needsSetup: boolean;

  constructor(sourceId: InspirationSourceId, message: string, needsSetup = false) {
    super(message);
    this.name = "InspirationSourceError";
    this.sourceId = sourceId;
    this.needsSetup = needsSetup;
  }
}
