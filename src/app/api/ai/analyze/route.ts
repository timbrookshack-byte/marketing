import { NextResponse } from "next/server";
import { buildSnapshot } from "@/lib/analytics";
import { analysePortfolio, toRecommendationRows } from "@/lib/ai/analyst";
import { AiUnavailableError, explainAiError } from "@/lib/ai/client";
import { clearRecommendations, saveRecommendations } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}) as { days?: number; context?: string });
    const snapshot = buildSnapshot(Number(body.days) || 30);

    if (snapshot.isEmpty) {
      return NextResponse.json({ error: "There is no data to analyse yet." }, { status: 400 });
    }

    const analysis = await analysePortfolio(snapshot, body.context);

    // A fresh pass replaces the previous open AI findings rather than stacking
    // a second copy of the same advice on top of them.
    clearRecommendations("ai");
    saveRecommendations(toRecommendationRows(analysis).map((rec) => ({ ...rec, status: "open" as const })));

    return NextResponse.json({ ok: true, analysis });
  } catch (error) {
    const status = error instanceof AiUnavailableError ? 400 : 500;
    return NextResponse.json({ error: explainAiError(error) }, { status });
  }
}
