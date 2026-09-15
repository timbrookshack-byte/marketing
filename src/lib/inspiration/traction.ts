import { clamp, daysBetween, todayISO } from "../util";
import type { ExternalCreative } from "./types";

/**
 * Inferring what is working from what is still running.
 *
 * The reasoning, stated plainly so it can be argued with:
 *
 *   A paid ad costs money every day it delivers. Advertisers watch that spend
 *   and cut what does not pay — usually within one or two weeks, because the
 *   platforms' own optimisation surfaces losers fast. So an ad that is *still
 *   live* after several months has survived a renewed decision to keep funding
 *   it, every single one of those days. Nobody keeps paying for an ad that
 *   loses money, and nobody builds eleven variants of a concept that flopped.
 *
 * That gives two behavioural signals, neither self-reported:
 *
 *   longevity  — days between first and last delivery
 *   iteration  — how many near-duplicate variants of the same concept exist
 *
 * And three honest limits, which the UI repeats rather than hides:
 *
 *   1. A large brand can run a brand-awareness ad for a year on a budget line
 *      that never had a ROAS target. Longevity means "not cut", not "profitable".
 *   2. Always-on evergreen creative is sometimes just neglect.
 *   3. Their economics are not yours. A 70%-margin DTC brand can sustain a CPA
 *      that would bankrupt a 25%-margin retailer, so a concept that works for
 *      them can still be wrong for you.
 *
 * Treat the score as "worth stealing the idea and testing", never as "this
 * will work".
 */

export interface TractionScore {
  /** 0..100. Comparable within a refresh, not across accounts. */
  score: number;
  daysLive: number;
  variantCount: number;
  isLive: boolean;
  /** One line a person can read instead of trusting the number. */
  verdict: string;
  band: "proven" | "promising" | "early" | "retired";
}

/**
 * Days a creative delivered. Still-live ads are measured to today, which is the
 * point — the clock is still running on them.
 */
export function daysLive(creative: ExternalCreative, asOf = todayISO()): number {
  if (!creative.firstSeen) return 0;
  const end = creative.isLive ? asOf : (creative.lastSeen ?? asOf);
  return Math.max(0, daysBetween(creative.firstSeen, end));
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "with", "your", "you", "our", "we",
  "to", "of", "in", "on", "at", "is", "are", "it", "this", "that", "from", "get",
  "now", "new", "all", "more", "off", "up", "out", "shop", "buy",
]);

/** The meaningful words in a creative, with prices and countdowns stripped out. */
export function contentWords(creative: ExternalCreative): Set<string> {
  const text = `${creative.headline ?? ""} ${creative.body ?? ""}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[0-9]+([.,][0-9]+)?%?/g, "") // prices, percentages, countdowns
    .replace(/[^a-z\s]/g, " ");

  return new Set(
    text.split(/\s+/).filter((word) => word.length > 3 && !STOP_WORDS.has(word)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * How much two creatives have to overlap to count as the same concept.
 * 0.45 groups a reworded headline over an identical body, which is the common
 * case, without merging two genuinely different promises.
 */
const SAME_CONCEPT_THRESHOLD = 0.45;

/**
 * Groups a cohort into concepts, so five reworded versions of one promise count
 * as one concept iterated five times rather than five separate ideas.
 *
 * This compares word sets pairwise rather than hashing each creative to a key
 * independently. An earlier version built a key from each creative's first six
 * words alphabetically, which sounds equivalent and is not: whether a headline
 * word displaced a body word from that window depended on its spelling, so
 * rewordings of one ad scattered across several keys. Similarity has to be
 * measured between two creatives; it cannot be baked into one of them alone.
 *
 * Greedy single-pass assignment: each creative joins the first cluster it is
 * similar enough to. Good enough for the tens-of-ads scale this runs at.
 */
export function clusterConcepts(cohort: ExternalCreative[]): Map<string, string> {
  const clusters: { id: string; advertiser: string; words: Set<string>; size: number }[] = [];
  const assignment = new Map<string, string>();

  for (const creative of cohort) {
    const words = contentWords(creative);

    // Concepts are scoped to one advertiser: two brands making the same promise
    // is a market signal, not one brand iterating on its own idea.
    const match = clusters.find(
      (cluster) =>
        cluster.advertiser === creative.advertiser &&
        jaccard(cluster.words, words) >= SAME_CONCEPT_THRESHOLD,
    );

    if (match) {
      match.size += 1;
      // The cluster narrows to the words common to everything in it, so it does
      // not drift as members are added.
      for (const word of [...match.words]) if (!words.has(word)) match.words.delete(word);
      assignment.set(creativeKey(creative), match.id);
      continue;
    }

    const label =
      [...words].sort().slice(0, 4).join("-") || `unkeyed-${creative.externalId}`;
    // Two different concepts can derive the same label; suffix to keep ids unique.
    const id = clusters.some((cluster) => cluster.id === label)
      ? `${label}-${clusters.length}`
      : label;

    clusters.push({ id, advertiser: creative.advertiser, words: new Set(words), size: 1 });
    assignment.set(creativeKey(creative), id);
  }

  return assignment;
}

export function creativeKey(creative: ExternalCreative): string {
  return [creative.advertiser, creative.source, creative.externalId].join("::");
}

/**
 * Single-creative concept label, for callers that have no cohort to compare
 * against (the storage layer, which writes one row at a time).
 */
export function variantKey(creative: ExternalCreative): string {
  return (
    [...contentWords(creative)].sort().slice(0, 4).join("-") ||
    `unkeyed-${creative.externalId}`
  );
}

/**
 * Scores one creative against the whole set it was fetched with, because
 * variant counts only mean anything relative to the same advertiser.
 */
export function scoreTraction(
  creative: ExternalCreative,
  cohort: ExternalCreative[],
  asOf = todayISO(),
  clusters?: Map<string, string>,
): TractionScore {
  const days = daysLive(creative, asOf);
  const assignment = clusters ?? clusterConcepts(cohort);
  const conceptId = assignment.get(creativeKey(creative));
  const variantCount = conceptId
    ? [...assignment.values()].filter((id) => id === conceptId).length
    : 1;

  // Longevity saturates: 180 days live is overwhelming evidence, and 360 is not
  // twice as convincing as 180. A log curve keeps a year-old ad from swamping
  // the ranking.
  const longevity = clamp(Math.log10(1 + days) / Math.log10(181), 0, 1);

  // Iteration counts, but with diminishing weight for the same reason.
  const iteration = clamp(Math.log10(variantCount) / Math.log10(8), 0, 1);

  // Still running is worth more than the same run length in the past: a retired
  // ad was eventually cut, whatever it did before that.
  const liveBonus = creative.isLive ? 0.15 : 0;

  const score = Math.round(clamp(longevity * 0.6 + iteration * 0.25 + liveBonus, 0, 1) * 100);

  const band: TractionScore["band"] = !creative.isLive
    ? "retired"
    : days >= 90
      ? "proven"
      : days >= 30
        ? "promising"
        : "early";

  const verdict = (() => {
    if (!creative.isLive) {
      return days >= 60
        ? `Ran ${days} days before being retired — it worked for a while, so the angle is sound even if the execution aged out.`
        : `Only ran ${days} days and was cut. Treat as a rejected experiment, not a model.`;
    }
    if (days >= 300) {
      return `Live ${days} days — over a year. At that length this is as likely to be brand budget with no return target as it is a performance winner. Read the creative, not the runtime.`;
    }
    if (days >= 90) {
      return variantCount > 2
        ? `Live ${days} days with ${variantCount} variants in rotation. They are still funding it and still investing in it — as close to proof as public data gets.`
        : `Live ${days} days straight. Nobody keeps paying for an ad this long unless it pays them back.`;
    }
    if (days >= 30) {
      return `Live ${days} days — past the point where a loser would normally have been cut, but not yet proven.`;
    }
    return `Only ${days} days old. Too early to read anything into it; check again in a month.`;
  })();

  return { score, daysLive: days, variantCount, isLive: creative.isLive, verdict, band };
}

export interface ScoredCreative extends ExternalCreative {
  traction: TractionScore;
  variantKeyValue: string;
}

/** Scores and ranks a whole fetch, best evidence first. */
export function rankByTraction(creatives: ExternalCreative[], asOf = todayISO()): ScoredCreative[] {
  // Cluster once for the whole cohort: pairwise similarity is O(n x clusters),
  // and recomputing it per creative would make ranking quadratic for no gain.
  const clusters = clusterConcepts(creatives);
  return creatives
    .map((creative) => ({
      ...creative,
      traction: scoreTraction(creative, creatives, asOf, clusters),
      variantKeyValue: clusters.get(creativeKey(creative)) ?? variantKey(creative),
    }))
    .sort((a, b) => b.traction.score - a.traction.score);
}

/**
 * Collapses a ranked list to one entry per concept, keeping the longest-running
 * example. A grid of eleven near-identical ads is noise; the concept is signal.
 */
export function dedupeToConcepts(scored: ScoredCreative[]): ScoredCreative[] {
  const best = new Map<string, ScoredCreative>();
  for (const creative of scored) {
    const key = `${creative.advertiser}:${creative.variantKeyValue}`;
    const current = best.get(key);
    if (!current || creative.traction.daysLive > current.traction.daysLive) {
      best.set(key, creative);
    }
  }
  return [...best.values()].sort((a, b) => b.traction.score - a.traction.score);
}
