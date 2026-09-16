import { getConnector } from "./connectors/registry";
import { getOAuthClient, isExpired, refreshAccessToken } from "./connectors/oauth";
import { ConnectorError } from "./connectors/http";
import type { ConnectorContext } from "./connectors/types";
import {
  CredentialsUnreadableError,
  finishSyncRun,
  getConnection,
  listConnections,
  loadCredentials,
  markSynced,
  saveCredentials,
  setConnectionStatus,
  startSyncRun,
  upsertAdGroups,
  upsertAds,
  upsertCampaigns,
  upsertMetrics,
  upsertOrders,
} from "./repo";
import { trailingWindow } from "./util";
import type { Connection, DateRange } from "./types";

/**
 * Sync orchestration: build a connector context, pull entities and numbers for
 * a window, and write them through the repository. Token refresh happens here
 * so no connector has to think about it.
 */

export interface SyncResult {
  connectionId: string;
  platform: string;
  status: "success" | "error" | "skipped";
  rowsIngested: number;
  error?: string;
}

async function buildContext(connection: Connection): Promise<ConnectorContext> {
  const connector = getConnector(connection.platform);
  let credentials = loadCredentials(connection.id) ?? {};

  const refresh = async () => {
    if (!connector.oauth) return credentials;
    const client = getOAuthClient(connection.platform);
    if (!client) {
      throw new ConnectorError(
        `${connector.displayName} OAuth client is not configured on this server`,
        401,
        "",
      );
    }
    credentials = await refreshAccessToken(connector.oauth, client, credentials);
    saveCredentials(connection.id, credentials);
    return credentials;
  };

  // Refresh up front when we already know the token is stale — cheaper than
  // letting the first call fail and retrying.
  if (connector.oauth && credentials.refreshToken && isExpired(credentials)) {
    await refresh();
  }

  return {
    connectionId: connection.id,
    externalAccountId: connection.externalAccountId,
    credentials,
    config: { ...connection.config, currency: connection.currency },
    refresh,
  };
}

export async function syncConnection(
  connectionId: string,
  range: DateRange = trailingWindow(90),
): Promise<SyncResult> {
  const connection = getConnection(connectionId);
  if (!connection) {
    return { connectionId, platform: "unknown", status: "error", rowsIngested: 0, error: "Connection not found" };
  }

  const runId = startSyncRun(connectionId);
  const connector = getConnector(connection.platform);

  try {
    const ctx = await buildContext(connection);
    let rows = 0;

    if (connector.kind === "ads") {
      const snapshot = await connector.fetchEntities(ctx);
      upsertCampaigns(snapshot.campaigns);
      upsertAdGroups(snapshot.adGroups);
      upsertAds(snapshot.ads);

      const metrics = await connector.fetchMetrics(ctx, range);
      rows = upsertMetrics(metrics);
    } else {
      const orders = await connector.fetchOrders(ctx, range);
      rows = upsertOrders(orders);
    }

    finishSyncRun(runId, "success", rows);
    markSynced(connectionId);
    setConnectionStatus(connectionId, "connected");
    return { connectionId, platform: connection.platform, status: "success", rowsIngested: rows };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishSyncRun(runId, "error", 0, message);
    const needsReauth =
      error instanceof CredentialsUnreadableError ||
      (error instanceof ConnectorError && error.needsReauth);
    setConnectionStatus(connectionId, needsReauth ? "needs_reauth" : "error", message);
    return {
      connectionId,
      platform: connection.platform,
      status: "error",
      rowsIngested: 0,
      error: message,
    };
  }
}

/** Syncs every connection that has credentials, one after another. */
export async function syncAll(range: DateRange = trailingWindow(90)): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const connection of listConnections()) {
    results.push(await syncConnection(connection.id, range));
  }
  return results;
}
