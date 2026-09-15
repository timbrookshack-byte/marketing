import { addDays, todayISO } from "../util";
import { saveCreatives, upsertCompetitor } from "./repo";
import type { ExternalCreative } from "./types";

/**
 * Demo competitive set.
 *
 * Built so the traction scoring is visibly doing something rather than just
 * listing ads. The set contains, on purpose:
 *
 *   - a concept three different brands run and have all kept live for months
 *     (the strongest possible public signal, and a genuine gap for us)
 *   - a concept one brand has iterated into six variants
 *   - ads that were cut after three weeks, which should rank near the bottom
 *   - a brand-awareness ad running a year, to show why longevity alone is not
 *     proof of profit
 *
 * Dates are generated relative to today so the numbers stay sensible whenever
 * this is run.
 */

interface DemoAd {
  advertiser: string;
  platform: ExternalCreative["platform"];
  headline: string;
  body: string;
  cta: string;
  /** Days before today that delivery started. */
  startedDaysAgo: number;
  /** Days before today it stopped, or null if still running. */
  stoppedDaysAgo: number | null;
  source: ExternalCreative["source"];
  reach?: [number, number];
}

const ADS: DemoAd[] = [
  // --- The cross-brand consensus: "the cheap one costs more in the end".
  // Three brands, all long-running. This is the gap the analysis should find.
  {
    advertiser: "Northfell Goods",
    platform: "meta_ads",
    headline: "Buy it once",
    body: "The £29 one lasts a season. Ours is still going after nine years — we have the repair records to prove it.",
    cta: "See the guarantee",
    startedDaysAgo: 214,
    stoppedDaysAgo: null,
    source: "meta_ad_library",
    reach: [500_000, 600_000],
  },
  {
    advertiser: "Harrow & Main",
    platform: "meta_ads",
    headline: "Replacing it twice costs more",
    body: "Do the maths on the cheap version. Three years, two replacements, and you have spent more than ours costs today.",
    cta: "Compare",
    startedDaysAgo: 168,
    stoppedDaysAgo: null,
    source: "meta_ad_library",
    reach: [200_000, 300_000],
  },
  {
    advertiser: "Cadence Supply",
    platform: "google_ads",
    headline: "Cheaper Twice Is Not Cheaper",
    body: "Built to outlast the replacements. 10-year guarantee, parts included.",
    cta: "Shop now",
    startedDaysAgo: 131,
    stoppedDaysAgo: null,
    source: "licensed_provider",
  },

  // --- One brand iterating hard on a single concept: six near-duplicates.
  ...["Still deciding?", "Left something behind", "Still in your basket", "It is still here", "Your basket is waiting", "Nearly yours"].map(
    (headline, index): DemoAd => ({
      advertiser: "Harrow & Main",
      platform: "meta_ads",
      headline,
      body: "Free returns if it is not right. Most orders arrive next day.",
      cta: "Finish order",
      startedDaysAgo: 96 - index * 7,
      stoppedDaysAgo: null,
      source: "meta_ad_library",
    }),
  ),

  // --- Proven, and we do run something like it: should NOT read as a gap.
  {
    advertiser: "Northfell Goods",
    platform: "meta_ads",
    headline: "Free returns, always",
    body: "Send anything back within 30 days. No forms, no questions, no restocking fee.",
    cta: "Shop now",
    startedDaysAgo: 142,
    stoppedDaysAgo: null,
    source: "meta_ad_library",
  },

  // --- A second real gap: the sustainability/repair angle, two brands, long-lived.
  {
    advertiser: "Cadence Supply",
    platform: "tiktok_ads",
    headline: "We will fix it, not sell you another",
    body: "Send it back at any age and we repair it. Watch our workshop do it in 40 seconds.",
    cta: "Watch",
    startedDaysAgo: 121,
    stoppedDaysAgo: null,
    source: "tiktok_commercial_content",
  },
  {
    advertiser: "Verity Home",
    platform: "tiktok_ads",
    headline: "Repaired, not replaced",
    body: "Every return gets refurbished and resold. Nothing we make goes to landfill.",
    cta: "Learn more",
    startedDaysAgo: 98,
    stoppedDaysAgo: null,
    source: "tiktok_commercial_content",
  },

  // --- Long-running brand film: the cautionary case. A year live, but this is
  // brand budget, not a performance line. The analysis should flag the ambiguity.
  {
    advertiser: "Verity Home",
    platform: "meta_ads",
    headline: "Made in Sheffield since 1946",
    body: "Four generations, one workshop. A short film about the people who build it.",
    cta: "Watch the film",
    startedDaysAgo: 372,
    stoppedDaysAgo: null,
    source: "meta_ad_library",
    reach: [1_200_000, 1_400_000],
  },

  // --- Tried and cut. Should rank near the bottom and be read as a warning.
  {
    advertiser: "Northfell Goods",
    platform: "meta_ads",
    headline: "40% off this weekend only",
    body: "Two days. Everything reduced. Ends Sunday at midnight.",
    cta: "Shop the sale",
    startedDaysAgo: 64,
    stoppedDaysAgo: 43,
    source: "meta_ad_library",
  },
  {
    advertiser: "Harrow & Main",
    platform: "meta_ads",
    headline: "Meet the new collection",
    body: "Twelve new pieces, designed in-house.",
    cta: "Browse",
    startedDaysAgo: 88,
    stoppedDaysAgo: 71,
    source: "meta_ad_library",
  },

  // --- Too new to read. Should be scored as 'early', not ranked highly.
  {
    advertiser: "Cadence Supply",
    platform: "meta_ads",
    headline: "Winter kit, restocked",
    body: "The pieces that sold out in November are back.",
    cta: "Shop now",
    startedDaysAgo: 11,
    stoppedDaysAgo: null,
    source: "meta_ad_library",
  },

  // --- B2B-flavoured, long-lived, on a channel we barely use.
  {
    advertiser: "Cadence Supply",
    platform: "linkedin_ads",
    headline: "The procurement case for buying better",
    body: "A cost-per-year comparison across a five-year replacement cycle. Free, no gate.",
    cta: "Download",
    startedDaysAgo: 156,
    stoppedDaysAgo: null,
    source: "linkedin_ad_library",
  },
];

const COMPETITORS = [
  {
    name: "Northfell Goods",
    domain: "northfell.example",
    category: "Premium home and outdoor goods",
    handles: { meta_ad_library: "100000000000001" },
  },
  {
    name: "Harrow & Main",
    domain: "harrowandmain.example",
    category: "Mid-market homeware, heavy retargeting",
    handles: { meta_ad_library: "100000000000002" },
  },
  {
    name: "Cadence Supply",
    domain: "cadencesupply.example",
    category: "Direct-to-consumer, repair-led positioning",
    handles: { meta_ad_library: "100000000000003" },
  },
  {
    name: "Verity Home",
    domain: "verityhome.example",
    category: "Heritage brand, brand-led spend",
    handles: { meta_ad_library: "100000000000004" },
  },
] as const;

export function generateInspirationDemoData(): { competitors: number; creatives: number } {
  const today = todayISO();
  const idByName = new Map<string, string>();

  for (const spec of COMPETITORS) {
    const competitor = upsertCompetitor({
      name: spec.name,
      domain: spec.domain,
      category: spec.category,
      handles: spec.handles,
      origin: "user",
      notes: "Demo competitor — no live API calls are made for these.",
    });
    idByName.set(spec.name, competitor.id);
  }

  let total = 0;
  for (const [name, competitorId] of idByName) {
    const creatives: ExternalCreative[] = ADS.filter((ad) => ad.advertiser === name).map(
      (ad, index) => ({
        source: ad.source,
        platform: ad.platform,
        externalId: `demo-${name}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        advertiser: ad.advertiser,
        headline: ad.headline,
        body: ad.body,
        callToAction: ad.cta,
        format: ad.platform === "tiktok_ads" ? "video" : "image",
        landingPage: null,
        mediaUrl: null,
        permalink: null,
        firstSeen: addDays(today, -ad.startedDaysAgo),
        lastSeen: ad.stoppedDaysAgo === null ? null : addDays(today, -ad.stoppedDaysAgo),
        isLive: ad.stoppedDaysAgo === null,
        reachLower: ad.reach?.[0] ?? null,
        reachUpper: ad.reach?.[1] ?? null,
        countries: ["GB", "IE", "DE"],
        raw: { demo: true },
      }),
    );
    total += saveCreatives(creatives, competitorId);
  }

  return { competitors: idByName.size, creatives: total };
}
