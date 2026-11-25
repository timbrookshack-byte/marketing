"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Caps } from "@/lib/control/policy";

function Button({
  onClick,
  busy,
  tone = "default",
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  tone?: "default" | "primary" | "danger";
  children: React.ReactNode;
}) {
  const palette =
    tone === "primary"
      ? "bg-[var(--text-primary)] text-[var(--surface)] hover:opacity-90"
      : tone === "danger"
        ? "text-[var(--danger,#b4232a)] hover:bg-[var(--surface-sunken)]"
        : "hover:bg-[var(--surface-sunken)]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-50 hairline ${palette}`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export function DecideButtons({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/proposals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = (await response.json()) as { detail?: string; error?: string };
      if (!response.ok) setError(data.detail ?? data.error ?? "That did not work");
      else start(() => router.refresh());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button onClick={() => decide("reject")} busy={busy || pending}>
          Reject
        </Button>
        <Button onClick={() => decide("approve")} busy={busy || pending} tone="primary">
          Approve &amp; apply
        </Button>
      </div>
      {error ? (
        <p className="max-w-[320px] text-right text-[12px] text-[var(--danger,#b4232a)]">{error}</p>
      ) : null}
    </div>
  );
}

const FIELDS: { key: keyof Caps; label: string; help: string; suffix?: string }[] = [
  {
    key: "maxDailyBudget",
    label: "Per-campaign daily cap",
    help: "No campaign's daily budget may be set above this.",
    suffix: "$",
  },
  {
    key: "minDailyBudget",
    label: "Daily budget floor",
    help: "Below this, pause the campaign instead of starving it.",
    suffix: "$",
  },
  {
    key: "maxIncreasePercent",
    label: "Largest rise in one change",
    help: "Platforms relearn after a budget move; big jumps are rarely worth the reset.",
    suffix: "%",
  },
  {
    key: "maxDecreasePercent",
    label: "Largest cut in one change",
    help: "A cut deeper than this is usually a pause in disguise.",
    suffix: "%",
  },
  {
    key: "maxAccountDailyBudget",
    label: "Account daily ceiling",
    help: "The most every running campaign may commit between them, per day.",
    suffix: "$",
  },
  {
    key: "maxChangesPerCampaignPerDay",
    label: "Changes per campaign per day",
    help: "Counted over a rolling 24 hours, against changes that actually applied.",
  },
  {
    key: "proposalTtlHours",
    label: "Proposal expires after",
    help: "A proposal judges the account at a moment; past this it must be made again.",
    suffix: "h",
  },
];

export function CapsForm({ initial }: { initial: Caps }) {
  const router = useRouter();
  const [caps, setCaps] = useState<Caps>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/control/caps", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(caps),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) setError(data.error ?? "That did not save");
      else {
        setMessage("Saved. New limits apply to the next proposal and to anything approved from now on.");
        router.refresh();
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="text-[13px] font-medium">{field.label}</span>
            <span className="flex items-center gap-1.5">
              {field.suffix === "$" ? (
                <span className="text-[13px] text-[var(--text-muted)]">$</span>
              ) : null}
              <input
                type="number"
                value={String(caps[field.key] as number)}
                onChange={(event) =>
                  setCaps({ ...caps, [field.key]: Number(event.target.value) } as Caps)
                }
                className="w-28 rounded-lg border px-2 py-1 text-[13px] hairline"
              />
              {field.suffix && field.suffix !== "$" ? (
                <span className="text-[13px] text-[var(--text-muted)]">{field.suffix}</span>
              ) : null}
            </span>
            <span className="text-[12px] text-[var(--text-muted)]">{field.help}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Allowed actions</span>
        <div className="flex flex-wrap gap-4">
          {(["pause", "resume", "set_budget"] as const).map((action) => (
            <label key={action} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={caps.allow[action]}
                onChange={(event) =>
                  setCaps({ ...caps, allow: { ...caps.allow, [action]: event.target.checked } })
                }
              />
              {action === "set_budget" ? "Change budgets" : action === "pause" ? "Pause" : "Resume"}
            </label>
          ))}
        </div>
        <p className="text-[12px] text-[var(--text-muted)]">
          Switching one off refuses it everywhere, including from the portal&apos;s own buttons.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} busy={busy} tone="primary">
          Save limits
        </Button>
        {message ? <span className="text-[12px] text-[var(--text-muted)]">{message}</span> : null}
        {error ? (
          <span className="text-[12px] text-[var(--danger,#b4232a)]">{error}</span>
        ) : null}
      </div>
    </div>
  );
}
