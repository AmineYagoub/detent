import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { stateDir, writeArtifact } from "../fs/layout.js";

/**
 * T-140 — `init` writes the project config (R-9, X-1, S-5).
 *
 * X-1 is explicit: `run_spend_usd` has no defensible universal default, so
 * config load refuses a budgets object that omits it and `init` must write
 * one the USER chose — the `--spend-cap-usd` argument is that choice, an
 * input like `--replan`, not a sixth decision (C-5 stays closed). Everything
 * else config carries starts at its documented default: the X-1 ceilings via
 * schema defaults, the F-1 protected set, no risk globs, no model routing.
 *
 * The v2 line shipped without this writer because its live exits (T-051,
 * T-070) never ran — the fixture wrote config by hand. The N-7 self-build
 * cannot: a PRD-only folder must reach a loadable config through `init`
 * alone.
 */

export const DEFAULT_PROTECTED = ["tickets/**", ".detent/tickets/**", "AGENTS.md", "CLAUDE.md"] as const;

/** S-5: the agent-sdk pin mirrors package.json's exact dependency. */
export const PINNED_AGENT_SDK = "0.3.191";

/**
 * S-5's backend pin is "the version this project initialized against":
 * recorded from the installed CLI at init time, checked by doctor thereafter.
 * An unreadable CLI records "unknown", which doctor then flags — honest, not
 * silent.
 */
export function installedClaudeVersion(): string {
  try {
    const raw = execFileSync("claude", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return raw.trim().split(/\s+/)[0] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function configFilePath(root: string): string {
  return path.join(stateDir(root), "config.json");
}

export type EnsureConfigResult = "exists" | "written" | "missing-cap";

/** Idempotent: an existing config is the project's own and is never rewritten. */
export function ensureConfig(root: string, spendCapUsd?: number): EnsureConfigResult {
  if (existsSync(configFilePath(root))) return "exists";
  if (spendCapUsd === undefined) return "missing-cap";
  mkdirSync(stateDir(root), { recursive: true });
  writeArtifact(root, "config.json", {
    budgets: { run_spend_usd: spendCapUsd },
    protected: [...DEFAULT_PROTECTED],
    risk: [],
    model_routing: {},
    pinned: { agent_sdk: PINNED_AGENT_SDK, claude_code: installedClaudeVersion() },
  });
  return "written";
}
