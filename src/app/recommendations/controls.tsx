"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RunAnalysisButton({ aiConfigured }: { aiConfigured: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!aiConfigured) {
    return (
      <p className="max-w-xs text-right text-[12px] text-[var(--text-muted)]">
        Set <code className="rounded bg-[var(--surface-sunken)] px-1">ANTHROPIC_API_KEY</code> to add
        Claude&rsquo;s read on top. Everything on this page works without it.
      </p>
    );
  }

  const run = () => {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/api/ai/analyze", { method: "POST" });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? `Analysis failed (${response.status})`);
        }
        router.refresh();
      } catch (caught) {
        setError((caught as Error).message);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: "var(--series-1)" }}
      >
        {pending ? "Analysing…" : "Run Claude analysis"}
      </button>
      {error ? (
        <span className="max-w-xs text-right text-[11px]" style={{ color: "var(--status-critical)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function RecommendationControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const set = (next: "accepted" | "dismissed" | "done" | "open") => {
    startTransition(async () => {
      await fetch(`/api/recommendations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    });
  };

  if (status !== "open") {
    return (
      <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
        <span>Marked {status}.</span>
        <button
          type="button"
          disabled={pending}
          onClick={() => set("open")}
          className="underline underline-offset-2 disabled:opacity-50"
        >
          Reopen
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => set("accepted")}
        className="rounded border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-50 hairline"
      >
        Accept
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => set("done")}
        className="rounded border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-50 hairline"
      >
        Mark done
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => set("dismissed")}
        className="rounded border px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-50 hairline"
      >
        Dismiss
      </button>
    </div>
  );
}
