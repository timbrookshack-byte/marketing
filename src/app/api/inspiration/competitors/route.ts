import { NextResponse } from "next/server";
import { listCompetitors, upsertCompetitor } from "@/lib/inspiration";
import type { Competitor } from "@/lib/inspiration";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, competitors: listCompetitors() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      domain?: string;
      category?: string;
      handles?: Competitor["handles"];
      notes?: string;
      origin?: Competitor["origin"];
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "A brand name is required." }, { status: 400 });
    }

    const competitor = upsertCompetitor({
      name: body.name,
      domain: body.domain || null,
      category: body.category || null,
      handles: body.handles ?? {},
      notes: body.notes || null,
      origin: body.origin ?? "user",
    });

    return NextResponse.json({ ok: true, competitor });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
