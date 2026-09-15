import { NextResponse } from "next/server";
import { generateDemoData } from "@/lib/demo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Generates the demo account so the analysis can be seen before anything is connected. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}) as { days?: number });
    const result = generateDemoData({ days: Number(body.days) || 90 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
