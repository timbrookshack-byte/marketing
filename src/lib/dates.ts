/**
 * Calendar ranges, in the business's own timezone.
 *
 * Everything stored is UTC and every date in the database is a plain
 * YYYY-MM-DD, which is the right way round: a day is a label, not an instant.
 * The problem is deciding which label today carries. A Worker runs in UTC, so
 * a shop in Queensland asking for "today" before ten in the morning would be
 * handed yesterday — and the morning is when someone looks.
 *
 * So the current date is read in the configured zone, and the arithmetic from
 * there is plain string arithmetic on calendar days. No instant is converted,
 * which avoids the usual trap of a range that shifts by an hour twice a year.
 */

export interface DateRange {
  start: string;
  end: string;
}

export type RangePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_7"
  | "last_30"
  | "last_90"
  | "custom";

/** Today's calendar date in the given zone, as YYYY-MM-DD. */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    // en-CA renders as YYYY-MM-DD, which is what every date column holds.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // An unknown zone should not take the page down with it.
    return now.toISOString().slice(0, 10);
  }
}

export function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return moved.toISOString().slice(0, 10);
}

/** 0 = Monday. The trading week here starts on a Monday. */
function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (day + 6) % 7;
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function endOfMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export const PRESET_LABELS: Record<Exclude<RangePreset, "custom">, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  last_7: "Last 7 days",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
};

/**
 * The dates a preset covers, both ends inclusive.
 *
 * "This week" and "this month" run to today rather than to the end of the
 * period, because a range that includes days which have not happened makes
 * every rate metric in the portal look worse than it is.
 */
export function rangeFor(preset: RangePreset, timezone: string, now = new Date()): DateRange {
  const today = todayIn(timezone, now);

  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const d = shiftDays(today, -1);
      return { start: d, end: d };
    }
    case "this_week":
      return { start: shiftDays(today, -weekdayIndex(today)), end: today };
    case "last_week": {
      const thisMonday = shiftDays(today, -weekdayIndex(today));
      return { start: shiftDays(thisMonday, -7), end: shiftDays(thisMonday, -1) };
    }
    case "this_month":
      return { start: startOfMonth(today), end: today };
    case "last_month": {
      const lastMonthDay = shiftDays(startOfMonth(today), -1);
      return { start: startOfMonth(lastMonthDay), end: endOfMonth(lastMonthDay) };
    }
    case "last_7":
      return { start: shiftDays(today, -6), end: today };
    case "last_90":
      return { start: shiftDays(today, -89), end: today };
    case "last_30":
    case "custom":
    default:
      return { start: shiftDays(today, -29), end: today };
  }
}

/** How many calendar days a range covers, both ends inclusive. */
export function daysBetween(range: DateRange): number {
  const [ys, ms, ds] = range.start.split("-").map(Number);
  const [ye, me, de] = range.end.split("-").map(Number);
  const start = Date.UTC(ys, ms - 1, ds);
  const end = Date.UTC(ye, me - 1, de);
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns query parameters into a range.
 *
 * A custom range wins when both ends are present and valid, which lets a
 * bookmarked link keep pointing at the same window rather than quietly
 * becoming "the last 30 days" whenever it is opened.
 */
export function rangeFromParams(
  params: { range?: string; from?: string; to?: string },
  timezone: string,
  now = new Date(),
): { range: DateRange; preset: RangePreset } {
  const { from, to } = params;
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to)) {
    const range = from <= to ? { start: from, end: to } : { start: to, end: from };
    return { range, preset: "custom" };
  }

  const named = (params.range ?? "last_30") as RangePreset;
  const known = named in PRESET_LABELS ? named : "last_30";
  return { range: rangeFor(known, timezone, now), preset: known };
}
