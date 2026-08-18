import { afterEach, describe, expect, it } from "vitest";
import {
  NOT_FOUND_EXIT,
  TIMEOUT_EXIT,
  evidence,
  looksLikeWatchMode,
  runGate,
  runnable,
} from "../../src/adapter/run.js";
import { classify } from "../../src/kernel/classify.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * T-020 — gate runner (V-4).
 *
 * Two of these are oracle ports: `test_gate_executes_and_flags_unrunnable` and
 * `test_gate_accepts_runnable_failing_command` (test_contract.py). The Python
 * reference asserted both through `Contract.validate_gate`, which raised on
 * `rc == 127 or rc is None`; here that predicate is `runnable()` and the
 * raising belongs to T-026, which is the layer that decides whether a candidate
 * may be approved. The property being ported is the runner's, not the caller's.
 */

const trees: string[] = [];
const tree = (files?: Record<string, string>): string => {
  const root = tmpTree(files);
  trees.push(root);
  return root;
};
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
});

describe("T-020 exit normalization matrix (V-4)", () => {
  it("a clean exit is green and normalizes to 0", async () => {
    const r = await runGate({ command: "exit 0", cwd: tree() });
    expect(r.green).toBe(true);
    expect(r.outcome).toBe("exited");
    expect(r.normalizedExit).toBe(0);
  });

  it.each([1, 2, 42])("exit %i is red, runnable, and normalizes to itself", async (code) => {
    const r = await runGate({ command: `exit ${code}`, cwd: tree() });
    expect(r.green).toBe(false);
    expect(runnable(r)).toBe(true);
    expect(r.exitCode).toBe(code);
    expect(r.normalizedExit).toBe(code);
  });

  it("oracle test_gate_executes_and_flags_unrunnable: a missing command is not runnable", async () => {
    const r = await runGate({ command: "definitely_not_a_command_xyz --version", cwd: tree() });
    expect(runnable(r)).toBe(false);
    expect(r.outcome).toBe("not-found");
    expect(r.normalizedExit).toBe(NOT_FOUND_EXIT);
  });

  it("oracle test_gate_accepts_runnable_failing_command: exit 1 runs, so it is a usable binding", async () => {
    const r = await runGate({ command: "sh -c 'exit 1'", cwd: tree() });
    expect(runnable(r)).toBe(true);
    expect(r.green).toBe(false);
    expect(r.exitCode).toBe(1);
  });

  it("a signalled death normalizes to 128+n rather than to null", async () => {
    const r = await runGate({ command: "kill -TERM $$", cwd: tree() });
    expect(r.exitCode).toBeNull();
    expect(r.signal).toBe("SIGTERM");
    expect(r.normalizedExit).toBe(143);
  });

  it("an unusable cwd is reported as not-found, never as a crash", async () => {
    const root = tree();
    const r = await runGate({ command: "exit 0", cwd: `${root}/does-not-exist` });
    expect(r.outcome).toBe("not-found");
    expect(runnable(r)).toBe(false);
  });
});

describe("T-020 timeout (V-1 watch-mode substrate)", () => {
  it("a command that never exits is killed, and the result is classifiable", async () => {
    const r = await runGate({ command: "sleep 30", cwd: tree(), timeoutMs: 250, killGraceMs: 250 });
    expect(r.outcome).toBe("timed-out");
    expect(looksLikeWatchMode(r)).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(r.normalizedExit).toBe(TIMEOUT_EXIT);
    /** X-5 reads exitCode === null as environmental until a rerun proves otherwise. */
    expect(classify(r.output, r.exitCode).patternClass).toBe("flake-pattern");
    expect(classify(r.output, r.exitCode).suspectedFlake).toBe(true);
  });

  it("the whole process group dies, not just the shell", async () => {
    /**
     * The shell exits immediately; the grandchild would hold the pipes open and
     * outlive the timeout if only the shell were killed.
     */
    const r = await runGate({
      command: "sleep 30 & wait",
      cwd: tree(),
      timeoutMs: 250,
      killGraceMs: 250,
    });
    expect(r.outcome).toBe("timed-out");
    expect(r.durationMs).toBeLessThan(5_000);
  });
});

describe("T-020 bounded capture", () => {
  it("keeps the tail and reports what it dropped", async () => {
    const r = await runGate({
      command: `node -e "process.stdout.write('x'.repeat(200000)); process.stdout.write('TAIL-MARKER')"`,
      cwd: tree(),
      tailBytes: 1024,
    });
    expect(r.outputBytes).toBe(200_011);
    expect(r.truncated).toBe(true);
    expect(r.output.length).toBeLessThanOrEqual(1024);
    expect(r.output.endsWith("TAIL-MARKER")).toBe(true);
  });

  it("captures stderr as well as stdout", async () => {
    const r = await runGate({ command: "echo out; echo err 1>&2", cwd: tree() });
    expect(r.output).toContain("out");
    expect(r.output).toContain("err");
    expect(r.truncated).toBe(false);
  });

  it("does not truncate output that fits", async () => {
    const r = await runGate({ command: "echo hello", cwd: tree(), tailBytes: 1024 });
    expect(r.output).toBe("hello\n");
    expect(r.outputBytes).toBe(6);
  });
});

describe("T-020 invocation surface", () => {
  it("runs in the given cwd and merges env over the parent's", async () => {
    const root = tree({ "marker.txt": "here\n" });
    const r = await runGate({ command: "ls marker.txt; echo $DETENT_TEST_VAR", cwd: root, env: { DETENT_TEST_VAR: "1" } });
    expect(r.green).toBe(true);
    expect(r.output).toContain("marker.txt");
    expect(r.output).toContain("1");
    /** PATH survives, so the caller supplies additions rather than a whole env. */
    const p = await runGate({ command: "test -n \"$PATH\"", cwd: root, env: { DETENT_TEST_VAR: "1" } });
    expect(p.green).toBe(true);
  });

  it("evidence names the slot, the exit and the outcome", async () => {
    const r = await runGate({ command: "exit 3", cwd: tree(), slot: "lint" });
    expect(evidence(r)).toBe("lint:exit=3:outcome=exited");
  });
});
