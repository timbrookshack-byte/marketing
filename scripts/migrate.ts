import { getDb } from "../src/lib/db";

// Creating the connection runs the migration as a side effect.
getDb();
console.log("Schema is up to date.");
