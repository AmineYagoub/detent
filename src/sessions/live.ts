import { ensureDependencies } from "../adapter/install.js";
import { discover } from "../adapter/discover/index.js";
import { CI_ENV } from "../adapter/normalize.js";
import { runGate as runCommand } from "../adapter/run.js";
import { execFile, execFileSync } from "node:child_process";
import { STRUCTURAL_PROTECTED } from "../schemas/common.js";
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

/**
 * T-140 — is a live backend reachable? The v2 line assumed the API key was
 * the only transport; the platform grew two more, and the SDK's bundled
 * runtime honors all three (proven by execution on a Max-plan machine with
 * no key at all): `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` (from
 * `claude setup-token` — the subscription CI path), and the claude CLI's own
 * login. `DETENT_NO_LIVE=1` forces "no" — the seam that keeps the harness's
 * dry run spend-free even on a logged-in machine. R-10's GATE (consent plus
 * a cap) is unchanged; only the auth transport broadened.
 */
export function hasLiveBackendAuth(
  env: NodeJS.ProcessEnv = process.env,
  probe: () => boolean = cliLoggedIn,
): boolean {
  if (env["DETENT_NO_LIVE"] === "1") return false;
  if (env["ANTHROPIC_API_KEY"] !== undefined || env["CLAUDE_CODE_OAUTH_TOKEN"] !== undefined) return true;
  return probe();
}

/** The three transports a refusal should name, in one place. */
export const LIVE_AUTH_HINT =
  "provide one of: a logged-in claude CLI (subscription — run `claude` and `/login`), " +
  "CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`, for CI), or ANTHROPIC_API_KEY.";

function cliLoggedIn(): boolean {
  try {
    const raw = execFileSync("claude", ["auth", "status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    return raw.includes('"loggedIn": true');
  } catch {
    return false;
  }
}

/**
 * S-5 (PRDR-251): every entrypoint that can obtain a live backend, and the
 * module that checks the pin for it.
 *
 * Modelled on `ENFORCEMENT_SITES` (X-1), for the same reason: PRDR-181 stated
 * the rule in a doc-block — "the pinned CLI version is CHECKED, on the path
 * that runs" — and satisfied it on one of three spending paths. Prose cannot
 * carry a claim about which modules do a thing; a map the oracle checks for
 * totality can. A new verb that builds a live backend fails
 * `tests/oracle/pin-parity.test.ts` until it appears here.
 *
 * `cli/run` is the one row whose checker is a different module: it hands the
 * backend to the headless driver, and `kernel/run.ts` holds the refusal for
 * both. Stated rather than special-cased, so the exception is readable.
 */
export const PIN_CHECK_SITES = {
  "cli/doctor": "cli/doctor",
  "cli/init": "cli/init",
  "cli/referee": "cli/referee",
  "cli/run": "kernel/run",
} as const;

export function buildLiveBackend(root: string): ClaudeCodeBackend {
  const gateCmd = readBindings(root).bindings.find((b) => b.slot === "test")?.resolved ?? null;
  return new ClaudeCodeBackend({
    /** PRDR-149: the same structural floor the per-session policies carry. */
    policy: { surface: ["**"], protectedGlobs: [...STRUCTURAL_PROTECTED], workRoot: root },
    gateCmd,
    /**
     * PRDR-211: the scoped gate runs where the session works — its worktree
     * since B-2″, which this used to ignore: on gate-313 it ran `npm test` in a
     * root with no `package.json`, and the session read the ENOENT as proof the
     * gate runner had npm. And it runs only after what the manifest declares is
     * installed there (V-1⁗); a failed install here is advisory, the referee's
     * own gate run records it.
     */
    runScopedGate: async (command, cwd = root) => {
      await ensureDependencies(
        cwd,
        (install) => runCommand({ command: install, cwd, timeoutMs: CEILINGS.gate_timeout_ms.default, env: CI_ENV }),
        undefined,
        /* PRDR-232: never an npm install in a project that chose another manager. */
        discover(cwd).stack.pm,
      );
      return runGate(command, cwd);
    },
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
