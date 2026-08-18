import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { stateDir } from "../fs/layout.js";
import { loadConfig, type LoadedConfig } from "../kernel/worstcase.js";
import type { SessionBackend } from "../sessions/backend.js";
import { researchTools } from "../sessions/guard.js";

/**
 * T-050 — `detent doctor` (S-5, C-12, X-1, S-3).
 *
 * The checks a run would otherwise discover mid-flight: the pinned backend
 * versions against what is installed, the config against its own load
 * assertion (with the computed worst case reported — the computation is
 * authoritative over any quoted figure), the WebFetch rule forms, and — when
 * a key is present (R-10) — one live smoke session proving telemetry parses
 * end to end.
 */

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly exitCode: 0 | 1;
}

export interface DoctorDeps {
  /** The live backend for the version check + smoke; injectable for tests. */
  readonly backend?: SessionBackend;
  /** R-10: the smoke session runs only when a key (and a cap) is present. */
  readonly env?: NodeJS.ProcessEnv;
  /** The installed SDK version; defaults to reading the package manifest. */
  readonly installedSdkVersion?: () => string;
}

function installedSdk(): string {
  const require = createRequire(import.meta.url);
  const manifest = require("@anthropic-ai/claude-agent-sdk/package.json") as { version: string };
  return manifest.version;
}

/** S-3/PRDR-050: a rule form the backend cannot parse must fail HERE, loudly. */
const WEBFETCH_RULE = /^WebFetch\(domain:[A-Za-z0-9.-]+\)$/;

export async function doctor(root: string, deps: DoctorDeps = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const env = deps.env ?? process.env;

  // ---- config loads; the computed worst case is reported (X-1) -------------
  let loaded: LoadedConfig | null = null;
  const configPath = path.join(stateDir(root), "config.json");
  if (!existsSync(configPath)) {
    checks.push({ name: "config", ok: false, detail: `no config at ${configPath}` });
  } else {
    try {
      loaded = loadConfig(JSON.parse(readFileSync(configPath, "utf8")));
      checks.push({
        name: "config",
        ok: true,
        detail:
          `loads; computed worst case ${loaded.computedWorstCase} sessions/generation, ` +
          `configured net ${loaded.config.budgets.sessions} — the computation is authoritative (X-1)`,
      });
    } catch (err) {
      checks.push({ name: "config", ok: false, detail: (err as Error).message });
    }
  }

  // ---- SDK pin (S-5) -------------------------------------------------------
  if (loaded !== null) {
    const installed = (deps.installedSdkVersion ?? installedSdk)();
    const pinned = loaded.config.pinned.agent_sdk;
    checks.push({
      name: "agent-sdk-pin",
      ok: installed === pinned,
      detail:
        installed === pinned
          ? `pinned ${pinned} == installed ${installed}`
          : `MISMATCH: pinned ${pinned}, installed ${installed} (S-5 — upgrades are PRs gated on the fixture suite)`,
    });

    // ---- CLI pin (S-5), via the backend's own check ------------------------
    if (deps.backend !== undefined) {
      try {
        await deps.backend.checkVersion(loaded.config.pinned.claude_code);
        checks.push({ name: "claude-code-pin", ok: true, detail: `backend reports the pinned ${loaded.config.pinned.claude_code}` });
      } catch (err) {
        checks.push({ name: "claude-code-pin", ok: false, detail: (err as Error).message });
      }
    } else {
      checks.push({ name: "claude-code-pin", ok: true, detail: "no live backend supplied; checked at run time" });
    }
  }

  // ---- WebFetch rule forms (S-3/PRDR-050) ---------------------------------
  // PRDR-062: the domain list has no config home yet; doctor validates the
  // FORM the composer emits, so a malformed domain fails here rather than
  // becoming a silent no-op rule in a session.
  const probeDomains = ["docs.example.com"];
  const malformed = researchTools(probeDomains)
    .filter((t) => t.startsWith("WebFetch("))
    .filter((t) => !WEBFETCH_RULE.test(t));
  checks.push({
    name: "webfetch-rule-form",
    ok: malformed.length === 0,
    detail:
      malformed.length === 0
        ? "domain-scoped rule form matches the pinned syntax; live verification rides the smoke session"
        : `unrecognizable rule form(s): ${malformed.join(", ")} — a silent no-op here is an unenforced network boundary`,
  });

  // ---- live smoke (R-10) ---------------------------------------------------
  if (env["ANTHROPIC_API_KEY"] === undefined || deps.backend === undefined) {
    checks.push({
      name: "smoke-session",
      ok: true,
      detail: "skipped: no ANTHROPIC_API_KEY / live backend (R-10) — the mock suite stays fully green without one",
    });
  } else {
    try {
      const result = await deps.backend.run({
        role: "review",
        ticketId: "doctor-smoke",
        promptPrefix: "== ROLE ==\nYou are a smoke check.",
        promptVariable: 'Reply with the single word "ok". Do not use tools.',
        cwd: root,
        artifactOut: path.join(stateDir(root), "runs", "doctor-smoke", "review.json"),
        allowedTools: [],
        permissionMode: "plan",
        model: "",
        maxTurns: 1,
      });
      checks.push({
        name: "smoke-session",
        ok: result.telemetryParsed,
        detail: result.telemetryParsed
          ? `smoke OK: telemetry parsed end-to-end (cost estimate $${result.costEstimateUsd.toFixed(4)}, ${result.turns} turns)`
          : "smoke session ran but telemetry did not parse (S-4)",
      });
    } catch (err) {
      checks.push({ name: "smoke-session", ok: false, detail: (err as Error).message });
    }
  }

  return { checks, exitCode: checks.every((c) => c.ok) ? 0 : 1 };
}

export function renderDoctor(report: DoctorReport): string {
  const lines = report.checks.map((c) => `  [${c.ok ? "ok" : "FAIL"}] ${c.name}: ${c.detail}`);
  return `detent doctor\n${lines.join("\n")}\n`;
}

export async function main(argv: readonly string[]): Promise<number> {
  const { positionals } = parseArgs({ args: [...argv], allowPositionals: true, options: {} });
  const report = await doctor(positionals[0] ?? process.cwd());
  process.stdout.write(renderDoctor(report));
  return report.exitCode;
}
