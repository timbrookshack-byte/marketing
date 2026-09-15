"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ConnectionControls({
  platform,
  connectionId,
  canConnect,
  status,
}: {
  platform: string;
  connectionId: string | null;
  canConnect: boolean;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const sync = () => {
    startTransition(async () => {
      setMessage(null);
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const body = await response.json();
      const result = body.results?.[0];
      setMessage(
        result
          ? result.status === "success"
            ? `Pulled ${result.rowsIngested.toLocaleString()} rows`
            : (result.error ?? result.status)
          : (body.error ?? "Sync finished"),
      );
      router.refresh();
    });
  };

  const disconnect = () => {
    if (!window.confirm("Disconnect this account? Its stored data is removed from the portal.")) return;
    startTransition(async () => {
      await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
      router.refresh();
    });
  };

  const button =
    "rounded border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-50 hairline";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canConnect ? (
        <a
          href={`/api/connectors/${platform}/authorize`}
          className="rounded px-2 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--series-1)" }}
        >
          {connectionId && status === "connected" ? "Reconnect" : "Connect"}
        </a>
      ) : null}

      {connectionId ? (
        <>
          <button type="button" onClick={sync} disabled={pending} className={button}>
            {pending ? "Working…" : "Sync now"}
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={pending}
            className={button}
            style={{ color: "var(--status-critical)" }}
          >
            Disconnect
          </button>
        </>
      ) : null}

      {message ? (
        <span className="basis-full text-[11px] text-[var(--text-muted)]">{message}</span>
      ) : null}
    </div>
  );
}

export function SyncAllButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const response = await fetch("/api/sync", { method: "POST" });
            const body = await response.json();
            const results = (body.results ?? []) as { status: string; rowsIngested: number }[];
            const ok = results.filter((r) => r.status === "success");
            const rows = ok.reduce((total, r) => total + r.rowsIngested, 0);
            setMessage(
              results.length === 0
                ? "Nothing connected to sync"
                : `${ok.length}/${results.length} succeeded · ${rows.toLocaleString()} rows`,
            );
            router.refresh();
          })
        }
        className="rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-60 hairline"
      >
        {pending ? "Syncing…" : "Sync everything"}
      </button>
      {message ? <span className="text-[11px] text-[var(--text-muted)]">{message}</span> : null}
    </div>
  );
}

export function DemoDataButton({ hasData }: { hasData: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          hasData &&
          !window.confirm(
            "Regenerate the demo account? This replaces the existing demo connections and their data.",
          )
        ) {
          return;
        }
        startTransition(async () => {
          await fetch("/api/demo", { method: "POST" });
          router.refresh();
        });
      }}
      className="rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-60 hairline"
    >
      {pending ? "Generating…" : hasData ? "Regenerate demo data" : "Load demo account"}
    </button>
  );
}
