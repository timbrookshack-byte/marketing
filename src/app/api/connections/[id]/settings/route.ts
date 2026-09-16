import { NextResponse } from "next/server";
import { clearConnectionData, getConnection, upsertConnection } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Sets the account a connection points at, after the fact.
 *
 * OAuth can succeed while account discovery does not — most often on Google
 * Ads, where `listAccessibleCustomers` returns nothing useful for a login whose
 * ad account sits under a manager account. Rather than leave the connection
 * stranded with no customer id, the operator can name it directly, along with
 * the manager id that grants access to it.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const connection = getConnection(id);
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const body = (await request.json()) as {
    externalAccountId?: string;
    loginCustomerId?: string;
  };

  // Google writes customer ids as 123-456-7890; the API wants them without dashes.
  const accountId = body.externalAccountId?.trim().replace(/-/g, "");
  if (!accountId) {
    return NextResponse.json({ error: "An account ID is required." }, { status: 400 });
  }
  const loginCustomerId = body.loginCustomerId?.trim().replace(/-/g, "") || null;

  // Data pulled from the previous account is not this account's. Keeping it
  // would quietly inflate every total on the dashboard with another
  // advertiser's spend, so it goes before the switch is recorded.
  const switchedAccount =
    connection.externalAccountId !== null && connection.externalAccountId !== accountId;
  const cleared = switchedAccount ? clearConnectionData(connection.id) : null;

  const baseName = connection.displayName.split(" — ")[0];
  upsertConnection({
    id: connection.id,
    platform: connection.platform,
    kind: connection.kind,
    displayName: `${baseName} — ${accountId}`,
    externalAccountId: accountId,
    status: "connected",
    currency: connection.currency,
    config: { ...connection.config, ...(loginCustomerId ? { loginCustomerId } : {}) },
  });

  return NextResponse.json({ ok: true, externalAccountId: accountId, loginCustomerId, cleared });
}
