import { NextResponse } from "next/server";
import { getConnector } from "@/lib/connectors/registry";
import { buildAuthorizeUrl, getOAuthClient } from "@/lib/connectors/oauth";
import { pkcePair, randomToken } from "@/lib/crypto";
import { saveOAuthState } from "@/lib/repo";
import type { PlatformId } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Starts the OAuth handshake.
 *
 * The state value is random, stored server-side and single-use, so a callback
 * that did not originate here is rejected rather than trusted. PKCE verifiers
 * are stored the same way for the platforms that require them.
 */
export async function GET(_request: Request, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;

  let connector;
  try {
    connector = getConnector(platform as PlatformId);
  } catch {
    return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 404 });
  }

  if (!connector.oauth) {
    return NextResponse.json(
      { error: `${connector.displayName} does not use OAuth — add its API key to the environment instead.` },
      { status: 400 },
    );
  }

  const client = getOAuthClient(connector.platform);
  if (!client) {
    const prefix = connector.platform.toUpperCase();
    return NextResponse.json(
      {
        error:
          `${connector.displayName} is not configured on this server. ` +
          `Set ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET, then try again.`,
      },
      { status: 400 },
    );
  }

  const state = randomToken();
  const pkce = connector.oauth.usePkce ? pkcePair() : null;

  saveOAuthState({
    state,
    platform: connector.platform,
    codeVerifier: pkce?.verifier ?? null,
    redirectTo: "/connections",
  });

  const url = buildAuthorizeUrl(connector.platform, connector.oauth, client, state, pkce?.challenge);
  return NextResponse.redirect(url);
}
