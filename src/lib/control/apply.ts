/**
 * Making a change on the platform.
 *
 * Lifted out of the campaign action route, which was the only caller until
 * approving a proposal became a second one. Two copies of this would drift,
 * and the half that drifted would be the one that talks to live ad accounts.
 *
 * This deliberately knows nothing about proposals or policy. It takes a
 * campaign and a change, talks to the platform, updates the local row to match
 * and reports what happened. Whether the change was allowed is decided before
 * anything gets here.
 */

import { getOAuthClient, isExpired, refreshAccessToken } from "../connectors/oauth";
import { getAdsConnector } from "../connectors/registry";
import type { ConnectorContext } from "../connectors/types";
import { loadCredentials, saveCredentials, setCampaignBudget, setCampaignStatus } from "../repo";
import type { Campaign, Connection } from "../types";
import type { ChangeAction } from "./policy";

export interface ApplyResult {
  /** Whether the platform accepted the change. */
  ok: boolean;
  /**
   * False when the connector has no write-back for this action at all, as
   * opposed to having tried and failed. The caller records the intent rather
   * than reporting a failure that was never attempted.
   */
  attempted: boolean;
  detail?: string;
}

/**
 * Applies a change to the live account.
 *
 * The local row is only updated once the platform has accepted the change, so
 * a failed write leaves the portal showing what the account actually holds
 * rather than what someone hoped it would.
 */
export async function applyChange(
  campaign: Campaign,
  connection: Connection,
  action: ChangeAction,
  dailyBudget?: number,
): Promise<ApplyResult> {
  const connector = getAdsConnector(campaign.platform);

  const writer =
    action === "set_budget"
      ? connector.setCampaignBudget
      : action === "pause" || action === "resume"
        ? connector.pauseCampaign
        : undefined;

  if (action === "resume" && !connector.resumeCampaign) {
    return {
      ok: false,
      attempted: false,
      detail: `${connector.displayName} cannot be resumed from here yet.`,
    };
  }

  if (!writer) {
    return {
      ok: false,
      attempted: false,
      detail: `${connector.displayName} write-back is not implemented`,
    };
  }

  let credentials = (await loadCredentials(connection.id)) ?? {};
  const refresh = async () => {
    const client = getOAuthClient(connection.platform);
    if (!connector.oauth || !client) throw new Error("OAuth client is not configured");
    credentials = await refreshAccessToken(connector.oauth, client, credentials);
    await saveCredentials(connection.id, credentials);
    return credentials;
  };
  if (connector.oauth && credentials.refreshToken && isExpired(credentials)) await refresh();

  const ctx: ConnectorContext = {
    connectionId: connection.id,
    externalAccountId: connection.externalAccountId,
    credentials,
    config: { ...connection.config, currency: connection.currency },
    refresh,
  };

  let result: { ok: boolean; detail?: string };
  if (action === "set_budget") {
    result = await connector.setCampaignBudget!(ctx, campaign.externalId, Number(dailyBudget));
  } else if (action === "resume") {
    result = await connector.resumeCampaign!(ctx, campaign.externalId);
  } else {
    result = await connector.pauseCampaign!(ctx, campaign.externalId);
  }

  if (result.ok) {
    // Awaited on purpose. This was previously fired without awaiting, which
    // was harmless while the write was synchronous and a race once it was not.
    if (action === "set_budget") await setCampaignBudget(campaign.id, Number(dailyBudget));
    else if (action === "pause") await setCampaignStatus(campaign.id, "paused");
    else await setCampaignStatus(campaign.id, "active");
  }

  return { ok: result.ok, attempted: true, detail: result.detail };
}
