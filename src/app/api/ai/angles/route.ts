import { NextResponse } from "next/server";
import { analyseAngles } from "@/lib/ai/inspiration";
import { AiUnavailableError } from "@/lib/ai/client";
import { saveAngleReport } from "@/lib/inspiration";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}) as { market?: string; days?: number });
    const report = await analyseAngles({ market: body.market, days: body.days });

    saveAngleReport({
      market: body.market ?? null,
      summary: report.summary,
      angles: report.angles,
      gaps: report.gaps,
      concepts: report.concepts,
      caveats: report.caveats,
    });

    return NextResponse.json({ ok: true, report });
  } catch (error) {
    const status = error instanceof AiUnavailableError ? 400 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
