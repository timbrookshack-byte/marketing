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

/**
 * Held on globalThis rather than in a module variable.
 *
 * The bundler splits the server build into chunks and a module imported from
 * several of them can end up instantiated more than once. A module-level
 * variable then exists once per copy: the startup hook installs the driver into
 * one of them and every page reads a different one, which presents as the
 * database never having been installed at all. A single global key is shared by
 * every copy, whatever the bundler does.
 */
const KEY = "__marketing360_database__";

type Resolver = () => SqlDatabase;
type Holder = typeof globalThis & { [KEY]?: Resolver };

/**
 * Installed as a function, not an instance.
 *
 * A SQLite file can be opened once and held for the life of the process. A D1
 * binding cannot: it is reachable only from inside a request, and the one
 * belonging to the request being handled is the only one that may be used.
 * Resolving on each call covers both — the SQLite driver's resolver returns the
 * same cached handle every time, and D1's returns whichever binding is current.
 */
export function setDatabaseResolver(resolve: Resolver): void {
  (globalThis as Holder)[KEY] = resolve;
}

export function setDatabase(db: SqlDatabase): void {
  setDatabaseResolver(() => db);
}

export function hasDatabase(): boolean {
  return (globalThis as Holder)[KEY] !== undefined;
}

export function getDatabase(): SqlDatabase {
  const resolve = (globalThis as Holder)[KEY];
  if (!resolve) {
    throw new Error(
      "No database has been installed. A Node process installs the local SQLite file by " +
        "importing lib/sql/node and calling installSqlite(); the Workers entry point installs " +
        "the request's D1 binding. One of the two has to run before anything reads data.",
    );
  }
  return resolve();
}

export type { SqlDatabase, PreparedStatement, BoundStatement, SqlRow } from "./driver";
