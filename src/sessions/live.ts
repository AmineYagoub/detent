import { ensureDependencies } from "../adapter/install.js";
import { discover } from "../adapter/discover/index.js";
import { gateEnv } from "../adapter/normalize.js";
import { NO_SIBLINGS, notRunNoteFor, npmGateScripts, readApprovals, siblingsOf, withSiblings, type GateBinding } from "../adapter/lifecycle.js";
import { ROOT_PACKAGE } from "../adapter/packages.js";
import { runGate as runCommand, type GateResult } from "../adapter/run.js";
import { execFileSync } from "node:child_process";
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

/**
 * S-5 (PRDR-254): the OTHER half of S-5's sentence — and why nothing refuses.
 *
 * S-5 pins two things. `PIN_CHECK_SITES` above answers for the CLI pin, which
 * refuses on all four paths that can spend. The SDK pin refuses on none, and a
 * reader who arrives here asking which pins are enforced where deserves that
 * answer rather than silence — PRDR-253's sweep read the silence as the gap
 * PRDR-251 had closed three fields over, and filed it.
 *
 * The two pins guard different threats and only one is the operator's to get
 * wrong. `claude_code` names a binary on their PATH, upgraded whenever they
 * like with nothing vetting it against Detent — the unvetted-backend case S-5's
 * "upgrades are PRs gated on the cross-ecosystem fixture suite" exists to
 * refuse. `agent_sdk` cannot move unless Detent moves, and Detent cannot ship
 * without `docs/release-checklist.md` item 5 putting the new SDK through the
 * N-7 self-build first. The vetting S-5 demands already happened, upstream, in
 * the release that shipped it; a project config re-litigating it adds nothing.
 *
 * Gating it anyway was considered and rejected: `ensureConfig` never rewrites
 * an existing config, so the first Detent upgrade would refuse every `run`,
 * `init` and `referee` in every project initialised before it until a human
 * edited each `.detent/config.json` — and the escape hatch, Detent updating the
 * pin to match itself, is a pin in name only.
 *
 * So the map is roles, not checkers. `tests/oracle/pin-parity.test.ts` holds it
 * total over the modules that mention the pin in code, so a new reader fails
 * until it declares itself. That a reporter does not REFUSE is behaviour a role
 * string cannot check; `tests/cli/doctor.test.ts` holds that half.
 */
export const AGENT_SDK_PIN_SITES = {
  "cli/doctor": "reporter",
  "init/config": "writer",
  "kernel/worstcase": "schema",
} as const;

export function buildLiveBackend(root: string): ClaudeCodeBackend {
  /**
   * V-5′ (PRDR-295): the root package's own `test`, since the stop gate runs
   * where the session works, the tree's root. A package's gates are the
   * referee's to run, in the package's directory, after the session ends.
   */
  const binding = readBindings(root).bindings.find((b) => b.package === "." && b.slot === "test");
  const gateCmd = binding?.resolved ?? null;
  return new ClaudeCodeBackend({
    /** PRDR-149: the same structural floor the per-session policies carry. */
    policy: { surface: ["**"], protectedGlobs: [...STRUCTURAL_PROTECTED], workRoot: root },
    gateCmd,
    /**
     * PRDR-211: the scoped gate runs where the session works — its worktree
     * since B-2″, which this used to ignore: on gate-313 it ran `npm test` in a
     * root with no `package.json`, and the session read the ENOENT as proof the
     * gate runner had npm.
     */
    runScopedGate: async (command, cwd = root) => await scopedGate(command, cwd, { root, binding: binding ?? null }),
  });
}

export interface ScopedGateOptions {
  /** The project's root, whose `.detent` holds the lifecycle approvals (V-1⁷). */
  readonly root: string;
  /** The root package's bound gate, whose approved `pre` and `post` run around it. */
  readonly binding?: GateBinding | null;
  readonly timeoutMs?: number;
}

/** The Stop hook's block reason keeps the last 1,500 characters of this tail (`stopGate`). */
const TAIL = 1500;

/**
 * The Stop hook's scoped gate (S-2's accelerant): what the manifest declares is
 * installed (V-1⁗), then the bound command runs. A failed install here is
 * advisory; the referee's own gate run records it.
 *
 * Both run through the adapter's gate runner, under the run's gate
 * environment, with X-1's gate timeout, as every other gate does (V-1⁶).
 * PRDR-332: the gate ran `sh -c` through `execFile` with Detent's own
 * environment, so `npm run test` ran the `pretest` and `posttest` the session
 * had written, as Detent's own child. And `execFile`'s timeout killed the
 * shell alone, so a test runner's workers held the pipes open; the adapter's
 * runner kills the whole process group.
 *
 * V-1⁷ (PRDR-233): the approved scripts run where npm would have run them, and
 * a red gate's tail ends by naming the declared scripts Detent did not run.
 */
export async function scopedGate(command: string, cwd: string, opts: ScopedGateOptions): Promise<{ readonly green: boolean; readonly outputTail: string }> {
  const timeoutMs = opts.timeoutMs ?? CEILINGS.gate_timeout_ms.default;
  const env = gateEnv(opts.root);
  const run = (c: string): Promise<GateResult> => runCommand({ command: c, cwd, timeoutMs, env });
  const approvals = readApprovals(opts.root);
  /* PRDR-232: never an npm install in a project that chose another manager. */
  const pm = discover(cwd).stack.pm;
  await ensureDependencies(cwd, run, undefined, pm, { approvals, package: ROOT_PACKAGE });
  const gate = opts.binding ?? null;
  const result = await withSiblings(gate === null ? NO_SIBLINGS : siblingsOf(cwd, gate, command, approvals), run, () => run(command));
  const note = result.green ? null : notRunNoteFor(cwd, ROOT_PACKAGE, gate === null ? [] : npmGateScripts(ROOT_PACKAGE, [gate]), approvals, pm);
  if (note === null) return { green: result.green, outputTail: result.output.slice(-TAIL) };
  return { green: false, outputTail: `${result.output.slice(-Math.max(0, TAIL - note.length - 1))}\n${note}` };
}
