import { InspirationSourceError, type ExternalCreative, type InspirationSource } from "./types";

/**
 * Hand-entered creatives.
 *
 * Every API above has a hole: Meta needs EU delivery, TikTok needs research
 * approval, Google has no API at all. This source has none of those problems,
 * because it is you pasting in an ad you saw. It is the fallback that always
 * works, and in practice it is how most competitive research actually starts —
 * somebody screenshots something good.
 *
 * Entries carry whatever dates you supply. Leave them blank and the traction
 * score correctly reports that there is no evidence either way, rather than
 * inventing some.
 */

export interface ManualEntry {
  advertiser: string;
  platform?: string;
  headline?: string;
  body?: string;
  callToAction?: string;
  landingPage?: string;
  permalink?: string;
  /** YYYY-MM-DD, if you know when it started running. */
  firstSeen?: string;
  stillRunning?: boolean;
  notes?: string;
}

export function toExternalCreative(entry: ManualEntry, index = 0): ExternalCreative {
  if (!entry.advertiser?.trim()) {
    throw new InspirationSourceError("manual", "Every entry needs the advertiser's name.");
  }
  if (!entry.headline?.trim() && !entry.body?.trim()) {
    throw new InspirationSourceError("manual", "Give at least a headline or body — there is nothing to analyse otherwise.");
  }

  const slug = `${entry.advertiser}-${entry.headline ?? entry.body ?? ""}-${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80);

  return {
    source: "manual",
    platform: (entry.platform as ExternalCreative["platform"]) ?? "unknown",
    externalId: slug,
    advertiser: entry.advertiser.trim(),
    headline: entry.headline?.trim() || null,
    body: entry.body?.trim() || null,
    callToAction: entry.callToAction?.trim() || null,
    format: null,
    landingPage: entry.landingPage?.trim() || null,
    mediaUrl: null,
    permalink: entry.permalink?.trim() || null,
    firstSeen: entry.firstSeen ?? null,
    lastSeen: null,
    isLive: entry.stillRunning ?? true,
    reachLower: null,
    reachUpper: null,
    countries: [],
    raw: { notes: entry.notes ?? null, enteredByHand: true },
  };
}

export const manualSource: InspirationSource = {
  id: "manual",
  displayName: "Added by hand",
  summary: "Paste in an ad you saw. No API, no approval, works for any platform.",
  docsUrl: "",
  requiredEnv: [],
  capabilities: {
    creativeText: true,
    media: false,
    deliveryDates: true,
    reach: false,
    keywordSearch: false,
    coverage:
      "Only as good as what you enter. Supply a first-seen date if you know it, or the traction " +
      "score will correctly say there is no evidence rather than guessing.",
  },

  async search(): Promise<ExternalCreative[]> {
    // Entries arrive through the UI, not by querying anything.
    throw new InspirationSourceError(
      "manual",
      "Hand-entered creatives are added directly, not searched for.",
    );
  },
};
