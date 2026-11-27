/**
 * Calendar ranges, including the cases that are quietly wrong everywhere else.
 *
 * The one that matters most: a Worker runs in UTC, so at 7am in Brisbane it is
 * still yesterday in UTC. "Today" computed the obvious way shows yesterday's
 * figures every morning, which is when someone looks.
 *
 * Run with `npm run test:dates`.
 */
import { daysBetween, rangeFor, rangeFromParams, todayIn } from "../src/lib/dates";

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else {
    failed += 1;
    console.log(`FAIL  ${label}`);
    console.log(`        want ${JSON.stringify(want)}`);
    console.log(`        got  ${JSON.stringify(got)}`);
  }
}

const BNE = "Australia/Brisbane";

console.log("\nThe timezone actually matters\n");

// 2026-11-26 21:30 UTC is 2026-11-27 07:30 in Brisbane.
const earlyMorning = new Date("2026-11-26T21:30:00Z");
check("UTC still calls it the 26th", earlyMorning.toISOString().slice(0, 10), "2026-11-26");
check("Brisbane calls it the 27th", todayIn(BNE, earlyMorning), "2026-11-27");
check(
  "so 'today' is the 27th, not the 26th",
  rangeFor("today", BNE, earlyMorning),
  { start: "2026-11-27", end: "2026-11-27" },
);
check(
  "and 'yesterday' is the 26th",
  rangeFor("yesterday", BNE, earlyMorning),
  { start: "2026-11-26", end: "2026-11-26" },
);

console.log("\nWeeks start on Monday\n");

// 2026-11-27 is a Friday.
const friday = new Date("2026-11-27T03:00:00Z");
check("this week runs Monday to today", rangeFor("this_week", BNE, friday), {
  start: "2026-11-23",
  end: "2026-11-27",
});
check("last week is the Monday to Sunday before", rangeFor("last_week", BNE, friday), {
  start: "2026-11-16",
  end: "2026-11-22",
});

// A Monday must be the start of its own week, not the end of the previous one.
const monday = new Date("2026-11-23T03:00:00Z");
check("on a Monday, this week starts today", rangeFor("this_week", BNE, monday), {
  start: "2026-11-23",
  end: "2026-11-23",
});

// A Sunday is the last day of its week, not the first.
const sunday = new Date("2026-11-22T03:00:00Z");
check("on a Sunday, the week started six days ago", rangeFor("this_week", BNE, sunday), {
  start: "2026-11-16",
  end: "2026-11-22",
});

console.log("\nMonths, including the awkward ones\n");

check("this month runs to today, not to month end", rangeFor("this_month", BNE, friday), {
  start: "2026-11-01",
  end: "2026-11-27",
});
check("last month is the whole of it", rangeFor("last_month", BNE, friday), {
  start: "2026-10-01",
  end: "2026-10-31",
});

// January asking for last month must cross the year.
const january = new Date("2027-01-15T03:00:00Z");
check("last month from January is December", rangeFor("last_month", BNE, january), {
  start: "2026-12-01",
  end: "2026-12-31",
});

// February in a leap year.
const march2028 = new Date("2028-03-10T03:00:00Z");
check("February 2028 has 29 days", rangeFor("last_month", BNE, march2028), {
  start: "2028-02-01",
  end: "2028-02-29",
});

// The 31st asking for this month must not roll into the next one.
const lastDay = new Date("2026-10-31T03:00:00Z");
check("the 31st is still this month", rangeFor("this_month", BNE, lastDay), {
  start: "2026-10-01",
  end: "2026-10-31",
});

console.log("\nTrailing windows are inclusive of both ends\n");

check("last 7 days means 7 days", rangeFor("last_7", BNE, friday), {
  start: "2026-11-21",
  end: "2026-11-27",
});
check("counted as 7", daysBetween(rangeFor("last_7", BNE, friday)), 7);
check("last 30 counted as 30", daysBetween(rangeFor("last_30", BNE, friday)), 30);
check("a single day counts as 1", daysBetween({ start: "2026-11-27", end: "2026-11-27" }), 1);

console.log("\nReading it back from a link\n");

check(
  "a custom range survives being bookmarked",
  rangeFromParams({ from: "2026-09-01", to: "2026-09-30" }, BNE, friday),
  { range: { start: "2026-09-01", end: "2026-09-30" }, preset: "custom" },
);
check(
  "reversed dates are put the right way round",
  rangeFromParams({ from: "2026-09-30", to: "2026-09-01" }, BNE, friday).range,
  { start: "2026-09-01", end: "2026-09-30" },
);
check(
  "a nonsense preset falls back rather than throwing",
  rangeFromParams({ range: "last_fortnight" }, BNE, friday).preset,
  "last_30",
);
check(
  "a half-given custom range falls back to the preset",
  rangeFromParams({ from: "2026-09-01" }, BNE, friday).preset,
  "last_30",
);
check(
  "a malformed date falls back rather than querying nonsense",
  rangeFromParams({ from: "01/09/2026", to: "30/09/2026" }, BNE, friday).preset,
  "last_30",
);

console.log("\nAn unknown timezone must not break the page\n");

check(
  "it falls back to UTC rather than throwing",
  todayIn("Not/AZone", friday),
  "2026-11-27",
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
