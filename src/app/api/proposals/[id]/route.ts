import { NextResponse } from "next/server";

import { approve, reject } from "@/lib/control/proposals";

export const dynamic = "force-dynamic";

/**
 * Deciding a proposal.
 *
 * The decider's name is taken from the signed-in identity rather than the
 * request body, so the audit trail records who actually clicked rather than
 * whatever the caller claimed. Cloudflare Access puts the verified email in
 * Cf-Access-Authenticated-User-Email; running without Access in front there is
 * no identity to record, and the row says so instead of inventing one.
 */
function decider(request: Request): string {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  return email ? email.trim().toLowerCase() : "portal (unauthenticated)";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { decision?: string };

  const by = decider(request);

  if (body.decision === "reject") {
    const proposal = await reject(id, by);
    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    return NextResponse.json({ ok: true, status: proposal.status });
  }

  if (body.decision !== "approve") {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }

  const result = await approve(id, by);

  if (!result.proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, detail: result.detail, status: result.proposal.status, findings: result.findings },
      // The request was fine; the policy or the platform refused it.
      { status: 422 },
    );
  }

  return NextResponse.json({ ok: true, detail: result.detail, status: result.proposal.status });
}
