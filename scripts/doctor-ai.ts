/**
 * Anthropic connection doctor.
 *
 * The AI layer fails with a bare status from the API, and the three causes look
 * alike from the outside: a key that is wrong, a key that is right but belongs
 * to no workspace, and an account with no credit. This separates them, and
 * checks what .env actually holds first — a key duplicated in that file is read
 * differently by different tools, and this project has already had one.
 *
 * Run it with `npm run doctor:ai`. The key itself is never printed.
 */

import Anthropic from "@anthropic-ai/sdk";

import { heading, loadEnvFile } from "./doctor-common";
import { MODEL, explainAiError } from "../src/lib/ai/client";

const env = loadEnvFile();

/** Enough to recognise a key without revealing one. */
function describeKey(value: string | undefined): string {
  if (!value) return "not set";
  const trimmed = value.trim();
  if (trimmed !== value) return `set, but with surrounding whitespace (${trimmed.length} characters)`;
  const shape = /^sk-ant-/.test(trimmed) ? "starts with sk-ant-" : "does NOT start with sk-ant-";
  return `set, ${trimmed.length} characters, ${shape}`;
}

async function main(): Promise<void> {
  heading("Configuration");

  console.log(`.env file          ${env.found ? "found" : "NOT FOUND in this directory"}`);
  console.log(`ANTHROPIC_API_KEY  ${describeKey(process.env.ANTHROPIC_API_KEY)}`);
  console.log(`workspace id       ${process.env.ANTHROPIC_WORKSPACE_ID?.trim() || "not set"}`);
  console.log(`model              ${MODEL}`);

  const anthropicKeys = env.keys.filter((name) => name.startsWith("ANTHROPIC_"));
  const repeated = anthropicKeys.filter((name, index) => anthropicKeys.indexOf(name) !== index);
  if (repeated.length > 0) {
    console.log(
      `\nRepeated in .env: ${[...new Set(repeated)].join(", ")}. The last line wins, so an ` +
        "earlier real key is overridden by a later blank or placeholder one — delete the spares.",
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      "\nNo key to test. Add ANTHROPIC_API_KEY to .env from console.anthropic.com/settings/keys.\n" +
        "Every number, every diagnostic and the budget optimiser work without it; only the\n" +
        "written analysis and the Ask page need it.",
    );
    return;
  }

  heading("Calling the API");

  // Listing models is the cheapest call that proves the key works: it is
  // authenticated, costs no tokens, and needs no workspace.
  try {
    const client = new Anthropic(
      process.env.ANTHROPIC_WORKSPACE_ID?.trim()
        ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID.trim() } }
        : {},
    );
    const models = await client.models.list({ limit: 5 });
    console.log("Authenticated. Models this key can see:");
    for (const model of models.data) console.log(`  ${model.id}`);

    const configured = models.data.some((model) => model.id === MODEL);
    console.log(
      configured
        ? `\n${MODEL} is available. The AI features should work.`
        : `\n${MODEL} was not in the first few models listed, which is not itself a problem — ` +
            "the list is paginated.",
    );
  } catch (error) {
    console.log(`Failed: ${explainAiError(error)}`);
  }

  console.log("\nDone. Paste everything above — the key itself is never printed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
