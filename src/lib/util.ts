import crypto from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}

/** Deterministic id so re-syncing the same entity updates it instead of duplicating. */
export function stableId(prefix: string, ...parts: string[]): string {
  const hash = crypto.createHash("sha1").update(parts.join("::")).digest("base64url");
  return `${prefix}_${hash.slice(0, 16)}`;
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

export function formatCompactCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 1 : 0,
  }).format(Number.isFinite(value) ? value : 0);
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

/** Deterministic PRNG so demo data is reproducible across restarts. */
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
