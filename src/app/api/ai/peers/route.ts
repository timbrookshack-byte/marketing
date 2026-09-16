import { NextResponse } from "next/server";
import { suggestCompetitors } from "@/lib/ai/inspiration";
import { AiUnavailableError, explainAiError } from "@/lib/ai/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Suggests brands to watch. Nothing is stored here — suggestions are returned
 * for the operator to confirm, because the model is reasoning from general
 * knowledge of a category rather than from their actual market.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      description?: string;
      category?: string;
      market?: string;
    };

    if (!body.description?.trim()) {
      return NextResponse.json(
        { error: "Describe what you sell and who buys it." },
        { status: 400 },
      );
    }

    const suggestions = await suggestCompetitors({
      description: body.description,
      category: body.category,
      market: body.market,
    });

    return NextResponse.json({ ok: true, ...suggestions });
  } catch (error) {
    const status = error instanceof AiUnavailableError ? 400 : 500;
    return NextResponse.json({ error: explainAiError(error) }, { status });
  }
}
