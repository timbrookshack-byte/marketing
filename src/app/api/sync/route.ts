import { NextResponse } from "next/server";
import { syncAll, syncConnection } from "@/lib/sync";
import { trailingWindow } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Pulls fresh data for one connection, or every connection when none is named. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}) as { connectionId?: string; days?: number });
    const range = trailingWindow(Number(body.days) || 90);

    const results = body.connectionId
      ? [await syncConnection(body.connectionId, range)]
      : await syncAll(range);

    return NextResponse.json({ ok: true, range, results });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
