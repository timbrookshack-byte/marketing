"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Write-back controls.
 *
 * These change a live ad account, so they confirm first and report exactly what
 * happened. Connectors that cannot write yet record the intent in the action log
 * rather than silently doing nothing — the response says which of the two
 * occurred.
 */
export function CampaignActions({
  campaignId,
  campaignName,
  status,
  suggestedBudget,
}: {
  campaignId: string;
  campaignName: string;
  status: string;
  suggestedBudget: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: "pause" | "set_budget") => {
    const confirmText =
      action === "pause"
        ? `Pause "${campaignName}"? This stops delivery on the live ad account.`
        : `Set the daily budget for "${campaignName}" to ${Math.round(suggestedBudget ?? 0)}? This changes the live ad account.`;
    if (!window.confirm(confirmText)) return;

    startTransition(async () => {
      setMessage(null);
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            dailyBudget: action === "set_budget" ? suggestedBudget : undefined,
          }),
        });
        const body = (await response.json()) as { ok?: boolean; detail?: string; error?: string };
        setMessage(body.detail ?? body.error ?? (body.ok ? "Done" : "Failed"));
        router.refresh();
      } catch (error) {
        setMessage((error as Error).message);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {status === "active" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("pause")}
            className="rounded border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-50 hairline"
            style={{ color: "var(--status-critical)" }}
          >
            Pause
          </button>
        ) : null}
        {suggestedBudget !== null && suggestedBudget > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("set_budget")}
            className="rounded border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-50 hairline"
          >
            Apply
          </button>
        ) : null}
      </div>
      {message ? (
        <span className="max-w-[170px] text-right text-[10px] leading-tight text-[var(--text-muted)]">
          {message}
        </span>
      ) : null}
    </div>
  );
}
