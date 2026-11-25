/**
 * Prints the schema as one SQL file for D1.
 *
 * `wrangler d1 execute` takes a file, and the schema lives in TypeScript so
 * both drivers apply exactly the same DDL. Rather than keep a second copy in
 * .sql that would drift from it, this writes the file from the one source:
 *
 *   npm run --silent cf:schema > schema.sql
 *   npx wrangler d1 execute marketing360 --remote --file=schema.sql
 */
import { schemaStatements } from "../src/lib/sql/schema";

console.log(schemaStatements().join("\n\n"));
