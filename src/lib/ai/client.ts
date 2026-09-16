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
    //
    // A key created at the organisation level rather than inside a workspace
    // belongs to no workspace, and the API refuses to guess one: every request
    // has to name it. ANTHROPIC_WORKSPACE_ID supplies that header so an
    // organisation key works without being reissued.
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    client = new Anthropic(
      workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {},
    );
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
 * Turns the two configuration failures that look like bugs into instructions.
 *
 * Both arrive as a plain 400 from a key that is perfectly valid, so the natural
 * reading is that the request is malformed rather than that the account needs a
 * setting.
 */
export function explainAiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("anthropic-workspace-id")) {
    return (
      "This Anthropic API key belongs to the organisation rather than to a workspace, so every " +
      "request has to name the workspace to use. Either create a key inside a workspace at " +
      "console.anthropic.com/settings/keys and put that in ANTHROPIC_API_KEY, or add " +
      "ANTHROPIC_WORKSPACE_ID to .env with the workspace's id."
    );
  }
  if (message.includes("credit balance") || message.includes("insufficient")) {
    return (
      "The Anthropic account has no credit. Add credit at console.anthropic.com/settings/billing — " +
      "every rules-based finding and the budget optimiser keep working without it."
    );
  }
  return message;
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
