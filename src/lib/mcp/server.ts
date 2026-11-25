/**
 * The MCP wire protocol, as much of it as this server needs.
 *
 * MCP over streamable HTTP is JSON-RPC 2.0 in a POST body, and the useful
 * surface is three methods: initialize, tools/list and tools/call. That is
 * small enough to implement directly, which avoids adding a dependency to a
 * Worker bundle — a bundle that has already needed two separate fixes for
 * packages that assumed they were running on Node.
 *
 * Implemented from the specification rather than copied from a client's
 * behaviour, so a client that follows the spec more strictly than the one it
 * was tested against still works.
 */

import { findTool, TOOLS } from "./tools";

/** The specification revision this server implements. */
export const PROTOCOL_VERSION = "2025-06-18";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Codes from the JSON-RPC 2.0 specification.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

/**
 * Handles one JSON-RPC message.
 *
 * Returns null for a notification, which by the specification gets no response
 * at all — answering one is a protocol error, not a harmless extra.
 */
export async function handleMessage(
  message: JsonRpcRequest,
  actor: string,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const isNotification = message.id === undefined;

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return isNotification ? null : fail(id, INVALID_REQUEST, "Not a JSON-RPC 2.0 request");
  }

  const method = message.method;

  // Notifications: acknowledged by doing nothing and returning nothing.
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "shack360-marketing", version: "1.0.0" },
        instructions:
          "Read before you write. account_overview and list_campaigns give the figures; " +
          "get_change_limits says what a change is allowed to be. propose_change does not " +
          "touch the ad account — it puts a change in front of a person to approve in the " +
          "portal. There is no tool that approves anything.",
      });

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case "tools/call": {
      const params = message.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments as Record<string, unknown>) ?? {};
      const tool = findTool(name);

      if (!tool) {
        return fail(id, METHOD_NOT_FOUND, `No such tool: ${name || "(none given)"}`);
      }

      try {
        const result = await tool.handler(args, actor);
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (error) {
        // A tool that throws is reported inside the result, not as a protocol
        // error: the call itself was well formed, and the model should see
        // what went wrong rather than a transport failure.
        return ok(id, {
          content: [{ type: "text", text: `Tool failed: ${(error as Error).message}` }],
          isError: true,
        });
      }
    }

    default:
      return isNotification ? null : fail(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

/**
 * Handles a whole request body, which may be one message or a batch.
 *
 * Returns null when nothing needs sending back — a batch consisting only of
 * notifications, which the specification says to answer with no body.
 */
export async function handleBody(
  body: unknown,
  actor: string,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return fail(null, INVALID_REQUEST, "Empty batch");
    const responses: JsonRpcResponse[] = [];
    for (const message of body) {
      const response = await handleMessage(message as JsonRpcRequest, actor);
      if (response) responses.push(response);
    }
    return responses.length > 0 ? responses : null;
  }

  if (!body || typeof body !== "object") {
    return fail(null, PARSE_ERROR, "Expected a JSON-RPC request object");
  }

  return handleMessage(body as JsonRpcRequest, actor);
}

export { INTERNAL_ERROR, PARSE_ERROR };
