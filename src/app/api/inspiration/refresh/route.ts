import { NextResponse } from "next/server";
import {
  EU_UK_COUNTRIES,
  refreshAllCompetitors,
  refreshCompetitor,
  type InspirationSourceId,
} from "@/lib/inspiration";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_SOURCES: InspirationSourceId[] = [
  "meta_ad_library",
  "tiktok_commercial_content",
  "linkedin_ad_library",
  "licensed_provider",
];

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(
      () => ({}) as { competitorId?: string; sources?: InspirationSourceId[]; countries?: string[] },
    );

    // Meta only returns commercial ads for EU/UK delivery, so that is the
    // default search region rather than the operator's home market.
    const countries = body.countries?.length ? body.countries : EU_UK_COUNTRIES.slice(0, 6);
    const sources = body.sources?.length ? body.sources : DEFAULT_SOURCES;

    const results = body.competitorId
      ? await refreshCompetitor(body.competitorId, sources, countries)
      : await refreshAllCompetitors(sources, countries);

    return NextResponse.json({ ok: true, countries, results });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
