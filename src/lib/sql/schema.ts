/**
 * The schema, in one place, applied identically by every driver.
 *
 * Kept as plain CREATE TABLE IF NOT EXISTS statements rather than a migration
 * chain: there is one database, it belongs to one operator, and a chain would
 * be ceremony around a file that can be rebuilt from the platforms in minutes.
 */
export const SCHEMA = `
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
      detail        TEXT,
      /*
       * Who asked for this, and under which proposal.
       *
       * Added when writes stopped being something only a person sitting in
       * front of the portal could start. A log that cannot distinguish a
       * change an assistant proposed from one an operator made by hand cannot
       * answer the only question that matters after a bad change.
       *
       * Both are nullable: rows written before this existed have neither, and
       * a change made directly in the portal has an actor but no proposal.
       */
      actor         TEXT,
      proposal_id   TEXT
    );

    /*
     * Changes asked for but not yet made.
     *
     * The portal could already pause a campaign and move a budget, and did it
     * the moment it was asked. That was tolerable while the only way to ask
     * was a person clicking a button in a browser. It stops being tolerable
     * once an assistant can ask, so every write now becomes a proposal first
     * and reaches the platform only when a person approves it.
     *
     * 'before' is the state captured when the proposal was made, which is what
     * makes a proposal reviewable ("$40 -> $120", not "$120") and what lets a
     * change be put back. 'guardrails' holds what the policy said at the time:
     * kept rather than recomputed, because the caps may have been edited since
     * and the question later is always what was known when it was approved.
     */
    CREATE TABLE IF NOT EXISTS change_proposals (
      id            TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL,
      created_by    TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      platform      TEXT NOT NULL,
      scope         TEXT NOT NULL,
      target_id     TEXT NOT NULL,
      target_name   TEXT NOT NULL,
      action        TEXT NOT NULL,
      payload       TEXT NOT NULL DEFAULT '{}',
      before        TEXT NOT NULL DEFAULT '{}',
      rationale     TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      guardrails    TEXT NOT NULL DEFAULT '[]',
      expires_at    TEXT,
      decided_at    TEXT,
      decided_by    TEXT,
      applied_at    TEXT,
      result        TEXT,
      detail        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_proposals_status
      ON change_proposals (status, created_at);
    CREATE INDEX IF NOT EXISTS idx_proposals_target
      ON change_proposals (target_id, created_at);

    /*
     * Every visit on the way to an order, not just the one that got the credit.
     *
     * The connector already asks Shopify for the whole customer journey -- the
     * first visit, the last, and the moments between -- and then collapses it
     * to a single attributing visit before saving. That is the right answer
     * for "which campaign gets this sale", and it is the wrong answer for
     * every other question: an awareness campaign's job is to be someone's
     * first touch, and last-click attribution hands that credit to whatever
     * they searched three weeks later. Judged on last click, a campaign doing
     * its job perfectly reads as zero return.
     *
     * Position is the visit's place in the journey, counting from 1, so first
     * and last touch are just the ends of the list and the middle is intact.
     * The ordering comes from Shopify rather than from us: occurred_at can be
     * missing, and sorting by a null would silently reorder a journey.
     *
     * Keyed on (order_id, position) so a re-sync of the same order replaces
     * its journey rather than appending a second copy of it.
     */
    CREATE TABLE IF NOT EXISTS order_touchpoints (
      order_id     TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
      position     INTEGER NOT NULL,
      occurred_at  TEXT,
      source       TEXT,
      medium       TEXT,
      campaign     TEXT,
      content      TEXT,
      term         TEXT,
      referrer     TEXT,
      landing_page TEXT,
      click_id     TEXT,
      click_id_type TEXT,
      PRIMARY KEY (order_id, position)
    );

    CREATE INDEX IF NOT EXISTS idx_touchpoints_source
      ON order_touchpoints (source, medium);

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
  `;

/**
 * Splits the schema into individual statements.
 *
 * Walks the text rather than splitting on semicolons: the schema is commented,
 * and a semicolon inside a comment or a string literal would otherwise cut a
 * statement in half and hand the driver something that will not parse. The
 * failure is "incomplete input", which says nothing about which table.
 */
export function schemaStatements(): string[] {
  const statements: string[] = [];
  let current = "";
  let index = 0;

  while (index < SCHEMA.length) {
    const rest = SCHEMA.slice(index);

    if (rest.startsWith("/*")) {
      const close = SCHEMA.indexOf("*/", index + 2);
      index = close === -1 ? SCHEMA.length : close + 2;
      continue;
    }
    if (rest.startsWith("--")) {
      const newline = SCHEMA.indexOf("\n", index);
      index = newline === -1 ? SCHEMA.length : newline;
      continue;
    }
    if (rest.startsWith("'")) {
      // Copy the literal whole, so a semicolon inside it is not a boundary.
      const close = SCHEMA.indexOf("'", index + 1);
      const end = close === -1 ? SCHEMA.length : close + 1;
      current += SCHEMA.slice(index, end);
      index = end;
      continue;
    }
    if (rest.startsWith(";")) {
      const trimmed = current.trim();
      if (trimmed) statements.push(`${trimmed};`);
      current = "";
      index += 1;
      continue;
    }

    current += SCHEMA[index];
    index += 1;
  }

  const trailing = current.trim();
  if (trailing) statements.push(`${trailing};`);
  return statements;
}

/**
 * Changes to tables that already exist.
 *
 * Everything above is written as CREATE TABLE IF NOT EXISTS, which is exactly
 * right for a fresh database and does nothing at all for one that already has
 * the table. A column added to a CREATE above therefore appears only in
 * databases created after it was added — silently, since no statement fails.
 *
 * These run after the schema, and each is expected to fail once the column is
 * there. SQLite has no ADD COLUMN IF NOT EXISTS, so the caller tolerates the
 * duplicate-column error and nothing else; see `isAlreadyApplied`.
 */
export function migrationStatements(): string[] {
  return [
    "ALTER TABLE action_log ADD COLUMN actor TEXT;",
    "ALTER TABLE action_log ADD COLUMN proposal_id TEXT;",
  ];
}

/**
 * Whether a failed migration is one that had already been applied.
 *
 * Narrow on purpose: it matches the one message SQLite and D1 give for a
 * column that is already there, so a genuine error in a migration — a typo, a
 * missing table — still stops the startup rather than being swallowed.
 */
export function isAlreadyApplied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column name/i.test(message);
}
