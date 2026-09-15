/**
 * One HTTP client for every connector, so rate limiting, retries and error
 * reporting behave the same no matter which network we are talking to.
 */

export class ConnectorError extends Error {
  readonly status: number;
  readonly body: string;
  /** True when re-authenticating is the fix, so the UI can prompt for it. */
  readonly needsReauth: boolean;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ConnectorError";
    this.status = status;
    this.body = body;
    this.needsReauth = status === 401 || status === 403;
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
        const error = new ConnectorError(
          `${method} ${new URL(target).host} responded ${response.status}`,
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
