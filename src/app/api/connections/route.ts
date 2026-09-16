import { NextResponse } from "next/server";
import { getConnector } from "@/lib/connectors/registry";
import { saveCredentials, setConnectionStatus, upsertConnection } from "@/lib/repo";
import { syncConnection } from "@/lib/sync";
import { trailingWindow } from "@/lib/util";
import type { Credentials, PlatformId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Connects an account by pasting credentials, for the platforms that issue a key
 * directly instead of running an OAuth handshake.
 *
 * Secrets arrive here and are encrypted immediately. They are never written to
 * the response, and the connections page never reads them back — once saved, a
 * credential can be replaced but not viewed.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      platform?: PlatformId;
      displayName?: string;
      values?: Record<string, string>;
      currency?: string;
      /** Pull data straight away so the operator sees whether it actually worked. */
      syncNow?: boolean;
    };

    if (!body.platform) {
      return NextResponse.json({ error: "A platform is required." }, { status: 400 });
    }

    let connector;
    try {
      connector = getConnector(body.platform);
    } catch {
      return NextResponse.json({ error: `Unknown platform: ${body.platform}` }, { status: 404 });
    }

    const setup = connector.manualSetup;
    if (!setup) {
      return NextResponse.json(
        {
          error: `${connector.displayName} connects through OAuth — use the Connect button rather than pasting a key.`,
        },
        { status: 400 },
      );
    }

    const values = body.values ?? {};
    const missing = setup.fields
      .filter((field) => field.required !== false && !values[field.key]?.trim())
      .map((field) => field.label);

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    // Split what was submitted by where it belongs: encrypted credentials, open
    // config, or the platform's own account identifier.
    const credentials: Credentials = {};
    const config: Record<string, unknown> = {};
    let externalAccountId: string | null = null;

    for (const field of setup.fields) {
      const value = values[field.key]?.trim();
      if (!value) continue;
      if (field.target === "credentials") credentials[field.key] = value;
      else if (field.target === "config") config[field.key] = value;
      else externalAccountId = value;
    }

    // Shopify identifies the account by its shop domain; using it as the
    // external id keeps one connection per store rather than per paste.
    if (!externalAccountId && typeof config.shopDomain === "string") {
      externalAccountId = config.shopDomain;
    }
    if (!externalAccountId && typeof config.storeUrl === "string") {
      externalAccountId = config.storeUrl;
    }

    const connection = upsertConnection({
      platform: connector.platform,
      kind: connector.kind,
      displayName: body.displayName?.trim() || `${connector.displayName}${externalAccountId ? ` — ${externalAccountId}` : ""}`,
      externalAccountId,
      status: "connected",
      currency: body.currency ?? "USD",
      config,
    });

    saveCredentials(connection.id, credentials);

    if (body.syncNow === false) {
      return NextResponse.json({ ok: true, connectionId: connection.id });
    }

    // A first sync is the only honest confirmation that the key works. If it
    // fails, the connection stays but is marked with the reason.
    const result = await syncConnection(connection.id, trailingWindow(90));

    if (result.status === "error") {
      return NextResponse.json({
        ok: false,
        connectionId: connection.id,
        error: `Saved, but the first sync failed: ${result.error}`,
      });
    }

    setConnectionStatus(connection.id, "connected");
    return NextResponse.json({
      ok: true,
      connectionId: connection.id,
      rowsIngested: result.rowsIngested,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
