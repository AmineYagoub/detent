import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SYMBOL_EDITING_TOOLS,
  SYMBOL_READ_TOOLS,
  SYMBOL_CONTEXT_YAML,
  writeSymbolContext,
  symbolContextPath,
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
    expect(SYMBOL_READ_TOOLS).toEqual(["find_symbol", "find_referencing_symbols", "get_symbols_overview"]);
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

  /**
   * PRDR-198: this case was called "disables the server's own memory with
   * upstream's real mechanism" and asserted `--mode no-memories`. Serena has no
   * such mode, so the server could never start — and the test passed anyway,
   * because every value here lives in ANOTHER PROGRAM and asserting our own
   * copy of it proves only that we wrote it down.
   *
   * Its predecessor made the same mistake with `--enable-memory false`, and the
   * comment recording that lesson sat directly above the next instance of it.
   * The title now claims only what the assertion can carry.
   */
  it("passes the context, mode and project Serena accepts — values read from the tool, not chosen", () => {
    const server = symbolServerConfig(CONFIG, "/repo") as { serena: { args: string[] } };
    const args = server.serena.args;
    expect(args[0]).toBe("start-mcp-server");
    /**
     * `serena context list` -> agent, chatgpt, codex, context.template,
     * desktop-app, ide-assistant. `ide-assistant` excludes `create_text_file`,
     * `read_file`, `execute_shell_command`, `prepare_for_new_conversation` and
     * `replace_regex` — the duplication a session driven by the Agent SDK must
     * avoid. Verified live: the server reaches "lifetime setup complete".
     */
    /* PRDR-223: the context is Detent's own file, whose exclusions Serena applied live ("Number of exposed tools: 3"). */
    expect(args[args.indexOf("--context") + 1]).toBe(symbolContextPath("/repo"));
    /** `serena mode list` -> editing, interactive, no-onboarding, onboarding, one-shot, planning. */
    expect(args[args.indexOf("--mode") + 1]).toBe("no-onboarding");
    expect(args[args.indexOf("--project") + 1]).toBe("/repo");
    /**
     * And NOT a memory claim. Two live runs, with and without the mode, produce
     * an identical tool surface carrying `write_memory`, `read_memory`,
     * `list_memories`, `delete_memory`, `onboarding` and
     * `check_onboarding_performed`. `start-mcp-server` has no memory flag, so
     * no argument this function can pass suppresses it. Asserting the absence
     * of such a claim is the only honest thing this test can say about memory.
     */
    expect(args).not.toContain("no-memories");
    expect(args.some((a) => a.includes("memory"))).toBe(false);
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

/**
 * PRDR-220 — a server that opens a window.
 *
 * Serena's machine config decides whether its web dashboard starts and whether
 * it opens a browser window at launch, and the shipped defaults say yes to
 * both. Detent's launch never said otherwise, so every session with symbols on
 * opened a tab on the operator's machine. The two override flags are in the
 * pinned tool's `--help`, listed in PRDR-198's own inventory; here they are
 * required, and read from the tool where the tool is installed.
 */
describe("PRDR-220 the symbol server opens nothing on the operator's machine", () => {
  it("the launch turns the web dashboard and the GUI log window off, explicitly", () => {
    const server = symbolServerConfig(CONFIG, "/repo") as { serena: { args: string[] } };
    const args = server.serena.args;
    expect(args[args.indexOf("--enable-web-dashboard") + 1]).toBe("false");
    expect(args[args.indexOf("--enable-gui-log-window") + 1]).toBe("false");
    /* And the project still comes last, after the flags the tool reads before it. */
    expect(args[args.indexOf("--project") + 1]).toBe("/repo");
  });

  it("both flags are the pinned tool's own — read from `start-mcp-server --help` where it is installed", () => {
    const help = spawnSync("serena", ["start-mcp-server", "--help"], { encoding: "utf8" });
    if (help.error !== undefined || help.status !== 0) return;
    expect(help.stdout).toContain("--enable-web-dashboard");
    expect(help.stdout).toContain("--enable-gui-log-window");
  });
});

/**
 * PRDR-221 — a server nobody was introduced to.
 *
 * The platform defers MCP tools behind tool search by default, so Serena's
 * eighteen tools reached a session only as names in a `deferred_tools_delta`
 * — callable after a `ToolSearch`, never before — and across 113 gate-313
 * sessions there were zero searches and zero calls. The SDK's per-server
 * `alwaysLoad` keeps a server's tools on the turn-one tool list.
 */
describe("PRDR-221 the symbol server's tools are on the tool list, not behind tool search", () => {
  it("the server config asks the SDK never to defer this server's tools", () => {
    const server = symbolServerConfig(CONFIG, "/repo") as { serena: { alwaysLoad?: boolean } };
    expect(server.serena.alwaysLoad).toBe(true);
  });
});

/**
 * PRDR-223 — a surface that says one thing and shows another.
 *
 * Twenty-one of the twenty-four tools on the server's list are ones Detent
 * refuses, and Serena's own description of `check_onboarding_performed` says
 * to call it first — which every gate-313 session did, refused, PRDR-222's
 * sentence or not. Serena's `--context` accepts a path to a custom context
 * whose `excluded_tools` removes tools from the MCP surface itself, so the
 * server now shows exactly what the allowlist admits. And `find_implementations`
 * is not a tool the pinned Serena has: the read set is three.
 */
describe("PRDR-223 the symbol server exposes exactly what is granted", () => {
  it("the read set is the three tools the pinned Serena has — no phantom", () => {
    expect([...SYMBOL_READ_TOOLS]).toEqual(["find_symbol", "find_referencing_symbols", "get_symbols_overview"]);
  });

  it("the launch passes Detent's own context file, written under the root's local state", () => {
    const root = mkdtempSync(path.join(tmpdir(), "detent-symbols-"));
    try {
      const file = writeSymbolContext(root);
      expect(file).toBe(path.join(root, ".detent", "state", "serena-context.yml"));
      const server = symbolServerConfig(CONFIG, root) as { serena: { args: string[] } };
      expect(server.serena.args[server.serena.args.indexOf("--context") + 1]).toBe(file);
      const yaml = readFileSync(file, "utf8");
      for (const tool of SYMBOL_READ_TOOLS) expect(yaml, `${tool} must stay exposed`).not.toMatch(new RegExp(`^\\s*- ${tool}$`, "m"));
      for (const tool of ["check_onboarding_performed", "list_dir", "write_memory", "replace_symbol_body", "read_file", "think_about_task_adherence"]) {
        expect(yaml, `${tool} must be excluded`).toMatch(new RegExp(`^\\s*- ${tool}$`, "m"));
      }
      expect(yaml).toContain("excluded_tools:");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the excluded inventory is the pinned tool's own — read from `serena tools list` where it is installed", () => {
    const listed = spawnSync("serena", ["tools", "list"], { encoding: "utf8" });
    if (listed.error !== undefined || listed.status !== 0) return;
    const names = [...listed.stdout.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? "").filter((n) => n !== "");
    for (const tool of SYMBOL_READ_TOOLS) expect(names, `${tool} exists in the pinned Serena`).toContain(tool);
    expect(names).not.toContain("find_implementations");
    const excluded = names.filter((n) => !SYMBOL_READ_TOOLS.includes(n));
    const yaml = SYMBOL_CONTEXT_YAML;
    for (const tool of excluded) expect(yaml, `${tool} is a Serena tool Detent must exclude`).toMatch(new RegExp(`^\\s*- ${tool}$`, "m"));
  });
});
