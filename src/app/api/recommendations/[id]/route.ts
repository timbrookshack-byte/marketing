import { NextResponse } from "next/server";
import { setRecommendationStatus } from "@/lib/repo";
import type { Recommendation } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED: Recommendation["status"][] = ["open", "accepted", "dismissed", "done"];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as { status?: Recommendation["status"] };

  if (!body.status || !ALLOWED.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${ALLOWED.join(", ")}` }, { status: 400 });
  }

  setRecommendationStatus(id, body.status);
  return NextResponse.json({ ok: true, status: body.status });
}
