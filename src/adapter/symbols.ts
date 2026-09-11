import { execFileSync } from "node:child_process";

/**
 * S-3′ (PRDR-121) — symbol intelligence as an optional adapter.
 *
 * A ticket can declare that it provides `v1.TerminalStates` (A-1‴), and
 * nothing can check whether it did. A session changing a symbol has no way to
 * ask who depends on it — which is the mechanism behind an implementation
 * quietly destroying what an earlier ticket built.
 *
 * Serena (MIT, LSP-backed, 40+ languages) answers both through MCP. Three
 * constraints shape how it is allowed in, and all three were found before a
 * line of this file existed:
 *
 * 1. Its EDITING tools write from inside the MCP server process, so they never
 *    pass through the `Write`/`Edit` calls the D-21 hook inspects. Granting one
 *    would silently void per-ticket write containment (S-2′, SEC-3). Read tools
 *    only — `assertNoEditingTools` is the enforcement, and a test is the proof.
 * 2. Its cross-session memory must stay off. Detent's sessions are memoryless
 *    by design: artifacts are the interface (P2), prefixes are byte-identical
 *    (S-6), replay is content-addressed (C-8). A hidden per-project memory
 *    would make two identical runs diverge.
 * 3. It is the operator's tooling, not Detent's (D-4, F-2). A global install
 *    with read access to a private codebase is a decision its owner makes.
 *    Detent DISCOVERS it and never installs it — there is no install path in
 *    this file, and `symbolsSetupMessage` exists to name the command a human
 *    runs rather than to run it.
 */

/** The only tools ever granted. Read-only, by construction. */
export const SYMBOL_READ_TOOLS: readonly string[] = [
  "find_symbol",
  "find_referencing_symbols",
  "find_implementations",
  "get_symbols_overview",
];

/**
 * The tools that must never be granted. They edit through the server process,
 * out of reach of the containment hook. Named explicitly so the prohibition is
 * testable rather than a comment nobody re-reads.
 */
export const SYMBOL_EDITING_TOOLS: readonly string[] = [
  "replace_symbol_body",
  "insert_after_symbol",
  "insert_before_symbol",
  "safe_delete",
  "rename",
  "move",
  "inline",
  "propagate_deletions",
  "execute_shell_command",
  "create_text_file",
];

export interface SymbolsConfig {
  /** Undefined until a person decides: absent is "not asked yet", `false` is "no". */
  readonly enabled?: boolean | undefined;
  readonly command: string;
  readonly pinned: string;
}

export type SymbolsStatus =
  | { readonly kind: "off" }
  | { readonly kind: "ready"; readonly command: string }
  | { readonly kind: "missing"; readonly command: string; readonly reason: string };

/** MCP tool names as a session allowlist spells them. */
export function symbolToolNames(server = "serena"): string[] {
  return SYMBOL_READ_TOOLS.map((t) => `mcp__${server}__${t}`);
}

/**
 * SEC-3: refuses at construction rather than trusting the caller. An editing
 * tool reaching an allowlist is a containment hole, not a configuration
 * preference, so there is no flag that permits it.
 */
export function assertNoEditingTools(tools: readonly string[]): void {
  const banned = tools.filter((t) => SYMBOL_EDITING_TOOLS.some((e) => t === e || t.endsWith(`__${e}`)));
  if (banned.length > 0) {
    throw new Error(
      `symbol intelligence: ${banned.join(", ")} write from inside the MCP server and would bypass the D-21 containment hook — read tools only (SEC-3)`,
    );
  }
}

/**
 * Is it there and does it run? A command that exists but cannot answer is
 * treated as absent with the reason recorded — the discipline V-1 already
 * applies to a verification candidate that will not execute.
 */
export function probeSymbols(
  config: SymbolsConfig | undefined,
  run: (command: string) => void = defaultProbe,
): SymbolsStatus {
  if (config === undefined || !config.enabled) return { kind: "off" };
  try {
    run(config.command);
    return { kind: "ready", command: config.command };
  } catch (err) {
    return { kind: "missing", command: config.command, reason: (err as Error).message.split("\n")[0] ?? "not runnable" };
  }
}

/**
 * PRDR-198: `--help`, not `--version`.
 *
 * `serena --version` exits 2 — the CLI has no such option — so this reported a
 * correctly installed tool as missing and handed the operator an instruction to
 * install what they had just installed. `--help` exits 0 and answers the only
 * question the probe asks: is it there and does it run.
 */
function defaultProbe(command: string): void {
  execFileSync(command, ["--help"], { stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
}

/**
 * The MCP server a session is given.
 *
 * Every flag here is upstream's and was verified against Serena's own
 * configuration documentation rather than assumed — an earlier version of this
 * function passed `--context ide-assistant` (not a valid context) and
 * `--enable-memory false` (not a flag at all), so the memory this comment
 * claims to disable would have stayed on and the test asserting otherwise
 * proved nothing.
 *
 * `--mode no-memories` is the real mechanism: it disables the memory tools and
 * everything built on them.
 *
 * PRDR-198: every value below was read out of the installed tool, and the
 * commands that read it are named so the next person can re-run them rather
 * than trust this sentence. The previous version claimed the same verification
 * and had four values the tool does not have.
 *
 * `serena context list` -> agent, chatgpt, codex, context.template,
 * desktop-app, ide-assistant. `--context claude-code` was not among them and
 * the binary refused it outright: "Context claude-code not found".
 * `ide-assistant` is the right one on its own description — "Non-symbolic
 * editing tools and general shell tool are excluded... file operations, basic
 * edits and reads, and shell commands are handled by your own, internal tools"
 * — which is exactly the duplication a session driven by the Agent SDK must
 * avoid. It was previously recorded here AS the mistake; it was the answer.
 *
 * `serena mode list` -> editing, interactive, no-onboarding, onboarding,
 * one-shot, planning. `no-memories` was not among them; `no-onboarding` is the
 * nearest valid value and its intent is right.
 *
 * MEMORY IS NOT SUPPRESSED, and this is measured rather than assumed. Two runs
 * were compared, with and against without `--mode no-onboarding`, and the tool
 * surface is IDENTICAL: `write_memory`, `read_memory`, `list_memories`,
 * `delete_memory`, `onboarding` and `check_onboarding_performed` are exposed
 * either way. Serena logs `SerenaAgentMode[name='no-onboarding'] excluded 2
 * tools` and the MCP surface still carries them. `start-mcp-server` has no
 * memory flag at all — `--project --project-file --context --mode --transport
 * --host --port --enable-web-dashboard --enable-gui-log-window --log-level
 * --trace-lsp-communication --tool-timeout`.
 *
 * So the sentence this file used to carry — that C-8 replay and S-6 prefixes
 * are protected because the server does not remember — is false, and was false
 * before PRDR-198 and after the first draft of its fix. If that guarantee is
 * required it needs a mechanism Detent controls, not a flag.
 *
 * PRDR-220: the dashboard and the GUI log window are turned OFF per launch.
 * Serena's machine config (`~/.serena/serena_config.yml`) ships with
 * `web_dashboard: true` and `web_dashboard_open_on_launch: true`, so a server
 * launched without saying otherwise opened a browser tab on the operator's
 * machine for every session that had one. Both override flags are in the
 * inventory above and in the pinned tool's `--help`; the test reads them from
 * the tool where it is installed. D-4 holds: nothing under `~/.serena` is
 * edited — the launch declines a window it never wanted.
 */
export const SYMBOL_SERVER_ARGS: readonly string[] = [
  "start-mcp-server",
  "--context",
  "ide-assistant",
  "--mode",
  "no-onboarding",
  "--enable-web-dashboard",
  "false",
  "--enable-gui-log-window",
  "false",
];


export function symbolServerConfig(config: SymbolsConfig, root: string): Record<string, unknown> {
  return {
    serena: {
      command: config.command,
      args: [...SYMBOL_SERVER_ARGS, "--project", root],
    },
  };
}

/**
 * C-6: what a human runs. Detent prints this and stops; it does not execute it.
 * The version is pinned because an MCP server reading a private repository is
 * supply chain, and "latest" is not a thing Detent should recommend.
 */
export function symbolsSetupMessage(config: SymbolsConfig, reason: string): string {
  return [
    `Symbol intelligence is enabled in .detent/config.json but \`${config.command}\` could not be run: ${reason}.`,
    "",
    "Detent does not install tooling — it binds to what the machine has (D-4).",
    `Install it yourself, pinned:   uv tool install -p 3.13 serena-agent==${config.pinned}`,
    'Or turn it off:                "symbols": { "enabled": false }  in .detent/config.json',
  ].join("\n");
}
