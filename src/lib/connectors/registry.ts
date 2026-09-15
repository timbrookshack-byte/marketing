import { googleAdsConnector } from "./google-ads";
import { metaAdsConnector } from "./meta-ads";
import { openAiAdsConnector } from "./openai-ads";
import { linkedInAdsConnector } from "./linkedin-ads";
import { tiktokAdsConnector } from "./tiktok-ads";
import { plannedAdsConnectors } from "./planned-ads";
import { salesConnectors } from "./sales";
import { getOAuthClient } from "./oauth";
import type { AdsConnector, Connector, SalesConnector } from "./types";
import type { PlatformId } from "../types";

/**
 * The catalog. Order here is the order the connections page shows, so the
 * platforms most people start with come first.
 */
export const adsConnectors: AdsConnector[] = [
  googleAdsConnector,
  metaAdsConnector,
  openAiAdsConnector,
  linkedInAdsConnector,
  tiktokAdsConnector,
  ...plannedAdsConnectors,
];

export const connectors: Connector[] = [...adsConnectors, ...salesConnectors];

const byPlatform = new Map<PlatformId, Connector>(connectors.map((c) => [c.platform, c]));

export function getConnector(platform: PlatformId): Connector {
  const connector = byPlatform.get(platform);
  if (!connector) throw new Error(`Unknown platform: ${platform}`);
  return connector;
}

export function getAdsConnector(platform: PlatformId): AdsConnector {
  const connector = getConnector(platform);
  if (connector.kind !== "ads") throw new Error(`${platform} is not an ad platform`);
  return connector;
}

export function getSalesConnector(platform: PlatformId): SalesConnector {
  const connector = getConnector(platform);
  if (connector.kind === "ads") throw new Error(`${platform} is not a revenue source`);
  return connector;
}

/** The short label the UI uses for a platform — falls back to the raw id. */
export function platformLabel(platform: PlatformId | string): string {
  return byPlatform.get(platform as PlatformId)?.displayName ?? String(platform);
}

/**
 * What the connections page needs to render a card, including whether the
 * server is actually configured to talk to this platform.
 */
export interface ConnectorCatalogEntry {
  platform: PlatformId;
  kind: Connector["kind"];
  displayName: string;
  summary: string;
  docsUrl: string;
  authType: Connector["authType"];
  provisional: boolean;
  provisionalNote: string | null;
  /** Env vars this connector needs that are not set on this server. */
  missingEnv: string[];
  configured: boolean;
}

export function catalog(): ConnectorCatalogEntry[] {
  return connectors.map((connector) => {
    const missingEnv = connector.requiredEnv.filter((name) => !process.env[name]);
    // OAuth connectors are usable as soon as a client id/secret pair exists,
    // whatever the naming of the rest of their env vars.
    const hasOAuthClient = connector.oauth ? Boolean(getOAuthClient(connector.platform)) : false;
    return {
      platform: connector.platform,
      kind: connector.kind,
      displayName: connector.displayName,
      summary: connector.summary,
      docsUrl: connector.docsUrl,
      authType: connector.authType,
      provisional: Boolean(connector.provisional),
      provisionalNote: connector.provisionalNote ?? null,
      missingEnv,
      configured: missingEnv.length === 0 || hasOAuthClient,
    };
  });
}

/**
 * Channel colour assignment. Colours follow the platform, never its rank in the
 * current view, so a filter that drops a channel never repaints the others.
 * The order is the validated categorical order from the design system.
 */
const CHANNEL_COLOR_SLOT: Record<string, number> = {
  google_ads: 1,
  meta_ads: 2,
  openai_ads: 3,
  tiktok_ads: 4,
  linkedin_ads: 5,
  microsoft_ads: 6,
  reddit_ads: 7,
  x_ads: 8,
};

export function channelColor(platform: PlatformId | string): string {
  const slot = CHANNEL_COLOR_SLOT[platform as string];
  // Past the eight validated slots a channel is drawn in muted ink rather than a
  // ninth generated hue, which would not be distinguishable under CVD.
  return slot ? `var(--series-${slot})` : "var(--text-muted)";
}
