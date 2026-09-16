/**
 * One HTTP client for every connector, so rate limiting, retries and error
 * reporting behave the same no matter which network we are talking to.
 */

/**
 * Pulls the human-readable reason out of an error body.
 *
 * Platforms answer failures with a status and a body that says what actually
 * went wrong — Google names the exact error code, Meta explains the permission.
 * Reporting only "responded 403" throws that away and leaves the operator
 * guessing at the one thing the API was willing to tell them.
 *
 * HTML error pages are skipped: they bury the message under a stylesheet.
 */
export function describeErrorBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (/^<|<html|<!doctype/i.test(trimmed)) return "";

  try {
    const decoded = JSON.parse(trimmed) as unknown;

    // searchStream answers with an array of chunks, and reports a failure as an
    // array too. Unwrapping only objects is how a real error arrives as a bare
    // status with nothing after it.
    const parsed = (Array.isArray(decoded)
      ? decoded.find((entry) => entry && typeof entry === "object" && "error" in entry) ?? decoded[0]
      : decoded) as Record<string, unknown> | undefined;

    if (!parsed || typeof parsed !== "object") return "";

    // Google: { error: { message, status, details: [{ errors: [{ errorCode, message }] }] } }
    const googleError = parsed.error as
      | {
          message?: string;
          status?: string;
          details?: { errors?: { message?: string; errorCode?: Record<string, string> }[] }[];
        }
      | string
      | undefined;

    if (googleError && typeof googleError === "object") {
      const specific = googleError.details
        ?.flatMap((detail) => detail.errors ?? [])
        .map((entry) => {
          const code = entry.errorCode ? Object.values(entry.errorCode)[0] : undefined;
          return [code, entry.message].filter(Boolean).join(": ");
        })
        .filter(Boolean);

      if (specific?.length) return specific.join(" | ");
      if (googleError.message) {
        return googleError.status ? `${googleError.status}: ${googleError.message}` : googleError.message;
      }
    }

    // Meta and most OAuth servers: a flat message or error_description.
    if (typeof googleError === "string") return googleError;
    const flat =
      (parsed.error_description as string) ??
      (parsed.message as string) ??
      (parsed.error_message as string);
    if (flat) return flat;
  } catch {
    // Not JSON. A short plain-text body is still worth passing on.
    if (trimmed.length <= 200) return trimmed;
  }

  return "";
}

/**
 * Whether reconnecting would actually fix this.
 *
 * 401 means the platform does not know who is calling: the token is missing,
 * expired or revoked, and a fresh handshake fixes it. 403 is the opposite — it
 * knows exactly who is calling and is refusing them. Reconnecting the same
 * account changes nothing, and telling someone to do it sends them round a loop
 * that cannot terminate while the real problem (an account they cannot see, an
 * API tier they have not been granted) goes unnamed.
 *
 * The exception is platforms that answer an expired token with 403 anyway, so a
 * 403 that names an authentication failure is still treated as one.
 */
function reconnectWouldHelp(status: number, body: string): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  return /UNAUTHENTICATED|invalid_grant|invalid_token|token (has )?expired|expired token/i.test(body);
}

export class ConnectorError extends Error {
  readonly status: number;
  readonly body: string;
  /** True when re-authenticating is the fix, so the UI can prompt for it. */
  readonly needsReauth: boolean;

  constructor(message: string, status: number, body: string) {
    const detail = describeErrorBody(body);
    super(detail ? `${message} — ${detail}` : message);
    this.name = "ConnectorError";
    this.status = status;
    this.body = body;
    this.needsReauth = reconnectWouldHelp(status, body);
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Send the body as form-encoded rather than JSON — token endpoints want this. */
  form?: Record<string, string>;
  /** Total attempts including the first. */
  retries?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function buildUrl(url: string, query?: RequestOptions["query"]): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) u.searchParams.set(key, String(value));
  }
  return u.toString();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries on 429 and 5xx with exponential backoff, honouring Retry-After when
 * the platform sends it. 4xx other than 429 fails immediately — retrying a bad
 * request just burns quota.
 */
export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    headers = {},
    query,
    body,
    form,
    retries = 3,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const target = buildUrl(url, query);
  let lastError: ConnectorError | null = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const init: RequestInit = { method, signal: controller.signal, headers: { ...headers } };

      if (form) {
        (init.headers as Record<string, string>)["content-type"] =
          "application/x-www-form-urlencoded";
        init.body = new URLSearchParams(form).toString();
      } else if (body !== undefined) {
        (init.headers as Record<string, string>)["content-type"] = "application/json";
        init.body = JSON.stringify(body);
      }

      const response = await fetch(target, init);
      const text = await response.text();

      if (!response.ok) {
        // Path, not the full URL: query strings carry access tokens on some
        // platforms, and an error message ends up in logs and on screen.
        const { host, pathname } = new URL(target);
        const error = new ConnectorError(
          `${method} ${host}${pathname} responded ${response.status}`,
          response.status,
          text.slice(0, 2000),
        );
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === retries - 1) throw error;

        const retryAfter = Number(response.headers.get("retry-after"));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 2 ** attempt * 1000;
        lastError = error;
        await sleep(backoff);
        continue;
      }

      return (text ? JSON.parse(text) : null) as T;
    } catch (error) {
      if (error instanceof ConnectorError) {
        if (!(error.status === 429 || error.status >= 500) || attempt === retries - 1) throw error;
        lastError = error;
        continue;
      }
      // Network-level failure (DNS, TLS, abort): retry, then surface as a 0.
      if (attempt === retries - 1) {
        throw new ConnectorError(
          `Request to ${new URL(target).host} failed: ${(error as Error).message}`,
          0,
          "",
        );
      }
      await sleep(2 ** attempt * 1000);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new ConnectorError("Request failed", 0, "");
}

export function bearer(token: string | undefined): Record<string, string> {
  if (!token) throw new ConnectorError("Missing access token", 401, "");
  return { authorization: `Bearer ${token}` };
}

/**
 * Runs a connector call and retries it once after refreshing the token, so an
 * expired access token is handled without bothering the user.
 */
export async function withTokenRefresh<T>(
  run: () => Promise<T>,
  refresh: () => Promise<unknown>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ConnectorError && error.status === 401) {
      await refresh();
      return run();
    }
    throw error;
  }
}
