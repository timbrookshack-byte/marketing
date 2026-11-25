import { installSqlite } from "../src/lib/sql/node";

// Opening the database applies the schema as a side effect.
installSqlite();
console.log("Schema is up to date.");
