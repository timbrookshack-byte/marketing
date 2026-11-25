/**
 * Which database the repository talks to.
 *
 * Installed rather than detected. Workers reaches D1 through a binding that
 * only exists inside a request, and Node reaches SQLite through a native module
 * Workers cannot even parse — so neither can be resolved at import time, and a
 * module that tried would break the deployment that does not use it.
 *
 * Nothing else in the codebase knows which of the two it has.
 */

import type { SqlDatabase } from "./driver";

let installed: SqlDatabase | null = null;

export function setDatabase(db: SqlDatabase): void {
  installed = db;
}

export function hasDatabase(): boolean {
  return installed !== null;
}

export function getDatabase(): SqlDatabase {
  if (!installed) {
    throw new Error(
      "No database has been installed. A Node process installs the local SQLite file by " +
        "importing lib/sql/node and calling installSqlite(); the Workers entry point installs " +
        "the request's D1 binding. One of the two has to run before anything reads data.",
    );
  }
  return installed;
}

export type { SqlDatabase, PreparedStatement, BoundStatement, SqlRow } from "./driver";
