import { NextResponse } from "next/server";

import { getCaps, setCaps } from "@/lib/control/proposals";
import type { Caps } from "@/lib/control/policy";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getCaps());
}

/** Fields that must be a number, with the range outside which they make no sense. */
const NUMERIC: Record<string, { min: number; max: number }> = {
  maxDailyBudget: { min: 1, max: 1_000_000 },
  minDailyBudget: { min: 0, max: 1_000_000 },
  maxIncreasePercent: { min: 1, max: 10_000 },
  maxDecreasePercent: { min: 1, max: 100 },
  maxAccountDailyBudget: { min: 1, max: 10_000_000 },
  maxChangesPerCampaignPerDay: { min: 1, max: 100 },
  proposalTtlHours: { min: 1, max: 720 },
};

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<Caps> | null;
  if (!body) return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });

  const update: Partial<Caps> = {};
  const errors: string[] = [];

  for (const [key, range] of Object.entries(NUMERIC)) {
    const value = (body as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < range.min || n > range.max) {
      errors.push(`${key} must be a number between ${range.min} and ${range.max}`);
      continue;
    }
    (update as Record<string, unknown>)[key] = n;
  }

  if (body.allow) {
    update.allow = {
      pause: Boolean(body.allow.pause),
      resume: Boolean(body.allow.resume),
      set_budget: Boolean(body.allow.set_budget),
    };
  }

  // A floor above the ceiling would refuse every budget change while reading
  // as two separately sensible numbers, so it is caught here rather than
  // discovered one rejected proposal at a time.
  const merged = { ...(await getCaps()), ...update };
  if (merged.minDailyBudget >= merged.maxDailyBudget) {
    errors.push("The daily budget floor must be below the per-campaign cap");
  }
  if (merged.maxDailyBudget > merged.maxAccountDailyBudget) {
    errors.push("The per-campaign cap cannot be above the account ceiling");
  }

  if (errors.length > 0) return NextResponse.json({ error: errors.join(". ") }, { status: 400 });

  await setCaps(update);
  return NextResponse.json({ ok: true, caps: await getCaps() });
}
