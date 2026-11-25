/**
 * The local driver: better-sqlite3 behind the async interface.
 *
 * Kept so development, the doctor scripts and the one-off tools run against the
 * same repository code that Workers runs, rather than against a second
 * implementation that drifts. The synchronous calls are wrapped in promises
 * that resolve immediately — no concurrency is gained, and none is wanted here.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { schemaStatements } from "./schema";
import {
  normaliseAll,
  toPositional,
  type BindParams,
  type BoundStatement,
  type PreparedStatement,
  type SqlDatabase,
  type SqlRow,
} from "./driver";

class SqliteStatement implements PreparedStatement {
  constructor(
    private readonly db: Database.Database,
    private readonly sql: string,
  ) {}

  bind(params?: BindParams): BoundStatement {
    const { sql, values } = toPositional(this.sql, params);
    return { sql, values };
  }

  private statement(params?: BindParams): { stmt: Database.Statement; values: unknown[] } {
    const { sql, values } = toPositional(this.sql, params);
    return { stmt: this.db.prepare(sql), values: normaliseAll(values) };
  }

  async run(params?: BindParams): Promise<{ changes: number }> {
    const { stmt, values } = this.statement(params);
    const result = stmt.run(...(values as never[]));
    return { changes: result.changes };
  }

  async get<T = SqlRow>(params?: BindParams): Promise<T | undefined> {
    const { stmt, values } = this.statement(params);
    return stmt.get(...(values as never[])) as T | undefined;
  }

  async all<T = SqlRow>(params?: BindParams): Promise<T[]> {
    const { stmt, values } = this.statement(params);
    return stmt.all(...(values as never[])) as T[];
  }

  async pluck<T = unknown>(params?: BindParams): Promise<T | undefined> {
    const { stmt, values } = this.statement(params);
    return stmt.pluck().get(...(values as never[])) as T | undefined;
  }
}

export class SqliteDatabase implements SqlDatabase {
  constructor(private readonly db: Database.Database) {}

  prepare(sql: string): PreparedStatement {
    return new SqliteStatement(this.db, sql);
  }

  async batch(statements: BoundStatement[]): Promise<{ changes: number }[]> {
    const run = this.db.transaction((items: BoundStatement[]) =>
      items.map((item) => ({
        changes: this.db.prepare(item.sql).run(...(normaliseAll(item.values) as never[])).changes,
      })),
    );
    return run(statements);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }
}

let cached: SqliteDatabase | null = null;

export function sqliteDatabase(): SqliteDatabase {
  if (cached) return cached;

  const file =
    process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "marketing360.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const statement of schemaStatements()) db.exec(statement);

  cached = new SqliteDatabase(db);
  return cached;
}
