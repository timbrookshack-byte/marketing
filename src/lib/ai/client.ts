import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta";

/**
 * The one place the Claude client is configured.
 *
 * Model choice: Claude Opus 5 with adaptive thinking. The analysis work here —
 * weighing channels against each other under uncertain attribution — is exactly
 * the kind of reasoning that benefits from it.
 */
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

let client: Anthropic | null = null;

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN);
}

export function getClient(): Anthropic {
  if (!client) {
    // The SDK resolves credentials from the environment (API key, auth token or
    // a logged-in profile), so no key is passed in here.
    client = new Anthropic();
  }
  return client;
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export function assertAiConfigured(): void {
  if (!isAiConfigured()) {
    throw new AiUnavailableError(
      "Claude is not configured. Set ANTHROPIC_API_KEY to enable AI analysis — " +
        "every rules-based finding and the budget optimiser work without it.",
    );
  }
}

/**
 * Safety classifiers can decline a request with HTTP 200 and
 * `stop_reason: "refusal"`, so `content` must never be read before this check.
 * (Server-side fallback routing is not exposed by the installed SDK version, so
 * a refusal surfaces as a clear error rather than being silently rerouted.)
 */
export function assertNotRefused(message: BetaMessage): void {
  if (message.stop_reason === "refusal") {
    const detail =
      message.stop_details && "explanation" in message.stop_details
        ? String(message.stop_details.explanation ?? "")
        : "";
    throw new Error(`Claude declined this request${detail ? `: ${detail}` : "."}`);
  }
}

export function textOf(message: BetaMessage): string {
  return message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
