import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SYMBOL_EDITING_TOOLS,
  SYMBOL_READ_TOOLS,
  assertNoEditingTools,
  probeSymbols,
  symbolServerConfig,
  symbolToolNames,
  symbolsSetupMessage,
} from "../../src/adapter/symbols.js";
import { buildOptions } from "../../src/sessions/sdk.js";
import { symbolReminder } from "../../src/init/symbol-reminder.js";

/**
 * S-3′ / S-3″ (PRDR-121) — the adapter's safety properties.
 *
 * Two of these are the reason the ticket exists at all: an editing tool would
 * write from inside the MCP server, out of the D-21 hook's sight, and a
 * cross-session memory would make two identical runs diverge. Neither is a
 * preference, so neither has a flag — and both are asserted here rather than
 * left to a comment nobody re-reads.
 */

const CONFIG = { enabled: true, command: "serena-agent", pinned: "0.1.4" };

describe("S-3′ symbol intelligence cannot become a containment hole", () => {
  it("grants read tools only, and every editing tool is named so the prohibition is testable", () => {
    expect(SYMBOL_READ_TOOLS).toEqual(["find_symbol", "find_referencing_symbols", "find_implementations", "get_symbols_overview"]);
    for (const read of SYMBOL_READ_TOOLS) expect(SYMBOL_EDITING_TOOLS).not.toContain(read);
    /** The ones that would bypass the hook are enumerated, not merely absent. */
    for (const banned of ["replace_symbol_body", "insert_after_symbol", "safe_delete", "rename", "execute_shell_command"]) {
      expect(SYMBOL_EDITING_TOOLS).toContain(banned);
    }
  });

  it("refuses an allowlist containing an editing tool, however it is spelled", () => {
    expect(() => assertNoEditingTools(symbolToolNames())).not.toThrow();
    expect(() => assertNoEditingTools(["mcp__serena__replace_symbol_body"])).toThrow(/bypass the D-21 containment hook/);
    expect(() => assertNoEditingTools(["safe_delete"])).toThrow(/SEC-3/);
  });

  it("disables the server's own memory, because a remembering session breaks replay", () => {
    const server = symbolServerConfig(CONFIG, "/repo") as { serena: { args: string[] } };
    const args = server.serena.args;
    expect(args).toContain("--enable-memory");
    expect(args[args.indexOf("--enable-memory") + 1]).toBe("false");
    expect(args).toContain("/repo");
  });

  it("reaches the session as an MCP server whose tools are exactly the read set", () => {
    const spec = {
      role: "implement" as const,
      ticketId: "t-1",
      promptPrefix: "p",
      promptVariable: "v",
      cwd: "/repo",
      artifactOut: "/repo/.detent/out.json",
      allowedTools: ["Read", ...symbolToolNames()],
      permissionMode: "" as const,
      model: "",
      mcpServers: symbolServerConfig(CONFIG, "/repo"),
    };
    const options = buildOptions(spec, { policy: { surface: ["**"], protectedGlobs: [], workRoot: "/repo" } });
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["serena"]);
    expect(options.allowedTools).toContain("mcp__serena__find_referencing_symbols");
    expect(options.allowedTools?.some((t) => SYMBOL_EDITING_TOOLS.some((e) => t.endsWith(e)))).toBe(false);
  });

  it("Detent never installs it: absent means a message naming the pinned command, and no install anywhere", () => {
    expect(probeSymbols(undefined)).toEqual({ kind: "off" });
    expect(probeSymbols({ ...CONFIG, enabled: false })).toEqual({ kind: "off" });
    const missing = probeSymbols(CONFIG, () => {
      throw new Error("spawn serena-agent ENOENT");
    });
    expect(missing.kind).toBe("missing");
    const message = symbolsSetupMessage(CONFIG, "not found");
    expect(message).toContain("uv tool install -p 3.13 serena-agent==0.1.4");
    expect(message).toContain("Detent does not install tooling");

    /** The prohibition is structural: no source file may execute an install. */
    const source = ["src/adapter/symbols.ts", "src/init/symbol-reminder.ts"]
      .map((f) => readFileSync(path.join(process.cwd(), f), "utf8"))
      .join("\n");
    expect(/execFileSync\([^)]*install/.test(source), "no code path may install the tool").toBe(false);
    expect(probeSymbols(CONFIG, () => undefined)).toEqual({ kind: "ready", command: "serena-agent" });
  });
});

describe("S-3″ the reminder is earned, and silenceable", () => {
  const evidence = [
    { tag: "coherence" as const, ticket: "t-s01-016", finding: "contradicts `v1.TerminalStates` which t-s01-002 fixes" },
    { tag: "dependency" as const, ticket: "t-s01-027", finding: "wires the pipeline from `pkg.Deps` built elsewhere" },
  ];

  it("says nothing when nothing in the run suggests it would have helped", () => {
    expect(symbolReminder(undefined, [])).toBeNull();
    expect(symbolReminder(undefined, [{ tag: "sizing", ticket: "t-1", finding: "too large for one session" }])).toBeNull();
  });

  it("names the actual tickets it would have caught, and how to switch it off", () => {
    const message = symbolReminder(undefined, evidence) ?? "";
    expect(message).toContain("2 finding(s)");
    expect(message).toContain("t-s01-016 → v1.TerminalStates");
    expect(message).toContain("t-s01-027 → pkg.Deps");
    expect(message).toContain('"symbols": { "enabled": false }');
  });

  it("a user who declined once is never asked again, and one who enabled it is not pitched to", () => {
    expect(symbolReminder({ ...CONFIG, enabled: false }, evidence)).toBeNull();
    expect(symbolReminder(CONFIG, evidence)).toBeNull();
  });
});
