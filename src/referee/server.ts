import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { RefereeCore } from "../kernel/referee.js";
import { TOOL_DESCRIPTIONS, TOOL_INPUTS, TOOL_NAMES, callTool, isToolError } from "./registry.js";

/**
 * T-100/T-106 — the referee as an MCP server (R-1, ARCH-2).
 *
 * A thin transport over the SAME `callTool` the in-process driver uses: the
 * two paths share one validation, one dispatch, one escrow — so a result that
 * differs between transports is a defect, and the T-106 parity test asserts
 * they do not. Structured tool errors travel as `isError` results with the
 * same JSON body, never as protocol failures; a protocol failure means the
 * referee itself is broken.
 *
 * The plugin's `.mcp.json` names this server; the composition root that
 * constructs the core (root, backend, config, journal) is `src/cli/referee.ts`
 * — this module owns no wiring, so ARCH-2's "referee is driver-agnostic"
 * holds for the transport too.
 */

export function buildServer(core: RefereeCore): Server {
  const server = new Server(
    { name: "detent-referee", version: "3.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOL_NAMES.map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: asObjectSchema(z.toJSONSchema(TOOL_INPUTS[name])),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(core, request.params.name, request.params.arguments ?? {});
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: isToolError(result),
    };
  });

  return server;
}

/**
 * MCP requires every tool's inputSchema to declare `type: "object"` at the
 * top level. zod renders a discriminated union as a bare `anyOf` — every
 * branch IS an object, so stamping the type is accurate, not a loosening.
 */
function asObjectSchema(schema: Record<string, unknown>): { type: "object"; [k: string]: unknown } {
  return { ...schema, type: "object" };
}
