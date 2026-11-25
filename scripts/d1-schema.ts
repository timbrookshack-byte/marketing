/**
 * Writes the schema as one SQL file for D1.
 *
 * `wrangler d1 execute` takes a file, and the schema lives in TypeScript so
 * both drivers apply exactly the same DDL. Rather than keep a second copy in
 * .sql that would drift from it, this writes the file from the one source:
 *
 *   npm run cf:schema
 *   npx wrangler d1 execute marketing360 --remote --file=schema.sql
 *
 * The file is written here rather than piped to a shell redirect on purpose.
 * PowerShell 5.1, still the default on Windows, writes `>` output as UTF-16
 * with a byte-order mark, which wrangler cannot parse as SQL. Writing it from
 * Node gives the same UTF-8 bytes on every platform.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { schemaStatements } from "../src/lib/sql/schema";

const target = resolve(process.argv[2] ?? "schema.sql");
const statements = schemaStatements();

writeFileSync(target, `${statements.join("\n\n")}\n`, "utf8");

console.log(`Wrote ${statements.length} statements to ${target}`);
