import { NextResponse } from "next/server";
import { getConnector } from "@/lib/connectors/registry";
import { exchangeCode, getOAuthClient } from "@/lib/connectors/oauth";
import {
  consumeOAuthState,
  markSynced,
  saveCredentials,
  setConnectionStatus,
  upsertConnection,
} from "@/lib/repo";
import { syncConnection } from "@/lib/sync";
import { trailingWindow } from "@/lib/util";
import type { ConnectorContext } from "@/lib/connectors/types";
import type { PlatformId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function back(message: string, ok: boolean): NextResponse {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const url = new URL("/connections", base);
  url.searchParams.set(ok ? "connected" : "error", message);
  return NextResponse.redirect(url);
}

/**
 * Completes the handshake: verify state, swap the code for tokens, pick an
 * account, then immediately pull 90 days so the portal has something to show
 * rather than an empty connected card.
 */
export async function GET(request: Request, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  const url = new URL(request.url);

  const error = url.searchParams.get("error");
  if (error) {
    return back(url.searchParams.get("error_description") ?? error, false);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("Callback was missing its code or state", false);

  // Single-use and server-side: a state we did not issue never gets this far.
  const stored = consumeOAuthState(state);
  if (!stored || stored.platform !== platform) {
    return back("This authorisation link has expired or did not come from here. Start again.", false);
  }

  let connector;
  try {
    connector = getConnector(platform as PlatformId);
  } catch {
    return back(`Unknown platform: ${platform}`, false);
  }

  const client = getOAuthClient(connector.platform);
  if (!connector.oauth || !client) return back(`${platform} is not configured on this server`, false);

  try {
    const credentials = await exchangeCode(
      connector.platform,
      connector.oauth,
      client,
      code,
      stored.codeVerifier,
    );

    // The connection has to exist before we can ask the platform which accounts
    // this token can see, because listAccounts needs a context to run in.
    const connection = upsertConnection({
      platform: connector.platform,
      kind: connector.kind,
      displayName: connector.displayName,
      status: "connected",
      currency: "USD",
      config: {},
    });
    saveCredentials(connection.id, credentials);

    if (connector.listAccounts) {
      const ctx: ConnectorContext = {
        connectionId: connection.id,
        externalAccountId: null,
        credentials,
        config: {},
        refresh: async () => credentials,
      };
      const accounts = await connector.listAccounts(ctx);
      const chosen = accounts[0];
      if (!chosen) {
        setConnectionStatus(connection.id, "error", "This login can see no ad accounts.");
        return back("Connected, but that login can see no ad accounts.", false);
      }

      // First account by default. Multi-account pickers are the next step here;
      // until then the choice is explicit in the connection's display name.
      upsertConnection({
        id: connection.id,
        platform: connector.platform,
        kind: connector.kind,
        displayName: `${connector.displayName} — ${chosen.name}`,
        externalAccountId: chosen.id,
        status: "connected",
        currency: chosen.currency,
        config: { timezone: chosen.timezone ?? null, availableAccounts: accounts.length },
      });
    }

    markSynced(connection.id);

    const result = await syncConnection(connection.id, trailingWindow(90));
    if (result.status === "error") {
      return back(`Connected, but the first sync failed: ${result.error}`, false);
    }

    return back(
      `${connector.displayName} connected — pulled ${result.rowsIngested.toLocaleString()} rows.`,
      true,
    );
  } catch (caught) {
    return back((caught as Error).message, false);
  }
}
