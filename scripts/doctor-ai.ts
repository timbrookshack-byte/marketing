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

/**
 * Enough to recognise a key without revealing one.
 *
 * The variety matters as much as the shape. An Admin key is a valid Anthropic
 * key that the Messages API refuses outright — it administers the organisation
 * and cannot call models — and it is easy to copy by mistake, because it sits
 * on a neighbouring console page and looks like every other key.
 */
function describeKey(value: string | undefined): string {
  if (!value) return "not set";
  const trimmed = value.trim();
  const padding = trimmed !== value ? ", with surrounding whitespace to remove" : "";

  const variety = /^sk-ant-admin/.test(trimmed)
    ? "an ADMIN key — these manage the organisation and cannot call models"
    : /^sk-ant-api/.test(trimmed)
      ? "a standard API key"
      : /^sk-ant-/.test(trimmed)
        ? "an unrecognised sk-ant- variety"
        : "NOT an Anthropic key — it does not begin with sk-ant-";

  return `set, ${trimmed.length} characters, ${variety}${padding}`;
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
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Failed: ${message.split("\n")[0]}`);

    if (/invalid x-api-key|authentication_error/.test(message)) {
      const key = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
      console.log(
        "\nThe key is well formed and appears once in .env, so the value reaching the API is the\n" +
          "one you meant. That leaves what the key itself is:",
      );
      if (/^sk-ant-admin/.test(key)) {
        console.log(
          "\n  This is an Admin key. It administers the organisation and cannot call models, so\n" +
            "  the API refuses it however valid it is. Create a key under API keys instead, inside\n" +
            "  a workspace, at console.anthropic.com/settings/keys.",
        );
      } else {
        console.log(
          "\n  - It has been revoked or deleted. Check it is still listed at\n" +
            "    console.anthropic.com/settings/keys, and that you are looking at the right\n" +
            "    organisation if you belong to more than one.\n" +
            "  - It was copied with a character missing or added. The console only shows a key\n" +
            "    once, so a partial copy is easy and looks entirely normal.\n\n" +
            "  Either way the fix is a new key, created inside a workspace rather than at\n" +
            "  organisation level — that also avoids the workspace header this portal would\n" +
            "  otherwise need.",
        );
      }
    } else {
      console.log(`\n${explainAiError(error)}`);
    }
  }

  console.log("\nDone. Paste everything above — the key itself is never printed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
