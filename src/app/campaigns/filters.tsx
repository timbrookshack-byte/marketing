"use client";

import { useMemo, useState, type ReactNode } from "react";

/**
 * What the table needs to decide whether a row belongs in view.
 *
 * The row itself arrives already rendered. Filtering is the only thing this
 * component does, so the cells stay server-rendered and there is no second
 * copy of the formatting to drift from the first.
 */
export interface CampaignRow {
  id: string;
  name: string;
  platform: string;
  platformLabel: string;
  status: string;
  spend: number;
  node: ReactNode;
}

type View = "relevant" | "spending" | "all";

/**
 * Why "relevant" is the default rather than "all".
 *
 * An account accumulates campaigns and never loses them: this one carries
 * sixty paused campaigns that have not spent a cent in the window, against
 * fifteen that have. A list where most rows are noise does not get read
 * carefully, it gets skimmed, and skimming is how a campaign quietly spending
 * four thousand dollars for nothing goes unnoticed for another month.
 *
 * "Relevant" keeps anything that either cost money in the period or is running
 * now. The second half matters: a campaign switched on today has spent nothing
 * yet and is exactly the thing worth watching.
 */
const VIEWS: { key: View; label: string; help: string }[] = [
  { key: "relevant", label: "Relevant", help: "Spent money in this period, or running now" },
  { key: "spending", label: "Spending", help: "Only campaigns that cost money in this period" },
  { key: "all", label: "Everything", help: "Including paused campaigns with no spend" },
];

export function CampaignTable({
  rows,
  header,
  windowDays,
}: {
  rows: CampaignRow[];
  header: ReactNode;
  windowDays: number;
}) {
  const [view, setView] = useState<View>("relevant");
  const [platform, setPlatform] = useState<string>("all");
  const [search, setSearch] = useState("");

  const platforms = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) seen.set(row.platform, row.platformLabel);
    return [...seen.entries()];
  }, [rows]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (view === "spending" && row.spend <= 0) return false;
      if (view === "relevant" && row.spend <= 0 && row.status !== "active") return false;
      if (platform !== "all" && row.platform !== platform) return false;
      if (needle && !row.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, view, platform, search]);

  const hidden = rows.length - visible.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="inline-flex rounded-lg border hairline">
          {VIEWS.map((option) => (
            <button
              key={option.key}
              type="button"
              title={option.help}
              onClick={() => setView(option.key)}
              className={`px-2.5 py-1 text-[12px] transition-colors first:rounded-l-lg last:rounded-r-lg ${
                view === option.key
                  ? "bg-[var(--text-primary)] text-[var(--surface)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {platforms.length > 1 ? (
          <div className="inline-flex rounded-lg border hairline">
            <button
              type="button"
              onClick={() => setPlatform("all")}
              className={`px-2.5 py-1 text-[12px] transition-colors rounded-l-lg ${
                platform === "all"
                  ? "bg-[var(--text-primary)] text-[var(--surface)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
              }`}
            >
              All channels
            </button>
            {platforms.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPlatform(key)}
                className={`px-2.5 py-1 text-[12px] transition-colors last:rounded-r-lg ${
                  platform === key
                    ? "bg-[var(--text-primary)] text-[var(--surface)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a campaign…"
          className="w-48 rounded-lg border px-2.5 py-1 text-[12px] hairline"
        />

        <span className="text-[12px] text-[var(--text-muted)]">
          {visible.length} of {rows.length}
          {hidden > 0 && view !== "all" ? (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => setView("all")}
                className="underline underline-offset-2 hover:text-[var(--text-primary)]"
              >
                {hidden} hidden
              </button>
            </>
          ) : null}
        </span>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[1000px] border-collapse">
          {header}
          <tbody>{visible.map((row) => row.node)}</tbody>
        </table>
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
          Nothing matches. Over the last {windowDays} days, {rows.filter((r) => r.spend > 0).length}{" "}
          campaigns spent money.
        </p>
      ) : null}
    </div>
  );
}
