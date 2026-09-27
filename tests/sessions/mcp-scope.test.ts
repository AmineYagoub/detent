import { describe, expect, it } from "vitest";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { buildOptions, type SdkBackendConfig } from "../../src/sessions/sdk.js";

/**
 * PRDR-303 — a headless session's MCP servers are the ones Detent passes it.
 *
 * D-22 empties `settingSources`, and a project's `.mcp.json` stays out. The
 * account's claude.ai connectors did not: a session stopped at its init
 * message listed "claude.ai Claude Docs", source `claudeai`, beside the one
 * server it was given, and tabachir's AUDIT survey carried that connector's
 * create, update and delete tools. `strictMcpConfig` is the SDK's option for
 * "the servers passed, and no others".
 */

const CONFIG: SdkBackendConfig = { policy: { surface: ["src/**"], protectedGlobs: [], workRoot: "/wt" } };

const spec = (over: Partial<SessionSpec> = {}): SessionSpec => ({
  role: "audit",
  ticketId: "init",
  promptPrefix: "p",
  promptVariable: "{}",
  cwd: "/wt",
  artifactOut: "/wt/.detent/state/audit-survey.json",
  allowedTools: ["Read", "Grep", "Glob", "WebSearch", "Write(//wt/.detent/state/audit-survey.json)"],
  permissionMode: "",
  model: "",
  ...over,
});

describe("PRDR-303 a headless session's MCP servers are the ones Detent passes it (D-22)", () => {
  it("AC 4: every session is built with strictMcpConfig, beside its empty setting sources", () => {
    const options = buildOptions(spec(), CONFIG);

    expect(options.strictMcpConfig).toBe(true);
    expect(options.settingSources).toEqual([]);
    expect(options.mcpServers, "a session given no server has none to connect").toBeUndefined();
  });

  it("a server Detent passes still reaches the session (S-3⁸)", () => {
    const symbols = { command: "/usr/local/bin/symbols", args: ["--stdio"] };

    const options = buildOptions(spec({ role: "review", mcpServers: { symbols } }), CONFIG);

    expect(options.strictMcpConfig).toBe(true);
    expect(options.mcpServers).toEqual({ symbols });
  });
});
