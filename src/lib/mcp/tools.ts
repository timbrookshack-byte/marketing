/**
 * What an assistant may do to this account.
 *
 * Read tools return the same shape the in-portal analyst already gets, rather
 * than a second summary that could disagree with the screens a person is
 * looking at while they talk to it.
 *
 * There is deliberately no tool that approves anything. An assistant can
 * propose a change and can see what is pending, and that is where its reach
 * ends: approval happens in the portal, by a person, against the limits. A
 * propose-and-approve pair in the same hands is just a write with extra steps.
 */

import { buildSnapshot, summariseForModel } from "../analytics";
import { getCaps, listProposals, propose } from "../control/proposals";
import type { ChangeAction } from "../control/policy";
import { listCampaigns } from "../repo";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Returns any JSON-serialisable value; the transport renders it. */
  handler: (args: Record<string, unknown>, actor: string) => Promise<unknown>;
}

const DAYS = {
  type: "number",
  description: "How many days back to look. Defaults to 30.",
  minimum: 1,
  maximum: 365,
};

function days(args: Record<string, unknown>): number {
  const value = Number(args.days ?? 30);
  if (!Number.isFinite(value)) return 30;
  return Math.min(365, Math.max(1, Math.round(value)));
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "account_overview",
    description:
      "Spend, attributed revenue, ROAS and gross profit for the whole account and per channel, " +
      "over a window. Attributed revenue comes from matched store orders; platform-claimed " +
      "revenue is each network marking its own homework, and the two are never merged.",
    inputSchema: { type: "object", properties: { days: DAYS } },
    handler: async (args) => {
      const snapshot = await buildSnapshot(days(args));
      const summary = summariseForModel(snapshot);
      return {
        window: summary.window,
        settings: summary.settings,
        portfolio: summary.portfolio,
        channels: summary.channels,
        isEmpty: snapshot.isEmpty,
      };
    },
  },
  {
    name: "list_campaigns",
    description:
      "Every campaign with its spend, attributed revenue, orders, ROAS and current daily budget " +
      "over a window. Use this before proposing a change, so the proposal cites real numbers.",
    inputSchema: {
      type: "object",
      properties: {
        days: DAYS,
        platform: {
          type: "string",
          description: "Optional filter, for example meta_ads or google_ads.",
        },
        limit: { type: "number", description: "Most campaigns to return. Defaults to 40." },
      },
    },
    handler: async (args) => {
      const snapshot = await buildSnapshot(days(args));
      const limit = Math.min(200, Math.max(1, Number(args.limit ?? 40)));
      const summary = summariseForModel(snapshot, { campaigns: limit, ads: 0 });
      const platform = typeof args.platform === "string" ? args.platform : null;
      const campaigns = platform
        ? summary.campaigns.filter((c) => c.platform === platform)
        : summary.campaigns;
      return { window: summary.window, count: campaigns.length, campaigns };
    },
  },
  {
    name: "get_change_limits",
    description:
      "The limits every proposed change is judged against, and which actions are switched on. " +
      "Read this before proposing, so a proposal is not made that cannot be approved.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => getCaps(),
  },
  {
    name: "list_proposals",
    description:
      "Changes that have been proposed, and what became of them. Status is one of pending, " +
      "approved, applied, rejected, failed or expired.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional status filter, for example pending." },
        limit: { type: "number", description: "Most to return. Defaults to 25." },
      },
    },
    handler: async (args) => {
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 25)));
      const status = typeof args.status === "string" ? args.status : undefined;
      const proposals = await listProposals(status as never, limit);
      return {
        count: proposals.length,
        proposals: proposals.map((p) => ({
          id: p.id,
          campaign: p.targetName,
          action: p.action,
          from: p.before,
          to: p.payload,
          status: p.status,
          rationale: p.rationale,
          proposedBy: p.createdBy,
          createdAt: p.createdAt,
          decidedBy: p.decidedBy,
          detail: p.detail,
        })),
      };
    },
  },
  {
    name: "propose_change",
    description:
      "Propose pausing a campaign, resuming it, or changing its daily budget. This does NOT " +
      "change the ad account: it puts the change in front of a person to approve in the portal. " +
      "A change outside the limits is refused outright and says which limit refused it. Always " +
      "give a rationale citing the numbers you based it on, because that is what the person " +
      "approving reads.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: {
          type: "string",
          description: "The campaign's id as returned by list_campaigns.",
        },
        action: {
          type: "string",
          enum: ["pause", "resume", "set_budget"],
          description: "What to do.",
        },
        dailyBudget: {
          type: "number",
          description: "Required for set_budget: the proposed new daily budget.",
        },
        rationale: {
          type: "string",
          description: "Why, citing the figures. Shown to whoever approves it.",
        },
      },
      required: ["campaignId", "action", "rationale"],
    },
    handler: async (args, actor) => {
      const action = String(args.action) as ChangeAction;
      if (!["pause", "resume", "set_budget"].includes(action)) {
        return { accepted: false, reason: "action must be pause, resume or set_budget" };
      }
      if (action === "set_budget" && !(Number(args.dailyBudget) > 0)) {
        return { accepted: false, reason: "set_budget needs a positive dailyBudget" };
      }
      const rationale = String(args.rationale ?? "").trim();
      if (!rationale) {
        return { accepted: false, reason: "a rationale is required" };
      }

      const outcome = await propose({
        campaignId: String(args.campaignId),
        action,
        dailyBudget: action === "set_budget" ? Number(args.dailyBudget) : undefined,
        rationale,
        createdBy: actor,
      });

      if (!outcome.proposal) {
        return {
          accepted: false,
          reason: outcome.detail ?? "Refused by the change policy",
          findings: outcome.findings,
        };
      }

      return {
        accepted: true,
        proposalId: outcome.proposal.id,
        status: "pending",
        awaiting: "approval by a person in the portal, on the Changes screen",
        expiresAt: outcome.proposal.expiresAt,
        warnings: outcome.findings.filter((f) => f.severity === "warn").map((f) => f.message),
      };
    },
  },
  {
    name: "list_recent_actions",
    description:
      "The audit trail: writes this portal attempted against the ad accounts, including the " +
      "ones that failed, with who asked for each.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Most to return. Defaults to 25." } },
    },
    handler: async (args) => {
      const { listActions } = await import("../repo");
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 25)));
      const actions = await listActions(limit);
      const campaigns = await listCampaigns();
      const nameOf = new Map(campaigns.map((c) => [c.id, c.name]));
      return {
        count: actions.length,
        actions: actions.map((a) => ({
          at: a.createdAt,
          action: a.action,
          campaign: nameOf.get(a.targetId) ?? a.targetId,
          result: a.result,
          detail: a.detail,
          actor: a.actor,
        })),
      };
    },
  },
];

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
