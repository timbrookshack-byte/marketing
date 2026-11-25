import { getDatabase } from "../sql/index";
import { newId, nowISO, stableId } from "../util";
import { variantKey } from "./traction";
import type { Competitor, ExternalCreative, InspirationSourceId } from "./types";

/** Storage for the inspiration module, kept beside its own domain. */

type Row = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- competitors

function toCompetitor(row: Row): Competitor {
  return {
    id: row.id as string,
    name: row.name as string,
    domain: (row.domain as string) ?? null,
    category: (row.category as string) ?? null,
    handles: parseJson<Competitor["handles"]>(row.handles, {}),
    origin: row.origin as Competitor["origin"],
    notes: (row.notes as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export async function listCompetitors(): Promise<Competitor[]> {
  return ((await getDatabase().prepare("SELECT * FROM competitors ORDER BY name").all()) as Row[]).map(
    toCompetitor,
  );
}

export async function getCompetitor(id: string): Promise<Competitor | null> {
  const row = (await getDatabase().prepare("SELECT * FROM competitors WHERE id = ?").get([id])) as Row | undefined;
  return row ? toCompetitor(row) : null;
}

export async function upsertCompetitor(input: {
  name: string;
  domain?: string | null;
  category?: string | null;
  handles?: Competitor["handles"];
  origin?: Competitor["origin"];
  notes?: string | null;
}): Promise<Competitor> {
  const id = stableId("comp", input.name.trim().toLowerCase());
  await getDatabase()
    .prepare(
      `INSERT INTO competitors (id, name, domain, category, handles, origin, notes, created_at)
       VALUES (@id, @name, @domain, @category, @handles, @origin, @notes, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         domain   = COALESCE(excluded.domain, competitors.domain),
         category = COALESCE(excluded.category, competitors.category),
         handles  = excluded.handles,
         notes    = COALESCE(excluded.notes, competitors.notes),
         -- A suggestion that the user re-adds becomes a confirmed entry.
         origin   = CASE WHEN excluded.origin = 'user' THEN 'user' ELSE competitors.origin END`,
    )
    .run({
      id,
      name: input.name.trim(),
      domain: input.domain ?? null,
      category: input.category ?? null,
      handles: JSON.stringify(input.handles ?? {}),
      origin: input.origin ?? "user",
      notes: input.notes ?? null,
      createdAt: nowISO(),
    });
  return (await getCompetitor(id))!;
}

export async function deleteCompetitor(id: string): Promise<void> {
  await getDatabase().prepare("DELETE FROM competitors WHERE id = ?").run([id]);
}

// ----------------------------------------------------------------- creatives

/**
 * Writes a fetch to storage.
 *
 * `first_seen` is preserved across refreshes with MIN(): libraries occasionally
 * restate a start date, and the earliest observation is the honest one. Losing
 * it would silently shorten every longevity score.
 */
export async function saveCreatives(
  creatives: ExternalCreative[],
  competitorId: string | null,
): Promise<number> {
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO external_creatives
       (id, competitor_id, source, platform, external_id, advertiser, headline, body,
        call_to_action, format, landing_page, media_url, permalink, first_seen, last_seen,
        is_live, reach_lower, reach_upper, countries, variant_key, raw, fetched_at)
     VALUES (@id, @competitorId, @source, @platform, @externalId, @advertiser, @headline, @body,
             @callToAction, @format, @landingPage, @mediaUrl, @permalink, @firstSeen, @lastSeen,
             @isLive, @reachLower, @reachUpper, @countries, @variantKey, @raw, @fetchedAt)
     ON CONFLICT(source, external_id) DO UPDATE SET
       competitor_id = COALESCE(excluded.competitor_id, external_creatives.competitor_id),
       headline      = excluded.headline,
       body          = excluded.body,
       first_seen    = MIN(COALESCE(external_creatives.first_seen, excluded.first_seen),
                           COALESCE(excluded.first_seen, external_creatives.first_seen)),
       last_seen     = excluded.last_seen,
       is_live       = excluded.is_live,
       reach_lower   = excluded.reach_lower,
       reach_upper   = excluded.reach_upper,
       variant_key   = excluded.variant_key,
       raw           = excluded.raw,
       fetched_at    = excluded.fetched_at`,
  );

  await db.batch(
    creatives.map((creative) =>
      stmt.bind({
        id: stableId("xcr", creative.source, creative.externalId),
        competitorId,
        source: creative.source,
        platform: creative.platform,
        externalId: creative.externalId,
        advertiser: creative.advertiser,
        headline: creative.headline,
        body: creative.body,
        callToAction: creative.callToAction,
        format: creative.format,
        landingPage: creative.landingPage,
        mediaUrl: creative.mediaUrl,
        permalink: creative.permalink,
        firstSeen: creative.firstSeen,
        lastSeen: creative.lastSeen,
        isLive: creative.isLive ? 1 : 0,
        reachLower: creative.reachLower,
        reachUpper: creative.reachUpper,
        countries: JSON.stringify(creative.countries),
        variantKey: variantKey(creative),
        raw: JSON.stringify(creative.raw),
        fetchedAt: nowISO(),
      }),
    ),
  );
  return creatives.length;
}

function toCreative(row: Row): ExternalCreative & { competitorId: string | null; fetchedAt: string } {
  return {
    competitorId: (row.competitor_id as string) ?? null,
    source: row.source as InspirationSourceId,
    platform: row.platform as ExternalCreative["platform"],
    externalId: row.external_id as string,
    advertiser: row.advertiser as string,
    headline: (row.headline as string) ?? null,
    body: (row.body as string) ?? null,
    callToAction: (row.call_to_action as string) ?? null,
    format: (row.format as string) ?? null,
    landingPage: (row.landing_page as string) ?? null,
    mediaUrl: (row.media_url as string) ?? null,
    permalink: (row.permalink as string) ?? null,
    firstSeen: (row.first_seen as string) ?? null,
    lastSeen: (row.last_seen as string) ?? null,
    isLive: Boolean(row.is_live),
    reachLower: (row.reach_lower as number) ?? null,
    reachUpper: (row.reach_upper as number) ?? null,
    countries: parseJson<string[]>(row.countries, []),
    raw: parseJson<Record<string, unknown>>(row.raw, {}),
    fetchedAt: row.fetched_at as string,
  };
}

export async function listCreatives(competitorId?: string) {
  const db = getDatabase();
  const rows = (
    competitorId
      ? await db
          .prepare("SELECT * FROM external_creatives WHERE competitor_id = ? ORDER BY first_seen DESC")
          .all([competitorId])
      : await db.prepare("SELECT * FROM external_creatives ORDER BY first_seen DESC").all()
  ) as Row[];
  return rows.map(toCreative);
}

export async function deleteCreative(source: string, externalId: string): Promise<void> {
  await getDatabase()
    .prepare("DELETE FROM external_creatives WHERE source = ? AND external_id = ?")
    .run([source, externalId]);
}

// ---------------------------------------------------------------------- runs

export async function startInspirationRun(source: string, competitorId: string | null): Promise<string> {
  const id = newId("insp");
  await getDatabase()
    .prepare(
      "INSERT INTO inspiration_runs (id, started_at, source, competitor_id, status) VALUES (?, ?, ?, ?, 'running')",
    )
    .run([id, nowISO(), source, competitorId]);
  return id;
}

export async function finishInspirationRun(
  id: string,
  status: "success" | "error",
  found: number,
  error?: string,
): Promise<void> {
  await getDatabase()
    .prepare("UPDATE inspiration_runs SET finished_at = ?, status = ?, found = ?, error = ? WHERE id = ?")
    .run([nowISO(), status, found, error ?? null, id]);
}

export async function listInspirationRuns(limit = 15) {
  const rows = (await getDatabase()
    .prepare("SELECT * FROM inspiration_runs ORDER BY started_at DESC LIMIT ?")
    .all([limit])) as Row[];
  return rows.map((row) => ({
    id: row.id as string,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string) ?? null,
    source: row.source as string,
    competitorId: (row.competitor_id as string) ?? null,
    status: row.status as string,
    found: row.found as number,
    error: (row.error as string) ?? null,
  }));
}

// ------------------------------------------------------------- angle reports

export interface StoredAngleReport {
  id: string;
  createdAt: string;
  market: string | null;
  summary: string;
  angles: unknown[];
  gaps: unknown[];
  concepts: unknown[];
  caveats: string[];
}

export async function saveAngleReport(report: Omit<StoredAngleReport, "id" | "createdAt">): Promise<string> {
  const id = newId("angle");
  await getDatabase()
    .prepare(
      `INSERT INTO angle_reports (id, created_at, market, summary, angles, gaps, concepts, caveats)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run([id, nowISO(), report.market, report.summary, JSON.stringify(report.angles), JSON.stringify(report.gaps), JSON.stringify(report.concepts), JSON.stringify(report.caveats)]);
  return id;
}

export async function latestAngleReport(): Promise<StoredAngleReport | null> {
  const row = (await getDatabase()
    .prepare("SELECT * FROM angle_reports ORDER BY created_at DESC LIMIT 1")
    .get()) as Row | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    market: (row.market as string) ?? null,
    summary: row.summary as string,
    angles: parseJson<unknown[]>(row.angles, []),
    gaps: parseJson<unknown[]>(row.gaps, []),
    concepts: parseJson<unknown[]>(row.concepts, []),
    caveats: parseJson<string[]>(row.caveats, []),
  };
}
