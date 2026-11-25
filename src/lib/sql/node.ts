/**
 * Installs the local SQLite driver.
 *
 * Imported only by things that run on Node — the development server, the doctor
 * scripts, the one-off tools. Keeping it in its own module is what stops the
 * native driver being pulled into the Workers bundle, where it cannot run.
 */

import { setDatabase } from "./index";
import { sqliteDatabase } from "./sqlite";

export function installSqlite(): void {
  setDatabase(sqliteDatabase());
}
