import type { AdsConnector } from "./types";
import type { PlatformId } from "../types";

/**
 * Networks the portal knows about but does not yet pull live data from.
 *
 * They are first-class in every other respect — they appear in the channel
 * picker, carry demo data, and are included in cross-channel analysis — but
 * their live fetch throws a specific, actionable error instead of silently
 * returning nothing. That keeps "no data" from ever being ambiguous.
 *
 * Adding a real implementation means writing the connector file and replacing
 * the entry here; nothing else in the app changes.
 */

class NotImplementedError extends Error {
  constructor(displayName: string, note: string) {
    super(`${displayName} live sync is not implemented yet. ${note}`);
    this.name = "NotImplementedError";
  }
}

interface PlannedSpec {
  platform: PlatformId;
  displayName: string;
  summary: string;
  docsUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  usePkce?: boolean;
  clientAuth?: "basic" | "body";
  note: string;
}

const SPECS: PlannedSpec[] = [
  {
    platform: "microsoft_ads",
    displayName: "Microsoft Advertising",
    summary: "Bing, Edge and the Microsoft Audience Network.",
    docsUrl: "https://learn.microsoft.com/en-us/advertising/guides/",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["https://ads.microsoft.com/msads.manage", "offline_access"],
    note:
      "Campaign management and reporting are SOAP services, so this connector needs a SOAP " +
      "client plus a developer token rather than the shared JSON HTTP client.",
  },
  {
    platform: "reddit_ads",
    displayName: "Reddit Ads",
    summary: "Community-targeted promoted posts and conversation placements.",
    docsUrl: "https://ads-api.reddit.com/docs/",
    authorizeUrl: "https://www.reddit.com/api/v1/authorize",
    tokenUrl: "https://www.reddit.com/api/v1/access_token",
    scopes: ["adsread", "adsedit"],
    clientAuth: "basic",
    note: "OAuth is wired; the reporting mapping still needs to be written.",
  },
  {
    platform: "x_ads",
    displayName: "X Ads",
    summary: "Promoted posts and takeover placements on X.",
    docsUrl: "https://developer.x.com/en/docs/x-ads-api",
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.read", "users.read", "offline.access"],
    usePkce: true,
    note: "The Ads API uses OAuth 1.0a request signing for most endpoints, which needs its own signer.",
  },
  {
    platform: "amazon_ads",
    displayName: "Amazon Ads",
    summary: "Sponsored Products, Brands and Display across Amazon properties.",
    docsUrl: "https://advertising.amazon.com/API/docs/en-us",
    authorizeUrl: "https://www.amazon.com/ap/oa",
    tokenUrl: "https://api.amazon.com/auth/o2/token",
    scopes: ["advertising::campaign_management"],
    note:
      "Reporting is asynchronous: request a report, poll for completion, then download a gzipped " +
      "payload. That polling loop is the remaining work.",
  },
  {
    platform: "pinterest_ads",
    displayName: "Pinterest Ads",
    summary: "Shopping and idea-pin placements with long discovery windows.",
    docsUrl: "https://developers.pinterest.com/docs/api/v5/",
    authorizeUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    scopes: ["ads:read", "ads:write"],
    clientAuth: "basic",
    note: "OAuth is wired; the analytics mapping still needs to be written.",
  },
  {
    platform: "snapchat_ads",
    displayName: "Snapchat Ads",
    summary: "Vertical video and AR placements for younger audiences.",
    docsUrl: "https://developers.snap.com/api/marketing-api/Ads-API/introduction",
    authorizeUrl: "https://accounts.snapchat.com/login/oauth2/authorize",
    tokenUrl: "https://accounts.snapchat.com/login/oauth2/access_token",
    scopes: ["snapchat-marketing-api"],
    note: "OAuth is wired; the stats mapping still needs to be written.",
  },
];

function toConnector(spec: PlannedSpec): AdsConnector {
  const fail = () => {
    throw new NotImplementedError(spec.displayName, spec.note);
  };
  return {
    platform: spec.platform,
    kind: "ads",
    displayName: spec.displayName,
    summary: spec.summary,
    docsUrl: spec.docsUrl,
    authType: "oauth2",
    requiredEnv: [
      `${spec.platform.toUpperCase()}_CLIENT_ID`,
      `${spec.platform.toUpperCase()}_CLIENT_SECRET`,
    ],
    provisional: true,
    provisionalNote: spec.note,
    oauth: {
      authorizeUrl: spec.authorizeUrl,
      tokenUrl: spec.tokenUrl,
      scopes: spec.scopes,
      usePkce: spec.usePkce,
      clientAuth: spec.clientAuth,
    },
    fetchEntities: async () => fail(),
    fetchMetrics: async () => fail(),
  };
}

export const plannedAdsConnectors: AdsConnector[] = SPECS.map(toConnector);
