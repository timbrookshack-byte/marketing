/**
 * One-time cleanup for installs that were seeded with demo data before it was
 * removed from the project.
 *
 * Demo rows and real rows in the same database make every number meaningless —
 * spend that was never spent, orders that were never placed — so this deletes
 * them outright. Connections cascade to their campaigns, metrics and orders, so
 * removing the connection removes everything that hung off it.
 *
 * Safe to run more than once, and a no-op on a database that never held any.
 */
import { getDb } from "../src/lib/db";

const db = getDb();

const demoConnections = db
  .prepare(
    `SELECT id, display_name FROM connections
     WHERE status = 'demo'
        OR external_account_id LIKE 'demo-%'
        OR json_extract(config, '$.demo') = 1`,
  )
  .all() as { id: string; display_name: string }[];

const demoCompetitors = db
  .prepare("SELECT id, name FROM competitors WHERE notes LIKE 'Demo competitor%'")
  .all() as { id: string; name: string }[];

const demoCreatives = db
  .prepare("SELECT COUNT(*) AS count FROM external_creatives WHERE external_id LIKE 'demo-%'")
  .get() as { count: number };

if (demoConnections.length === 0 && demoCompetitors.length === 0 && demoCreatives.count === 0) {
  console.log("No demo data found — nothing to remove.");
  process.exit(0);
}

const purge = db.transaction(() => {
  for (const connection of demoConnections) {
    db.prepare("DELETE FROM connections WHERE id = ?").run(connection.id);
  }
  for (const competitor of demoCompetitors) {
    db.prepare("DELETE FROM competitors WHERE id = ?").run(competitor.id);
  }
  db.prepare("DELETE FROM external_creatives WHERE external_id LIKE 'demo-%'").run();
  // Findings and briefs were computed from the data just deleted.
  db.prepare("DELETE FROM recommendations").run();
  db.prepare("DELETE FROM angle_reports").run();
});

purge();

for (const connection of demoConnections) {
  console.log(`Removed demo connection: ${connection.display_name}`);
}
for (const competitor of demoCompetitors) {
  console.log(`Removed demo competitor: ${competitor.name}`);
}

const remaining = db.prepare("SELECT COUNT(*) AS count FROM metrics_daily").get() as { count: number };
const orders = db.prepare("SELECT COUNT(*) AS count FROM sales_orders").get() as { count: number };
console.log(
  `\nDone. ${remaining.count.toLocaleString()} metric rows and ${orders.count.toLocaleString()} orders remain — all from real connections.`,
);
