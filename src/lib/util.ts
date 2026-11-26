import { base64url, sha1 } from "./hash/sha1";

/**
 * crypto.getRandomValues and the sync SHA-1 above, rather than node:crypto:
 * Workers has neither randomBytes nor createHash, and both of these are used
 * inline in places that cannot await.
 */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `${prefix}_${base64url(bytes)}`;
}

/** Deterministic id so re-syncing the same entity updates it instead of duplicating. */
export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${base64url(sha1(parts.join("::"))).slice(0, 16)}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The last `days` days ending yesterday — ad platforms restate today all day. */
export function trailingWindow(days: number, endingOn = todayISO()): { start: string; end: string } {
  const end = addDays(endingOn, -1);
  return { start: addDays(end, -(days - 1)), end };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Guards every ratio in the app: no Infinity, no NaN leaking into the UI. */
export function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!denominator || !Number.isFinite(denominator)) return fallback;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

export function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + (pick(item) || 0), 0);
}

export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

export function formatCurrency(value: number, currency = "USD", maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Money, shortened once it gets long.
 *
 * The shortening is done here rather than by Intl's compact notation, which is
 * not portable between engines even with the locale pinned: Node renders
 * 15,000 as "$15.0K" and Chrome as "$15K". Since this runs on the server and
 * then again in the browser, that disagreement surfaces as a React hydration
 * error on every page showing a compact figure that lands on a whole thousand,
 * and the tree gets thrown away and re-rendered.
 *
 * Intl still formats the number itself, so the currency symbol, the grouping
 * and the negative sign stay correct for the currency given. Only the choice
 * of suffix and decimal place is ours.
 */
export function formatCompactCurrency(value: number, currency = "USD"): string {
  const safe = Number.isFinite(value) ? value : 0;
  const magnitude = Math.abs(safe);

  if (magnitude < 10_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(safe);
  }

  const [divisor, suffix] =
    magnitude >= 1_000_000_000
      ? [1_000_000_000, "B"]
      : magnitude >= 1_000_000
        ? [1_000_000, "M"]
        : [1_000, "K"];

  const scaled = safe / divisor;
  // One decimal while the mantissa is small enough for it to mean something.
  const digits = Math.abs(scaled) < 100 ? 1 : 0;

  return (
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(Number(scaled.toFixed(digits))) + suffix
  );
}

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(
    Number.isFinite(value) ? value : 0,
  );
}

export function formatPercent(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Fixed-decimal percentage for table columns. Aligned numbers have to agree on
 * their decimal places or the column stops reading as a column.
 */
export function formatPercentFixed(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatDateShort(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Deterministic PRNG, seeded so repeated runs agree. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A campaign objective in words rather than in the platform's constant.
 *
 * Meta returns OUTCOME_SALES and Google returns PERFORMANCE_MAX; neither is
 * written for the person reading a table, and on a phone the long ones wrap
 * into two lines of shouting. The original is kept where the exact value
 * matters -- it goes in the title attribute -- and anything unrecognised falls
 * back to a tidied version of itself rather than being dropped.
 */
export function objectiveLabel(objective: string | null | undefined): string {
  if (!objective) return "";

  const known: Record<string, string> = {
    OUTCOME_SALES: "Sales",
    OUTCOME_AWARENESS: "Awareness",
    OUTCOME_TRAFFIC: "Traffic",
    OUTCOME_LEADS: "Leads",
    OUTCOME_ENGAGEMENT: "Engagement",
    OUTCOME_APP_PROMOTION: "App promotion",
    CATALOG_SALES: "Catalogue sales",
    LEAD_GENERATION: "Lead generation",
    LINK_CLICKS: "Link clicks",
    CONVERSIONS: "Conversions",
    PERFORMANCE_MAX: "Performance Max",
    SHOPPING: "Shopping",
    SEARCH: "Search",
    DISPLAY: "Display",
    VIDEO: "Video",
    SMART: "Smart",
    DEMAND_GEN: "Demand Gen",
    MULTI_CHANNEL: "Multi-channel",
  };

  const upper = objective.toUpperCase();
  if (known[upper]) return known[upper];

  // Unknown constants still read better without the underscores.
  const words = upper.replace(/^OUTCOME_/, "").split("_").filter(Boolean);
  if (words.length === 0) return objective;
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0) + word.slice(1).toLowerCase() : word.toLowerCase(),
    )
    .join(" ");
}
