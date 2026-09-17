/**
 * Shopify attribution doctor.
 *
 * Answers one question: for recent orders, what evidence of an ad click does
 * the store actually hold? A server-side tagging setup stamps click ids onto
 * the order; Shopify's own customer journey records the visits. They fail
 * independently, and "attribution is poor" says nothing about which one to fix.
 *
 * Prints, per order, what each source carries. No secret is printed, and order
 * values are not shown — only whether the attribution fields are there.
 */

import { call, heading, loadEnvFile, prepare } from "./doctor-common";
import {
  chooseAttributingVisit,
  parseLandingPage,
  readOrderAttributes,
  shopifyAccessToken,
} from "../src/lib/connectors/sales";
import type { OrderAttribute } from "../src/lib/connectors/sales";

const env = loadEnvFile();

const SAMPLE = 15;

async function main(): Promise<void> {
  const ready = await prepare("shopify", env);
  if (!ready) return;

  const { connection, credentials } = ready;
  const shop = (connection.externalAccountId ?? "").replace(/^https?:\/\//, "");
  const version = (connection.config.apiVersion as string) ?? "2025-01";

  // Shopify issues a short-lived token per call from the stored client
  // credentials, so the doctor mints one the same way a sync does.
  let token: string;
  try {
    token = await shopifyAccessToken(
      {
        connectionId: connection.id,
        externalAccountId: connection.externalAccountId,
        credentials,
        config: connection.config,
        refresh: async () => credentials,
      },
      shop,
    );
    console.log("\nExchanged the stored client credentials for an access token.");
  } catch (error) {
    console.log(`\nCould not obtain an access token: ${(error as Error).message}`);
    return;
  }

  heading(`The last ${SAMPLE} orders`);

  const visitFields =
    "landingPage source sourceType occurredAt utmParameters { source medium campaign content term }";
  const query = `
    query Recent {
      orders(first: ${SAMPLE}, reverse: true, sortKey: CREATED_AT) {
        edges {
          node {
            name
            createdAt
            landingPageUrl
            customAttributes { key value }
            customerJourneySummary {
              lastVisit { ${visitFields} }
              firstVisit { ${visitFields} }
              moments(first: 25) {
                edges { node { ... on CustomerVisit { ${visitFields} } } }
              }
            }
          }
        }
      }
    }`;

  const { status, body } = await call("orders:", `https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (status !== 200) return;

  const parsed = JSON.parse(body) as {
    data?: { orders?: { edges: { node: Record<string, unknown> }[] } };
    errors?: { message: string }[];
  };

  if (parsed.errors?.length) {
    console.log(
      "\nShopify rejected the query, and the message above says why. A complaint about the shape " +
        "of the query is a bug here; a refusal about access or availability means the plan does " +
        "not expose the full customer journey, and orders can then only be attributed to their " +
        "last visit.",
    );
    return;
  }

  const orders = parsed.data?.orders?.edges ?? [];
  if (orders.length === 0) {
    console.log("\nNo orders returned.");
    return;
  }

  heading("What each order carries");

  let stampedCount = 0;
  let journeyCount = 0;
  let neitherCount = 0;
  const attributeKeys = new Set<string>();

  for (const { node } of orders) {
    const attributes = node.customAttributes as OrderAttribute[] | undefined;
    for (const attribute of attributes ?? []) if (attribute.key) attributeKeys.add(attribute.key);

    const stamped = readOrderAttributes(attributes);
    const journey = node.customerJourneySummary as Parameters<typeof chooseAttributingVisit>[0];
    const visit = chooseAttributingVisit(journey, node.landingPageUrl as string | undefined);
    const fromVisit = parseLandingPage(visit.landingPage);
    const visitCampaign = visit.utmParameters?.campaign ?? fromVisit.utmCampaign;

    const onOrder = stamped.clickId ? `${stamped.clickIdType} click id` : stamped.utmCampaign ? "utm only" : "—";
    const inJourney = fromVisit.clickId
      ? `${fromVisit.clickIdType} click id`
      : visitCampaign
        ? "utm only"
        : "—";

    if (stamped.clickId) stampedCount += 1;
    if (fromVisit.clickId) journeyCount += 1;
    if (!stamped.clickId && !fromVisit.clickId && !stamped.utmCampaign && !visitCampaign) neitherCount += 1;

    console.log(
      `${String(node.name).padEnd(10)} ${String(node.createdAt).slice(0, 10)}  ` +
        `on order: ${onOrder.padEnd(18)} in journey: ${inJourney}`,
    );
  }

  heading("Reading");
  console.log(`Order attribute keys seen: ${[...attributeKeys].join(", ") || "(none)"}`);
  console.log(`Click id stamped on the order : ${stampedCount}/${orders.length}`);
  console.log(`Click id found in the journey : ${journeyCount}/${orders.length}`);
  console.log(`No ad evidence at all         : ${neitherCount}/${orders.length}`);
  console.log("");

  if (stampedCount === 0 && attributeKeys.size === 0) {
    console.log(
      "Nothing is being written onto the order. If a server-side tagging setup is in place, it is\n" +
        "not passing the click id through to the cart — that is one setting in the tagging setup,\n" +
        "and it is the single highest-value change available here.",
    );
  } else if (stampedCount === 0) {
    console.log(
      "Orders carry attributes, but none the reader recognises as a click id. The names it looks\n" +
        "for are gclid, wbraid, gbraid, fbclid, _fbc, ttclid, msclkid, li_fat_id, epik, twclid and\n" +
        "rdt_cid, with or without a leading underscore. If yours are named differently, say what\n" +
        "the keys above are and they can be read.",
    );
  } else {
    console.log("Click ids are reaching the order. This is the strongest attribution available.");
  }

  console.log("\nDone. Paste everything above — no secrets and no order values are printed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
