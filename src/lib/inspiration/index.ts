import { getInspirationSource, inspirationCatalog } from "./registry";
import {
  finishInspirationRun,
  getCompetitor,
  listCompetitors,
  listCreatives,
  saveCreatives,
  startInspirationRun,
} from "./repo";
import { dedupeToConcepts, rankByTraction, type ScoredCreative } from "./traction";
import { InspirationSourceError, type ExternalCreative, type InspirationSourceId } from "./types";

export * from "./types";
export * from "./traction";
export * from "./registry";
export * from "./repo";
export { toExternalCreative, type ManualEntry } from "./manual";
export { EU_UK_COUNTRIES, hasCommercialCoverage } from "./meta-ad-library";

/** Orchestration: fetch from a source, store it, report honestly what happened. */

export interface RefreshResult {
  source: InspirationSourceId;
  competitorId: string | null;
  competitorName: string | null;
  status: "success" | "error" | "skipped";
  found: number;
  /** Populated on error and on skip — always says why. */
  detail?: string;
  needsSetup?: boolean;
}

export async function refreshCompetitor(
  competitorId: string,
  sourceIds: InspirationSourceId[],
  countries: string[],
  limit = 50,
): Promise<RefreshResult[]> {
  const competitor = getCompetitor(competitorId);
  if (!competitor) {
    return [
      {
        source: sourceIds[0] ?? "manual",
        competitorId,
        competitorName: null,
        status: "error",
        found: 0,
        detail: "Competitor not found",
      },
    ];
  }

  const results: RefreshResult[] = [];

  for (const sourceId of sourceIds) {
    if (sourceId === "manual") continue; // Added to, never queried.

    const source = getInspirationSource(sourceId);
    const missingEnv = source.requiredEnv.filter((name) => !process.env[name]);
    if (missingEnv.length > 0) {
      results.push({
        source: sourceId,
        competitorId,
        competitorName: competitor.name,
        status: "skipped",
        found: 0,
        detail: `Not configured — set ${missingEnv.join(", ")}`,
        needsSetup: true,
      });
      continue;
    }

    const runId = startInspirationRun(sourceId, competitorId);
    try {
      const creatives = await source.search({
        advertiser: competitor.name,
        handle: competitor.handles[sourceId],
        countries,
        limit,
      });
      const stored = saveCreatives(creatives, competitorId);
      finishInspirationRun(runId, "success", stored);
      results.push({
        source: sourceId,
        competitorId,
        competitorName: competitor.name,
        status: "success",
        found: stored,
        // An empty result from a working source is information, not silence.
        detail:
          stored === 0
            ? `No ads found. ${source.capabilities.coverage}`
            : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishInspirationRun(runId, "error", 0, message);
      results.push({
        source: sourceId,
        competitorId,
        competitorName: competitor.name,
        status: "error",
        found: 0,
        detail: message,
        needsSetup: error instanceof InspirationSourceError && error.needsSetup,
      });
    }
  }

  return results;
}

export async function refreshAllCompetitors(
  sourceIds: InspirationSourceId[],
  countries: string[],
): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];
  for (const competitor of listCompetitors()) {
    results.push(...(await refreshCompetitor(competitor.id, sourceIds, countries)));
  }
  return results;
}

/** Stores hand-entered creatives against a competitor. */
export function addManualCreatives(
  competitorId: string | null,
  creatives: ExternalCreative[],
): number {
  return saveCreatives(creatives, competitorId);
}

export interface InspirationSnapshot {
  competitors: ReturnType<typeof listCompetitors>;
  /** Every stored creative, scored and ranked by evidence of traction. */
  ranked: ScoredCreative[];
  /** One entry per distinct concept — the grid worth actually looking at. */
  concepts: ScoredCreative[];
  /** Concepts with the strongest evidence, by advertiser. */
  byAdvertiser: { advertiser: string; concepts: ScoredCreative[]; proven: number }[];
  sources: ReturnType<typeof inspirationCatalog>;
  isEmpty: boolean;
  /** True when nothing is configured and nothing has been entered by hand. */
  needsSetup: boolean;
}

export function buildInspirationSnapshot(competitorId?: string): InspirationSnapshot {
  const stored = listCreatives(competitorId);
  const ranked = rankByTraction(stored);
  const concepts = dedupeToConcepts(ranked);
  const sources = inspirationCatalog();

  const grouped = new Map<string, ScoredCreative[]>();
  for (const concept of concepts) {
    const list = grouped.get(concept.advertiser) ?? [];
    list.push(concept);
    grouped.set(concept.advertiser, list);
  }

  const byAdvertiser = [...grouped.entries()]
    .map(([advertiser, items]) => ({
      advertiser,
      concepts: items,
      proven: items.filter((item) => item.traction.band === "proven").length,
    }))
    .sort((a, b) => b.proven - a.proven || b.concepts.length - a.concepts.length);

  return {
    competitors: listCompetitors(),
    ranked,
    concepts,
    byAdvertiser,
    sources,
    isEmpty: stored.length === 0,
    needsSetup: stored.length === 0 && sources.every((source) => !source.configured),
  };
}
