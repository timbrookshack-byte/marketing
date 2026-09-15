import { NextResponse } from "next/server";
import { deleteCompetitor, getCompetitor } from "@/lib/inspiration";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getCompetitor(id)) {
    return NextResponse.json({ error: "Competitor not found" }, { status: 404 });
  }
  // Their stored creatives cascade with them.
  deleteCompetitor(id);
  return NextResponse.json({ ok: true });
}
