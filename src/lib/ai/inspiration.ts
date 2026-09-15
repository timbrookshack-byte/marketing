import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODEL, assertAiConfigured, assertNotRefused, getClient } from "./client";
import { buildInspirationSnapshot } from "../inspiration";
import { buildSnapshot } from "../analytics";
import { platformLabel } from "../connectors/registry";

/**
 * Turning a pile of competitor ads into something to do.
 *
 * A grid of rival creatives is not insight — it is homework. The useful question
 * is not "what are they running" but "what angle are they all running that we
 * are not, and is it working for them". That is a clustering and gap problem,
 * which is what this does:
 *
 *   1. cluster competitor creatives into angles (the promise being made)
 *   2. cluster our own live ads the same way
 *   3. subtract
 *
 * The model is given traction evidence (days live, variant counts) alongside
 * each creative, and told explicitly what that evidence can and cannot support.
 * It is not given, and must not invent, competitor performance figures.
 */

const AngleSchema = z.object({
  name: z.string().describe("Short name for the angle, e.g. 'cost of replacing it twice'."),
  promise: z.string().describe("The actual promise being made to the reader, in one sentence."),
  advertisers: z.array(z.string()).describe("Which brands in the data run this angle."),
  evidenceStrength: z
    .enum(["proven", "promising", "early", "weak"])
    .describe(
      "proven: multiple long-running ads across brands. weak: seen once, recently, by one brand.",
    ),
  evidenceNote: z
    .string()
    .describe("Cite the actual longevity and variant counts this rests on. No invented metrics."),
  weRunIt: z.boolean().describe("True if our own ads already make this promise."),
});

const GapSchema = z.object({
  angle: z.string().describe("The angle name, matching one above."),
  whyItMatters: z
    .string()
    .describe("Why this gap is worth closing for us specifically, given our economics and channels."),
  risk: z
    .string()
    .describe(
      "The honest reason it might not transfer — their margin, their brand equity, their audience.",
    ),
  priority: z.enum(["high", "medium", "low"]),
});

const ConceptSchema = z.object({
  angle: z.string(),
  channel: z.string().describe("Platform id such as meta_ads where this should be tested first."),
  headline: z.string(),
  body: z.string(),
  callToAction: z.string(),
  whyThisChannel: z.string().describe("One sentence tying the channel choice to our own data."),
  inspiredBy: z
    .string()
    .describe("Which competitor creative prompted this, named, so the lineage is checkable."),
  howItDiffers: z
    .string()
    .describe("How this is our version rather than a copy of theirs. Be specific."),
  successMetric: z.string().describe("The number that decides it, and the threshold that counts."),
});

export const AngleReportSchema = z.object({
  summary: z
    .string()
    .describe(
      "Three to five sentences: what the competitive set is collectively betting on, and where we sit relative to it.",
    ),
  angles: z.array(AngleSchema).describe("Every distinct angle found, strongest evidence first."),
  gaps: z
    .array(GapSchema)
    .describe("Angles rivals run with real evidence behind them that we do not run at all."),
  concepts: z
    .array(ConceptSchema)
    .describe("Three to six testable concepts that close the highest-priority gaps."),
  caveats: z
    .array(z.string())
    .describe(
      "What would make this analysis wrong: thin data, one dominant advertiser, brands whose economics differ from ours.",
    ),
});

export type AngleReport = z.infer<typeof AngleReportSchema>;

const SYSTEM = `You are a creative strategist reviewing what competitors are advertising, for an operator who will spend their own money acting on it.

What you are working from, and its limits:
- You can see competitor ad TEXT and how long each ad has been RUNNING. You cannot see their click-through rate, conversion rate, spend or return, and neither can anyone else — those are not public. Never state or imply a competitor performance figure.
- Ad longevity is the evidence you have. It is behavioural: advertisers cut losers within days, so an ad still live after three months has survived a renewed decision to fund it every one of those days. Treat 90+ days live as strong, 30-90 as suggestive, under 30 as nothing yet.
- Longevity is not proof of profit. A brand-awareness ad can run for a year on a budget line that never had a return target, and evergreen creative is sometimes just neglect. Say so where it applies.
- Their economics are not ours. A high-margin brand can sustain a cost per sale that would bankrupt us. An angle working for them is a reason to test, never a reason to assume.

How to work:
- Cluster on the PROMISE being made, not on wording or format. "Free returns", "30-day guarantee" and "send it back, no questions" are one angle.
- An angle only counts as a gap if our own ads genuinely do not make that promise. Check our creative before claiming a gap.
- Rank by what is worth our money, not by what is most novel.
- Concepts must be our version of an idea, not a rewrite of their ad. Say explicitly how each differs.
- Where the data is too thin to support a conclusion, say that instead of producing a confident one.`;

export async function analyseAngles(options?: { market?: string; days?: number }): Promise<AngleReport> {
  assertAiConfigured();
  const client = getClient();

  const inspiration = buildInspirationSnapshot();
  if (inspiration.isEmpty) {
    throw new Error(
      "No competitor creatives stored yet. Add a competitor and refresh a source, or enter an ad by hand.",
    );
  }

  const performance = buildSnapshot(options?.days ?? 30);

  // Competitor side: one entry per concept, with the traction evidence attached
  // so the model reasons from it rather than around it.
  const competitorConcepts = inspiration.concepts.slice(0, 60).map((item) => ({
    advertiser: item.advertiser,
    platform: item.platform,
    headline: item.headline,
    body: item.body?.slice(0, 300) ?? null,
    callToAction: item.callToAction,
    daysLive: item.traction.daysLive,
    stillRunning: item.traction.isLive,
    variantsOfThisConcept: item.traction.variantCount,
    evidenceBand: item.traction.band,
    source: item.source,
  }));

  // Our side: what we currently say, and how it performs. The second half is
  // what lets the model weigh a gap against our own economics.
  const ourCreative = performance.ads
    .filter((ad) => ad.totals.impressions > 0)
    .slice(0, 30)
    .map((ad) => ({
      name: ad.ad.name,
      platform: ad.platform,
      headline: ad.ad.headline,
      body: ad.ad.body?.slice(0, 300) ?? null,
      callToAction: ad.ad.callToAction,
      spend: Math.round(ad.totals.spend),
      ctrPct: Number((ad.derived.ctr * 100).toFixed(2)),
      roas: Number(ad.derived.roas.toFixed(2)),
    }));

  const ourChannels = performance.channels.map((channel) => ({
    platform: channel.platform,
    label: platformLabel(channel.platform),
    spend: Math.round(channel.totals.spend),
    roas: Number(channel.derived.roas.toFixed(2)),
  }));

  const prompt = [
    options?.market ? `Market context from the operator: ${options.market}` : "",
    "",
    "Competitor creatives, deduplicated to one entry per concept, with traction evidence:",
    "```json",
    JSON.stringify(competitorConcepts, null, 2),
    "```",
    "",
    "Our own live creative, with how it actually performs:",
    "```json",
    JSON.stringify(ourCreative, null, 2),
    "```",
    "",
    "Our channels and their returns, so you can judge where a new concept belongs:",
    "```json",
    JSON.stringify(ourChannels, null, 2),
    "```",
    "",
    `Our break-even return is ${(1 / performance.settings.grossMargin).toFixed(2)}x at a ${(performance.settings.grossMargin * 100).toFixed(0)}% gross margin, against a ${performance.settings.targetRoas.toFixed(1)}x target.`,
    "",
    "Cluster both sides into angles, find the gaps that have real evidence behind them, and write concepts that close them.",
    "If one advertiser dominates the competitor data, say so in the caveats — a single brand's habits are not a market signal.",
  ]
    .filter(Boolean)
    .join("\n");

  const message = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
    output_config: { format: betaZodOutputFormat(AngleReportSchema) },
  });

  assertNotRefused(message);
  if (!message.parsed_output) {
    throw new Error("Claude returned an angle report that did not match the expected shape.");
  }
  return message.parsed_output;
}

// ------------------------------------------------------- competitor discovery

const PeerSchema = z.object({
  peers: z
    .array(
      z.object({
        name: z.string().describe("The brand's name as it would appear on its own ad account."),
        domain: z.string().nullable().describe("Primary website domain, or null if unsure."),
        why: z.string().describe("Why this brand competes for the same buyer."),
        overlap: z
          .enum(["direct", "adjacent", "aspirational"])
          .describe(
            "direct: same products, same buyer. adjacent: overlapping buyer, different range. aspirational: where our buyer looks up to.",
          ),
        confidence: z.number().min(0).max(1),
      }),
    )
    .describe("Six to twelve brands, direct competitors first."),
  note: z
    .string()
    .describe("What the operator should verify before trusting this list."),
});

export type PeerSuggestions = z.infer<typeof PeerSchema>;

/**
 * Suggests who to watch.
 *
 * Deliberately a suggestion rather than a fact: the model is reasoning from
 * general knowledge of a category, not from the operator's actual market, and
 * it may name brands that no longer exist or have shifted position. Suggestions
 * are stored with origin 'suggested' and are not fetched until confirmed.
 */
export async function suggestCompetitors(input: {
  description: string;
  category?: string;
  market?: string;
}): Promise<PeerSuggestions> {
  assertAiConfigured();
  const client = getClient();

  const message = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text:
          "You suggest which brands an operator should watch for advertising inspiration. " +
          "Name real, currently-trading brands that advertise actively. Prefer brands of a " +
          "similar size and price position over category giants, whose budgets and brand equity " +
          "make their creative a poor model for a smaller advertiser. " +
          "Your knowledge has a cutoff and brands change — mark anything you are unsure of with " +
          "low confidence and say what needs checking, rather than presenting guesses as facts.",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          `Our business: ${input.description}`,
          input.category ? `Category: ${input.category}` : "",
          input.market ? `Market: ${input.market}` : "",
          "",
          "Who should we be watching?",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    output_config: { format: betaZodOutputFormat(PeerSchema) },
  });

  assertNotRefused(message);
  if (!message.parsed_output) {
    throw new Error("Claude returned suggestions that did not match the expected shape.");
  }
  return message.parsed_output;
}
