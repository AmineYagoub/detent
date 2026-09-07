import { execFileSync } from "node:child_process";
import { readBindings } from "../adapter/drift.js";
import { CI_ENV, needsBaseRef, substituteBase } from "../adapter/normalize.js";
import { runGate, runnable } from "../adapter/run.js";
import { changedFiles, git } from "./git.js";

/**
 * V-6 (PRDR-150) — was this test sensitive to the change it shipped with?
 *
 * Three of the 7 September audit's critical blockers had a PASSING test
 * asserting the property they violated: SEC-4 asserted against a function
 * production never called, the git-hooks evasion passed because the test's own
 * policy carried the glob the product lacked, and the symbol reminder was only
 * ever tested with an input production cannot produce. The remediation then
 * repeated it — the SEC-5′ test passed because its fixture was already CI-safe,
 * so the mismatch it should have caught was a no-op inside it.
 *
 * All four are one mechanical property: a test that would pass WITHOUT the
 * change it accompanies. Revert the source half of the diff, re-run the tests,
 * and the ones that stay green have told you nothing.
 *
 * Deliberately EVIDENCE and never a gate (the A-1⁗ precedent). A test can stay
 * green for honest reasons — it guards against over-correction rather than
 * reproducing a defect, or the revert did not reach the behaviour it exercises.
 * A reviewer weighs that in a sentence; a red build cannot.
 */

/**
 * Which changed paths are tests.
 *
 * A path heuristic, not a parse. It is wrong in the harmless direction: a test
 * file this misses simply means no probe runs, never a false accusation.
 */
export function isTestPath(rel: string): boolean {
  const posix = rel.split("\\").join("/");
  if (/(^|\/)(tests?|__tests__|spec|specs)\//.test(posix)) return true;
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(posix) || /_test\.(go|py|rb)$/.test(posix) || /(^|\/)test_[^/]+\.py$/.test(posix);
}

export interface FalsifyProbe {
  /** Paths whose tests survived their own source change being reverted. */
  readonly unfalsified: readonly string[];
  /** Why no verdict was reached, when there is none. */
  readonly skipped: string | null;
}

export interface FalsifyDeps {
  readonly workDir: string;
  /** The ticket's claim base — what the diff is measured against. */
  readonly base: string | null;
  /** Runs the bound test gate in `workDir`; true when it passed. */
  readonly runTests: () => Promise<boolean>;
}

const NOTHING: FalsifyProbe = { unfalsified: [], skipped: null };

/**
 * Revert the source half, run the tests, restore. The restore is in a
 * `finally` and the revert uses `git apply -R`, which refuses cleanly rather
 * than half-applying — so the failure mode is "no probe", not "a broken tree".
 * Should a restore ever be missed, B-5's `resetDirtyTracked` on the next claim
 * returns tracked files to HEAD.
 */
export async function falsificationProbe(deps: FalsifyDeps): Promise<FalsifyProbe> {
  const { workDir, base } = deps;
  if (base === null) return { unfalsified: [], skipped: "no claim base to measure the diff against" };

  const changed = changedFiles(workDir, base);
  const tests = changed.filter(isTestPath);
  const source = changed.filter((f) => !isTestPath(f));
  /* Nothing to falsify: a diff with no tests, or with no source for them to depend on. */
  if (tests.length === 0 || source.length === 0) return NOTHING;

  const patch = git(workDir, "diff", base, "--", ...source);
  if (patch.trim() === "") return NOTHING;

  let reverted = false;
  try {
    try {
      applyPatch(workDir, patch, ["--reverse"]);
      reverted = true;
    } catch {
      /*
       * A patch that will not reverse cleanly is not a finding about the tests
       * — it is a probe that could not run. Say so rather than guess.
       */
      return { unfalsified: [], skipped: "the source half of the diff could not be reverted cleanly" };
    }
    const stillGreen = await deps.runTests();
    return { unfalsified: stillGreen ? tests : [], skipped: null };
  } finally {
    if (reverted) {
      try {
        applyPatch(workDir, patch, []);
      } catch {
        /* Restore failed: B-5's dirty-tracked reset on the next claim is the backstop. */
      }
    }
  }
}

function applyPatch(cwd: string, patch: string, flags: readonly string[]): void {
  execFileSync("git", ["apply", ...flags, "-"], {
    cwd,
    input: patch,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** What the review is told, when there is anything to tell it. */
export function falsifyEvidence(probe: FalsifyProbe): Record<string, unknown> {
  if (probe.unfalsified.length === 0) return {};
  return {
    unfalsified_tests: [...probe.unfalsified],
    falsification_instruction:
      "Detent reverted this ticket's SOURCE changes, left its test changes in place, and re-ran the tests — and they " +
      "still passed. A test that passes without the change it ships with is not evidence that the change works. " +
      "Treat it as evidence, not proof: a test can honestly stay green because it guards against over-correction " +
      "rather than reproducing a defect, or because the revert did not reach the behaviour it exercises. Judge " +
      "whether these tests actually exercise what the ticket changed.",
  };
}

/**
 * The bound TEST gate, reduced to "did it pass".
 *
 * `test_single` is preferred where the project bound one — the probe asks a
 * narrow question and the flake filter already established that seam. An
 * unbound or unrunnable gate answers `false`, which `falsificationProbe` reads
 * as "the tests did not pass without the source", i.e. no finding: this must
 * never manufacture an accusation out of a missing binding.
 */
export function boundTestRunner(root: string, baseRef: string, timeoutMs: number): (workDir: string) => Promise<boolean> {
  return async (workDir: string): Promise<boolean> => {
    const bindings = readBindings(root).bindings;
    const binding = bindings.find((b) => b.slot === "test_single") ?? bindings.find((b) => b.slot === "test");
    if (binding === undefined) return false;
    const command = needsBaseRef(binding.resolved) ? substituteBase(binding.resolved, baseRef) : binding.resolved;
    const result = await runGate({ command, cwd: workDir, slot: binding.slot, timeoutMs, env: CI_ENV });
    return runnable(result) && result.green;
  };
}
