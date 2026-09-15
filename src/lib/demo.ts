import {
  saveCredentials,
  setConnectionStatus,
  upsertAdGroups,
  upsertAds,
  upsertCampaigns,
  upsertConnection,
  upsertMetrics,
  upsertOrders,
} from "./repo";
import { addDays, mulberry32, stableId, todayISO } from "./util";
import { generateInspirationDemoData } from "./inspiration/demo";
import type { CreativeFormat, MetricRow, PlatformId, SalesOrder } from "./types";

/**
 * Demo data generator.
 *
 * The point is not to make the dashboard look busy — it is to make the analysis
 * layer provable. Each campaign profile below is built to trigger a specific
 * diagnostic, so anyone can see what the portal catches before connecting a real
 * account:
 *
 *   - Meta "Cold Prospecting Video" spends with no attributed orders at all
 *   - Meta "Broad Reach Always-On" converts but below break-even
 *   - Meta "Retargeting Dynamic" is a winner pinned against its daily budget
 *   - OpenAI "Conversational Q&A" has a tracking gap: the platform claims sales
 *     the store cannot see
 *   - Google "Performance Max Catch-All" is drifting downward mid-window
 *   - TikTok "Creator Collab" has one fatigued creative dragging the set
 *
 * Numbers are generated from a fixed seed, so the same story appears every time.
 */

interface CampaignProfile {
  platform: PlatformId;
  name: string;
  objective: string;
  status: "active" | "paused";
  dailyBudget: number | null;
  /** Daily spend at the start of the window. */
  baseSpend: number;
  /** Multiplier applied linearly across the window: 1.4 means spend grew 40%. */
  spendTrend: number;
  cpc: number;
  ctr: number;
  /** Orders per click. */
  conversionRate: number;
  /** Multiplier on conversion rate across the window — below 1 means decaying. */
  performanceTrend: number;
  aov: number;
  /** Share of real orders that carry a click id or UTM we can match. */
  trackingCoverage: number;
  /** How much more the platform claims than the store records. */
  platformInflation: number;
  ads: { name: string; headline: string; body: string; cta: string; format: CreativeFormat; weight: number; ctrFactor: number }[];
}

const PROFILES: CampaignProfile[] = [
  // ---------------------------------------------------------------- Google Ads
  {
    platform: "google_ads",
    name: "Brand Search — Exact",
    objective: "SEARCH",
    status: "active",
    dailyBudget: 120,
    baseSpend: 95,
    spendTrend: 1.05,
    cpc: 1.1,
    ctr: 0.18,
    conversionRate: 0.14,
    performanceTrend: 1.0,
    aov: 118,
    trackingCoverage: 0.94,
    platformInflation: 1.15,
    ads: [
      {
        name: "Brand RSA — Official Store",
        headline: "Official Store | Free Returns",
        body: "Shop the full range direct. Free shipping over $50.",
        cta: "Shop now",
        format: "responsive_search",
        weight: 1,
        ctrFactor: 1,
      },
    ],
  },
  {
    platform: "google_ads",
    name: "Non-Brand Search — Category Terms",
    objective: "SEARCH",
    status: "active",
    dailyBudget: 400,
    baseSpend: 340,
    spendTrend: 1.15,
    cpc: 2.4,
    ctr: 0.062,
    conversionRate: 0.048,
    performanceTrend: 0.95,
    aov: 104,
    trackingCoverage: 0.88,
    platformInflation: 1.35,
    ads: [
      {
        name: "Category RSA — Value",
        headline: "Built To Last | From $39",
        body: "Rated 4.8 by 12,000 customers. Ships in 24 hours.",
        cta: "Shop now",
        format: "responsive_search",
        weight: 0.6,
        ctrFactor: 1.1,
      },
      {
        name: "Category RSA — Guarantee",
        headline: "30-Day Money Back | Free Returns",
        body: "Try it risk free. Return anything within 30 days, no questions.",
        cta: "Learn more",
        format: "responsive_search",
        weight: 0.4,
        ctrFactor: 0.9,
      },
    ],
  },
  {
    platform: "google_ads",
    name: "Shopping — Best Sellers",
    objective: "SHOPPING",
    status: "active",
    dailyBudget: 260,
    baseSpend: 245,
    spendTrend: 1.1,
    cpc: 0.85,
    ctr: 0.09,
    conversionRate: 0.045,
    performanceTrend: 1.02,
    aov: 96,
    trackingCoverage: 0.91,
    platformInflation: 1.2,
    ads: [
      {
        name: "Shopping feed — core SKUs",
        headline: "Best Sellers",
        body: "Product listing ads across the top 40 SKUs.",
        cta: "Shop now",
        format: "image",
        weight: 1,
        ctrFactor: 1,
      },
    ],
  },
  {
    platform: "google_ads",
    name: "Performance Max — Catch-All",
    objective: "PERFORMANCE_MAX",
    status: "active",
    dailyBudget: 300,
    baseSpend: 210,
    spendTrend: 1.45,
    cpc: 1.6,
    ctr: 0.031,
    conversionRate: 0.019,
    // Efficiency falls away as the campaign scales into weaker inventory.
    performanceTrend: 0.62,
    aov: 88,
    trackingCoverage: 0.72,
    platformInflation: 1.8,
    ads: [
      {
        name: "PMax asset group — evergreen",
        headline: "Everything You Need, One Place",
        body: "Automated placements across Search, Display, YouTube and Discover.",
        cta: "Shop now",
        format: "native",
        weight: 1,
        ctrFactor: 1,
      },
    ],
  },
  // ------------------------------------------------------------------ Meta Ads
  {
    platform: "meta_ads",
    name: "Retargeting — Dynamic Product",
    objective: "OUTCOME_SALES",
    status: "active",
    // Pinned at its cap: spend runs right up against this every day.
    dailyBudget: 150,
    baseSpend: 144,
    spendTrend: 1.0,
    cpc: 0.62,
    ctr: 0.021,
    conversionRate: 0.078,
    performanceTrend: 1.04,
    aov: 112,
    trackingCoverage: 0.9,
    platformInflation: 1.4,
    ads: [
      {
        name: "DPA — carousel, viewed products",
        headline: "Still thinking it over?",
        body: "The items you looked at are still in stock. Free returns if it is not right.",
        cta: "Shop now",
        format: "carousel",
        weight: 1,
        ctrFactor: 1,
      },
    ],
  },
  {
    platform: "meta_ads",
    name: "Cold Prospecting — Video Views",
    objective: "OUTCOME_AWARENESS",
    status: "active",
    dailyBudget: 250,
    baseSpend: 228,
    spendTrend: 1.12,
    cpc: 1.35,
    ctr: 0.008,
    // Optimised for video views, so it buys attention and no purchases at all.
    conversionRate: 0,
    performanceTrend: 1,
    aov: 0,
    trackingCoverage: 0,
    platformInflation: 0,
    ads: [
      {
        name: "Brand film 30s",
        headline: "Made for the long haul",
        body: "The story behind how we build. 30 seconds.",
        cta: "Watch more",
        format: "video",
        weight: 0.55,
        ctrFactor: 1.15,
      },
      {
        name: "Founder cut 15s",
        headline: "Why we started",
        body: "Two people, one workshop, a lot of prototypes.",
        cta: "Learn more",
        format: "video",
        weight: 0.45,
        ctrFactor: 0.85,
      },
    ],
  },
  {
    platform: "meta_ads",
    name: "Broad Reach — Always-On",
    objective: "OUTCOME_SALES",
    status: "active",
    dailyBudget: 320,
    baseSpend: 295,
    spendTrend: 1.08,
    cpc: 1.05,
    ctr: 0.013,
    // Converts, but each sale costs more than its margin.
    conversionRate: 0.012,
    performanceTrend: 0.93,
    aov: 79,
    trackingCoverage: 0.85,
    platformInflation: 1.9,
    ads: [
      {
        name: "Static — lifestyle hero",
        headline: "Everyday essentials, done properly",
        body: "Free shipping over $50. Rated 4.8 by 12,000 customers.",
        cta: "Shop now",
        format: "image",
        weight: 0.5,
        ctrFactor: 1,
      },
      {
        name: "Static — price led",
        headline: "From $39",
        body: "Quality that outlasts the cheap stuff. See the range.",
        cta: "Shop now",
        format: "image",
        weight: 0.5,
        ctrFactor: 1,
      },
    ],
  },
  {
    platform: "meta_ads",
    name: "Lookalike 1% — Purchasers",
    objective: "OUTCOME_SALES",
    status: "active",
    dailyBudget: 180,
    baseSpend: 162,
    spendTrend: 1.06,
    cpc: 0.94,
    ctr: 0.016,
    conversionRate: 0.034,
    performanceTrend: 0.99,
    aov: 101,
    trackingCoverage: 0.87,
    platformInflation: 1.5,
    ads: [
      {
        name: "UGC — unboxing",
        headline: "Worth every penny",
        body: "Real customers, real reviews, no scripts.",
        cta: "Shop now",
        format: "video",
        weight: 1,
        ctrFactor: 1,
      },
    ],
  },
  // ---------------------------------------------------------------- OpenAI Ads
  {
    platform: "openai_ads",
    name: "Assistant Placement — High Intent",
    objective: "CONVERSIONS",
    status: "active",
    dailyBudget: 140,
    baseSpend: 118,
    spendTrend: 1.3,
    cpc: 1.45,
    ctr: 0.048,
    conversionRate: 0.061,
    performanceTrend: 1.08,
    aov: 128,
    trackingCoverage: 0.89,
    platformInflation: 1.25,
    ads: [
      {
        name: "Answer-style — comparison intent",
        headline: "Comparing options? Here is the honest version",
        body: "Independent spec comparison, no sign-up needed.",
        cta: "See comparison",
        format: "conversational",
        weight: 1,
        ctrFactor: 1,
      },
    ],
  },
  {
    platform: "openai_ads",
    name: "Conversational Q&A — Broad",
    objective: "CONVERSIONS",
    status: "active",
    dailyBudget: 110,
    baseSpend: 96,
    spendTrend: 1.2,
    cpc: 1.1,
    ctr: 0.036,
    conversionRate: 0.052,
    performanceTrend: 1.0,
    aov: 94,
    // The UTM template is broken, so barely any order can be traced back.
    trackingCoverage: 0.18,
    platformInflation: 1.3,
    ads: [
      {
        name: "Answer-style — how do I",
        headline: "The short answer",
        body: "A practical guide, plus the kit that does the job.",
        cta: "Read guide",
        format: "conversational",
        weight: 1,
        ctrFactor: 1,
      },
    ],
  },
  // ---------------------------------------------------------------- TikTok Ads
  {
    platform: "tiktok_ads",
    name: "Creator Collab — Spark Ads",
    objective: "CONVERSIONS",
    status: "active",
    dailyBudget: 220,
    baseSpend: 186,
    spendTrend: 1.18,
    cpc: 0.71,
    ctr: 0.014,
    conversionRate: 0.027,
    performanceTrend: 0.88,
    aov: 86,
    trackingCoverage: 0.79,
    platformInflation: 1.7,
    ads: [
      {
        name: "Creator A — day in the life",
        headline: "How I actually use it",
        body: "Unscripted creator cut, 22 seconds.",
        cta: "Shop now",
        format: "video",
        weight: 0.45,
        ctrFactor: 1.45,
      },
      {
        name: "Creator B — tutorial",
        headline: "Three ways to use it",
        body: "Quick tutorial cut for the feed.",
        cta: "Learn more",
        format: "video",
        weight: 0.3,
        ctrFactor: 1.05,
      },
      {
        // Deliberately fatigued: same spend, far worse engagement.
        name: "Studio cut — polished",
        headline: "Introducing the range",
        body: "Studio-shot product film, 30 seconds.",
        cta: "Shop now",
        format: "video",
        weight: 0.25,
        ctrFactor: 0.32,
      },
    ],
  },
  // -------------------------------------------------------------- LinkedIn Ads
  {
    platform: "linkedin_ads",
    name: "B2B — Operations Buyers",
    objective: "LEAD_GENERATION",
    status: "active",
    dailyBudget: 130,
    baseSpend: 104,
    spendTrend: 1.0,
    cpc: 6.8,
    ctr: 0.006,
    conversionRate: 0.058,
    performanceTrend: 0.97,
    aov: 340,
    trackingCoverage: 0.82,
    platformInflation: 1.3,
    ads: [
      {
        name: "Whitepaper — procurement guide",
        headline: "The 2026 procurement checklist",
        body: "What operations leads ask before they sign. Free, no gate beyond email.",
        cta: "Download",
        format: "native",
        weight: 1,
        ctrFactor: 1,
      },
    ],
  },
];

const CLICK_ID_PARAM: Record<string, string> = {
  google_ads: "gclid",
  meta_ads: "fbclid",
  openai_ads: "oaiclid",
  tiktok_ads: "ttclid",
  linkedin_ads: "li_fat_id",
};

const CLICK_ID_TYPE: Record<string, string> = {
  google_ads: "google",
  meta_ads: "meta",
  openai_ads: "openai",
  tiktok_ads: "tiktok",
  linkedin_ads: "linkedin",
};

const UTM_SOURCE: Record<string, string> = {
  google_ads: "google",
  meta_ads: "facebook",
  openai_ads: "openai",
  tiktok_ads: "tiktok",
  linkedin_ads: "linkedin",
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Weekly rhythm: weekends are quieter for most advertisers. */
function weekdayFactor(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0) return 0.82;
  if (day === 6) return 0.86;
  if (day === 1) return 1.06;
  return 1;
}

export interface SeedOptions {
  days?: number;
  seed?: number;
}

export function generateDemoData(options: SeedOptions = {}): {
  campaigns: number;
  metricRows: number;
  orders: number;
  days: number;
  competitors: number;
  competitorCreatives: number;
} {
  const days = options.days ?? 90;
  const random = mulberry32(options.seed ?? 20260915);
  const end = addDays(todayISO(), -1);
  const start = addDays(end, -(days - 1));

  // One connection per platform, plus the store that closes the loop.
  const platforms = [...new Set(PROFILES.map((p) => p.platform))];
  const connectionByPlatform = new Map<PlatformId, string>();

  for (const platform of platforms) {
    const connection = upsertConnection({
      platform,
      kind: "ads",
      displayName: `${platform.replace(/_/g, " ")} — demo account`,
      externalAccountId: `demo-${platform}`,
      status: "demo",
      currency: "USD",
      config: { demo: true },
    });
    connectionByPlatform.set(platform, connection.id);
    setConnectionStatus(connection.id, "demo");
  }

  const storeConnection = upsertConnection({
    platform: "shopify",
    kind: "sales",
    displayName: "Demo Store — Shopify",
    externalAccountId: "demo-store.myshopify.com",
    status: "demo",
    currency: "USD",
    config: { demo: true, shopDomain: "demo-store.myshopify.com" },
  });
  setConnectionStatus(storeConnection.id, "demo");

  // Campaign, ad group and ad rows.
  const campaigns = PROFILES.map((profile) => {
    const connectionId = connectionByPlatform.get(profile.platform)!;
    return {
      connectionId,
      platform: profile.platform,
      externalId: `demo-${slug(profile.name)}`,
      name: profile.name,
      status: profile.status,
      objective: profile.objective,
      dailyBudget: profile.dailyBudget,
      currency: "USD",
      startDate: start,
      endDate: null,
    };
  });
  upsertCampaigns(campaigns);

  const adGroups = PROFILES.map((profile) => {
    const connectionId = connectionByPlatform.get(profile.platform)!;
    const campaignId = stableId("cmp", connectionId, `demo-${slug(profile.name)}`);
    return {
      connectionId,
      campaignId,
      externalId: `${slug(profile.name)}-group`,
      name: `${profile.name} — main set`,
      status: profile.status,
    };
  });
  upsertAdGroups(adGroups);

  const ads = PROFILES.flatMap((profile) => {
    const connectionId = connectionByPlatform.get(profile.platform)!;
    const campaignId = stableId("cmp", connectionId, `demo-${slug(profile.name)}`);
    const adGroupId = stableId("adg", campaignId, `${slug(profile.name)}-group`);
    return profile.ads.map((ad) => ({
      adGroupId,
      campaignId,
      externalId: slug(ad.name),
      name: ad.name,
      format: ad.format,
      status: profile.status,
      headline: ad.headline,
      body: ad.body,
      callToAction: ad.cta,
      landingPage: `https://demo-store.example/collections/${slug(profile.name)}`,
      previewUrl: null,
    }));
  });
  upsertAds(ads);

  // Daily metrics and the orders they produced.
  const metricRows: MetricRow[] = [];
  const orders: Omit<SalesOrder, "id">[] = [];
  let orderSequence = 0;

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const date = addDays(start, dayIndex);
    const progress = days > 1 ? dayIndex / (days - 1) : 1;
    const dow = weekdayFactor(date);

    for (const profile of PROFILES) {
      const connectionId = connectionByPlatform.get(profile.platform)!;
      const campaignExternalId = `demo-${slug(profile.name)}`;
      const groupExternalId = `${slug(profile.name)}-group`;

      // Spend and efficiency both move across the window, plus daily noise.
      const spendMultiplier = 1 + (profile.spendTrend - 1) * progress;
      const perfMultiplier = 1 + (profile.performanceTrend - 1) * progress;
      const noise = 0.88 + random() * 0.24;
      const campaignSpend = profile.baseSpend * spendMultiplier * dow * noise;

      for (const ad of profile.ads) {
        const spend = campaignSpend * ad.weight;
        const cpc = profile.cpc * (0.95 + random() * 0.1);
        const clicks = Math.max(0, Math.round(spend / cpc));
        const ctr = profile.ctr * ad.ctrFactor * (0.92 + random() * 0.16);
        const impressions = ctr > 0 ? Math.round(clicks / ctr) : 0;

        const conversionRate = profile.conversionRate * perfMultiplier * (0.85 + random() * 0.3);
        const realOrders = conversionRate > 0 ? clicks * conversionRate : 0;
        // Whole orders, with the fraction resolved probabilistically so small
        // campaigns do not always round to zero.
        const wholeOrders = Math.floor(realOrders) + (random() < realOrders % 1 ? 1 : 0);

        const orderValue = profile.aov * (0.8 + random() * 0.4);
        const storeRevenue = wholeOrders * orderValue;

        metricRows.push({
          date,
          connectionId,
          platform: profile.platform,
          campaignExternalId,
          adGroupExternalId: groupExternalId,
          adExternalId: slug(ad.name),
          impressions,
          clicks,
          spend: Number(spend.toFixed(2)),
          // The platform counts more than the store can verify.
          platformConversions: Number((wholeOrders * profile.platformInflation).toFixed(1)),
          platformRevenue: Number((storeRevenue * profile.platformInflation).toFixed(2)),
          videoViews: ad.format === "video" ? Math.round(impressions * 0.28) : 0,
          frequency: profile.platform === "meta_ads" ? Number((1.6 + random() * 2.4).toFixed(2)) : 0,
          currency: "USD",
        });

        // Store orders. Only the tracked share carries attribution — the rest
        // land in the unattributed bucket, exactly as they would in reality.
        for (let i = 0; i < wholeOrders; i += 1) {
          orderSequence += 1;
          const tracked = random() < profile.trackingCoverage;
          const hour = 8 + Math.floor(random() * 13);
          const revenue = Number((orderValue * (0.75 + random() * 0.5)).toFixed(2));
          const campaignSlug = slug(profile.name);
          const clickParam = CLICK_ID_PARAM[profile.platform];

          orders.push({
            connectionId: storeConnection.id,
            platform: "shopify",
            externalId: `demo-order-${orderSequence}`,
            orderedAt: `${date}T${String(hour).padStart(2, "0")}:${String(
              Math.floor(random() * 60),
            ).padStart(2, "0")}:00Z`,
            revenue,
            cogs: Number((revenue * 0.38).toFixed(2)),
            currency: "USD",
            customerRef: `demo-customer-${Math.floor(random() * 4200)}`,
            isNewCustomer: random() < 0.62,
            landingPage: `https://demo-store.example/collections/${campaignSlug}`,
            utmSource: tracked ? UTM_SOURCE[profile.platform] : null,
            utmMedium: tracked ? "cpc" : null,
            utmCampaign: tracked ? profile.name : null,
            utmContent: tracked ? slug(ad.name) : null,
            utmTerm: null,
            clickId: tracked && clickParam ? `${clickParam}-${orderSequence}` : null,
            clickIdType: tracked ? CLICK_ID_TYPE[profile.platform] : null,
          });
        }
      }
    }

    // Organic, email and direct revenue — real stores are not only paid media,
    // and including it keeps blended numbers honest.
    const organicOrders = Math.round(6 + random() * 9);
    for (let i = 0; i < organicOrders; i += 1) {
      orderSequence += 1;
      const channel = random();
      const isEmail = channel < 0.45;
      orders.push({
        connectionId: storeConnection.id,
        platform: "shopify",
        externalId: `demo-order-${orderSequence}`,
        orderedAt: `${date}T${String(9 + Math.floor(random() * 11)).padStart(2, "0")}:15:00Z`,
        revenue: Number((70 + random() * 120).toFixed(2)),
        cogs: null,
        currency: "USD",
        customerRef: `demo-customer-${Math.floor(random() * 4200)}`,
        isNewCustomer: random() < 0.35,
        landingPage: "https://demo-store.example/",
        utmSource: isEmail ? "klaviyo" : null,
        utmMedium: isEmail ? "email" : null,
        utmCampaign: isEmail ? "weekly-newsletter" : null,
        utmContent: null,
        utmTerm: null,
        clickId: null,
        clickIdType: null,
      });
    }
  }

  upsertMetrics(metricRows);
  upsertOrders(orders);

  // Demo connections hold no credentials; the placeholder keeps the encrypted
  // column populated so the connections page renders the same way as a real one.
  for (const connectionId of [...connectionByPlatform.values(), storeConnection.id]) {
    saveCredentials(connectionId, { apiKey: "demo" });
  }

  // The competitive set is part of the same demo story: the gaps it surfaces are
  // angles the demo account's own ads genuinely do not run.
  const inspiration = generateInspirationDemoData();

  return {
    campaigns: campaigns.length,
    metricRows: metricRows.length,
    orders: orders.length,
    days,
    competitors: inspiration.competitors,
    competitorCreatives: inspiration.creatives,
  };
}
