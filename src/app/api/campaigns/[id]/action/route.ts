import { NextResponse } from "next/server";
import { getAdsConnector } from "@/lib/connectors/registry";
import { getOAuthClient, isExpired, refreshAccessToken } from "@/lib/connectors/oauth";
import {
  getCampaign,
  getConnection,
  loadCredentials,
  logAction,
  saveCredentials,
  setCampaignBudget,
  setCampaignStatus,
} from "@/lib/repo";
import type { ConnectorContext } from "@/lib/connectors/types";

export const dynamic = "force-dynamic";

/**
 * Write-back to a live ad account.
 *
 * Three outcomes, and the response always says which happened:
 *   applied  — the change went through on the platform
 *   recorded — the connector cannot write yet, so the intent is logged here
 *   failed   — the platform rejected it, with its reason
 *
 * Demo connections never call out; they update locally and say so.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as { action?: string; dailyBudget?: number };

  const campaign = getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const connection = getConnection(campaign.connectionId);
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const action = body.action;
  if (action !== "pause" && action !== "set_budget") {
    return NextResponse.json({ error: "action must be 'pause' or 'set_budget'" }, { status: 400 });
  }
  if (action === "set_budget" && !(Number(body.dailyBudget) > 0)) {
    return NextResponse.json({ error: "dailyBudget must be a positive number" }, { status: 400 });
  }

  const applyLocally = () => {
    if (action === "pause") setCampaignStatus(campaign.id, "paused");
    else setCampaignBudget(campaign.id, Number(body.dailyBudget));
  };

  if (connection.status === "demo") {
    applyLocally();
    logAction({
      connectionId: connection.id,
      scope: "campaign",
      targetId: campaign.id,
      action,
      payload: { dailyBudget: body.dailyBudget },
      result: "recorded",
      detail: "Demo account — changed here only, nothing sent to a live platform",
    });
    return NextResponse.json({
      ok: true,
      detail: "Updated in the demo account. Nothing was sent to a live ad platform.",
    });
  }

  try {
    const connector = getAdsConnector(campaign.platform);
    const writer = action === "pause" ? connector.pauseCampaign : connector.setCampaignBudget;

    if (!writer) {
      logAction({
        connectionId: connection.id,
        scope: "campaign",
        targetId: campaign.id,
        action,
        payload: { dailyBudget: body.dailyBudget },
        result: "recorded",
        detail: `${connector.displayName} write-back is not implemented`,
      });
      return NextResponse.json({
        ok: true,
        detail: `${connector.displayName} cannot be changed from here yet — the action is logged, apply it in the platform.`,
      });
    }

    let credentials = loadCredentials(connection.id) ?? {};
    const refresh = async () => {
      const client = getOAuthClient(connection.platform);
      if (!connector.oauth || !client) throw new Error("OAuth client is not configured");
      credentials = await refreshAccessToken(connector.oauth, client, credentials);
      saveCredentials(connection.id, credentials);
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

    const result =
      action === "pause"
        ? await connector.pauseCampaign!(ctx, campaign.externalId)
        : await connector.setCampaignBudget!(ctx, campaign.externalId, Number(body.dailyBudget));

    if (result.ok) applyLocally();

    logAction({
      connectionId: connection.id,
      scope: "campaign",
      targetId: campaign.id,
      action,
      payload: { dailyBudget: body.dailyBudget },
      result: result.ok ? "applied" : "failed",
      detail: result.detail,
    });

    return NextResponse.json({ ok: result.ok, detail: result.detail });
  } catch (error) {
    const detail = (error as Error).message;
    logAction({
      connectionId: connection.id,
      scope: "campaign",
      targetId: campaign.id,
      action,
      payload: { dailyBudget: body.dailyBudget },
      result: "failed",
      detail,
    });
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}
