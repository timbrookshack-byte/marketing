import { generateDemoData } from "../src/lib/demo";
import { getDb } from "../src/lib/db";

const db = getDb();
const existing = db.prepare("SELECT COUNT(*) AS count FROM metrics_daily").get() as { count: number };

if (existing.count > 0 && !process.argv.includes("--force")) {
  console.log(
    `Database already holds ${existing.count.toLocaleString()} metric rows. ` +
      "Re-run with --force to regenerate demo data.",
  );
  process.exit(0);
}

const days = Number(process.env.SEED_DAYS ?? 90);
const result = generateDemoData({ days });

console.log(
  `Seeded ${result.campaigns} campaigns, ${result.metricRows.toLocaleString()} metric rows and ` +
    `${result.orders.toLocaleString()} store orders across ${result.days} days.`,
);
console.log(
  `Seeded ${result.competitors} competitors and ${result.competitorCreatives} competitor creatives.`,
);
