/**
 * Applies pending migrations to the remote D1 database.
 *
 * The schema file is every table written as CREATE TABLE IF NOT EXISTS, so it
 * can be applied again at any time and does nothing where the table already
 * exists. That is exactly why it cannot carry a column added to a table that
 * already exists: the CREATE is skipped and the new column never appears.
 *
 * Locally the driver runs the migrations at startup. Nothing did so for D1,
 * which meant a column added to the schema reached development and not
 * production, and the failure waited until something tried to write to it.
 *
 * SQLite has no ADD COLUMN IF NOT EXISTS, so each statement is expected to
 * fail once it has been applied. They are sent one at a time, and only the
 * duplicate-column error is tolerated -- anything else stops the run, because
 * a migration failing for a different reason is a migration that has not been
 * applied.
 *
 *   npm run cf:migrate              apply to the remote database
 *   npm run cf:migrate -- --local   apply to the local wrangler simulator
 */
import { spawnSync } from "node:child_process";

import { migrationStatements } from "../src/lib/sql/schema";

const DATABASE = "marketing360";
const local = process.argv.includes("--local");
const target = local ? "--local" : "--remote";

const statements = migrationStatements();
console.log(`${statements.length} migrations to check against ${DATABASE} (${target})\n`);

let applied = 0;
let already = 0;

for (const statement of statements) {
  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", DATABASE, target, "--yes", "--command", statement],
    { encoding: "utf8", shell: process.platform === "win32" },
  );

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const label = statement.replace(/\s+/g, " ").slice(0, 70);

  if (result.status === 0) {
    console.log(`applied   ${label}`);
    applied += 1;
    continue;
  }

  if (/duplicate column name/i.test(output)) {
    console.log(`already   ${label}`);
    already += 1;
    continue;
  }

  console.error(`FAILED    ${label}`);
  console.error(output.trim().split("\n").slice(-12).join("\n"));
  process.exit(1);
}

console.log(`\n${applied} applied, ${already} already present.`);
