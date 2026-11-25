/**
 * Checks the MCP server against the protocol, not just the happy path.
 *
 * The wire format is hand-written here, so the cases that matter are the ones
 * a strict client would exercise and a lenient one would hide: notifications
 * getting no reply, batches, unknown methods, and a failing tool arriving as a
 * result rather than a transport error.
 *
 * Run with `npm run test:mcp`.
 */
import { installSqlite } from "../src/lib/sql/node";
import { getDatabase } from "../src/lib/sql";
import { handleBody, handleMessage, PROTOCOL_VERSION } from "../src/lib/mcp/server";
import { TOOLS } from "../src/lib/mcp/tools";
import { listProposals } from "../src/lib/control/proposals";
import { nowISO } from "../src/lib/util";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`);
  }
  if (detail) console.log(`        ${detail}`);
}

const ACTOR = "mcp:test";

async function seed(): Promise<void> {
  const db = getDatabase();
  await db
    .prepare("INSERT INTO connections (id, platform, kind, display_name, status, created_at) VALUES (?,?,?,?,?,?)")
    .run(["conn1", "meta_ads", "ads", "Meta Ads", "connected", nowISO()]);
  await db
    .prepare(
      "INSERT INTO campaigns (id, connection_id, platform, external_id, name, status, daily_budget) VALUES (?,?,?,?,?,?,?)",
    )
    .run(["cmp_a", "conn1", "meta_ads", "1", "Toowoomba Sofas", "active", 100]);
}

async function main(): Promise<void> {
  installSqlite();
  await seed();

  console.log("\nHandshake\n");

  const init = await handleMessage(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION } },
    ACTOR,
  );
  const initResult = init?.result as Record<string, unknown> | undefined;
  check("initialize answers", init?.id === 1 && initResult !== undefined);
  check("it declares a protocol version", initResult?.protocolVersion === PROTOCOL_VERSION);
  check(
    "it declares the tools capability",
    Boolean((initResult?.capabilities as Record<string, unknown>)?.tools),
  );
  check(
    "it tells the model it cannot approve",
    String(initResult?.instructions ?? "").includes("no tool that approves"),
  );

  const note = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ACTOR);
  check("a notification gets no response at all", note === null);

  console.log("\nTool listing\n");

  const list = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ACTOR);
  const tools = (list?.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
  check("every tool is listed", tools.length === TOOLS.length, `${tools.length} tools`);
  check(
    "each has a schema",
    tools.every((t) => typeof t.inputSchema === "object" && t.inputSchema !== null),
  );
  check(
    "no tool can approve or apply",
    !tools.some((t) => /approve|apply|execute/i.test(t.name)),
    tools.map((t) => t.name).join(", "),
  );

  console.log("\nCalling tools\n");

  const limits = await handleMessage(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_change_limits", arguments: {} } },
    ACTOR,
  );
  const limitsResult = limits?.result as { content: { text: string }[]; isError: boolean };
  check("a read tool returns content", limitsResult.content.length === 1 && !limitsResult.isError);
  const caps = JSON.parse(limitsResult.content[0].text) as Record<string, unknown>;
  check("the limits come back as data", typeof caps.maxDailyBudget === "number", `cap ${caps.maxDailyBudget}`);

  const unknown = await handleMessage(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
    ACTOR,
  );
  check("an unknown tool is a protocol error", unknown?.error?.code === -32601, unknown?.error?.message);

  console.log("\nProposing\n");

  const proposed = await handleMessage(
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "propose_change",
        arguments: {
          campaignId: "cmp_a",
          action: "set_budget",
          dailyBudget: 120,
          rationale: "ROAS 4.2 over 14 days",
        },
      },
    },
    ACTOR,
  );
  const proposedBody = JSON.parse(
    (proposed?.result as { content: { text: string }[] }).content[0].text,
  ) as Record<string, unknown>;
  check("a change within the limits is accepted", proposedBody.accepted === true, JSON.stringify(proposedBody.awaiting));
  check("it comes back pending, not applied", proposedBody.status === "pending");

  const stored = await listProposals("pending");
  check("it is actually stored", stored.length === 1);
  check(
    "the actor is recorded from the transport, not the arguments",
    stored[0]?.createdBy === ACTOR,
    stored[0]?.createdBy,
  );

  const overCap = await handleMessage(
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "propose_change",
        arguments: {
          campaignId: "cmp_a",
          action: "set_budget",
          dailyBudget: 9000,
          rationale: "testing the cap",
        },
      },
    },
    ACTOR,
  );
  const refused = JSON.parse(
    (overCap?.result as { content: { text: string }[] }).content[0].text,
  ) as Record<string, unknown>;
  check("a change over the limits is refused", refused.accepted === false, String(refused.reason).slice(0, 80));
  check("the refusal names the limits", Array.isArray(refused.findings));

  const noRationale = await handleMessage(
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "propose_change", arguments: { campaignId: "cmp_a", action: "pause" } },
    },
    ACTOR,
  );
  const needsWhy = JSON.parse(
    (noRationale?.result as { content: { text: string }[] }).content[0].text,
  ) as Record<string, unknown>;
  check("a proposal without a rationale is refused", needsWhy.accepted === false, String(needsWhy.reason));

  console.log("\nFailures stay inside the result\n");

  const badArgs = await handleMessage(
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "list_proposals", arguments: { limit: "not a number" } },
    },
    ACTOR,
  );
  check(
    "a bad argument does not become a transport error",
    badArgs?.error === undefined && badArgs?.result !== undefined,
  );

  console.log("\nBatches and malformed input\n");

  const batch = await handleBody(
    [
      { jsonrpc: "2.0", id: 9, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/cancelled" },
      { jsonrpc: "2.0", id: 10, method: "tools/list" },
    ],
    ACTOR,
  );
  check(
    "a batch answers only the requests, not the notification",
    Array.isArray(batch) && batch.length === 2,
    Array.isArray(batch) ? `${batch.length} responses` : typeof batch,
  );

  const onlyNotes = await handleBody([{ jsonrpc: "2.0", method: "notifications/initialized" }], ACTOR);
  check("a batch of only notifications returns nothing", onlyNotes === null);

  const emptyBatch = await handleBody([], ACTOR);
  check("an empty batch is an error", (emptyBatch as { error?: unknown })?.error !== undefined);

  const notRpc = await handleMessage({ id: 11, method: "tools/list" } as never, ACTOR);
  check("a message without jsonrpc 2.0 is rejected", notRpc?.error?.code === -32600);

  const junk = await handleBody("hello", ACTOR);
  check("a non-object body is rejected", (junk as { error?: unknown })?.error !== undefined);

  const unknownMethod = await handleMessage({ jsonrpc: "2.0", id: 12, method: "wat" }, ACTOR);
  check("an unknown method is rejected", unknownMethod?.error?.code === -32601);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();
