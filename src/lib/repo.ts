import { getDb } from "./db";
import { decryptJson, encryptJson } from "./crypto";
import { newId, nowISO, stableId } from "./util";
import type {
  Ad,
  AdGroup,
  Campaign,
  Connection,
  ConnectionStatus,
  ConnectorKind,
  Credentials,
  CreativeBrief,
  DateRange,
  MetricRow,
  PlatformId,
  Recommendation,
  SalesOrder,
  SyncRun,
} from "./types";

/**
 * Every read and write goes through this module, so the rest of the app never
 * sees a SQL row shape — only the domain types.
 */

type Row = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- connections

function toConnection(row: Row): Connection {
  return {
    id: row.id as string,
    platform: row.platform as PlatformId,
    kind: row.kind as ConnectorKind,
    displayName: row.display_name as string,
    externalAccountId: (row.external_account_id as string) ?? null,
    status: row.status as ConnectionStatus,
    currency: row.currency as string,
    config: parseJson<Record<string, unknown>>(row.config, {}),
    lastSyncAt: (row.last_sync_at as string) ?? null,
    lastError: (row.last_error as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export function listConnections(kind?: ConnectorKind): Connection[] {
  const db = getDb();
  const rows = kind
    ? (db
        .prepare("SELECT * FROM connections WHERE kind = ? ORDER BY display_name")
        .all(kind) as Row[])
    : (db.prepare("SELECT * FROM connections ORDER BY kind, display_name").all() as Row[]);
  return rows.map(toConnection);
}

export function getConnection(id: string): Connection | null {
  const row = getDb().prepare("SELECT * FROM connections WHERE id = ?").get(id) as Row | undefined;
  return row ? toConnection(row) : null;
}

export function findConnectionByPlatform(platform: PlatformId): Connection | null {
  const row = getDb()
    .prepare("SELECT * FROM connections WHERE platform = ? ORDER BY created_at LIMIT 1")
    .get(platform) as Row | undefined;
  return row ? toConnection(row) : null;
}

export interface UpsertConnectionInput {
  id?: string;
  platform: PlatformId;
  kind: ConnectorKind;
  displayName: string;
  externalAccountId?: string | null;
  status?: ConnectionStatus;
  currency?: string;
  config?: Record<string, unknown>;
}

export function upsertConnection(input: UpsertConnectionInput): Connection {
  const db = getDb();
  const id = input.id ?? stableId("conn", input.platform, input.externalAccountId ?? "default");
  db.prepare(
    `INSERT INTO connections
       (id, platform, kind, display_name, external_account_id, status, currency, config, created_at)
     VALUES (@id, @platform, @kind, @displayName, @externalAccountId, @status, @currency, @config, @createdAt)
     ON CONFLICT(id) DO UPDATE SET
       display_name        = excluded.display_name,
       external_account_id = excluded.external_account_id,
       status              = excluded.status,
       currency            = excluded.currency,
       config              = excluded.config`,
  ).run({
    id,
    platform: input.platform,
    kind: input.kind,
    displayName: input.displayName,
    externalAccountId: input.externalAccountId ?? null,
    status: input.status ?? "disconnected",
    currency: input.currency ?? "USD",
    config: JSON.stringify(input.config ?? {}),
    createdAt: nowISO(),
  });
  return getConnection(id)!;
}

export function setConnectionStatus(
  id: string,
  status: ConnectionStatus,
  lastError: string | null = null,
): void {
  getDb()
    .prepare("UPDATE connections SET status = ?, last_error = ? WHERE id = ?")
    .run(status, lastError, id);
}

export function markSynced(id: string): void {
  getDb()
    .prepare("UPDATE connections SET last_sync_at = ?, last_error = NULL WHERE id = ?")
    .run(nowISO(), id);
}

export function deleteConnection(id: string): void {
  getDb().prepare("DELETE FROM connections WHERE id = ?").run(id);
}

/**
 * Removes everything a connection has pulled, without disconnecting it.
 *
 * Pointing a connection at a different account makes what it holds belong to a
 * different advertiser. Left in place those rows do not look stale — they look
 * like part of the new account, and every total silently includes them. So the
 * slate is cleared when the account changes. Credentials are untouched, so the
 * connection stays authorised and the next sync refills it.
 */
export function clearConnectionData(connectionId: string): {
  campaigns: number;
  metrics: number;
  orders: number;
} {
  const db = getDb();
  // Ad groups and ads hang off campaigns with ON DELETE CASCADE, so they go too.
  const run = db.transaction(() => ({
    campaigns: db.prepare("DELETE FROM campaigns WHERE connection_id = ?").run(connectionId).changes,
    metrics: db.prepare("DELETE FROM metrics_daily WHERE connection_id = ?").run(connectionId).changes,
    orders: db.prepare("DELETE FROM sales_orders WHERE connection_id = ?").run(connectionId).changes,
  }));
  return run();
}

/** Credentials are encrypted at rest — only the server ever calls these two. */
export function saveCredentials(connectionId: string, credentials: Credentials): void {
  getDb()
    .prepare("UPDATE connections SET credentials = ? WHERE id = ?")
    .run(encryptJson(credentials), connectionId);
}

/**
 * Raised when a connection holds credentials that cannot be decrypted, which in
 * practice means CREDENTIALS_KEY changed after the account was connected —
 * usually by being set for the first time, since development derives a
 * throwaway key when it is absent.
 *
 * This is deliberately distinct from "no credentials stored". Collapsing the
 * two into null made a changed key look identical to a fresh install: the
 * account quietly reverted to unconnected and the real cause went unsaid.
 */
export class CredentialsUnreadableError extends Error {
  constructor() {
    super(
      "Stored credentials could not be decrypted. CREDENTIALS_KEY has changed since this account " +
        "was connected, so the saved token is unreadable. Reconnect the account to store it under " +
        "the current key.",
    );
    this.name = "CredentialsUnreadableError";
  }
}

export function loadCredentials(connectionId: string): Credentials | null {
  const row = getDb()
    .prepare("SELECT credentials FROM connections WHERE id = ?")
    .get(connectionId) as { credentials: string | null } | undefined;
  if (!row?.credentials) return null;
  try {
    return decryptJson<Credentials>(row.credentials);
  } catch {
    throw new CredentialsUnreadableError();
  }
}

// ---------------------------------------------------------------- oauth state

export function saveOAuthState(input: {
  state: string;
  platform: PlatformId;
  connectionId?: string | null;
  codeVerifier?: string | null;
  redirectTo?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO oauth_states (state, platform, connection_id, code_verifier, redirect_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.state,
      input.platform,
      input.connectionId ?? null,
      input.codeVerifier ?? null,
      input.redirectTo ?? null,
      nowISO(),
    );
}

export function consumeOAuthState(state: string): {
  platform: PlatformId;
  connectionId: string | null;
  codeVerifier: string | null;
  redirectTo: string | null;
} | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state) as Row | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  // States are single-use and short-lived; anything older than an hour is stale.
  const age = Date.now() - Date.parse(row.created_at as string);
  if (age > 3_600_000) return null;
  return {
    platform: row.platform as PlatformId,
    connectionId: (row.connection_id as string) ?? null,
    codeVerifier: (row.code_verifier as string) ?? null,
    redirectTo: (row.redirect_to as string) ?? null,
  };
}

// ------------------------------------------------------------------ campaigns

function toCampaign(row: Row): Campaign {
  return {
    id: row.id as string,
    connectionId: row.connection_id as string,
    platform: row.platform as PlatformId,
    externalId: row.external_id as string,
    name: row.name as string,
    status: row.status as Campaign["status"],
    objective: (row.objective as string) ?? null,
    dailyBudget: (row.daily_budget as number) ?? null,
    currency: row.currency as string,
    startDate: (row.start_date as string) ?? null,
    endDate: (row.end_date as string) ?? null,
  };
}

export function upsertCampaigns(campaigns: Omit<Campaign, "id">[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO campaigns
       (id, connection_id, platform, external_id, name, status, objective, daily_budget, currency, start_date, end_date)
     VALUES (@id, @connectionId, @platform, @externalId, @name, @status, @objective, @dailyBudget, @currency, @startDate, @endDate)
     ON CONFLICT(connection_id, external_id) DO UPDATE SET
       name         = excluded.name,
       status       = excluded.status,
       objective    = excluded.objective,
       daily_budget = excluded.daily_budget,
       currency     = excluded.currency,
       start_date   = excluded.start_date,
       end_date     = excluded.end_date`,
  );
  const run = db.transaction((items: Omit<Campaign, "id">[]) => {
    for (const c of items) {
      stmt.run({ ...c, id: stableId("cmp", c.connectionId, c.externalId) });
    }
  });
  run(campaigns);
}

export function listCampaigns(): Campaign[] {
  return (getDb().prepare("SELECT * FROM campaigns ORDER BY name").all() as Row[]).map(toCampaign);
}

export function getCampaign(id: string): Campaign | null {
  const row = getDb().prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as Row | undefined;
  return row ? toCampaign(row) : null;
}

export function setCampaignStatus(id: string, status: Campaign["status"]): void {
  getDb().prepare("UPDATE campaigns SET status = ? WHERE id = ?").run(status, id);
}

export function setCampaignBudget(id: string, dailyBudget: number): void {
  getDb().prepare("UPDATE campaigns SET daily_budget = ? WHERE id = ?").run(dailyBudget, id);
}

/**
 * Children whose parent was not in the same snapshot are skipped rather than
 * inserted.
 *
 * A platform can report an ad group whose campaign it did not report — removed
 * campaigns are the usual reason, and a connector filtering them inconsistently
 * is a bug worth fixing at the query. But the foreign key turns one such row
 * into a failed sync for the whole account, which throws away every good row
 * alongside it. Skipping and counting keeps the sync useful and still says
 * something was wrong.
 */
export function upsertAdGroups(
  groups: (Omit<AdGroup, "id"> & { connectionId: string })[],
): { inserted: number; orphaned: number } {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO ad_groups (id, campaign_id, external_id, name, status)
     VALUES (@id, @campaignId, @externalId, @name, @status)
     ON CONFLICT(campaign_id, external_id) DO UPDATE SET
       name = excluded.name, status = excluded.status`,
  );
  const hasCampaign = db.prepare("SELECT 1 FROM campaigns WHERE id = ?").pluck();
  let inserted = 0;
  let orphaned = 0;

  const run = db.transaction((items: typeof groups) => {
    for (const g of items) {
      if (!hasCampaign.get(g.campaignId)) {
        orphaned += 1;
        continue;
      }
      stmt.run({
        id: stableId("adg", g.campaignId, g.externalId),
        campaignId: g.campaignId,
        externalId: g.externalId,
        name: g.name,
        status: g.status,
      });
      inserted += 1;
    }
  });
  run(groups);
  return { inserted, orphaned };
}

/** Same orphan handling as ad groups above, for ads whose ad group is missing. */
export function upsertAds(ads: Omit<Ad, "id">[]): { inserted: number; orphaned: number } {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO ads
       (id, ad_group_id, campaign_id, external_id, name, format, status, headline, body, call_to_action, landing_page, preview_url)
     VALUES (@id, @adGroupId, @campaignId, @externalId, @name, @format, @status, @headline, @body, @callToAction, @landingPage, @previewUrl)
     ON CONFLICT(ad_group_id, external_id) DO UPDATE SET
       name           = excluded.name,
       format         = excluded.format,
       status         = excluded.status,
       headline       = excluded.headline,
       body           = excluded.body,
       call_to_action = excluded.call_to_action,
       landing_page   = excluded.landing_page,
       preview_url    = excluded.preview_url`,
  );
  const hasAdGroup = db.prepare("SELECT 1 FROM ad_groups WHERE id = ?").pluck();
  let inserted = 0;
  let orphaned = 0;

  const run = db.transaction((items: Omit<Ad, "id">[]) => {
    for (const a of items) {
      if (!hasAdGroup.get(a.adGroupId)) {
        orphaned += 1;
        continue;
      }
      stmt.run({ ...a, id: stableId("ad", a.adGroupId, a.externalId) });
      inserted += 1;
    }
  });
  run(ads);
  return { inserted, orphaned };
}

export function listAds(): Ad[] {
  const rows = getDb().prepare("SELECT * FROM ads ORDER BY name").all() as Row[];
  return rows.map((row) => ({
    id: row.id as string,
    adGroupId: row.ad_group_id as string,
    campaignId: row.campaign_id as string,
    externalId: row.external_id as string,
    name: row.name as string,
    format: row.format as Ad["format"],
    status: row.status as Ad["status"],
    headline: (row.headline as string) ?? null,
    body: (row.body as string) ?? null,
    callToAction: (row.call_to_action as string) ?? null,
    landingPage: (row.landing_page as string) ?? null,
    previewUrl: (row.preview_url as string) ?? null,
  }));
}

export function listAdGroups(): AdGroup[] {
  const rows = getDb().prepare("SELECT * FROM ad_groups ORDER BY name").all() as Row[];
  return rows.map((row) => ({
    id: row.id as string,
    campaignId: row.campaign_id as string,
    externalId: row.external_id as string,
    name: row.name as string,
    status: row.status as AdGroup["status"],
  }));
}

// -------------------------------------------------------------------- metrics

export function upsertMetrics(rows: MetricRow[]): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO metrics_daily
       (date, connection_id, platform, campaign_external_id, ad_group_external_id, ad_external_id,
        impressions, clicks, spend, platform_conversions, platform_revenue, video_views, frequency, currency)
     VALUES (@date, @connectionId, @platform, @campaignExternalId, @adGroupExternalId, @adExternalId,
             @impressions, @clicks, @spend, @platformConversions, @platformRevenue, @videoViews, @frequency, @currency)
     ON CONFLICT(date, connection_id, campaign_external_id, ad_group_external_id, ad_external_id)
     DO UPDATE SET
       impressions          = excluded.impressions,
       clicks               = excluded.clicks,
       spend                = excluded.spend,
       platform_conversions = excluded.platform_conversions,
       platform_revenue     = excluded.platform_revenue,
       video_views          = excluded.video_views,
       frequency            = excluded.frequency,
       currency             = excluded.currency`,
  );
  const run = db.transaction((items: MetricRow[]) => {
    for (const m of items) {
      stmt.run({
        ...m,
        adGroupExternalId: m.adGroupExternalId ?? "",
        adExternalId: m.adExternalId ?? "",
      });
    }
  });
  run(rows);
  return rows.length;
}

export function queryMetrics(range: DateRange): MetricRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM metrics_daily WHERE date BETWEEN ? AND ? ORDER BY date")
    .all(range.start, range.end) as Row[];
  return rows.map((row) => ({
    date: row.date as string,
    connectionId: row.connection_id as string,
    platform: row.platform as PlatformId,
    campaignExternalId: row.campaign_external_id as string,
    adGroupExternalId: (row.ad_group_external_id as string) || null,
    adExternalId: (row.ad_external_id as string) || null,
    impressions: row.impressions as number,
    clicks: row.clicks as number,
    spend: row.spend as number,
    platformConversions: row.platform_conversions as number,
    platformRevenue: row.platform_revenue as number,
    videoViews: row.video_views as number,
    frequency: row.frequency as number,
    currency: row.currency as string,
  }));
}

export function metricsDateBounds(): { min: string | null; max: string | null } {
  const row = getDb()
    .prepare("SELECT MIN(date) AS min, MAX(date) AS max FROM metrics_daily")
    .get() as { min: string | null; max: string | null };
  return row ?? { min: null, max: null };
}

// ---------------------------------------------------------------------- sales

export function upsertOrders(orders: Omit<SalesOrder, "id">[]): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO sales_orders
       (id, connection_id, platform, external_id, ordered_at, revenue, cogs, currency, customer_ref,
        is_new_customer, landing_page, utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id, click_id_type)
     VALUES (@id, @connectionId, @platform, @externalId, @orderedAt, @revenue, @cogs, @currency, @customerRef,
             @isNewCustomer, @landingPage, @utmSource, @utmMedium, @utmCampaign, @utmContent, @utmTerm, @clickId, @clickIdType)
     ON CONFLICT(connection_id, external_id) DO UPDATE SET
       revenue       = excluded.revenue,
       cogs          = excluded.cogs,
       ordered_at    = excluded.ordered_at,
       utm_source    = excluded.utm_source,
       utm_medium    = excluded.utm_medium,
       utm_campaign  = excluded.utm_campaign,
       utm_content   = excluded.utm_content,
       utm_term      = excluded.utm_term,
       click_id      = excluded.click_id,
       click_id_type = excluded.click_id_type`,
  );
  const run = db.transaction((items: Omit<SalesOrder, "id">[]) => {
    for (const o of items) {
      stmt.run({
        ...o,
        id: stableId("ord", o.connectionId, o.externalId),
        isNewCustomer: o.isNewCustomer ? 1 : 0,
      });
    }
  });
  run(orders);
  return orders.length;
}

/**
 * Which connections revenue is counted from.
 *
 * A store API and an analytics property describe the same sales, so adding them
 * together double counts every order — and the total stays plausible while
 * being twice what the business took, which is the worst way for a number to be
 * wrong. A store is the better record when there is one: it knows individual
 * orders, their real value, and what was refunded. Analytics is the fallback
 * for a shop with no store API, and otherwise a second opinion rather than an
 * addition.
 */
export function revenueSourceKind(): ConnectorKind {
  const hasStore = getDb()
    .prepare("SELECT 1 FROM connections WHERE kind = 'sales' LIMIT 1")
    .pluck()
    .get();
  return hasStore ? "sales" : "analytics";
}

/**
 * Orders from the authoritative revenue source only. Pass a kind to read a
 * different one deliberately — comparing the two is the point of connecting
 * both, and that comparison has to ask for each side by name.
 */
export function queryOrders(range: DateRange, kind: ConnectorKind = revenueSourceKind()): SalesOrder[] {
  const rows = getDb()
    .prepare(
      `SELECT o.* FROM sales_orders o
         JOIN connections c ON c.id = o.connection_id
        WHERE c.kind = ? AND date(o.ordered_at) BETWEEN ? AND ?
        ORDER BY o.ordered_at`,
    )
    .all(kind, range.start, range.end) as Row[];
  return rows.map((row) => ({
    id: row.id as string,
    connectionId: row.connection_id as string,
    platform: row.platform as PlatformId,
    externalId: row.external_id as string,
    orderedAt: row.ordered_at as string,
    revenue: row.revenue as number,
    cogs: (row.cogs as number) ?? null,
    currency: row.currency as string,
    customerRef: (row.customer_ref as string) ?? null,
    isNewCustomer: Boolean(row.is_new_customer),
    landingPage: (row.landing_page as string) ?? null,
    utmSource: (row.utm_source as string) ?? null,
    utmMedium: (row.utm_medium as string) ?? null,
    utmCampaign: (row.utm_campaign as string) ?? null,
    utmContent: (row.utm_content as string) ?? null,
    utmTerm: (row.utm_term as string) ?? null,
    clickId: (row.click_id as string) ?? null,
    clickIdType: (row.click_id_type as string) ?? null,
  }));
}

// ------------------------------------------------------------ recommendations

function toRecommendation(row: Row): Recommendation {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    source: row.source as Recommendation["source"],
    scope: row.scope as Recommendation["scope"],
    targetId: row.target_id as string,
    targetName: row.target_name as string,
    platform: (row.platform as PlatformId) ?? null,
    type: row.type as Recommendation["type"],
    severity: row.severity as Recommendation["severity"],
    title: row.title as string,
    rationale: row.rationale as string,
    expectedMonthlyImpact: row.expected_monthly_impact as number,
    confidence: row.confidence as number,
    evidence: parseJson<Record<string, unknown>>(row.evidence, {}),
    status: row.status as Recommendation["status"],
  };
}

export function saveRecommendations(recs: Omit<Recommendation, "id" | "createdAt">[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO recommendations
       (id, created_at, source, scope, target_id, target_name, platform, type, severity, title,
        rationale, expected_monthly_impact, confidence, evidence, status)
     VALUES (@id, @createdAt, @source, @scope, @targetId, @targetName, @platform, @type, @severity, @title,
             @rationale, @expectedMonthlyImpact, @confidence, @evidence, @status)
     ON CONFLICT(id) DO UPDATE SET
       created_at              = excluded.created_at,
       severity                = excluded.severity,
       title                   = excluded.title,
       rationale               = excluded.rationale,
       expected_monthly_impact = excluded.expected_monthly_impact,
       confidence              = excluded.confidence,
       evidence                = excluded.evidence`,
  );
  const run = db.transaction((items: typeof recs) => {
    for (const r of items) {
      stmt.run({
        ...r,
        // Same finding on the same target updates in place rather than piling up
        // a new card on every refresh.
        id: stableId("rec", r.source, r.type, r.targetId),
        createdAt: nowISO(),
        evidence: JSON.stringify(r.evidence),
      });
    }
  });
  run(recs);
}

export function listRecommendations(status?: Recommendation["status"]): Recommendation[] {
  const db = getDb();
  const rows = (
    status
      ? db
          .prepare(
            "SELECT * FROM recommendations WHERE status = ? ORDER BY expected_monthly_impact DESC",
          )
          .all(status)
      : db
          .prepare("SELECT * FROM recommendations ORDER BY expected_monthly_impact DESC")
          .all()
  ) as Row[];
  return rows.map(toRecommendation);
}

export function setRecommendationStatus(id: string, status: Recommendation["status"]): void {
  getDb().prepare("UPDATE recommendations SET status = ? WHERE id = ?").run(status, id);
}

/** Drops stale rule findings before a fresh pass writes the current ones. */
export function clearRecommendations(source: Recommendation["source"]): void {
  getDb()
    .prepare("DELETE FROM recommendations WHERE source = ? AND status = 'open'")
    .run(source);
}

// ------------------------------------------------------------------ sync runs

export function startSyncRun(connectionId: string): string {
  const id = newId("sync");
  getDb()
    .prepare(
      "INSERT INTO sync_runs (id, connection_id, started_at, status, rows_ingested) VALUES (?, ?, ?, 'running', 0)",
    )
    .run(id, connectionId, nowISO());
  return id;
}

export function finishSyncRun(
  id: string,
  status: "success" | "error",
  rowsIngested: number,
  error?: string,
): void {
  getDb()
    .prepare(
      "UPDATE sync_runs SET finished_at = ?, status = ?, rows_ingested = ?, error = ? WHERE id = ?",
    )
    .run(nowISO(), status, rowsIngested, error ?? null, id);
}

export function listSyncRuns(limit = 20): SyncRun[] {
  const rows = getDb()
    .prepare("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map((row) => ({
    id: row.id as string,
    connectionId: row.connection_id as string,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string) ?? null,
    status: row.status as SyncRun["status"],
    rowsIngested: row.rows_ingested as number,
    error: (row.error as string) ?? null,
  }));
}

// ------------------------------------------------------------ creative briefs

export function saveCreativeBrief(brief: Omit<CreativeBrief, "id" | "createdAt">): CreativeBrief {
  const id = newId("brief");
  const createdAt = nowISO();
  getDb()
    .prepare(
      `INSERT INTO creative_briefs (id, created_at, platform, objective, audience, variants, test_plan, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      createdAt,
      brief.platform,
      brief.objective,
      brief.audience,
      JSON.stringify(brief.variants),
      brief.testPlan,
      brief.notes ?? null,
    );
  return { ...brief, id, createdAt };
}

export function listCreativeBriefs(limit = 25): CreativeBrief[] {
  const rows = getDb()
    .prepare("SELECT * FROM creative_briefs ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map((row) => ({
    id: row.id as string,
    createdAt: row.created_at as string,
    platform: row.platform as PlatformId,
    objective: row.objective as string,
    audience: row.audience as string,
    variants: parseJson<CreativeBrief["variants"]>(row.variants, []),
    testPlan: row.test_plan as string,
    notes: (row.notes as string) ?? null,
  }));
}

// ----------------------------------------------------------------- action log

export function logAction(entry: {
  connectionId?: string | null;
  scope: string;
  targetId: string;
  action: string;
  payload?: Record<string, unknown>;
  result: "applied" | "recorded" | "failed";
  detail?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO action_log (id, created_at, connection_id, scope, target_id, action, payload, result, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("act"),
      nowISO(),
      entry.connectionId ?? null,
      entry.scope,
      entry.targetId,
      entry.action,
      JSON.stringify(entry.payload ?? {}),
      entry.result,
      entry.detail ?? null,
    );
}

export function listActions(limit = 50) {
  const rows = getDb()
    .prepare("SELECT * FROM action_log ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Row[];
  return rows.map((row) => ({
    id: row.id as string,
    createdAt: row.created_at as string,
    connectionId: (row.connection_id as string) ?? null,
    scope: row.scope as string,
    targetId: row.target_id as string,
    action: row.action as string,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    result: row.result as string,
    detail: (row.detail as string) ?? null,
  }));
}
