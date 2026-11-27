"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { PRESET_LABELS, type RangePreset } from "@/lib/dates";

/**
 * The period a page covers.
 *
 * The choice lives in the URL rather than in component state, so a window
 * worth coming back to can be bookmarked or sent to someone, and a refresh
 * does not throw it away. The page is server-rendered from those parameters,
 * which also means the database is asked for the period actually wanted
 * instead of a month that is then filtered down in the browser.
 */
const ORDER: Exclude<RangePreset, "custom">[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_7",
  "last_30",
  "last_90",
];

export function RangePicker({
  preset,
  start,
  end,
}: {
  preset: RangePreset;
  start: string;
  end: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [customOpen, setCustomOpen] = useState(preset === "custom");
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);

  function go(next: URLSearchParams) {
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function choose(value: Exclude<RangePreset, "custom">) {
    const next = new URLSearchParams(params.toString());
    next.set("range", value);
    next.delete("from");
    next.delete("to");
    setCustomOpen(false);
    go(next);
  }

  function applyCustom() {
    if (!from || !to) return;
    const next = new URLSearchParams(params.toString());
    next.delete("range");
    next.set("from", from);
    next.set("to", to);
    go(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
        {ORDER.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => choose(value)}
            aria-pressed={preset === value}
            className={`shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[12px] transition-colors hairline ${
              preset === value
                ? "bg-[var(--text-primary)] text-[var(--surface-1)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
            }`}
          >
            {PRESET_LABELS[value]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen((open) => !open)}
          aria-pressed={preset === "custom"}
          aria-expanded={customOpen}
          className={`shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[12px] transition-colors hairline ${
            preset === "custom"
              ? "bg-[var(--text-primary)] text-[var(--surface-1)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
          }`}
        >
          Custom…
        </button>
        {pending ? (
          <span className="shrink-0 pl-1 text-[12px] text-[var(--text-muted)]">loading…</span>
        ) : null}
      </div>

      {customOpen ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
            From
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              className="rounded-lg border px-2 py-1 text-[12px] hairline"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]">
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className="rounded-lg border px-2 py-1 text-[12px] hairline"
            />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!from || !to || pending}
            className="rounded-lg border bg-[var(--text-primary)] px-3 py-1.5 text-[12px] text-[var(--surface-1)] transition-opacity hover:opacity-90 disabled:opacity-50 hairline"
          >
            Apply
          </button>
        </div>
      ) : null}
    </div>
  );
}
