import { existsSync, readFileSync } from "node:fs";
import { STRUCTURAL_PROTECTED } from "../schemas/common.js";
import { approvalState } from "../init/machine.js";
import { readPresentation } from "../init/present.js";
import path from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { stateDir } from "../fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../kernel/git.js";
import { RunJournal } from "../kernel/journal.js";
import { RefereeCore } from "../kernel/referee.js";
import { loadConfig } from "../kernel/worstcase.js";
import { buildServer } from "../referee/server.js";
import type { SessionBackend } from "../sessions/backend.js";
import { MockBackend } from "../sessions/mock.js";
import { loadPromptSet } from "../sessions/prompts.js";
import { ClaudeCodeBackend } from "../sessions/sdk.js";
import { acquireRunLock, lockPhaseSuffix, runLockRefusal } from "../kernel/run-lock.js";
import { readBindings } from "../adapter/drift.js";

/**
 * The referee's composition root: `detent referee --root <path>` serves the
 * R-1 tool set over MCP stdio. The plugin's `.mcp.json` points here (MP1);
 * the T-106 transport-parity fixture spawns it with `--backend mock`.
 *
 * Wiring only — every decision the served tools make lives in the registry
 * and the core, shared verbatim with the in-process driver (ARCH-2).
 */

export interface RefereeMainDeps {
  readonly buildBackend?: (root: string, protectedGlobs: readonly string[]) => SessionBackend;
}

/**
 * X-1 (PRDR-251): the live-backend builder is a seam, on PRDR-174's terms —
 * the reason `run` and `doctor` have one, and the reason the S-5 refusal above
 * could not be tested while this was an inline literal.
 */
function defaultBackend(root: string, protectedGlobs: readonly string[]): SessionBackend {
  /** PRDR-149: config globs PLUS the structural floor — this fallback had neither `.git` nor the floor. */
  return new ClaudeCodeBackend({
    policy: { surface: ["**"], protectedGlobs: [...protectedGlobs, ...STRUCTURAL_PROTECTED], workRoot: root },
  });
}

export async function main(argv: readonly string[], mainDeps: RefereeMainDeps = {}): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      root: { type: "string" },
      backend: { type: "string", default: "claude" },
      worker: { type: "string" },
      /** B-2″ (PRDR-153): the same posture the headless verb takes. */
      "no-worktree": { type: "boolean", default: false },
    },
  });
  const root = values.root ?? process.cwd();

  const configPath = path.join(stateDir(root), "config.json");
  if (!existsSync(configPath)) {
    process.stderr.write(`no config at ${configPath} — run \`detent init\` first\n`);
    return 2;
  }
  const loaded = loadConfig(JSON.parse(readFileSync(configPath, "utf8")));

  /**
   * C-9′ / B-2″ (PRDR-153): the MCP path is the interface the plugin actually
   * drives, and it had NEITHER guard — no approval check anywhere in the path,
   * and no `worktree`, so `RefereeContext` defaulted it to false and the
   * model-driven driver ran an unapproved plan in the operator's own checkout.
   * X-1⁗ moved the wall clock to the launch seam precisely so a ceiling would
   * not live on one driver only; these two were left on one driver in the same
   * change.
   */
  const approved = approvalState(root);
  if (!approved.approved) {
    /**
     * C-7 (PRDR-255): the PRESENTATION half of the second exit, on this driver.
     *
     * ARCH-2 makes a precondition on one driver a precondition on both, and the
     * doc-block above is this file's own record of that rule being broken. So
     * the refusal carries the same rendering `detent run` replays: the human in
     * chat sees the plan they are being asked about, which is C-7's first verb.
     *
     * It does NOT offer the decision, and that asymmetry is deliberate rather
     * than overlooked. C-7's second verb needs a prompt, and this driver must
     * not grow one — `tests/docs/golden-path.test.ts` sanctions the prompting
     * primitives in exactly three modules on the grounds that a fourth would be
     * "a sixth interrupt class in disguise", and this file is not among them. The
     * parity-faithful decision channel is a plan-level kind on the R-1 `record`
     * tool that both drivers reach through, which is a change to the tool
     * surface and takes its own ticket (N-6). Until then the model relays the
     * answer through `init`'s T-131 flags, and C-7 is whole on one driver and
     * half-built on this one — stated here rather than left to be discovered.
     */
    const shown = readPresentation(root);
    if (shown !== null) process.stderr.write(`${shown.presentation}\n\n`);
    process.stderr.write("no approved plan — run `detent init` and approve it first (C-9)\n");
    return 2;
  }
  if (approved.stale) {
    process.stderr.write(
      "the approval in .detent/plan/approval.json is for a different plan — the tickets have changed since it was given. " +
        "Re-approve with `detent init` (C-9)\n",
    );
    return 2;
  }

  /**
   * V-1″ (PRDR-181): no bound `test` gate is a refusal BEFORE anything spends.
   *
   * `kernel/run.ts` checks this at startup, "before spending rather than at the
   * first gate — where it used to mint a GREEN". The plugin referee began
   * serving without it, so the model driver claimed a ticket and launched a
   * billed implement session before anyone discovered the project had no gate
   * to judge it with. ARCH-2: a precondition on one driver is a precondition on
   * both.
   */
  try {
    if (!readBindings(root).bindings.some((b) => b.slot === "test")) {
      process.stderr.write(
        "no bound `test` gate — a ticket cannot be verified, and P2 counts only exit codes. " +
          "Run `detent init`, or `detent verify sync` if the command moved (V-1″)\n",
      );
      return 2;
    }
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const backend: SessionBackend =
    values.backend === "mock"
      ? new MockBackend()
      : (mainDeps.buildBackend ?? defaultBackend)(root, loaded.config.protected);

  /**
   * S-5 (PRDR-251): the pinned CLI version is checked on THIS driver too.
   *
   * PRDR-181 added three preconditions to this path — approval, a bound `test`
   * gate, the run lock — each under the rule it states above: "a precondition
   * on one driver is a precondition on both" (ARCH-2). The SAME ticket added
   * the S-5 pin check, and added it to `kernel/run.ts` only. So the doc-block
   * there reads "the pinned CLI version is CHECKED, on the path that runs"
   * while the model-driven driver — a path that runs, and the one the plugin
   * actually drives — verified nothing.
   *
   * Before the lock, with the other preconditions, so a refusal touches
   * nothing. `MockBackend.checkVersion` resolves, so `--backend mock` is
   * unaffected.
   */
  try {
    await backend.checkVersion(loaded.config.pinned.claude_code);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  /**
   * X-1‴ (PRDR-181): one referee per root, on the terms `run` already uses.
   *
   * `acquireRunLock` was wired to `kernel/run.ts` and then to `cli/init.ts`,
   * and not here — so two plugin referees could serve one root, each enforcing
   * `run_spend_usd` against its own view and jointly spending past it, which is
   * the exact shape PRDR-147 exists to refuse. Taken after the preconditions
   * above so a refusal touches nothing, and released when the server closes.
   */
  const lock = acquireRunLock(root);
  if (!lock.ok) {
    process.stderr.write(`${runLockRefusal(lock.heldBy)}\n`);
    return 2;
  }
  if (lock.brokeStale !== null) {
    process.stderr.write(
      `broke a stale run lock left by pid ${lock.brokeStale.pid} on this host${lockPhaseSuffix(lock.brokeStale)} (X-1‴)\n`,
    );
  }


  const journal = RunJournal.open(root);
  const runBranch = ensureRunBranch(root, `referee-${process.pid}`);
  installTrailerHook(root);
  const core = new RefereeCore(
    {
      root,
      backend,
      prompts: loadPromptSet(),
      ...(values.worker !== undefined ? { worker: values.worker } : {}),
      worktree: values["no-worktree"] !== true,
    },
    loaded,
    journal,
    runBranch,
  );

  const server = buildServer(core);
  const transport = new StdioServerTransport();
  /* The lock is NOT released on a normal close: the journal-close handler below replaces this
     `onclose` rather than chaining it, so `lock.release()` runs on no exit path. A stale lock is
     broken on the next run by `runLockBreakable` (dead pid, same host), which is why this has read
     as working. The claim this comment used to make — released on every exit path — was false from
     the line that overwrote it. */
  transport.onclose = (): void => {
    lock.release();
  };
  await server.connect(transport);
  /* Serve until the client closes stdin; the journal lock rides the process. */
  await new Promise<void>((resolve) => {
    transport.onclose = () => {
      journal.close();
      resolve();
    };
  });
  return 0;
}

/** Executed as an entry point (the plugin's .mcp.json spawns this file directly). */
const invoked = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invoked) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    });
}
