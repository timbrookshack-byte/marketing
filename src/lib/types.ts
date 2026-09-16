/** Shared domain types for the 360 Marketing portal. */

/** Every platform we can pull data from, ad networks and revenue sources alike. */
export type PlatformId =
  // Paid media
  | "google_ads"
  | "meta_ads"
  | "openai_ads"
  | "microsoft_ads"
  | "linkedin_ads"
  | "tiktok_ads"
  | "reddit_ads"
  | "x_ads"
  | "amazon_ads"
  | "pinterest_ads"
  | "snapchat_ads"
  // Revenue / conversion sources
  | "shopify"
  | "stripe"
  | "woocommerce"
  | "ga4"
  | "hubspot";

/** What a connection contributes to the picture. */
export type ConnectorKind = "ads" | "sales" | "analytics";

export type AuthType = "oauth2" | "api_key" | "basic";

export type ConnectionStatus =
  | "disconnected"
  | "connected"
  | "error"
  | "needs_reauth";

export interface Connection {
  id: string;
  platform: PlatformId;
  kind: ConnectorKind;
  /** What the user calls this account, e.g. "Acme UK — Google Ads". */
  displayName: string;
  /** The platform's own account identifier (customer ID, ad account ID, shop domain…). */
  externalAccountId: string | null;
  status: ConnectionStatus;
  currency: string;
  /** Non-secret connector settings (developer token id, API version, base URL overrides…). */
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
}

/** Decrypted credential bundle. Never leaves the server. */
export interface Credentials {
  accessToken?: string;
  refreshToken?: string;
  /** Unix ms. */
  expiresAt?: number;
  apiKey?: string;
  [key: string]: unknown;
}

export type CampaignStatus = "active" | "paused" | "ended" | "draft";

export interface Campaign {
  id: string;
  connectionId: string;
  platform: PlatformId;
  externalId: string;
  name: string;
  status: CampaignStatus;
  objective: string | null;
  /** Minor-unit-free daily budget in the connection currency. Null when unset. */
  dailyBudget: number | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
}

export interface AdGroup {
  id: string;
  campaignId: string;
  externalId: string;
  name: string;
  status: CampaignStatus;
}

export type CreativeFormat =
  | "search_text"
  | "responsive_search"
  | "image"
  | "video"
  | "carousel"
  | "collection"
  | "native"
  | "conversational";

export interface Ad {
  id: string;
  adGroupId: string;
  campaignId: string;
  externalId: string;
  name: string;
  format: CreativeFormat;
  status: CampaignStatus;
  headline: string | null;
  body: string | null;
  callToAction: string | null;
  landingPage: string | null;
  previewUrl: string | null;
}

/**
 * One row of normalised daily performance. Every connector converts its native
 * response into this shape, which is the only thing analytics ever reads.
 */
export interface MetricRow {
  date: string; // YYYY-MM-DD
  connectionId: string;
  platform: PlatformId;
  campaignExternalId: string;
  adGroupExternalId: string | null;
  adExternalId: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  /** Conversions as the ad platform counts them (its own attribution window). */
  platformConversions: number;
  /** Conversion value as the ad platform reports it. */
  platformRevenue: number;
  videoViews: number;
  /** Average times a person in the target audience saw an ad. 0 when N/A. */
  frequency: number;
  currency: string;
}

/** A real order or payment pulled from a store / billing system. */
export interface SalesOrder {
  id: string;
  connectionId: string;
  platform: PlatformId;
  externalId: string;
  orderedAt: string; // ISO timestamp
  revenue: number;
  /** Cost of goods, when the source reports it — lets us rank on margin, not just revenue. */
  cogs: number | null;
  currency: string;
  customerRef: string | null;
  isNewCustomer: boolean;
  landingPage: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  /** Platform click identifiers — the strongest attribution signal we get. */
  clickId: string | null;
  clickIdType: string | null;
}

export type RecommendationScope = "channel" | "campaign" | "adgroup" | "ad" | "portfolio";

export type RecommendationType =
  | "pause"
  | "reduce_budget"
  | "scale_budget"
  | "reallocate"
  | "test_creative"
  | "fix_tracking"
  | "investigate";

export type RecommendationStatus = "open" | "accepted" | "dismissed" | "done";

export interface Recommendation {
  id: string;
  createdAt: string;
  source: "rules" | "ai";
  scope: RecommendationScope;
  /** Campaign/ad/channel identifier this acts on. */
  targetId: string;
  targetName: string;
  platform: PlatformId | null;
  type: RecommendationType;
  severity: "critical" | "serious" | "warning" | "good";
  title: string;
  rationale: string;
  /** Monthly dollars freed or gained if actioned. Signed: positive is good. */
  expectedMonthlyImpact: number;
  /** 0..1 — how much the evidence supports acting now. */
  confidence: number;
  evidence: Record<string, unknown>;
  status: RecommendationStatus;
}

export interface SyncRun {
  id: string;
  connectionId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "error";
  rowsIngested: number;
  error: string | null;
}

export interface CreativeBrief {
  id: string;
  createdAt: string;
  platform: PlatformId;
  objective: string;
  audience: string;
  /** The generated variants, each with a hypothesis and a measurable success metric. */
  variants: CreativeVariant[];
  testPlan: string;
  notes: string | null;
}

export interface CreativeVariant {
  angle: string;
  headline: string;
  body: string;
  callToAction: string;
  hypothesis: string;
  successMetric: string;
  /** Which existing campaign or ad this is a response to, when applicable. */
  inspiredBy?: string;
}

export interface DateRange {
  /** Inclusive, YYYY-MM-DD. */
  start: string;
  /** Inclusive, YYYY-MM-DD. */
  end: string;
}
