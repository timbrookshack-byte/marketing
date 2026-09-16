"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Pasting credentials for a platform that issues a key directly.
 *
 * Secrets go straight to the server and are encrypted there. Nothing is read
 * back afterwards, so a saved key can be replaced but never viewed.
 */
export function ManualConnectForm({
  platform,
  displayName,
  setup,
  connected,
}: {
  platform: string;
  displayName: string;
  setup: { help: string; fields: ManualFieldSpec[] };
  connected: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: "var(--series-1)" }}
      >
        {connected ? "Replace key" : "Connect"}
      </button>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, values }),
      });
      const body = await response.json();
      if (!response.ok || body.ok === false) {
        setMessage(body.error ?? `Failed (${response.status})`);
      } else {
        setMessage(`Connected — pulled ${(body.rowsIngested ?? 0).toLocaleString()} rows.`);
        setValues({});
        setOpen(false);
        router.refresh();
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="basis-full">
      <p className="mb-2 text-[11px] leading-snug text-[var(--text-secondary)]">{setup.help}</p>
      <div className="flex flex-col gap-2">
        {setup.fields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">{field.label}</span>
            <input
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              value={values[field.key] ?? ""}
              placeholder={field.placeholder}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
              className="w-full rounded border bg-transparent px-2 py-1.5 text-[12px] outline-none transition-colors focus:border-[var(--series-1)] hairline"
            />
            {field.help ? (
              <span className="text-[10px] text-[var(--text-muted)]">{field.help}</span>
            ) : null}
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded px-2 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: "var(--series-1)" }}
        >
          {busy ? "Connecting…" : `Connect ${displayName}`}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setValues({});
          }}
          className="text-[11px] text-[var(--text-muted)] underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
      {message ? (
        <p className="mt-2 text-[11px] text-[var(--text-secondary)]">{message}</p>
      ) : null}
    </form>
  );
}

export interface ManualFieldSpec {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  secret?: boolean;
  required?: boolean;
}

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

/**
 * Naming the account a connection points at.
 *
 * Shown when OAuth succeeded but no account was attached — which on Google Ads
 * usually means the ad account sits under a manager account, so the login can
 * see it without it appearing in the accessible-customers list.
 */
export function AccountIdForm({
  connectionId,
  platform,
  currentAccountId,
}: {
  connectionId: string;
  platform: string;
  currentAccountId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(currentAccountId ?? "");
  const [loginCustomerId, setLoginCustomerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isGoogle = platform === "google_ads";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface-sunken)] hairline"
      >
        {currentAccountId ? "Change account ID" : "Set account ID"}
      </button>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/connections/${connectionId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalAccountId: accountId, loginCustomerId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? `Failed (${response.status})`);
      } else {
        setOpen(false);
        router.refresh();
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded border bg-transparent px-2 py-1.5 text-[12px] outline-none transition-colors focus:border-[var(--series-1)] hairline";

  return (
    <form onSubmit={submit} className="basis-full">
      {isGoogle ? (
        <p className="mb-2 text-[11px] leading-snug text-[var(--text-secondary)]">
          The customer ID is at the top right of the Google Ads interface, like 123-456-7890.
          If the account is inside a manager (MCC) account, add the manager&rsquo;s ID too —
          without it Google refuses the request.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            {isGoogle ? "Customer ID" : "Account ID"}
          </span>
          <input
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            placeholder={isGoogle ? "123-456-7890" : "account id"}
            className={field}
          />
        </label>
        {isGoogle ? (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              Manager (MCC) ID — optional
            </span>
            <input
              value={loginCustomerId}
              onChange={(event) => setLoginCustomerId(event.target.value)}
              placeholder="098-765-4321"
              className={field}
            />
          </label>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !accountId.trim()}
          className="rounded px-2 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: "var(--series-1)" }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-[var(--text-muted)] underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
      {message ? (
        <p className="mt-2 text-[11px]" style={{ color: "var(--status-critical)" }}>
          {message}
        </p>
      ) : null}
    </form>
  );
}

/** Shows what the OAuth callback came back with, which otherwise vanished. */
export function CallbackBanner({ connected, error }: { connected?: string; error?: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || (!connected && !error)) return null;

  const isError = Boolean(error);
  return (
    <div
      className="flex items-start gap-3 rounded-lg border p-3 hairline"
      style={{
        borderColor: isError ? "var(--status-critical)" : "var(--status-good)",
        background: "var(--surface-1)",
      }}
    >
      <span aria-hidden style={{ color: isError ? "var(--status-critical)" : "var(--status-good)" }}>
        {isError ? "■" : "●"}
      </span>
      <p className="flex-1 text-[13px] leading-relaxed">{error ?? connected}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-[11px] text-[var(--text-muted)] underline underline-offset-2"
      >
        Dismiss
      </button>
    </div>
  );
}
