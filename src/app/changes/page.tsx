import { getCaps, expireStale, listProposals, type Proposal } from "@/lib/control/proposals";
import { platformLabel } from "@/lib/connectors/registry";
import { listActions } from "@/lib/repo";
import { Card, EmptyState, TableWrap, Td, Th } from "@/components/ui";
import { CapsForm, DecideButtons } from "./controls";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  pause: "Pause",
  resume: "Resume",
  set_budget: "Change budget",
};

function when(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "not set";
  return `$${Math.round(value * 100) / 100}`;
}

/**
 * What the change does, in the terms a person approving it needs.
 *
 * Always as a movement rather than a destination: "$100 → $130" is reviewable,
 * "$130" requires the reader to go and look up what it is now.
 */
function describe(proposal: Proposal): string {
  if (proposal.action === "set_budget") {
    return `${money(proposal.before.dailyBudget)} → ${money(proposal.payload.dailyBudget)} per day`;
  }
  if (proposal.action === "pause") return `Running → paused`;
  return `Paused → running`;
}

export default async function ChangesPage() {
  // Swept on the way in rather than by a schedule: this is the only page where
  // a stale proposal could be acted on, so it is the place to be sure.
  await expireStale();

  const [pending, recent, actions, caps] = await Promise.all([
    listProposals("pending"),
    listProposals(undefined, 25),
    listActions(25),
    getCaps(),
  ]);

  const decided = recent.filter((p) => p.status !== "pending");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Changes</h1>
        <p className="mt-1 max-w-[70ch] text-[13px] text-[var(--text-secondary)]">
          Nothing here reaches an ad account until it is approved. Every change is checked against
          the limits twice — once when it is proposed, and again at the moment it is applied,
          because an account can move while a proposal waits.
        </p>
      </div>

      <Card title="Waiting for you" subtitle={`${pending.length} pending`}>
        {pending.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            body="Changes proposed by the assistant, or blocked for approval, appear here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((proposal) => (
              <div
                key={proposal.id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-xl border p-4 hairline"
              >
                <div className="flex min-w-[260px] flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[14px] font-medium">{proposal.targetName}</span>
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {platformLabel(proposal.platform as never)}
                    </span>
                  </div>
                  <div className="text-[13px]">
                    <span className="font-medium">{ACTION_LABEL[proposal.action] ?? proposal.action}</span>
                    {" · "}
                    <span>{describe(proposal)}</span>
                  </div>
                  {proposal.rationale ? (
                    <p className="max-w-[60ch] text-[12px] text-[var(--text-secondary)]">
                      {proposal.rationale}
                    </p>
                  ) : null}
                  {proposal.guardrails.length > 0 ? (
                    <ul className="mt-1 flex flex-col gap-1">
                      {proposal.guardrails.map((finding, index) => (
                        <li key={index} className="text-[12px] text-[var(--text-muted)]">
                          ⚠ {finding.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="text-[12px] text-[var(--text-muted)]">
                    Proposed by {proposal.createdBy} · {when(proposal.createdAt)}
                    {proposal.expiresAt
                      ? ` · expires ${new Date(proposal.expiresAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <DecideButtons id={proposal.id} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Limits" subtitle="What a change is allowed to be">
        <CapsForm initial={caps} />
      </Card>

      <Card title="Decided" subtitle="Recent proposals and what became of them">
        {decided.length === 0 ? (
          <EmptyState
            title="Nothing decided yet"
            body="Approved, rejected and expired proposals are kept here."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Change</Th>
                <Th>Outcome</Th>
                <Th>Decided by</Th>
                <Th align="right">When</Th>
              </tr>
            </thead>
            <tbody>
              {decided.map((proposal) => (
                <tr key={proposal.id}>
                  <Td>{proposal.targetName}</Td>
                  <Td>
                    {ACTION_LABEL[proposal.action] ?? proposal.action} · {describe(proposal)}
                  </Td>
                  <Td>
                    <span className="font-medium">{proposal.status}</span>
                    {proposal.detail ? (
                      <span className="block max-w-[46ch] text-[12px] text-[var(--text-muted)]">
                        {proposal.detail}
                      </span>
                    ) : null}
                  </Td>
                  <Td>{proposal.decidedBy ?? "—"}</Td>
                  <Td align="right">{when(proposal.decidedAt ?? proposal.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card title="Audit trail" subtitle="Every write this portal attempted, including the ones that failed">
        {actions.length === 0 ? (
          <EmptyState
            title="No writes yet"
            body="Once a change is applied it is recorded here with who asked for it."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Result</Th>
                <Th>Actor</Th>
                <Th align="right">When</Th>
              </tr>
            </thead>
            <tbody>
              {actions.map((entry) => (
                <tr key={entry.id}>
                  <Td>{ACTION_LABEL[entry.action] ?? entry.action}</Td>
                  <Td>{entry.targetId}</Td>
                  <Td>
                    {entry.result}
                    {entry.detail ? (
                      <span className="block max-w-[46ch] text-[12px] text-[var(--text-muted)]">
                        {entry.detail}
                      </span>
                    ) : null}
                  </Td>
                  <Td>{entry.actor ?? "—"}</Td>
                  <Td align="right">{when(entry.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
