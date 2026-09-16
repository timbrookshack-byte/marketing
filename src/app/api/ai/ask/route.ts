import { NextResponse } from "next/server";
import { askAnalyst } from "@/lib/ai/analyst";
import { AiUnavailableError, explainAiError } from "@/lib/ai/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      question?: string;
      history?: { role: "user" | "assistant"; content: string }[];
      days?: number;
    };

    if (!body.question?.trim()) {
      return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
    }

    const answer = await askAnalyst({
      question: body.question,
      // Keep the thread short enough to stay cheap without losing the thread.
      history: (body.history ?? []).slice(-8),
      days: body.days,
    });

    return NextResponse.json({ ok: true, answer });
  } catch (error) {
    const status = error instanceof AiUnavailableError ? 400 : 500;
    return NextResponse.json({ error: explainAiError(error) }, { status });
  }
}
