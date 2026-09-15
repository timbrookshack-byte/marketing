import { z } from "zod";

/**
 * Structured output contracts. The model fills these in; the app never parses
 * prose. Descriptions are part of the prompt — they are what the model reads to
 * decide what belongs in each field.
 */

export const RecommendationSchema = z.object({
  scope: z
    .enum(["portfolio", "channel", "campaign", "adgroup", "ad"])
    .describe("The level this action applies to."),
  targetId: z
    .string()
    .describe("The exact id from the data you were given. Use the platform name for channel scope, 'portfolio' for portfolio scope."),
  targetName: z.string().describe("Human-readable name of the campaign, ad or channel."),
  platform: z
    .string()
    .nullable()
    .describe("Platform id such as google_ads, or null for portfolio-wide actions."),
  type: z
    .enum([
      "pause",
      "reduce_budget",
      "scale_budget",
      "reallocate",
      "test_creative",
      "fix_tracking",
      "investigate",
    ])
    .describe("The action to take."),
  severity: z
    .enum(["critical", "serious", "warning", "good"])
    .describe("critical: losing money now. good: an opportunity rather than a problem."),
  title: z.string().describe("One line, specific, naming the campaign or channel. No hedging."),
  rationale: z
    .string()
    .describe(
      "Two to four sentences. Cite the actual numbers. Say what changes if this is done and what the risk is if the attribution is wrong.",
    ),
  expectedMonthlyImpact: z
    .number()
    .describe("Dollars per month gained or saved. Positive is good. Be conservative."),
  confidence: z.number().min(0).max(1).describe("How much the evidence supports acting now."),
  evidence: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .describe("The specific metrics this conclusion rests on, as key-value pairs."),
});

export const PortfolioAnalysisSchema = z.object({
  headline: z
    .string()
    .describe("The single most important thing about this account right now, in one sentence."),
  summary: z
    .string()
    .describe(
      "Three to five sentences a founder could read and act on. Where money is working, where it is leaking, what to do first.",
    ),
  wastedSpendMonthly: z
    .number()
    .describe("Total dollars per month currently going to campaigns that cannot pay for themselves."),
  bestOpportunity: z
    .string()
    .describe("The highest-return place to put the next dollar, named specifically, with the reason."),
  recommendations: z
    .array(RecommendationSchema)
    .describe("Ranked by expected monthly impact, highest first. Between 3 and 12 of them."),
  dataQualityWarnings: z
    .array(z.string())
    .describe(
      "Anything that makes this analysis less trustworthy: unattributed revenue, platforms claiming conversions the store cannot see, windows too short to judge. Empty array if genuinely none.",
    ),
});

export type PortfolioAnalysis = z.infer<typeof PortfolioAnalysisSchema>;

export const CreativeVariantSchema = z.object({
  angle: z.string().describe("The strategic angle in a few words, e.g. 'cost of inaction'."),
  headline: z.string().describe("Within the platform's headline character limit."),
  body: z.string().describe("Within the platform's body character limit."),
  callToAction: z.string().describe("A call to action the platform actually supports."),
  hypothesis: z
    .string()
    .describe("What this variant is testing and why it might beat what is running now."),
  successMetric: z
    .string()
    .describe("The one number that decides whether this won, and the threshold that counts as a win."),
  inspiredBy: z
    .string()
    .optional()
    .describe("The existing ad or campaign whose performance motivated this variant."),
});

export const CreativeWorkshopSchema = z.object({
  reasoning: z
    .string()
    .describe("What the current creative data says, and the angle gaps you are filling."),
  variants: z.array(CreativeVariantSchema).describe("Four to six genuinely distinct variants."),
  testPlan: z
    .string()
    .describe(
      "How to run this: budget, split, how long, minimum sample before calling it, and what to do with the loser.",
    ),
  risks: z.array(z.string()).describe("What could make this test misleading."),
});

export type CreativeWorkshop = z.infer<typeof CreativeWorkshopSchema>;
