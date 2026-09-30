import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { guardToolUse, type GuardDecision, type GuardPolicy } from "../../src/sessions/guard.js";
import { STRUCTURAL_PROTECTED } from "../../src/schemas/common.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * PRDR-329: the glob engine under every containment decision (R-6) is past
 * GHSA-c2c7-rcm5-vvqj and GHSA-3v7f-55p6-f55p, and past 4.0.4's dropped branch.
 *
 * Each behaviour runs on both skins of the one decision: `guardToolUse`, which
 * the SDK backend registers in-process, and `hooks/dist/detent-hook.cjs`,
 * spawned as the platform spawns it. The bundle carries its own copy of
 * picomatch, so a fixed `node_modules` alone proves nothing about the hook.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BUNDLE = path.join(ROOT, "hooks", "dist", "detent-hook.cjs");
const identity = (p: string): string => p;

/**
 * GHSA-3v7f-55p6-f55p: `POSIX_REGEX_SOURCE` inherited `Object.prototype`, so
 * `[[:constructor:]]` compiled to `[function Object() { [native code] }]`.
 * The text's own `]` closes the class early: the path is one character from
 * before it and then the ` }]` left over, which is what the surface granted.
 */
const INJECTED = "src/[[:constructor:]]*.ts";
const SPLICED = "src/e }].ts";

/**
 * GHSA-c2c7-rcm5-vvqj: the advisory's nested repeated extglob, and a run of
 * `a`s it cannot match. 4.0.3 takes seconds to reject twenty-eight of them
 * under this suite, and twice as long for each one more.
 */
const NESTED = "+(+(a))";
const aRun = (n: number): string => `${"a".repeat(n)}b`;

/**
 * 4.0.4's ReDoS rewrite returned at the first `*(…)` branch and compiled this
 * to `a*` (micromatch/picomatch#182), so `b` fell out of a protected glob.
 */
const TWO_BRANCHES = "+(*(a)|*(b))";

const decide = (surface: readonly string[], protectedGlobs: readonly string[], file: string): GuardDecision => {
  const policy: GuardPolicy = { surface, protectedGlobs, workRoot: "/wt" };
  return guardToolUse("Write", { file_path: file }, policy, identity);
};

describe("PRDR-329 the decision the SDK backend registers", () => {
  it("GHSA-3v7f-55p6-f55p: a surface naming `[[:constructor:]]` grants nothing spelled from `Object`'s source", () => {
    const decision = decide([INJECTED], STRUCTURAL_PROTECTED, SPLICED);
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("outside this ticket's declared surface");
  });

  it("GHSA-c2c7-rcm5-vvqj: a write under a `+(+(a))` surface is decided within a second, for a path of twenty-eight `a`s", () => {
    const started = performance.now();
    const decision = decide([NESTED], STRUCTURAL_PROTECTED, aRun(28));
    const elapsed = performance.now() - started;
    expect(decision.decision).toBe("deny");
    expect(elapsed, "the guard runs on Detent's own event loop: every session waits while it matches").toBeLessThan(1_000);
  });

  it("a protected `+(*(a)|*(b))` protects what its second branch names, which 4.0.4 dropped", () => {
    const decision = decide(["**"], [TWO_BRANCHES], "b");
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("b is protected");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The shipped artifact: the same three, over the bundle.
 */

const trees: string[] = [];
afterAll(() => {
  for (const tree of trees) removeTree(tree);
});

/** Every legitimate writer stamps an expiry (PRDR-149); so must the fixture. */
const FUTURE = 99_999_999_999_999;

/**
 * A spawn that outlives this is a hung decision. Node's start-up under a loaded
 * suite is well inside it; 4.0.3's match against forty `a`s would take hours.
 */
const HOOK_KILL_MS = 15_000;

interface HookRun {
  readonly out: string;
  readonly error: Error | undefined;
}

function hook(surface: readonly string[], protectedGlobs: readonly string[], file: string): HookRun {
  const cwd = tmpTree({
    ".detent/active_surface.json": JSON.stringify({ surface, protected: protectedGlobs, expires_at_ms: FUTURE }),
  });
  trees.push(cwd);
  const payload = { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file }, cwd };
  const res = spawnSync(process.execPath, [BUNDLE], { input: JSON.stringify(payload), encoding: "utf8", timeout: HOOK_KILL_MS });
  return { out: res.stdout.trim(), error: res.error };
}

/** A deny's reason; silence (an allow, D-29) is the empty string. */
function denial(run: HookRun): string {
  expect(run.error).toBeUndefined();
  if (run.out === "") return "";
  const parsed = JSON.parse(run.out) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
  expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  return parsed.hookSpecificOutput.permissionDecisionReason;
}

describe("PRDR-329 the bundled hook carries the fixed engine", () => {
  it("GHSA-3v7f-55p6-f55p: a surface naming `[[:constructor:]]` grants nothing spelled from `Object`'s source", () => {
    expect(denial(hook([INJECTED], [], SPLICED))).toContain("outside this ticket's declared surface");
  });

  it("GHSA-c2c7-rcm5-vvqj: a write under a `+(+(a))` surface is decided before the kill, for a path of forty `a`s", () => {
    const run = hook([NESTED], [], aRun(40));
    expect(run.error, `the hook was still matching after ${String(HOOK_KILL_MS)} ms`).toBeUndefined();
    expect(denial(run)).toContain("outside this ticket's declared surface");
  });

  it("a protected `+(*(a)|*(b))` protects what its second branch names, which 4.0.4 dropped", () => {
    expect(denial(hook(["**"], [TWO_BRANCHES], "b"))).toContain("b is protected");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The pin, in the three places it lives.
 */

interface Lockfile {
  readonly packages: Readonly<Record<string, { readonly version?: string; readonly dependencies?: Readonly<Record<string, string>> }>>;
}

const readJson = <T>(...segments: string[]): T => JSON.parse(readFileSync(path.join(ROOT, ...segments), "utf8")) as T;
const pinned = readJson<{ dependencies: Record<string, string> }>("package.json").dependencies["picomatch"] ?? "";

/** Whether `version` is `floor` or later, compared as numbers. */
function atLeast(version: string, floor: readonly number[]): boolean {
  const parts = version.split(".").map(Number);
  for (const [i, bound] of floor.entries()) {
    const part = parts[i] ?? 0;
    if (part !== bound) return part > bound;
  }
  return true;
}

describe("PRDR-329 the pin (N-3)", () => {
  it("is exact, and at 4.0.5 or later: past both advisories and past 4.0.4's dropped branch", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(atLeast(pinned, [4, 0, 5]), `picomatch ${pinned}`).toBe(true);
  });

  it("is what the lockfile resolves and what is installed, which is what the bundle is built from", () => {
    const lock = readJson<Lockfile>("package-lock.json");
    expect(lock.packages[""]?.dependencies?.["picomatch"]).toBe(pinned);
    expect(lock.packages["node_modules/picomatch"]?.version).toBe(pinned);
    const installed = readJson<{ version: string }>("node_modules", "picomatch", "package.json").version;
    expect(installed, "node_modules holds another picomatch than the pin; `npm ci` installs the pinned one").toBe(pinned);
  });
});
