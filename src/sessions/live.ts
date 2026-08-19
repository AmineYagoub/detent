import { execFile } from "node:child_process";
import { readBindings } from "../adapter/drift.js";
import { CEILINGS } from "../schemas/budgets.js";
import { ClaudeCodeBackend } from "./sdk.js";

/**
 * T-140 — the live backend, constructed for a run (S-1…S-6, D-21).
 *
 * One builder shared by `detent run --backend claude` and the N-7 self-build
 * harness, so the verb and the release gate exercise the same wiring. The
 * construction-time policy is only the FALLBACK — every worker session
 * carries its per-ticket policy on its spec (S-2′), which the backend
 * prefers — and the Stop-gate accelerant runs the project's bound test
 * command with the X-1 gate timeout. The referee re-runs the authoritative
 * gate regardless (P2).
 *
 * Until this module, `detent run` refused every non-mock backend with a
 * stale "lands at T-046" message — the v2 live exits never ran, so the lie
 * never surfaced. Found and closed by T-140's preparation.
 */

export function buildLiveBackend(root: string): ClaudeCodeBackend {
  const gateCmd = readBindings(root).bindings.find((b) => b.slot === "test")?.resolved ?? null;
  return new ClaudeCodeBackend({
    policy: { surface: ["**"], protectedGlobs: [".detent/tickets/**", ".detent/plan/**"], workRoot: root },
    gateCmd,
    runScopedGate: (command) => runGate(command, root),
  });
}

function runGate(command: string, cwd: string): Promise<{ green: boolean; outputTail: string }> {
  return new Promise((resolve) => {
    execFile(
      "sh",
      ["-c", command],
      { cwd, timeout: CEILINGS.gate_timeout_ms.default, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ green: error === null, outputTail: `${stdout}${stderr}`.slice(-1500) });
      },
    );
  });
}
