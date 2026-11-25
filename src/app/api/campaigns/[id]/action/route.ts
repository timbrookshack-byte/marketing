import { NextResponse } from "next/server";

import { approve, propose } from "@/lib/control/proposals";
import type { ChangeAction } from "@/lib/control/policy";

export const dynamic = "force-dynamic";

/**
 * Write-back to a live ad account, from the portal.
 *
 * This used to talk to the connector directly and apply whatever it was given.
 * It now goes through the same proposal path as everything else: the change is
 * recorded, judged against the policy, and applied — the difference from an
 * assistant's proposal being that a person clicking this button is already the
 * approval, so it is approved in the same request.
 *
 * Routing it this way rather than keeping a shortcut means the caps apply to
 * an operator too, and the audit trail has one shape regardless of who asked.
 * A cap that only binds the assistant is not a cap on the account.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as { action?: string; dailyBudget?: number };

  const action = body.action;
  if (action !== "pause" && action !== "resume" && action !== "set_budget") {
    return NextResponse.json(
      { error: "action must be 'pause', 'resume' or 'set_budget'" },
      { status: 400 },
    );
  }
  if (action === "set_budget" && !(Number(body.dailyBudget) > 0)) {
    return NextResponse.json({ error: "dailyBudget must be a positive number" }, { status: 400 });
  }

  const proposed = await propose({
    campaignId: id,
    action: action as ChangeAction,
    dailyBudget: action === "set_budget" ? Number(body.dailyBudget) : undefined,
    createdBy: "portal",
  });

  if (!proposed.proposal) {
    // 422 rather than 400: the request was well formed, the policy refused it.
    return NextResponse.json(
      { error: proposed.detail ?? "That change is not allowed", findings: proposed.findings },
      { status: 422 },
    );
  }

  const result = await approve(proposed.proposal.id, "portal");

  if (!result.ok) {
    const status = result.proposal?.result === "recorded" ? 200 : 502;
    return NextResponse.json(
      { ok: false, detail: result.detail, proposalId: proposed.proposal.id },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    detail: result.detail,
    proposalId: proposed.proposal.id,
    warnings: proposed.findings.filter((f) => f.severity === "warn").map((f) => f.message),
  });
}
