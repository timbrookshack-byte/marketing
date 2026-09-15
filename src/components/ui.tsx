import Link from "next/link";
import type { ReactNode } from "react";
import { formatCompactCurrency, formatPercent } from "@/lib/util";

/** Shared presentation pieces. Server components unless they need state. */

export function Card({
  children,
  className = "",
  title,
  subtitle,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title ? <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2> : null}
            {subtitle ? (
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{subtitle}</p>
            ) : null}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * A stat tile is the right form when the story is one number. The value keeps
 * proportional figures; only aligned columns get tabular ones.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  hint?: string;
  tone?: "neutral" | "good" | "critical";
}) {
  const toneColor =
    tone === "good" ? "var(--delta-up)" : tone === "critical" ? "var(--status-critical)" : "var(--text-primary)";

  return (
    <div className="card p-4">
      <div className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-2 text-[28px] leading-none font-semibold" style={{ color: toneColor }}>
        {value}
      </div>
      {delta !== undefined ? (
        <div
          className="mt-2 flex items-center gap-1 text-[12px]"
          style={{ color: delta >= 0 ? "var(--delta-up)" : "var(--status-critical)" }}
        >
          <span aria-hidden>{delta >= 0 ? "▲" : "▼"}</span>
          <span className="tnum">{formatPercent(Math.abs(delta))}</span>
          {deltaLabel ? <span className="text-[var(--text-muted)]">{deltaLabel}</span> : null}
        </div>
      ) : null}
      {hint ? <p className="mt-2 text-[12px] text-[var(--text-secondary)]">{hint}</p> : null}
    </div>
  );
}

export type Severity = "critical" | "serious" | "warning" | "good" | "neutral";

const SEVERITY_STYLE: Record<Severity, { color: string; icon: string; label: string }> = {
  critical: { color: "var(--status-critical)", icon: "■", label: "Critical" },
  serious: { color: "var(--status-serious)", icon: "▲", label: "Serious" },
  warning: { color: "var(--status-warning)", icon: "●", label: "Watch" },
  good: { color: "var(--status-good)", icon: "▲", label: "Opportunity" },
  neutral: { color: "var(--text-muted)", icon: "○", label: "Info" },
};

/** Status always ships as icon plus label — never colour on its own. */
export function SeverityBadge({ severity, children }: { severity: Severity; children?: ReactNode }) {
  const style = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.neutral;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium hairline"
      style={{ color: style.color }}
    >
      <span aria-hidden>{style.icon}</span>
      {children ?? style.label}
    </span>
  );
}

export function ChannelDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

export function Money({ value, currency = "USD" }: { value: number; currency?: string }) {
  return (
    <span className="tnum" style={{ color: value < 0 ? "var(--status-critical)" : undefined }}>
      {formatCompactCurrency(value, currency)}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      <p className="max-w-md text-[13px] text-[var(--text-secondary)]">{body}</p>
      {action}
    </div>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-lg px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
      style={{ background: "var(--series-1)" }}
    >
      {children}
    </Link>
  );
}

export function Th({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2.5 text-[13px] ${align === "right" ? "tnum text-right" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

/** Wide tables scroll on their own so the page body never scrolls sideways. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-2 overflow-x-auto px-2">{children}</div>;
}
