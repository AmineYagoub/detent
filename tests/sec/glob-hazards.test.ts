import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { initLayout, writeArtifact } from "../../src/fs/layout.js";
import { planDraftPath, readValidatedDraft } from "../../src/init/plan.js";
import { redraftRecordPath } from "../../src/init/machine.js";
import { readRedrafts } from "../../src/init/plan-cross.js";
import { run } from "../../src/kernel/run.js";
import { newTicket } from "../../src/kernel/tickets/mutations.js";
import { ticketPath } from "../../src/kernel/tickets/paths.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { SCHEMA_VERSION, STRUCTURAL_PROTECTED } from "../../src/schemas/common.js";
import { guardToolUse, type GuardDecision, type GuardPolicy } from "../../src/sessions/guard.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { gitInit, removeTree, tmpTree } from "../helpers.js";

/**
 * PRDR-330 (SEC-3″): a glob picomatch cannot match safely, or as written, is
 * refused where Detent reads it, and the guard refuses to match one.
 *
 * Three kinds, each on picomatch 4.0.5, which is pinned (N-3):
 * - `+(*)` and `+(a|b|ab)` compile to a group repeated over more than one
 *   character. Rejecting a path then tries every way to split it, and the
 *   time doubles with each character. `(a|b|ab)+` does the same with no
 *   extglob: picomatch passes that `+` through as a regex quantifier;
 * - `+(a|aa)` is a shape the upstream safeguard catches, and from 4.0.4 it
 *   compiles to its own escaped spelling, so it matches only a name spelled
 *   `+(a|aa)`;
 * - `+(a|aa|\+\(x)` is caught too, and its escaped spelling is an invalid
 *   regex, so picomatch matches it against nothing (`/$^/`).
 *
 * Every test goes through an entry point: the config's load, a ticket's read,
 * a plan draft's read, the redraft cache's read, `run`, and the guard on both
 * skins, as the SDK backend registers it and as the bundled hook is spawned.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BUNDLE = path.join(ROOT, "hooks", "dist", "detent-hook.cjs");
const identity = (p: string): string => p;

/** Four characters of glob: "one or more of anything", compiled to `(?:[^/]*?)+`. */
const STAR = "src/+(*)";
/** A run of `a`s the glob cannot end on: the `/` after it sends the engine back through every split. */
const starPath = (n: number): string => `src/${"a".repeat(n)}/x`;

/** Overlapping alternatives: `ab` is `a` then `b`, two ways at every pair. */
const OVERLAP = "+(a|b|ab)";
const overlapName = (n: number): string => `${"ab".repeat(n)}c`;

/** The same regex with no extglob in it. */
const REGEX_PLUS = "(a|b|ab)+";

/** A shape the safeguard catches, read from 4.0.4 as the literal name `+(a|aa)`. */
const LITERAL = "+(a|aa)";

/** Caught too, and its escaped spelling does not compile; picomatch then matches with `/$^/`. */
const UNCOMPILABLE = "+(a|aa|\\+\\(x)";

/** Rewritten by the safeguard to `[ab]*`, with its meaning kept (PRDR-329's case). */
const REWRITTEN = "+(*(a)|*(b))";

/** Extglobs that repeat one character or nothing, and the other glob forms. */
const ORDINARY = ["@(src|lib)/**", "!(*.d).ts", "?(a|ab)", "+([a-z])", "*(a)", "src/{a,b}.ts", "[[:alpha:]]*.md", "**/*.test.ts"];

const trees: string[] = [];
afterAll(() => {
  for (const tree of trees) removeTree(tree);
});

const tree = (files: Readonly<Record<string, string>> = {}): string => {
  const root = tmpTree(files);
  trees.push(root);
  return root;
};

const validConfig = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema_version: SCHEMA_VERSION,
  budgets: { run_spend_usd: 25 },
  pinned: { agent_sdk: "0.3.285", claude_code: "2.1.285" },
  ...overrides,
});

/** The refusal `loadConfig` throws, or the empty string where it loads. */
function refusal(config: Record<string, unknown>): string {
  try {
    loadConfig(config);
    return "";
  } catch (err) {
    return (err as Error).message;
  }
}

describe("PRDR-330 the config refuses such a glob when it loads (SEC-3″)", () => {
  it("a `protected` glob that repeats a group over more than one character, naming the glob", () => {
    const message = refusal(validConfig({ protected: [STAR] }));
    expect(message).toContain("protected");
    expect(message).toContain(STAR);
    expect(message).toContain("(?:[^/]*?)+");
  });

  it("a `risk` glob picomatch reads as its own spelling", () => {
    const message = refusal(validConfig({ risk: [LITERAL] }));
    expect(message).toContain("risk");
    expect(message).toContain("its own spelling");
  });

  it("a `plan_docs` glob whose `+` is a regex quantifier, which no extglob option turns off", () => {
    const message = refusal(validConfig({ plan_docs: [REGEX_PLUS] }));
    expect(message).toContain("plan_docs");
    expect(message).toContain("(a|b|ab)+");
  });

  it("a `protected` glob picomatch cannot compile, which it would match against nothing", () => {
    expect(refusal(validConfig({ protected: [UNCOMPILABLE] }))).toContain("matches nothing");
  });

  it("loads the safeguard's meaning-preserving rewrite, the ordinary extglobs and the protected floor", () => {
    expect(refusal(validConfig({ protected: [REWRITTEN, ...ORDINARY, ...STRUCTURAL_PROTECTED], risk: ORDINARY, plan_docs: ORDINARY }))).toBe("");
  });

  it("`run` refuses to start on it, and says why", async () => {
    const root = tree({ "README.md": "# demo\n" });
    gitInit(root);
    initLayout(root);
    writeArtifact(root, "config.json", { budgets: { run_spend_usd: 25 }, protected: [OVERLAP], risk: [], pinned: { agent_sdk: "0.3.285", claude_code: "2.1.285" } });
    const outcome = await run({ root, backend: new MockBackend({}), prompts: loadPromptSet(), ecosystems: [] });
    expect(outcome.summary.reason ?? "").toMatch(/config rejected/u);
    expect(outcome.summary.reason ?? "").toContain(OVERLAP);
  });
});

describe("PRDR-330 a plan's globs are refused where they are read (SEC-3″)", () => {
  const ticket = (surface: readonly string[]): Record<string, unknown> => ({
    ...newTicket({ id: "t-1", type: "feature", title: "one", acceptance_criteria: ["it works"], surface: ["src/**"] }),
    surface: [...surface],
  });

  it("a ticket whose surface holds one is refused when read, naming the ticket", () => {
    const root = tree();
    initLayout(root);
    writeFileSync(ticketPath(root, "t-1"), JSON.stringify(ticket([STAR])));
    expect(() => readTicket(root, "t-1")).toThrow(/t-1[\s\S]*\(\?:\[\^\/\]\*\?\)\+/u);
  });

  it("a plan draft whose ticket's surface holds one is invalid, and says which", () => {
    const root = tree();
    initLayout(root);
    const draft = {
      schema_version: SCHEMA_VERSION,
      tickets: [{ id: "t-1", type: "feature", title: "one", acceptance_criteria: ["it works"], surface: ["src/**", REGEX_PLUS] }],
    };
    writeFileSync(planDraftPath(root), JSON.stringify(draft));
    expect(() => readValidatedDraft(root, null)).toThrow(/invalid draft[\s\S]*surface[\s\S]*\(a\|b\|ab\)\+/u);
  });

  it("a cached redraft that holds one is a miss, not a plan", () => {
    const root = tree();
    initLayout(root);
    const drafted = { id: "t-1", type: "feature", title: "one", slice: "s01", acceptance_criteria: ["it works"], surface: [LITERAL] };
    const record = { schema_version: SCHEMA_VERSION, redrafts: [{ key: "k", slice: "s01", tickets: [drafted], spec_defects: [], findings: [] }] };
    writeFileSync(redraftRecordPath(root), JSON.stringify(record));
    expect(readRedrafts(root)).toEqual([]);
  });
});

const decide = (surface: readonly string[], protectedGlobs: readonly string[], file: string): GuardDecision => {
  const policy: GuardPolicy = { surface, protectedGlobs, workRoot: "/wt" };
  return guardToolUse("Write", { file_path: file }, policy, identity);
};

/** A decision, and how long it took. */
function timed(decision: () => GuardDecision): { readonly decision: GuardDecision; readonly ms: number } {
  const started = performance.now();
  const made = decision();
  return { decision: made, ms: performance.now() - started };
}

describe("PRDR-330 the decision the SDK backend registers does not match such a glob", () => {
  it("a write under a `src/+(*)` surface is refused within a second, for a run of twenty-six `a`s", () => {
    const { decision, ms } = timed(() => decide([STAR], STRUCTURAL_PROTECTED, starPath(26)));
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("SEC-3″");
    expect(ms, "the guard runs on Detent's own event loop: every session waits while it matches").toBeLessThan(1_000);
  });

  it("a protected `src/+(*)` is refused before it is matched: the write is decided within a second", () => {
    const { decision, ms } = timed(() => decide(["**"], [STAR], starPath(26)));
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("SEC-3″");
    expect(ms).toBeLessThan(1_000);
  });

  it("a protected `+(a|aa)` does not shrink to its own spelling: a write to `a` is refused", () => {
    const decision = decide(["**"], [LITERAL], "a");
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("its own spelling");
  });

  it("a protected glob picomatch cannot compile does not protect nothing: a write to `a` is refused", () => {
    const decision = decide(["**"], [UNCOMPILABLE], "a");
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("matches nothing");
  });

  it("a Glob call whose pattern repeats a group is refused within a second where it is matched against the way to an unreadable directory (C-4⁵)", () => {
    const long = overlapName(26);
    const root = tree({ [`${long}/archive/original.md`]: "# original\n" });
    const policy: GuardPolicy = { surface: [], protectedGlobs: [], workRoot: root, unreadable: [path.join(root, long, "archive")] };
    const { decision, ms } = timed(() => guardToolUse("Glob", { pattern: `${OVERLAP}/archive/**` }, policy, identity));
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("SEC-3″");
    expect(ms).toBeLessThan(1_000);
  });

  it("the safeguard's rewrite, `+(*(a)|*(b))`, still protects what its second branch names", () => {
    const decision = decide(["**"], [REWRITTEN], "b");
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("b is protected");
  });

  it("ordinary globs are matched as before: `@(src|lib)/**` grants `lib/x.ts`, and a protected `+([a-z])` protects it", () => {
    expect(decide(ORDINARY, STRUCTURAL_PROTECTED, "lib/x.ts").decision).toBe("allow");
    const decision = decide(["**"], ["+([a-z])"], "lib/x.ts");
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("lib/x.ts is protected");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The shipped artifact: the same refusals, over the bundle.
 */

/** Every legitimate writer stamps an expiry (PRDR-149); so must the fixture. */
const FUTURE = 99_999_999_999_999;

/** A spawn that outlives this is a hung decision; the unfixed engine takes about a minute on thirty `a`s. */
const HOOK_KILL_MS = 15_000;

interface HookRun {
  readonly out: string;
  readonly error: Error | undefined;
}

function hook(surface: readonly string[], protectedGlobs: readonly string[], file: string): HookRun {
  const cwd = tree({ ".detent/active_surface.json": JSON.stringify({ surface, protected: protectedGlobs, expires_at_ms: FUTURE }) });
  const payload = { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file }, cwd };
  const res = spawnSync(process.execPath, [BUNDLE], { input: JSON.stringify(payload), encoding: "utf8", timeout: HOOK_KILL_MS });
  return { out: res.stdout.trim(), error: res.error };
}

/** A deny's reason; silence (an allow, D-29) is the empty string. */
function denial(runOf: HookRun): string {
  expect(runOf.error, `the hook was still matching after ${String(HOOK_KILL_MS)} ms`).toBeUndefined();
  if (runOf.out === "") return "";
  const parsed = JSON.parse(runOf.out) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
  expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  return parsed.hookSpecificOutput.permissionDecisionReason;
}

describe("PRDR-330 the bundled hook does not match such a glob", () => {
  it("a write under a `src/+(*)` surface is refused before the kill, for a run of thirty `a`s", () => {
    expect(denial(hook([STAR], [], starPath(30)))).toContain("SEC-3″");
  });

  it("a protected `+(a|aa)` does not shrink to its own spelling: a write to `a` is refused", () => {
    expect(denial(hook(["**"], [LITERAL], "a"))).toContain("its own spelling");
  });
});
