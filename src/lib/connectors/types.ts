import type {
  Ad,
  AdGroup,
  AuthType,
  Campaign,
  ConnectorKind,
  Credentials,
  DateRange,
  MetricRow,
  PlatformId,
  SalesOrder,
} from "../types";

/**
 * The connector contract.
 *
 * Every platform — an ad network, a store, an analytics product — is reduced to
 * the same small surface: authenticate, list the accounts you can see, pull
 * entities, pull daily numbers. Analytics downstream never learns which
 * platform a row came from beyond its `platform` tag, so adding a network is a
 * new file in this folder and one line in the registry.
 */

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Platforms that require PKCE (X, Reddit, Snapchat…). */
  usePkce?: boolean;
  /** Extra query params the platform demands on the authorize call. */
  extraAuthParams?: Record<string, string>;
  /** Some platforms want client credentials in the body rather than Basic auth. */
  clientAuth?: "basic" | "body";
}

/** An advertiser/ad account the authenticated user can select after connecting. */
export interface RemoteAccount {
  id: string;
  name: string;
  currency: string;
  timezone?: string;
}

/** Everything a connector call needs to reach the platform. */
export interface ConnectorContext {
  connectionId: string;
  externalAccountId: string | null;
  credentials: Credentials;
  config: Record<string, unknown>;
  /** Refreshes and persists the access token, returning the fresh one. */
  refresh: () => Promise<Credentials>;
}

export interface EntitySnapshot {
  campaigns: Omit<Campaign, "id">[];
  adGroups: (Omit<AdGroup, "id"> & { connectionId: string })[];
  ads: Omit<Ad, "id">[];
}

export interface WriteResult {
  ok: boolean;
  detail: string;
}

interface BaseConnector {
  platform: PlatformId;
  kind: ConnectorKind;
  displayName: string;
  /** One line the connections page shows under the platform name. */
  summary: string;
  docsUrl: string;
  authType: AuthType;
  oauth?: OAuthConfig;
  /** Env vars that must be present before this connector can be used for real. */
  requiredEnv: string[];
  /**
   * Set when the platform's public API is not yet stable or not yet published,
   * so the UI can say so instead of implying a verified integration.
   */
  provisional?: boolean;
  /** Human note about what "provisional" means for this platform. */
  provisionalNote?: string;
  listAccounts?: (ctx: ConnectorContext) => Promise<RemoteAccount[]>;
}

export interface AdsConnector extends BaseConnector {
  kind: "ads";
  fetchEntities: (ctx: ConnectorContext) => Promise<EntitySnapshot>;
  fetchMetrics: (ctx: ConnectorContext, range: DateRange) => Promise<MetricRow[]>;
  /**
   * Optional write-back. Connectors that implement it let the portal act on a
   * recommendation; the rest record the intent in the action log instead.
   */
  pauseCampaign?: (ctx: ConnectorContext, externalCampaignId: string) => Promise<WriteResult>;
  setCampaignBudget?: (
    ctx: ConnectorContext,
    externalCampaignId: string,
    dailyBudget: number,
  ) => Promise<WriteResult>;
}

export interface SalesConnector extends BaseConnector {
  kind: "sales" | "analytics";
  fetchOrders: (ctx: ConnectorContext, range: DateRange) => Promise<Omit<SalesOrder, "id">[]>;
}

export type Connector = AdsConnector | SalesConnector;

export function isAdsConnector(connector: Connector): connector is AdsConnector {
  return connector.kind === "ads";
}

export function isSalesConnector(connector: Connector): connector is SalesConnector {
  return connector.kind === "sales" || connector.kind === "analytics";
}
