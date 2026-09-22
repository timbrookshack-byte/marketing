"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Competitor } from "@/lib/inspiration/types";
import type { SourceCatalogEntry } from "@/lib/inspiration/registry";

const FIELD =
  "w-full rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-[var(--series-1)] hairline";
const BUTTON =
  "rounded border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-50 hairline";

interface Suggestion {
  name: string;
  domain: string | null;
  why: string;
  overlap: string;
  confidence: number;
}

export function CompetitorManager({
  competitors,
  sources,
  aiConfigured,
}: {
  competitors: Competitor[];
  sources: SourceCatalogEntry[];
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const add = (input: { name: string; domain?: string | null; category?: string | null }) => {
    startTransition(async () => {
      setMessage(null);
      const response = await fetch("/api/inspiration/competitors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) setMessage(body.error ?? "Could not add that brand.");
      else {
        setName("");
        setCategory("");
        router.refresh();
      }
    });
  };

  const remove = (competitor: Competitor) => {
    if (!window.confirm(`Stop watching ${competitor.name}? Their stored creatives are removed too.`)) {
      return;
    }
    startTransition(async () => {
      await fetch(`/api/inspiration/competitors/${competitor.id}`, { method: "DELETE" });
      router.refresh();
    });
  };

  const refresh = (competitorId?: string) => {
    startTransition(async () => {
      setMessage(null);
      const response = await fetch("/api/inspiration/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(competitorId ? { competitorId } : {}),
      });
      const body = await response.json();
      const results = (body.results ?? []) as {
        source: string;
        status: string;
        found: number;
        detail?: string;
      }[];

      if (results.length === 0) {
        setMessage(body.error ?? "Nothing to pull — add a brand first.");
      } else {
        const ok = results.filter((r) => r.status === "success");
        const found = ok.reduce((total, r) => total + r.found, 0);

        // Every brand is searched with every source, so one unconfigured source
        // produces one identical complaint per brand. Repeating it four or ten
        // times buries the other sources' problems in its own noise, so each
        // distinct problem is stated once with a count of what it affected.
        const problems = new Map<string, { detail: string; brands: number }>();
        for (const result of results) {
          if (result.status === "success") continue;
          const detail = result.detail ?? result.status;
          const entry = problems.get(`${result.source}|${detail}`) ?? { detail, brands: 0 };
          entry.brands += 1;
          problems.set(`${result.source}|${detail}`, entry);
        }

        const sourcesTried = new Set(results.map((r) => r.source)).size;
        const summary =
          ok.length > 0
            ? `${found} creative${found === 1 ? "" : "s"} from ${ok.length} source${ok.length === 1 ? "" : "s"}.`
            : `Nothing found. None of the ${sourcesTried} source${sourcesTried === 1 ? "" : "s"} returned ads.`;

        setMessage(
          [
            summary,
            ...[...problems.entries()].map(([key, entry]) => {
              const source = key.split("|")[0];
              const scope = entry.brands > 1 ? ` (all ${entry.brands} brands)` : "";
              return `${source}${scope}: ${entry.detail}`;
            }),
          ].join("\n"),
        );
      }
      router.refresh();
    });
  };

  const suggest = async () => {
    if (!description.trim()) return;
    setBusy(true);
    setSuggestions(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ai/peers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not suggest brands.");
      setSuggestions(body.peers as Suggestion[]);
      setSuggestNote(body.note as string);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const configured = sources.filter((source) => source.configured && source.searchable);

  return (
    <section className="card p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Who you are watching</h2>
          <p className="mt-1 max-w-2xl text-[13px] text-[var(--text-secondary)]">
            Pick brands at a similar size and price position. Category giants advertise against brand
            equity you do not have, which makes their creative a poor model.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => refresh()}
            disabled={pending || competitors.length === 0}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: "var(--series-1)" }}
          >
            {pending ? "Pulling…" : "Pull latest ads"}
          </button>
          {/* A disabled button that says nothing reads as a broken one. */}
          {competitors.length === 0 ? (
            <span className="text-[11px] text-[var(--text-muted)]">
              Add a brand below first — there is nothing to search for yet.
            </span>
          ) : null}
        </div>
      </header>

      {/* Beside the button that produced it: the foot of the page is past the
          brand list and the grid, where an answer goes unread. */}
      {message ? (
        <p className="mb-4 whitespace-pre-line rounded-lg border p-3 text-[12px] leading-relaxed text-[var(--text-secondary)] hairline">
          {message}
        </p>
      ) : null}

      {competitors.length > 0 ? (
        <ul className="mb-5 flex flex-col divide-y hairline">
          {competitors.map((competitor) => (
            <li key={competitor.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0">
              <span className="text-[13px] font-medium">{competitor.name}</span>
              {competitor.origin === "suggested" ? (
                <span className="rounded border px-1.5 text-[10px] uppercase text-[var(--text-muted)] hairline">
                  unconfirmed
                </span>
              ) : null}
              {competitor.category ? (
                <span className="text-[12px] text-[var(--text-muted)]">{competitor.category}</span>
              ) : null}
              <span className="ml-auto flex gap-2">
                <button type="button" className={BUTTON} disabled={pending} onClick={() => refresh(competitor.id)}>
                  Pull
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  style={{ color: "var(--status-critical)" }}
                  disabled={pending}
                  onClick={() => remove(competitor)}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) add({ name, category });
        }}
        className="grid gap-2 sm:grid-cols-[2fr_2fr_auto]"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Brand name, as it appears on their ad account"
          className={FIELD}
        />
        <input
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="How they overlap with you (optional)"
          className={FIELD}
        />
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-50 hairline"
        >
          Add
        </button>
      </form>

      {aiConfigured ? (
        <div className="mt-5 border-t pt-4 hairline">
          <p className="mb-2 text-[12px] text-[var(--text-secondary)]">
            Not sure who to watch? Describe what you sell and Claude will suggest peers. These are
            suggestions from general knowledge, not from your market — verify before relying on them.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Premium cast-iron cookware, sold direct, UK, £80-£300"
              className={`${FIELD} flex-1 min-w-[260px]`}
            />
            <button type="button" onClick={suggest} disabled={busy || !description.trim()} className={BUTTON}>
              {busy ? "Thinking…" : "Suggest brands"}
            </button>
          </div>

          {suggestions ? (
            <div className="mt-3 flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.name}
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 hairline"
                >
                  <span className="text-[13px] font-medium">{suggestion.name}</span>
                  <span className="rounded border px-1.5 text-[10px] uppercase text-[var(--text-muted)] hairline">
                    {suggestion.overlap}
                  </span>
                  <span className="text-[12px] text-[var(--text-secondary)]">{suggestion.why}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="tnum text-[11px] text-[var(--text-muted)]">
                      {Math.round(suggestion.confidence * 100)}% sure
                    </span>
                    <button
                      type="button"
                      className={BUTTON}
                      disabled={pending}
                      onClick={() =>
                        add({ name: suggestion.name, domain: suggestion.domain, category: suggestion.why })
                      }
                    >
                      Watch
                    </button>
                  </span>
                </div>
              ))}
              {suggestNote ? (
                <p className="text-[12px] text-[var(--text-muted)]">{suggestNote}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 border-t pt-4 hairline">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Where the ads come from
        </h3>
        <div className="grid gap-2 md:grid-cols-2">
          {sources.map((source) => (
            <div key={source.id} className="rounded-lg border p-2.5 hairline">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{source.displayName}</span>
                <span
                  className="text-[11px] font-medium"
                  style={{
                    color: source.configured ? "var(--status-good)" : "var(--text-muted)",
                  }}
                >
                  {source.configured ? "ready" : source.searchable ? "not configured" : "always available"}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-[var(--text-secondary)]">{source.summary}</p>
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{source.coverage}</p>
              {source.caveat ? (
                <p
                  className="mt-1 border-l-2 pl-2 text-[11px] leading-snug"
                  style={{ borderColor: "var(--status-warning)", color: "var(--text-secondary)" }}
                >
                  {source.caveat}
                </p>
              ) : null}
              {!source.configured && source.missingEnv.length > 0 ? (
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Needs{" "}
                  {source.missingEnv.map((env, index) => (
                    <span key={env}>
                      {index > 0 ? ", " : ""}
                      <code className="rounded bg-[var(--surface-sunken)] px-1">{env}</code>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        {configured.length === 0 ? (
          <p className="mt-3 text-[12px] text-[var(--text-secondary)]">
            No live source is configured yet, which is fine — you can still paste in ads you have seen
            and everything below works on those.
          </p>
        ) : null}
      </div>


    </section>
  );
}

export function AngleAnalysisButton({
  aiConfigured,
  hasData,
}: {
  aiConfigured: boolean;
  hasData: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!aiConfigured) {
    return (
      <p className="max-w-[240px] text-right text-[11px] text-[var(--text-muted)]">
        Angle analysis needs <code className="rounded bg-[var(--surface-sunken)] px-1">ANTHROPIC_API_KEY</code>.
        The traction scoring above works without it.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending || !hasData}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const response = await fetch("/api/ai/angles", { method: "POST" });
            if (!response.ok) {
              const body = await response.json();
              setError(body.error ?? `Failed (${response.status})`);
            }
            router.refresh();
          })
        }
        className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: "var(--series-1)" }}
      >
        {pending ? "Analysing…" : "Find the gaps"}
      </button>
      {error ? (
        <span className="max-w-[260px] text-right text-[11px]" style={{ color: "var(--status-critical)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
