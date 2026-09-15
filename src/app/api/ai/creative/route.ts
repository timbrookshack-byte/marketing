import { NextResponse } from "next/server";
import { buildSnapshot } from "@/lib/analytics";
import { workshopCreative } from "@/lib/ai/analyst";
import { AiUnavailableError } from "@/lib/ai/client";
import { saveCreativeBrief } from "@/lib/repo";
import type { PlatformId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      platform: PlatformId;
      objective?: string;
      audience?: string;
      notes?: string;
    };

    if (!body.platform || !body.audience) {
      return NextResponse.json({ error: "Channel and audience are both required." }, { status: 400 });
    }

    const snapshot = buildSnapshot(30);
    const workshop = await workshopCreative({
      platform: body.platform,
      objective: body.objective ?? "Drive a first purchase",
      audience: body.audience,
      notes: body.notes,
      snapshot,
    });

    saveCreativeBrief({
      platform: body.platform,
      objective: body.objective ?? "Drive a first purchase",
      audience: body.audience,
      variants: workshop.variants,
      testPlan: workshop.testPlan,
      notes: body.notes ?? null,
    });

    return NextResponse.json({ ok: true, workshop });
  } catch (error) {
    const status = error instanceof AiUnavailableError ? 400 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
