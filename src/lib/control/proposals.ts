/**
 * The lifecycle of a proposed change.
 *
 * A change arrives as a proposal, is judged against the policy, waits for a
 * person, and only then reaches the ad account. The judging happens twice: at
 * proposal time so whoever asked is told immediately, and again at the moment
 * of applying, because an approval can sit for hours while the account moves
 * underneath it. A proposal approved when the account had room can easily be
 * over the ceiling by the time someone clicks apply.
 */

import { getConnection, getCampaign, listCampaigns, logAction } from "../repo";
import { getDatabase } from "../sql";
import { getJsonSetting, setJsonSetting } from "../sql/settings";
import type { Campaign } from "../types";
import { newId, nowISO } from "../util";
import { applyChange } from "./apply";
import {
  DEFAULT_CAPS,
  evaluate,
  isBlocked,
  type Caps,
  type ChangeAction,
  type ChangeContext,
  type Finding,
} from "./policy";

const CAPS_KEY = "change_policy_caps";

export type ProposalStatus =
  | "pending"
  | "approved"
  | "applied"
  | "rejected"
  | "failed"
  | "expired";

export interface Proposal {
  id: string;
  createdAt: string;
  createdBy: string;
  connectionId: string;
  platform: string;
  scope: string;
  targetId: string;
  targetName: string;
  action: ChangeAction;
  payload: { dailyBudget?: number };
  before: { dailyBudget?: number | null; status?: string };
  rationale: string | null;
  status: ProposalStatus;
  guardrails: Finding[];
  expiresAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  appliedAt: string | null;
  result: string | null;
  detail: string | null;
}

export async function getCaps(): Promise<Caps> {
  const stored = await getJsonSetting<Partial<Caps>>(CAPS_KEY, {});
  // Merged rather than replaced, so a cap added to the defaults later applies
  // to an account that saved its settings before that cap existed.
  return { ...DEFAULT_CAPS, ...stored, allow: { ...DEFAULT_CAPS.allow, ...stored.allow } };
}

export async function setCaps(caps: Partial<Caps>): Promise<void> {
  await setJsonSetting(CAPS_KEY, { ...(await getCaps()), ...caps });
}

/** How many changes this campaign has actually had applied in the last day. */
async function changesInLastDay(campaignId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const count = await getDatabase()
    .prepare(
      `SELECT count(*) FROM action_log
        WHERE target_id = ? AND result = 'applied' AND created_at >= ?`,
    )
    .pluck<number>([campaignId, since]);
  return Number(count ?? 0);
}

/**
 * The account's current daily commitment.
 *
 * Only campaigns that are actually running count: a paused campaign's budget
 * is not being spent, and counting it would refuse changes on the live ones
 * because of spend that is not happening.
 */
async function accountDailyBudget(): Promise<number> {
  const campaigns = await listCampaigns();
  return campaigns
    .filter((c) => c.status === "active")
    .reduce((sum, c) => sum + (c.dailyBudget ?? 0), 0);
}

export async function buildContext(campaign: Campaign): Promise<ChangeContext> {
  return {
    campaignName: campaign.name,
    currentDailyBudget: campaign.dailyBudget ?? null,
    currentStatus: campaign.status,
    accountDailyBudget: await accountDailyBudget(),
    changesToday: await changesInLastDay(campaign.id),
  };
}

function toProposal(row: Record<string, unknown>): Proposal {
  const parse = <T>(value: unknown, fallback: T): T => {
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    createdBy: row.created_by as string,
    connectionId: row.connection_id as string,
    platform: row.platform as string,
    scope: row.scope as string,
    targetId: row.target_id as string,
    targetName: row.target_name as string,
    action: row.action as ChangeAction,
    payload: parse(row.payload, {}),
    before: parse(row.before, {}),
    rationale: (row.rationale as string) ?? null,
    status: row.status as ProposalStatus,
    guardrails: parse(row.guardrails, [] as Finding[]),
    expiresAt: (row.expires_at as string) ?? null,
    decidedAt: (row.decided_at as string) ?? null,
    decidedBy: (row.decided_by as string) ?? null,
    appliedAt: (row.applied_at as string) ?? null,
    result: (row.result as string) ?? null,
    detail: (row.detail as string) ?? null,
  };
}

export interface ProposeInput {
  campaignId: string;
  action: ChangeAction;
  dailyBudget?: number;
  rationale?: string;
  /** Who is asking: "portal", or the MCP client's name. */
  createdBy: string;
}

export interface ProposeOutcome {
  /** Null when the policy refused outright, in which case nothing was stored. */
  proposal: Proposal | null;
  findings: Finding[];
  blocked: boolean;
  detail?: string;
}

/**
 * Records a change for someone to approve.
 *
 * A blocked proposal is not stored. The point of a pending list is that every
 * row on it is something a person could reasonably say yes to; filling it with
 * changes that can never be applied makes it a list nobody reads.
 */
export async function propose(input: ProposeInput): Promise<ProposeOutcome> {
  const campaign = await getCampaign(input.campaignId);
  if (!campaign) {
    return { proposal: null, findings: [], blocked: true, detail: "Campaign not found" };
  }

  const connection = await getConnection(campaign.connectionId);
  if (!connection) {
    return { proposal: null, findings: [], blocked: true, detail: "Connection not found" };
  }

  const caps = await getCaps();
  const context = await buildContext(campaign);
  const findings = evaluate(
    { action: input.action, dailyBudget: input.dailyBudget },
    context,
    caps,
  );

  if (isBlocked(findings)) {
    return {
      proposal: null,
      findings,
      blocked: true,
      detail: findings
        .filter((f) => f.severity === "block")
        .map((f) => f.message)
        .join(" "),
    };
  }

  const id = newId("prop");
  const createdAt = nowISO();
  const expiresAt = new Date(
    Date.now() + caps.proposalTtlHours * 60 * 60 * 1000,
  ).toISOString();

  await getDatabase()
    .prepare(
      `INSERT INTO change_proposals
         (id, created_at, created_by, connection_id, platform, scope, target_id, target_name,
          action, payload, before, rationale, status, guardrails, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run([
      id,
      createdAt,
      input.createdBy,
      connection.id,
      campaign.platform,
      "campaign",
      campaign.id,
      campaign.name,
      input.action,
      JSON.stringify({ dailyBudget: input.dailyBudget }),
      JSON.stringify({ dailyBudget: campaign.dailyBudget ?? null, status: campaign.status }),
      input.rationale ?? null,
      "pending",
      JSON.stringify(findings),
      expiresAt,
    ]);

  const proposal = await getProposal(id);
  return { proposal, findings, blocked: false };
}

export async function getProposal(id: string): Promise<Proposal | null> {
  const row = (await getDatabase()
    .prepare("SELECT * FROM change_proposals WHERE id = ?")
    .get([id])) as Record<string, unknown> | undefined;
  return row ? toProposal(row) : null;
}

export async function listProposals(status?: ProposalStatus, limit = 50): Promise<Proposal[]> {
  const rows = status
    ? await getDatabase()
        .prepare(
          "SELECT * FROM change_proposals WHERE status = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all([status, limit])
    : await getDatabase()
        .prepare("SELECT * FROM change_proposals ORDER BY created_at DESC LIMIT ?")
        .all([limit]);
  return (rows as Record<string, unknown>[]).map(toProposal);
}

/**
 * Marks pending proposals past their expiry as expired.
 *
 * A proposal is a judgement about an account at a moment. Left to sit, the
 * numbers behind it stop being true, and the worst version of this feature
 * would be a week-old budget rise applied because someone finally got round to
 * the list.
 */
export async function expireStale(): Promise<number> {
  const result = await getDatabase()
    .prepare(
      `UPDATE change_proposals
          SET status = 'expired', decided_at = ?, detail = 'Expired before it was approved'
        WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`,
    )
    .run([nowISO(), nowISO()]);
  return result.changes;
}

export async function reject(id: string, by: string): Promise<Proposal | null> {
  await getDatabase()
    .prepare(
      `UPDATE change_proposals SET status = 'rejected', decided_at = ?, decided_by = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .run([nowISO(), by, id]);
  return getProposal(id);
}

export interface ApproveOutcome {
  proposal: Proposal | null;
  ok: boolean;
  detail?: string;
  /** Findings from the re-check at apply time, when that is what refused it. */
  findings?: Finding[];
}

/**
 * Approves a proposal and applies it.
 *
 * The policy is re-run first against the account as it is now, not as it was
 * when the proposal was made. If the answer has changed, the proposal is
 * refused rather than applied, and says what changed.
 */
export async function approve(id: string, by: string): Promise<ApproveOutcome> {
  const proposal = await getProposal(id);
  if (!proposal) return { proposal: null, ok: false, detail: "Proposal not found" };

  if (proposal.status !== "pending") {
    return {
      proposal,
      ok: false,
      detail: `This proposal is ${proposal.status}, so there is nothing to apply.`,
    };
  }

  if (proposal.expiresAt && proposal.expiresAt < nowISO()) {
    await expireStale();
    return {
      proposal: await getProposal(id),
      ok: false,
      detail: "This proposal expired before it was approved. Propose it again.",
    };
  }

  const campaign = await getCampaign(proposal.targetId);
  const connection = await getConnection(proposal.connectionId);
  if (!campaign || !connection) {
    return { proposal, ok: false, detail: "The campaign or connection no longer exists." };
  }

  // The second look. Nothing below this point trusts what was decided earlier.
  const caps = await getCaps();
  const context = await buildContext(campaign);
  const findings = evaluate(
    { action: proposal.action, dailyBudget: proposal.payload.dailyBudget },
    context,
    caps,
  );

  if (isBlocked(findings)) {
    const detail =
      "The account has moved since this was proposed, and it no longer passes: " +
      findings
        .filter((f) => f.severity === "block")
        .map((f) => f.message)
        .join(" ");
    await getDatabase()
      .prepare(
        `UPDATE change_proposals
            SET status = 'rejected', decided_at = ?, decided_by = ?, detail = ?, guardrails = ?
          WHERE id = ?`,
      )
      .run([nowISO(), by, detail, JSON.stringify(findings), id]);
    return { proposal: await getProposal(id), ok: false, detail, findings };
  }

  let outcome: { ok: boolean; attempted: boolean; detail?: string };
  try {
    outcome = await applyChange(campaign, connection, proposal.action, proposal.payload.dailyBudget);
  } catch (error) {
    outcome = { ok: false, attempted: true, detail: (error as Error).message };
  }

  const status: ProposalStatus = outcome.ok ? "applied" : "failed";
  const appliedAt = nowISO();

  await getDatabase()
    .prepare(
      `UPDATE change_proposals
          SET status = ?, decided_at = ?, decided_by = ?, applied_at = ?, result = ?, detail = ?
        WHERE id = ?`,
    )
    .run([
      status,
      appliedAt,
      by,
      appliedAt,
      outcome.ok ? "applied" : outcome.attempted ? "failed" : "recorded",
      outcome.detail ?? null,
      id,
    ]);

  await logAction({
    connectionId: connection.id,
    scope: "campaign",
    targetId: campaign.id,
    action: proposal.action,
    payload: proposal.payload,
    result: outcome.ok ? "applied" : outcome.attempted ? "failed" : "recorded",
    detail: outcome.detail,
    actor: by,
    proposalId: id,
  });

  return { proposal: await getProposal(id), ok: outcome.ok, detail: outcome.detail };
}
