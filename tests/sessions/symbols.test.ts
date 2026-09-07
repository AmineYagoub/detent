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
import { ClaudeCodeBackend } from "../../src/sessions/sdk.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { CEILINGS } from "../../src/schemas/budgets.js";

const BASE_CONFIG = {
  schema_version: 1,
  budgets: Object.fromEntries(Object.entries(CEILINGS).map(([k, v]) => [k, v.default])),
  pinned: { agent_sdk: "0.3.258", claude_code: "2.1.258" },
};

/** Drive the backend over a scripted message stream and report what it concluded about MCP. */
async function captureFailures(messages: unknown[]): Promise<readonly { name: string; status: string }[] | undefined> {
  const backend = new ClaudeCodeBackend({
    policy: { surface: ["**"], protectedGlobs: [], workRoot: "/repo" },
    queryFn: () => (async function* () { for (const m of messages) yield m; })() as never,
  });
  const result = await backend.run({
    role: "implement", ticketId: "t-1", promptPrefix: "p", promptVariable: "v",
    cwd: "/repo", artifactOut: "/repo/out.json", allowedTools: ["Read"], permissionMode: "", model: "",
  });
  return result.mcpFailures;
}
import { contractEvidence, identifierOf, unverifiedProvides } from "../../src/kernel/contract-verify.js";

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

  it("disables the server's own memory with upstream's real mechanism, because a remembering session breaks replay", () => {
    const server = symbolServerConfig(CONFIG, "/repo") as { serena: { args: string[] } };
    const args = server.serena.args;
    /**
     * These are upstream's flags, checked against Serena's configuration docs.
     * A previous version asserted `--enable-memory false`, which is not a flag
     * Serena has — the test passed, the memory would have stayed on, and the
     * property this suite exists to guarantee was never guaranteed.
     */
    expect(args.slice(0, 2)).toEqual(["start-mcp-server", "--context"]);
    expect(args).toContain("--mode");
    expect(args[args.indexOf("--mode") + 1]).toBe("no-memories");
    /** `claude-code` drops the tools that would duplicate the session's built-ins. */
    expect(args[args.indexOf("--context") + 1]).toBe("claude-code");
    expect(args[args.indexOf("--project") + 1]).toBe("/repo");
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

describe("A-1⁗ the declared interface is checked against what the ticket actually changed", () => {
  const ticket = (provides: { kind: "symbol" | "config"; id: string; note: string }[]) =>
    ({ provides, consumes: [] }) as unknown as Parameters<typeof unverifiedProvides>[0];

  it("takes the identifier from the tail of the contract id", () => {
    expect(identifierOf("controlplane/internal/v1.TerminalStates")).toBe("TerminalStates");
    expect(identifierOf("pkg.Deps")).toBe("Deps");
    expect(identifierOf("Bare")).toBe("Bare");
  });

  it("a ticket claiming a symbol its diff never mentions becomes evidence for the review", () => {
    const t = ticket([{ kind: "symbol", id: "controlplane/internal/v1.TerminalStates", note: "failed, stopped" }]);
    const diff = "+++ b/controlplane/internal/v1/state.go\n+func Something() {}\n";
    expect(unverifiedProvides(t, diff)).toEqual(["controlplane/internal/v1.TerminalStates"]);
    const evidence = contractEvidence(t, diff);
    expect(evidence["unverified_provides"]).toEqual(["controlplane/internal/v1.TerminalStates"]);
    expect(String(evidence["contract_instruction"])).toContain("evidence, not proof");
  });

  it("says nothing when the identifier is there, when nothing is declared, or when there is no diff", () => {
    const t = ticket([{ kind: "symbol", id: "v1.TerminalStates", note: "" }]);
    expect(unverifiedProvides(t, "+func TerminalStates() []State {}")).toEqual([]);
    expect(contractEvidence(t, "+func TerminalStates() []State {}")).toEqual({});
    expect(unverifiedProvides(ticket([]), "anything")).toEqual([]);
    /** No diff is no evidence either way — it must never accuse on absence of input. */
    expect(unverifiedProvides(t, "")).toEqual([]);
  });

  it("only `symbol` provides are checked — a config key is not an identifier in the code", () => {
    const t = ticket([{ kind: "config", id: "KSAR_BUILD_TIMEOUT", note: "" }]);
    expect(unverifiedProvides(t, "+nothing here")).toEqual([]);
  });

  it("matches whole identifiers, so a longer name does not satisfy a shorter one", () => {
    const t = ticket([{ kind: "symbol", id: "pkg.Run", note: "" }]);
    expect(unverifiedProvides(t, "+func RunServer() {}")).toEqual(["pkg.Run"]);
    expect(unverifiedProvides(t, "+func Run() {}")).toEqual([]);
  });
});

describe("S-3‴ the command is a name, and a server that never attached says so", () => {
  it("refuses a command that names a path — a repository cannot choose which executable runs", () => {
    const load = (command: string) => loadConfig({ ...BASE_CONFIG, symbols: { enabled: true, command, pinned: "0.1.4" } });
    /**
     * `.detent/config.json` is repository content. Unrestricted, it let a repo
     * point the orchestrator at an executable it shipped and have it run at the
     * operator's privilege, before anything was presented or approved.
     */
    for (const bad of ["./evil.sh", "../evil", "/tmp/evil", "dir/serena", "evil;rm -rf /", ".hidden"]) {
      expect(() => load(bad), `${bad} must not parse`).toThrow();
    }
    for (const good of ["serena-agent", "serena", "serena_agent", "s2"]) {
      expect(load(good).config.symbols.command).toBe(good);
    }
  });

  it("a configured server that did not connect is reported; pending and connected are not failures", async () => {
    const statuses = (mcp: { name: string; status: string }[]) =>
      captureFailures([
        { type: "system", mcp_servers: mcp },
        { type: "result", subtype: "success", total_cost_usd: 0.1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } },
      ]);
    expect(await statuses([{ name: "serena", status: "failed" }])).toEqual([{ name: "serena", status: "failed" }]);
    expect(await statuses([{ name: "serena", status: "needs-auth" }])).toEqual([{ name: "serena", status: "needs-auth" }]);
    expect(await statuses([{ name: "serena", status: "connected" }])).toBeUndefined();
    /** Startup is non-blocking, so pending at init is not yet a failure. */
    expect(await statuses([{ name: "serena", status: "pending" }])).toBeUndefined();
  });

  it("silence is not success: a session that reported no server status claims no failure", async () => {
    const none = await captureFailures([
      { type: "result", subtype: "success", total_cost_usd: 0.1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    expect(none).toBeUndefined();
    /** An unrecognised shape is information we do not have, never a claim either way. */
    const garbage = await captureFailures([
      { type: "system", mcp_servers: "not-an-array" },
      { type: "result", subtype: "success", total_cost_usd: 0.1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    expect(garbage).toBeUndefined();
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

  /**
   * The regression that matters. Every assertion above hands the reminder
   * `undefined`, and the PRODUCTION path never does: `init` writes a config
   * before it reads one, and the schema filled `symbols` in. So the reminder
   * was unreachable in every real project while its tests stayed green —
   * they were only ever exercising the one input production cannot produce.
   *
   * This test therefore goes through `loadConfig`, the way `init` does.
   */
  it("fires for a real project config that has never mentioned symbols — the path init actually takes", () => {
    const { config } = loadConfig({ ...BASE_CONFIG });
    expect(config.symbols?.enabled).toBeUndefined();
    const message = symbolReminder(config.symbols, evidence) ?? "";
    expect(message).toContain("Symbol intelligence is not configured");
    expect(message).toContain("t-s01-016 → v1.TerminalStates");
  });

  it("a config that explicitly declined still silences it, through the same path", () => {
    const { config } = loadConfig({ ...BASE_CONFIG, symbols: { enabled: false } });
    expect(config.symbols?.enabled).toBe(false);
    expect(symbolReminder(config.symbols, evidence)).toBeNull();
  });
});
