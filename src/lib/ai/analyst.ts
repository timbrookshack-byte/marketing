import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODEL, assertAiConfigured, assertNotRefused, getClient, textOf } from "./client";
import { CreativeWorkshopSchema, PortfolioAnalysisSchema } from "./schemas";
import type { CreativeWorkshop, PortfolioAnalysis } from "./schemas";
import { buildSnapshot, summariseForModel, type ModelSummary, type PortfolioSnapshot } from "../analytics";
import { platformLabel } from "../connectors/registry";
import type { PlatformId, Recommendation } from "../types";

/**
 * The AI layer.
 *
 * Division of labour: the rules engine and the optimiser produce the numbers,
 * and the model is given those numbers rather than raw rows. It is asked to do
 * what arithmetic cannot — weigh a tracking gap against a ROAS gap, notice that
 * three campaigns are failing for the same reason, decide what to do first, and
 * write the creative response. It is explicitly told not to recompute the
 * metrics, because a model re-deriving CPA from memory is how a dashboard
 * starts quietly lying.
 */

const ANALYST_SYSTEM = `You are the performance marketing analyst for a 360 Marketing portal. You advise an owner-operator who is spending their own money and wants to know where it is being wasted.

How to work:
- The metrics you are given are already computed from connected ad accounts and real store orders. Use them as given. Never recompute or estimate a metric that has been provided, and never invent one that has not.
- Attributed revenue comes from matched store orders. Platform-reported revenue is each network marking its own homework, and two networks will claim the same sale. When they disagree, trust the store and say the gap exists.
- Distinguish "this is losing money" from "this has not proven itself yet". A campaign with 4 orders is not evidence. Say when a sample is too small to act on instead of ranking it confidently.
- Rank by money, not by tidiness. A 4% improvement on the largest line beats a 40% improvement on a rounding error.
- Never recommend an action whose evidence you cannot point to in the data provided.
- Be direct. The reader wants "stop this, it has cost you $4,200 and returned nothing", not "consider optimising underperforming segments".

The rules engine has already flagged deterministic findings and produced a budget reallocation plan. Your job is judgement on top of that: what matters most, what the findings mean together, what a rule cannot see, and what could make this analysis wrong.`;

function buildPrompt(summary: ModelSummary, extraContext?: string): string {
  return [
    "Here is the current state of the account.",
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    extraContext ? `Additional context from the operator:\n${extraContext}\n` : "",
    "Produce the portfolio analysis. Rank recommendations by expected monthly impact.",
    "Where you agree with a rule finding, say so and add the judgement the rule could not make.",
    "Where you disagree with one, say that explicitly and why.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function analysePortfolio(
  snapshot: PortfolioSnapshot,
  extraContext?: string,
): Promise<PortfolioAnalysis> {
  assertAiConfigured();
  const client = getClient();
  const summary = summariseForModel(snapshot);

  const message = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      // The instructions are stable across every call, so they sit in front of
      // the volatile account data where the cache can hold them.
      { type: "text", text: ANALYST_SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: buildPrompt(summary, extraContext) }],
    output_config: { format: betaZodOutputFormat(PortfolioAnalysisSchema) },
  });

  assertNotRefused(message);
  if (!message.parsed_output) {
    throw new Error("Claude returned an analysis that did not match the expected shape.");
  }
  return message.parsed_output;
}

/** Turns the model's output into rows the recommendations inbox can store. */
export function toRecommendationRows(
  analysis: PortfolioAnalysis,
): Omit<Recommendation, "id" | "createdAt" | "status">[] {
  return analysis.recommendations.map((rec) => ({
    source: "ai" as const,
    scope: rec.scope,
    targetId: rec.targetId,
    targetName: rec.targetName,
    platform: (rec.platform as PlatformId) ?? null,
    type: rec.type,
    severity: rec.severity,
    title: rec.title,
    rationale: rec.rationale,
    expectedMonthlyImpact: rec.expectedMonthlyImpact,
    confidence: rec.confidence,
    evidence: rec.evidence,
  }));
}

// ------------------------------------------------------------ creative workshop

/**
 * Platform copy limits, so variants come back usable rather than needing a
 * round of trimming. These are the practical limits advertisers work to.
 */
const COPY_LIMITS: Record<string, { headline: number; body: number; notes: string }> = {
  google_ads: {
    headline: 30,
    body: 90,
    notes:
      "Responsive search ads: each headline is a separate 30-character asset and each description 90. Write them to stand alone, because the system mixes them.",
  },
  meta_ads: {
    headline: 40,
    body: 125,
    notes: "Primary text is truncated around 125 characters on mobile. The first line carries the ad.",
  },
  openai_ads: {
    headline: 60,
    body: 180,
    notes:
      "Placements sit inside a conversation, so copy that reads as an answer to the user's question outperforms interruption copy.",
  },
  linkedin_ads: {
    headline: 70,
    body: 150,
    notes: "B2B audience. Job-title relevance beats cleverness; name the role or the outcome.",
  },
  tiktok_ads: {
    headline: 40,
    body: 100,
    notes: "The first two seconds decide it. Copy supports the hook rather than carrying it.",
  },
};

export async function workshopCreative(input: {
  platform: PlatformId;
  objective: string;
  audience: string;
  snapshot: PortfolioSnapshot;
  notes?: string;
}): Promise<CreativeWorkshop> {
  assertAiConfigured();
  const client = getClient();

  const limits = COPY_LIMITS[input.platform] ?? {
    headline: 40,
    body: 125,
    notes: "Keep copy short enough to survive mobile truncation.",
  };

  // Give the model what is already running on this channel and how it performs,
  // so the variants are a response to real data rather than generic ad copy.
  const channelAds = input.snapshot.ads
    .filter((item) => item.platform === input.platform)
    .slice(0, 15)
    .map((item) => ({
      name: item.ad.name,
      campaign: item.campaignName,
      headline: item.ad.headline,
      body: item.ad.body,
      cta: item.ad.callToAction,
      spend: Math.round(item.totals.spend),
      ctrPct: Number((item.derived.ctr * 100).toFixed(2)),
      roas: Number(item.derived.roas.toFixed(2)),
    }));

  const channel = input.snapshot.channels.find((c) => c.platform === input.platform);

  const prompt = [
    `Design new ad creative for ${platformLabel(input.platform)}.`,
    "",
    `Objective: ${input.objective}`,
    `Audience: ${input.audience}`,
    input.notes ? `Operator notes: ${input.notes}` : "",
    "",
    `Platform constraints — headline ${limits.headline} characters, body ${limits.body} characters. ${limits.notes}`,
    "",
    "Channel performance right now:",
    "```json",
    JSON.stringify(
      channel
        ? {
            spend: Math.round(channel.totals.spend),
            roas: Number(channel.derived.roas.toFixed(2)),
            ctrPct: Number((channel.derived.ctr * 100).toFixed(2)),
            cpa: Number(channel.derived.cpa.toFixed(2)),
            orders: channel.totals.attributedOrders,
          }
        : { note: "No spend on this channel yet — this is a cold start." },
      null,
      2,
    ),
    "```",
    "",
    "Ads currently running on this channel, with their results:",
    "```json",
    JSON.stringify(channelAds, null, 2),
    "```",
    "",
    "Write variants that test genuinely different angles from each other and from what is already running.",
    "Do not produce five rewordings of the same promise. If the existing ads all lead on price, at most one of yours should.",
    "Respect the character limits exactly — copy that has to be trimmed is copy that was not written to spec.",
  ]
    .filter(Boolean)
    .join("\n");

  const message = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text:
          ANALYST_SYSTEM +
          "\n\nFor creative work: you are writing ads that will run with real money behind them. Every variant must be a testable hypothesis, not a stylistic variation.",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: prompt }],
    output_config: { format: betaZodOutputFormat(CreativeWorkshopSchema) },
  });

  assertNotRefused(message);
  if (!message.parsed_output) {
    throw new Error("Claude returned creative that did not match the expected shape.");
  }
  return message.parsed_output;
}

// ------------------------------------------------------------------ analyst chat

/**
 * Free-form questions over the account.
 *
 * The model gets a compact summary up front and tools to pull detail on demand,
 * so a question about one campaign does not require shipping the whole account
 * into the context window.
 */
export async function askAnalyst(input: {
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  days?: number;
}): Promise<string> {
  assertAiConfigured();
  const client = getClient();

  const snapshot = buildSnapshot(input.days ?? 30);
  const summary = summariseForModel(snapshot, { campaigns: 15, ads: 8 });

  const campaignDetail = betaZodTool({
    name: "get_campaign_detail",
    description:
      "Full metrics and the daily spend/revenue series for one campaign. Use when a question is about a specific campaign.",
    inputSchema: z.object({
      campaignName: z.string().describe("Campaign name or id, matched case-insensitively."),
    }),
    run: ({ campaignName }) => {
      const needle = campaignName.toLowerCase();
      const found = snapshot.campaigns.find(
        (item) =>
          item.campaign.id === campaignName || item.campaign.name.toLowerCase().includes(needle),
      );
      if (!found) {
        return `No campaign matching "${campaignName}". Available: ${snapshot.campaigns
          .slice(0, 25)
          .map((c) => c.campaign.name)
          .join(", ")}`;
      }
      return JSON.stringify(
        {
          campaign: found.campaign,
          totals: found.totals,
          derived: found.derived,
          dailySeries: found.series,
        },
        null,
        2,
      );
    },
  });

  const listCampaignsTool = betaZodTool({
    name: "list_campaigns",
    description:
      "Every campaign with its headline metrics, optionally filtered by platform. Use when ranking or comparing across the account.",
    inputSchema: z.object({
      platform: z.string().optional().describe("Platform id such as meta_ads. Omit for all."),
      sortBy: z.enum(["spend", "roas", "cpa", "orders"]).default("spend"),
    }),
    run: ({ platform, sortBy }) => {
      let rows = snapshot.campaigns;
      if (platform) rows = rows.filter((item) => item.campaign.platform === platform);
      const sorted = [...rows].sort((a, b) => {
        if (sortBy === "roas") return b.derived.roas - a.derived.roas;
        if (sortBy === "cpa") return a.derived.cpa - b.derived.cpa;
        if (sortBy === "orders") return b.totals.attributedOrders - a.totals.attributedOrders;
        return b.totals.spend - a.totals.spend;
      });
      return JSON.stringify(
        sorted.map((item) => ({
          name: item.campaign.name,
          platform: item.campaign.platform,
          status: item.campaign.status,
          spend: Math.round(item.totals.spend),
          revenue: Math.round(item.totals.attributedRevenue),
          orders: item.totals.attributedOrders,
          roas: Number(item.derived.roas.toFixed(2)),
          cpa: Number(item.derived.cpa.toFixed(2)),
        })),
        null,
        2,
      );
    },
  });

  const attributionTool = betaZodTool({
    name: "get_attribution_breakdown",
    description:
      "How store orders were matched back to channels, and how much revenue could not be traced. Use for any question about whether the numbers can be trusted.",
    inputSchema: z.object({}),
    run: () => {
      const byMethod: Record<string, { orders: number; revenue: number }> = {};
      for (const item of snapshot.attribution) {
        const bucket = (byMethod[item.method] ??= { orders: 0, revenue: 0 });
        bucket.orders += 1;
        bucket.revenue += item.order.revenue;
      }
      return JSON.stringify(byMethod, null, 2);
    },
  });

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text:
          ANALYST_SYSTEM +
          "\n\nAnswer the operator's question directly in prose. Lead with the answer, then the evidence. Use the tools when you need detail beyond the summary. Keep it under 300 words unless the question genuinely needs more.",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Account summary:\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``,
      },
      { role: "assistant", content: "Understood — I have the account summary. What would you like to know?" },
      ...(input.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user", content: input.question },
    ],
    tools: [campaignDetail, listCampaignsTool, attributionTool],
  });

  const final = await runner.runUntilDone();
  assertNotRefused(final);
  return textOf(final) || "No answer was returned.";
}
