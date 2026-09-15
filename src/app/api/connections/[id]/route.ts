import { NextResponse } from "next/server";
import { deleteConnection, getConnection } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const connection = getConnection(id);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  // Campaigns, metrics and orders cascade with the connection, so disconnecting
  // genuinely removes the account's data rather than orphaning it.
  deleteConnection(id);
  return NextResponse.json({ ok: true });
}
