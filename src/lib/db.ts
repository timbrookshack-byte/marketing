import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * SQLite is the default store: the whole portal runs from one file with no
 * infrastructure. The access layer below is plain SQL, so moving to Postgres
 * later means swapping this module, not the application.
 */

const DB_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "marketing360.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id                   TEXT PRIMARY KEY,
      platform             TEXT NOT NULL,
      kind                 TEXT NOT NULL,
      display_name         TEXT NOT NULL,
      external_account_id  TEXT,
      status               TEXT NOT NULL DEFAULT 'disconnected',
      currency             TEXT NOT NULL DEFAULT 'USD',
      config               TEXT NOT NULL DEFAULT '{}',
      credentials          TEXT,
      last_sync_at         TEXT,
      last_error           TEXT,
      created_at           TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state          TEXT PRIMARY KEY,
      platform       TEXT NOT NULL,
      connection_id  TEXT,
      code_verifier  TEXT,
      redirect_to    TEXT,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      platform      TEXT NOT NULL,
      external_id   TEXT NOT NULL,
      name          TEXT NOT NULL,
      status        TEXT NOT NULL,
      objective     TEXT,
      daily_budget  REAL,
      currency      TEXT NOT NULL DEFAULT 'USD',
      start_date    TEXT,
      end_date      TEXT,
      UNIQUE (connection_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS ad_groups (
      id          TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL,
      UNIQUE (campaign_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS ads (
      id            TEXT PRIMARY KEY,
      ad_group_id   TEXT NOT NULL REFERENCES ad_groups(id) ON DELETE CASCADE,
      campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      external_id   TEXT NOT NULL,
      name          TEXT NOT NULL,
      format        TEXT NOT NULL,
      status        TEXT NOT NULL,
      headline      TEXT,
      body          TEXT,
      call_to_action TEXT,
      landing_page  TEXT,
      preview_url   TEXT,
      UNIQUE (ad_group_id, external_id)
    );

    /*
     * One row per day per entity. The composite primary key makes ingestion
     * idempotent: re-syncing a window overwrites rather than double-counts,
     * which matters because ad platforms restate recent days.
     */
    CREATE TABLE IF NOT EXISTS metrics_daily (
      date                   TEXT NOT NULL,
      connection_id          TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      platform               TEXT NOT NULL,
      campaign_external_id   TEXT NOT NULL,
      ad_group_external_id   TEXT NOT NULL DEFAULT '',
      ad_external_id         TEXT NOT NULL DEFAULT '',
      impressions            INTEGER NOT NULL DEFAULT 0,
      clicks                 INTEGER NOT NULL DEFAULT 0,
      spend                  REAL NOT NULL DEFAULT 0,
      platform_conversions   REAL NOT NULL DEFAULT 0,
      platform_revenue       REAL NOT NULL DEFAULT 0,
      video_views            INTEGER NOT NULL DEFAULT 0,
      frequency              REAL NOT NULL DEFAULT 0,
      currency               TEXT NOT NULL DEFAULT 'USD',
      PRIMARY KEY (date, connection_id, campaign_external_id, ad_group_external_id, ad_external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_date ON metrics_daily(date);
    CREATE INDEX IF NOT EXISTS idx_metrics_campaign ON metrics_daily(connection_id, campaign_external_id);

    CREATE TABLE IF NOT EXISTS sales_orders (
      id             TEXT PRIMARY KEY,
      connection_id  TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      platform       TEXT NOT NULL,
      external_id    TEXT NOT NULL,
      ordered_at     TEXT NOT NULL,
      revenue        REAL NOT NULL,
      cogs           REAL,
      currency       TEXT NOT NULL DEFAULT 'USD',
      customer_ref   TEXT,
      is_new_customer INTEGER NOT NULL DEFAULT 1,
      landing_page   TEXT,
      utm_source     TEXT,
      utm_medium     TEXT,
      utm_campaign   TEXT,
      utm_content    TEXT,
      utm_term       TEXT,
      click_id       TEXT,
      click_id_type  TEXT,
      UNIQUE (connection_id, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_date ON sales_orders(ordered_at);
    CREATE INDEX IF NOT EXISTS idx_orders_utm ON sales_orders(utm_source, utm_campaign);

    CREATE TABLE IF NOT EXISTS recommendations (
      id                      TEXT PRIMARY KEY,
      created_at              TEXT NOT NULL,
      source                  TEXT NOT NULL,
      scope                   TEXT NOT NULL,
      target_id               TEXT NOT NULL,
      target_name             TEXT NOT NULL,
      platform                TEXT,
      type                    TEXT NOT NULL,
      severity                TEXT NOT NULL,
      title                   TEXT NOT NULL,
      rationale               TEXT NOT NULL,
      expected_monthly_impact REAL NOT NULL DEFAULT 0,
      confidence              REAL NOT NULL DEFAULT 0,
      evidence                TEXT NOT NULL DEFAULT '{}',
      status                  TEXT NOT NULL DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      started_at    TEXT NOT NULL,
      finished_at   TEXT,
      status        TEXT NOT NULL,
      rows_ingested INTEGER NOT NULL DEFAULT 0,
      error         TEXT
    );

    CREATE TABLE IF NOT EXISTS creative_briefs (
      id         TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      platform   TEXT NOT NULL,
      objective  TEXT NOT NULL,
      audience   TEXT NOT NULL,
      variants   TEXT NOT NULL,
      test_plan  TEXT NOT NULL,
      notes      TEXT
    );

    /* Everything the portal changes on a live ad account is written here first. */
    CREATE TABLE IF NOT EXISTS action_log (
      id            TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL,
      connection_id TEXT,
      scope         TEXT NOT NULL,
      target_id     TEXT NOT NULL,
      action        TEXT NOT NULL,
      payload       TEXT NOT NULL DEFAULT '{}',
      result        TEXT NOT NULL,
      detail        TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    /* ---------------------------------------------------- concept inspiration */

    /* Brands we watch. Identifiers are per-source because no two ad libraries
       agree on how an advertiser is named. */
    CREATE TABLE IF NOT EXISTS competitors (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      domain      TEXT,
      /* Free-text category used to judge whether a peer is really in our space. */
      category    TEXT,
      /* { meta: "pageId", tiktok: "advertiserName", linkedin: "companyId", ... } */
      handles     TEXT NOT NULL DEFAULT '{}',
      /* 'user' when added by hand, 'suggested' when proposed and not yet confirmed. */
      origin      TEXT NOT NULL DEFAULT 'user',
      notes       TEXT,
      created_at  TEXT NOT NULL,
      UNIQUE (name)
    );

    /*
     * One row per creative seen in a public ad library.
     *
     * first_seen / last_seen are the load-bearing columns: we cannot observe a
     * competitor's performance, so how long they have kept an ad running is the
     * evidence that it works.
     */
    CREATE TABLE IF NOT EXISTS external_creatives (
      id             TEXT PRIMARY KEY,
      competitor_id  TEXT REFERENCES competitors(id) ON DELETE CASCADE,
      source         TEXT NOT NULL,
      platform       TEXT NOT NULL,
      external_id    TEXT NOT NULL,
      advertiser     TEXT NOT NULL,
      headline       TEXT,
      body           TEXT,
      call_to_action TEXT,
      format         TEXT,
      landing_page   TEXT,
      media_url      TEXT,
      permalink      TEXT,
      first_seen     TEXT,
      last_seen      TEXT,
      /* Still delivering as of the last refresh. */
      is_live        INTEGER NOT NULL DEFAULT 0,
      /* EU/UK DSA disclosures only; null everywhere else. */
      reach_lower    INTEGER,
      reach_upper    INTEGER,
      countries      TEXT NOT NULL DEFAULT '[]',
      /* Creatives that are near-duplicates share a variant_key. */
      variant_key    TEXT,
      raw            TEXT NOT NULL DEFAULT '{}',
      fetched_at     TEXT NOT NULL,
      UNIQUE (source, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_external_competitor ON external_creatives(competitor_id);
    CREATE INDEX IF NOT EXISTS idx_external_lastseen ON external_creatives(last_seen);

    CREATE TABLE IF NOT EXISTS inspiration_runs (
      id            TEXT PRIMARY KEY,
      started_at    TEXT NOT NULL,
      finished_at   TEXT,
      source        TEXT NOT NULL,
      competitor_id TEXT,
      status        TEXT NOT NULL,
      found         INTEGER NOT NULL DEFAULT 0,
      error         TEXT
    );

    /* The output of an angle analysis: what rivals run, what we do not. */
    CREATE TABLE IF NOT EXISTS angle_reports (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      market      TEXT,
      summary     TEXT NOT NULL,
      angles      TEXT NOT NULL DEFAULT '[]',
      gaps        TEXT NOT NULL DEFAULT '[]',
      concepts    TEXT NOT NULL DEFAULT '[]',
      caveats     TEXT NOT NULL DEFAULT '[]'
    );
  `);
}

/** Small helper so callers can read/write the settings key-value table. */
export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function getJsonSetting<T>(key: string, fallback: T): T {
  const raw = getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJsonSetting(key: string, value: unknown): void {
  setSetting(key, JSON.stringify(value));
}
