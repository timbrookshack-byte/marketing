/**
 * The Cloudflare driver: D1 behind the same interface.
 *
 * D1's own types live in @cloudflare/workers-types, which is a build-time
 * dependency of the Workers entry point rather than of this module. The shape
 * is declared structurally instead, so the repository and every test can be
 * typechecked without the Workers toolchain installed.
 */

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

/** The part of D1's surface this driver uses. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results?: T[] }>;
    };
  };
  batch(statements: unknown[]): Promise<unknown[]>;
  exec(sql: string): Promise<unknown>;
}

class D1Statement implements PreparedStatement {
  constructor(
    private readonly db: D1Like,
    private readonly sql: string,
  ) {}

  bind(params?: BindParams): BoundStatement {
    const { sql, values } = toPositional(this.sql, params);
    return { sql, values: normaliseAll(values) };
  }

  private prepared(params?: BindParams) {
    const { sql, values } = this.bind(params);
    return this.db.prepare(sql).bind(...values);
  }

  async run(params?: BindParams): Promise<{ changes: number }> {
    const result = await this.prepared(params).run();
    return { changes: result.meta?.changes ?? 0 };
  }

  async get<T = SqlRow>(params?: BindParams): Promise<T | undefined> {
    return (await this.prepared(params).first<T>()) ?? undefined;
  }

  async all<T = SqlRow>(params?: BindParams): Promise<T[]> {
    const result = await this.prepared(params).all<T>();
    return result.results ?? [];
  }

  async pluck<T = unknown>(params?: BindParams): Promise<T | undefined> {
    const row = await this.prepared(params).first<SqlRow>();
    if (!row) return undefined;
    const [first] = Object.values(row);
    return first as T;
  }
}

export class D1Database implements SqlDatabase {
  constructor(private readonly db: D1Like) {}

  prepare(sql: string): PreparedStatement {
    return new D1Statement(this.db, sql);
  }

  async batch(statements: BoundStatement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.db.batch(
      statements.map((statement) =>
        this.db.prepare(statement.sql).bind(...normaliseAll(statement.values)),
      ),
    );
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }
}

/**
 * Applies the schema to a D1 database.
 *
 * One statement at a time: D1's exec takes a single statement, and running them
 * individually means a failure names the table it was creating rather than the
 * whole file.
 */
export async function migrateD1(db: D1Like): Promise<void> {
  for (const statement of schemaStatements()) {
    try {
      await db.exec(statement.replace(/\s+/g, " "));
    } catch (error) {
      const name = /CREATE (?:TABLE|INDEX)(?: IF NOT EXISTS)? (\w+)/i.exec(statement)?.[1];
      throw new Error(
        `Applying the schema failed at ${name ?? "an unnamed statement"}: ${(error as Error).message}`,
      );
    }
  }
}
