/**
 * One async SQL interface, two drivers behind it.
 *
 * The portal is moving onto Cloudflare Workers and D1, which rules out the
 * synchronous native driver it was written against. Rather than cut over and
 * find out what broke in production, the repository talks to this interface and
 * each environment supplies a driver: D1 on Workers, better-sqlite3 locally so
 * `npm run dev` and every doctor script keep working on the same code.
 *
 * The interface is shaped to D1 rather than to SQLite, because D1 is the
 * constrained one and an interface that hides its limits would only hide them
 * until deployment. Two of those limits shape everything here.
 */

export interface SqlRow {
  [column: string]: unknown;
}

/** A statement with its values already attached, ready to run or to batch. */
export interface BoundStatement {
  readonly sql: string;
  readonly values: readonly unknown[];
}

export interface PreparedStatement {
  /** Attaches values without running, for `batch`. */
  bind(params?: BindParams): BoundStatement;
  run(params?: BindParams): Promise<{ changes: number }>;
  get<T = SqlRow>(params?: BindParams): Promise<T | undefined>;
  all<T = SqlRow>(params?: BindParams): Promise<T[]>;
  /** The first column of the first row — for `SELECT 1 FROM ...` existence checks. */
  pluck<T = unknown>(params?: BindParams): Promise<T | undefined>;
}

export type BindParams = Record<string, unknown> | readonly unknown[];

export interface SqlDatabase {
  prepare(sql: string): PreparedStatement;
  /**
   * Runs every statement atomically, all or nothing.
   *
   * Deliberately takes a list rather than a callback. D1 has no interactive
   * transaction: it cannot hold one open while application code decides what to
   * write next, so a callback that read a row mid-transaction would work
   * locally and fail in production. Taking the statements up front makes that
   * impossible to write by accident — any read a write depends on happens
   * before the batch is assembled.
   */
  batch(statements: BoundStatement[]): Promise<void>;
  /** Applies DDL. Used by migration only. */
  exec(sql: string): Promise<void>;
}

/**
 * Rewrites `@name` placeholders to positional `?`.
 *
 * The repository was written with named parameters, which better-sqlite3
 * supports and D1 does not. Rewriting here keeps the SQL readable — a
 * twenty-column upsert addressed by position is a transcription error waiting
 * to happen — and means neither driver sees a dialect the other cannot.
 *
 * A missing key is an error rather than a silent null: in an upsert that is the
 * difference between a column being cleared and a typo in its name.
 */
export function toPositional(
  sql: string,
  params: BindParams | undefined,
): { sql: string; values: unknown[] } {
  if (Array.isArray(params)) return { sql, values: [...params] };

  const named = (params ?? {}) as Record<string, unknown>;
  const values: unknown[] = [];
  const used = new Set<string>();

  const rewritten = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
    if (!(name in named)) {
      throw new Error(
        `SQL parameter @${name} has no value. Named parameters are matched by name, so this is ` +
          "either a typo in the SQL or a field missing from the object passed with it.",
      );
    }
    used.add(name);
    values.push(normalise(named[name]));
    return "?";
  });

  return { sql: rewritten, values };
}

/**
 * SQLite stores no booleans and no undefined, and the two drivers disagree
 * about what they do with them — better-sqlite3 throws, D1 coerces. Settling it
 * here means a row written locally and the same row written on Workers are the
 * same bytes.
 */
export function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function normaliseAll(values: readonly unknown[]): unknown[] {
  return values.map(normalise);
}
