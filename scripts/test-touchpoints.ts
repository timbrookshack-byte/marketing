/**
 * The journey, from Shopify's shape to stored rows.
 *
 * The case that matters is the one last-click attribution gets wrong: an ad
 * introduces someone, they come back by another route days later, and they
 * buy. The credited visit and the first touch are different visits, and until
 * now only the credited one survived.
 *
 * Run with `npm run test:touchpoints`.
 */
import { installSqlite } from "../src/lib/sql/node";
import { getDatabase } from "../src/lib/sql";
import { chooseAttributingVisit, journeyTouchpoints } from "../src/lib/connectors/sales";
import { upsertOrders } from "../src/lib/repo";
import { nowISO, stableId } from "../src/lib/util";
import type { SalesOrder } from "../src/lib/types";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
  if (detail) console.log(`        ${detail}`);
}

// Meta introduces them, they browse, they come back via Google brand search,
// then arrive directly and buy. Last click says "direct".
const journey = {
  firstVisit: {
    landingPage: "https://shop.example/outdoor?utm_source=facebook&utm_medium=paid&utm_campaign=Toowoomba%20Hype&fbclid=abc123",
    occurredAt: "2026-11-01T09:00:00Z",
    utmParameters: { source: "facebook", medium: "paid", campaign: "Toowoomba Hype" },
  },
  moments: {
    edges: [
      { node: {
        landingPage: "https://shop.example/outdoor?utm_source=facebook&utm_medium=paid&utm_campaign=Toowoomba%20Hype&fbclid=abc123",
        occurredAt: "2026-11-01T09:00:00Z",
        utmParameters: { source: "facebook", medium: "paid", campaign: "Toowoomba Hype" },
      } },
      { node: {
        landingPage: "https://shop.example/lounge?utm_source=google&utm_medium=cpc&utm_campaign=New%20branding%20search&gclid=xyz789",
        occurredAt: "2026-11-14T18:30:00Z",
        utmParameters: { source: "google", medium: "cpc", campaign: "New branding search" },
      } },
      { node: { landingPage: "https://shop.example/", occurredAt: "2026-11-20T07:15:00Z" } },
    ],
  },
  lastVisit: { landingPage: "https://shop.example/", occurredAt: "2026-11-20T07:15:00Z" },
};

async function main(): Promise<void> {
  installSqlite();
  const db = getDatabase();

  console.log("\nExtracting the journey\n");

  const points = journeyTouchpoints(journey, "https://shop.example/");
  check("duplicate visits are collapsed", points.length === 3, `${points.length} touchpoints from 5 entries`);
  check("position 1 is the first touch", points[0]?.campaign === "Toowoomba Hype", points[0]?.campaign ?? "(none)");
  check("the last position is the closing visit", points[points.length - 1]?.source === null, `source=${points[2]?.source}`);
  check("ordered oldest first", points.map((p) => p.occurredAt).join(" < ") ===
    "2026-11-01T09:00:00Z < 2026-11-14T18:30:00Z < 2026-11-20T07:15:00Z",
    points.map((p) => p.occurredAt).join(" < "));
  check("a click id is kept on the touch that carried it", points[0]?.clickId === "abc123", String(points[0]?.clickId));

  console.log("\nFirst touch and credited touch genuinely differ\n");

  const credited = chooseAttributingVisit(journey, undefined);
  check(
    "last-click credits the later Google visit, not the Meta one that introduced them",
    credited.utmParameters?.campaign === "New branding search",
    `credited: ${credited.utmParameters?.campaign}`,
  );
  check(
    "so the first touch is invisible without the journey stored",
    points[0]?.campaign !== credited.utmParameters?.campaign,
    `first=${points[0]?.campaign}  credited=${credited.utmParameters?.campaign}`,
  );

  console.log("\nNo journey at all\n");

  const bare = journeyTouchpoints(undefined, "https://shop.example/sale?utm_source=newsletter");
  check("falls back to the order's own landing page", bare.length === 1 && bare[0].source === "newsletter", JSON.stringify(bare[0]?.source));
  check("and nothing at all yields nothing", journeyTouchpoints(undefined, undefined).length === 0);

  console.log("\nStoring and re-syncing\n");

  await db.prepare("INSERT INTO connections (id, platform, kind, display_name, status, created_at) VALUES (?,?,?,?,?,?)")
    .run(["conn_s", "shopify", "sales", "Shopify", "connected", nowISO()]);

  const order: Omit<SalesOrder, "id"> = {
    connectionId: "conn_s", platform: "shopify", externalId: "gid://1001",
    orderedAt: "2026-11-20T07:20:00Z", revenue: 2400, cogs: null, currency: "AUD",
    customerRef: "cust_1", isNewCustomer: true, landingPage: "https://shop.example/",
    utmSource: "google", utmMedium: "cpc", utmCampaign: "New branding search",
    utmContent: null, utmTerm: null, clickId: "xyz789", clickIdType: "gclid",
    touchpoints: points,
  };

  await upsertOrders([order]);
  const orderId = stableId("ord", "conn_s", "gid://1001");
  const stored = (await db.prepare("SELECT count(*) AS n FROM order_touchpoints WHERE order_id = ?").get([orderId])) as { n: number };
  check("the journey is stored", stored.n === 3, `${stored.n} rows`);

  const first = (await db.prepare("SELECT campaign FROM order_touchpoints WHERE order_id = ? ORDER BY position LIMIT 1").get([orderId])) as { campaign: string };
  check("first touch readable straight from the table", first.campaign === "Toowoomba Hype", first.campaign);

  // Re-sync the same order: the journey must be replaced, not duplicated.
  await upsertOrders([order]);
  const again = (await db.prepare("SELECT count(*) AS n FROM order_touchpoints WHERE order_id = ?").get([orderId])) as { n: number };
  check("a re-sync replaces rather than appends", again.n === 3, `${again.n} rows after two syncs`);

  // A connector with no journeys must not wipe one already stored.
  await upsertOrders([{ ...order, touchpoints: undefined }]);
  const survived = (await db.prepare("SELECT count(*) AS n FROM order_touchpoints WHERE order_id = ?").get([orderId])) as { n: number };
  check("a journey-less sync leaves an existing journey alone", survived.n === 3, `${survived.n} rows`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();
