import { NextResponse } from "next/server";
import { addManualCreatives, toExternalCreative, type ManualEntry } from "@/lib/inspiration";

export const dynamic = "force-dynamic";

/** Hand-entered creatives — the path that works when no API covers a platform. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { competitorId?: string; entries?: ManualEntry[] };
    const entries = body.entries ?? [];

    if (entries.length === 0) {
      return NextResponse.json({ error: "Nothing to add." }, { status: 400 });
    }

    const creatives = entries.map((entry, index) => toExternalCreative(entry, index));
    const stored = addManualCreatives(body.competitorId ?? null, creatives);

    return NextResponse.json({ ok: true, stored });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
