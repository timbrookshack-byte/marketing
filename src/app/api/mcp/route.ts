import { NextResponse } from "next/server";

import { handleBody, PROTOCOL_VERSION } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

/**
 * The MCP endpoint.
 *
 * Authentication is Cloudflare Access's, not this route's. Access sits in
 * front of the whole Worker and a request only arrives here having satisfied a
 * policy, so there is no second password to get wrong, no token to store in
 * this database, and nothing to rotate in two places. A client authenticates
 * with an Access service token.
 *
 * What this route does with identity is record it. Access names the caller in
 * the request headers, and that name is what ends up on the proposal and in
 * the audit trail, so "who proposed this" has an answer that the proposer did
 * not supply themselves.
 */
function actorFrom(request: Request): string {
  // A person signed in through a browser.
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (email) return `mcp:${email.trim().toLowerCase()}`;

  // A machine using a service token. The client id is not a secret — it is the
  // public half of the pair — so it is safe to store and show.
  const clientId = request.headers.get("Cf-Access-Client-Id");
  if (clientId) {
    const short = clientId.split(".")[0]?.slice(0, 12) ?? clientId.slice(0, 12);
    return `mcp:token ${short}`;
  }

  // No Access in front: local development, or a deployment that is not
  // protected. Named plainly rather than given a borrowed identity, so a
  // proposal from an unprotected deployment is obvious in the audit trail.
  return "mcp:unauthenticated";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const response = await handleBody(body, actorFrom(request));

  // A body of only notifications gets no response, which is 202 with no
  // content rather than an empty 200 with a JSON content type.
  if (response === null) return new Response(null, { status: 202 });

  return NextResponse.json(response);
}

/**
 * A plain description of the endpoint.
 *
 * Streamable HTTP uses GET for the server-to-client event stream, which this
 * server does not offer: every tool here answers immediately and nothing is
 * pushed. Saying so in a readable form is more use than the 405 a client would
 * otherwise get while someone is trying to work out whether the URL is right.
 */
export async function GET() {
  return NextResponse.json({
    name: "shack360-marketing",
    protocolVersion: PROTOCOL_VERSION,
    transport: "streamable-http (POST only; no server-initiated stream)",
    authentication: "Cloudflare Access — service token or signed-in session",
    note: "POST JSON-RPC 2.0 to this URL. This endpoint proposes changes; it cannot approve them.",
  });
}
