"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CreativeWorkshop } from "@/lib/ai/schemas";

export function CreativeWorkshopForm({
  aiConfigured,
  platforms,
}: {
  aiConfigured: boolean;
  platforms: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [platform, setPlatform] = useState(platforms[0]?.id ?? "google_ads");
  const [objective, setObjective] = useState("First purchase from a new customer");
  const [audience, setAudience] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreativeWorkshop | null>(null);

  if (!aiConfigured) {
    return (
      <p className="text-[13px] text-[var(--text-secondary)]">
        The creative workshop needs Claude. Set{" "}
        <code className="rounded bg-[var(--surface-sunken)] px-1">ANTHROPIC_API_KEY</code> and reload
        — the performance tables above work without it.
      </p>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/ai/creative", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, objective, audience, notes }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Failed (${response.status})`);
      setResult(body.workshop as CreativeWorkshop);
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-[var(--series-1)] hairline";

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">Channel</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={field}>
            {platforms.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">Objective</span>
          <input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className={field}
            placeholder="First purchase from a new customer"
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            Who are you talking to?
          </span>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className={field}
            placeholder="Home cooks aged 28-45 who already buy premium kitchenware"
            required
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            Anything else worth knowing? (optional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={field}
            placeholder="We cannot make price claims. Avoid anything that reads as medical advice."
          />
        </label>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: "var(--series-1)" }}
          >
            {busy ? "Writing variants…" : "Workshop new ads"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="text-[13px]" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-4 border-t pt-5 hairline">
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{result.reasoning}</p>

          <div className="grid gap-3 md:grid-cols-2">
            {result.variants.map((variant, index) => (
              <article key={index} className="rounded-lg border p-3 hairline">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    {variant.angle}
                  </span>
                  <span className="tnum text-[10px] text-[var(--text-muted)]">
                    {variant.headline.length}/{variant.body.length} chars
                  </span>
                </div>
                <h3 className="mt-1.5 text-[14px] font-medium">{variant.headline}</h3>
                <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{variant.body}</p>
                <div className="mt-2 text-[12px] text-[var(--text-muted)]">
                  CTA: {variant.callToAction}
                </div>
                <p className="mt-2 border-t pt-2 text-[12px] leading-relaxed text-[var(--text-secondary)] hairline">
                  <strong className="font-medium text-[var(--text-primary)]">Testing:</strong>{" "}
                  {variant.hypothesis}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  <strong className="font-medium text-[var(--text-primary)]">Wins if:</strong>{" "}
                  {variant.successMetric}
                </p>
              </article>
            ))}
          </div>

          <div>
            <h3 className="text-[13px] font-semibold">How to run it</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
              {result.testPlan}
            </p>
          </div>

          {result.risks.length > 0 ? (
            <div>
              <h3 className="text-[13px] font-semibold">What could make this misleading</h3>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {result.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-[12px] text-[var(--text-muted)]">
            Saved to your briefs below. Nothing has been uploaded to any ad account.
          </p>
        </div>
      ) : null}
    </div>
  );
}
