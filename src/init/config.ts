import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { probeSymbols, type SymbolsConfig, type SymbolsStatus } from "../adapter/symbols.js";
import { stateDir, writeArtifact } from "../fs/layout.js";
import { loadConfig } from "../kernel/worstcase.js";
import { CEILINGS } from "../schemas/budgets.js";
import { DEFAULT_MODEL_ROUTING } from "../schemas/roles.js";

/**
 * T-140 — `init` writes the project config (R-9, X-1, S-5).
 *
 * X-1 is explicit: `run_spend_usd` has no defensible universal default, so
 * config load refuses a budgets object that omits it and `init` must write
 * one the USER chose — the `--spend-cap-usd` argument is that choice, an
 * input like `--replan`, not a sixth decision (C-5 stays closed). Everything
 * else config carries starts at its documented default: the X-1 ceilings via
 * schema defaults, the F-1 protected set, no risk globs, and PRDR-114's model
 * routing — judgement roles on the stronger models, volume roles on Sonnet.
 *
 * The v2 line shipped without this writer because its live exits (T-051,
 * T-070) never ran — the fixture wrote config by hand. The N-7 self-build
 * cannot: a PRD-only folder must reach a loadable config through `init`
 * alone.
 */

const DEFAULT_PROTECTED = ["tickets/**", ".detent/tickets/**", "AGENTS.md", "CLAUDE.md"] as const;

/** S-5: the agent-sdk pin mirrors package.json's exact dependency. */
const PINNED_AGENT_SDK = "0.3.258";

/**
 * S-5's backend pin is "the version this project initialized against":
 * recorded from the installed CLI at init time, checked by doctor thereafter.
 * An unreadable CLI records "unknown", which doctor then flags — honest, not
 * silent.
 */
function installedClaudeVersion(): string {
  try {
    const raw = execFileSync("claude", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return raw.trim().split(/\s+/)[0] ?? "unknown";
  } catch {
    return "unknown";
  }
}

function configFilePath(root: string): string {
  return path.join(stateDir(root), "config.json");
}

export type EnsureConfigResult = "exists" | "written" | "written-default";

/** Idempotent: an existing config is the project's own and is never rewritten. */
export function ensureConfig(root: string, spendCapUsd?: number): EnsureConfigResult {
  if (existsSync(configFilePath(root))) return "exists";
  /* X-1′ (PRDR-083): an unstated ceiling defaults and is announced, never demanded. */
  const cap = spendCapUsd ?? CEILINGS.run_spend_usd.default;
  mkdirSync(stateDir(root), { recursive: true });
  writeArtifact(root, "config.json", {
    budgets: { run_spend_usd: cap },
    protected: [...DEFAULT_PROTECTED],
    risk: [],
    model_routing: { ...DEFAULT_MODEL_ROUTING },
    /**
     * PRDR-197: empty, and PRESENT. The default must change nothing, but a knob
     * an operator cannot see in the file they edit is one they do not have.
     */
    effort_routing: {},
    plan_baseline: "production",
    pinned: { agent_sdk: PINNED_AGENT_SDK, claude_code: installedClaudeVersion() },
  });
  return spendCapUsd === undefined ? "written-default" : "written";
}

export type SymbolsDecision = "on" | "off";

/**
 * S-3⁗ (PRDR-208): `--symbols` / `--no-symbols` — a person deciding, carried
 * where a TTY prompt cannot go.
 *
 * S-3″ made `symbols.enabled` tri-state so only a person enables a tool that
 * reads a private codebase (D-4, F-2). The only way to decide was a prompt, and
 * the runs that matter most have none: the self-build gate, CI, a background
 * launch. gate-313 planned and ran with serena installed and undecided, and
 * sent 80 symbol-level couplings to review that code could have checked.
 *
 * "On" is honoured only when the probe finds the tool: `enabled: true` for a
 * command that cannot run would be the silent failure S-3‴ exists to report,
 * so it refuses and names the install instead, writing nothing. "Off" is the
 * decline S-3″ honours absolutely.
 */
export function decideSymbols(
  root: string,
  decision: SymbolsDecision,
  probe: (config: SymbolsConfig) => SymbolsStatus = probeSymbols,
): { readonly ok: true; readonly enabled: boolean; readonly command: string } | { readonly ok: false; readonly message: string } {
  const file = configFilePath(root);
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  /* The schema supplies `command` and `pinned` for a config that never mentioned symbols. */
  const current = loadConfig(raw).config.symbols;
  const symbols: SymbolsConfig = { command: current.command, pinned: current.pinned, enabled: decision === "on" };
  if (decision === "on") {
    const status = probe(symbols);
    if (status.kind !== "ready") {
      const reason = status.kind === "missing" ? status.reason : "not enabled";
      return {
        ok: false,
        message: [
          `--symbols asked for symbol intelligence, but \`${symbols.command}\` could not be run: ${reason}.`,
          "Detent does not install tooling — it binds to what the machine has (D-4).",
          `Install it yourself, pinned:   uv tool install -p 3.13 serena-agent==${symbols.pinned}`,
          "Or pass --no-symbols to record the decline.",
        ].join("\n"),
      };
    }
  }
  writeArtifact(root, "config.json", { ...raw, symbols });
  return { ok: true, enabled: symbols.enabled === true, command: symbols.command };
}
