import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_HUMAN_GATED, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { buildOptions, buildPreToolUseHook, parseResultMessage, type SdkBackendConfig } from "../../src/sessions/sdk.js";
import { removeTree, writeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "../kernel/run-fixture.js";

/**
 * T-046 — the SDK backend, everything decidable without a live session:
 * option construction (the two load-bearing security lines), the hook wiring,
 * and telemetry parsing over the SDK's documented result shapes. Transport is
 * exercised by doctor's smoke and the M2 exit under R-10's key gate.
 */

const PROMPTS = loadPromptSet();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const CONFIG: SdkBackendConfig = {
  policy: { surface: ["src/**"], protectedGlobs: ["AGENTS.md"], workRoot: "/wt" },
};

function spec(over: Partial<SessionSpec> = {}): SessionSpec {
  return {
    role: "implement",
    ticketId: "t1",
    promptPrefix: "prefix",
    promptVariable: "{}",
    cwd: "/wt",
    artifactOut: "/wt/.detent/runs/t1/implement.json",
    allowedTools: ["Edit", "Write"],
    permissionMode: "",
    model: "",
    ...over,
  };
}

describe("T-046 option construction (S-1, D-21, D-22)", () => {
  it("settingSources is the EMPTY SET — repository policy can never load (PRDR-051)", () => {
    const options = buildOptions(spec(), CONFIG);
    expect(options.settingSources).toEqual([]);
    /**
     * Not undefined: undefined would mean the SDK default, which enables
     * project scope resolving against the repository under work.
     */
    expect(Object.hasOwn(options, "settingSources")).toBe(true);
  });

  it("the guard is wired as a PreToolUse hook, and canUseTool is absent (PRDR-050)", () => {
    const options = buildOptions(spec(), CONFIG);
    expect(options.hooks?.PreToolUse).toHaveLength(1);
    expect("canUseTool" in options).toBe(false);
  });

  it("read-only roles run plan mode; write roles run default", () => {
    expect(buildOptions(spec({ permissionMode: "plan" }), CONFIG).permissionMode).toBe("plan");
    expect(buildOptions(spec(), CONFIG).permissionMode).toBe("default");
  });

  it("model routing and the turn bound pass through only when set — no ceiling by default (X-1″)", () => {
    expect("model" in buildOptions(spec(), CONFIG)).toBe(false);
    expect(buildOptions(spec({ model: "haiku" }), CONFIG).model).toBe("haiku");
    /* PRDR-106: the referee sets none; only the doctor probe bounds itself. */
    expect("maxTurns" in buildOptions(spec(), CONFIG)).toBe(false);
    expect(buildOptions(spec({ maxTurns: 1 }), CONFIG).maxTurns).toBe(1);
  });

  it("the hook callback denies a protected write with the reason in the decision shape", async () => {
    const hooks = buildPreToolUseHook(CONFIG.policy);
    const [matcher] = hooks.PreToolUse ?? [];
    const callback = matcher?.hooks[0];
    expect(callback).toBeDefined();
    const output = (await callback!(
      { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "/wt/AGENTS.md" }, tool_use_id: "x" } as never,
      undefined,
      { signal: new AbortController().signal },
    )) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain("protected");
  });
});

describe("T-046 telemetry parsing (S-4, PRDR-052/053)", () => {
  const SUCCESS = {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 4,
    total_cost_usd: 0.12,
    usage: { input_tokens: 900, output_tokens: 80 },
    modelUsage: {
      "claude-opus-5": { inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 400, cacheCreationInputTokens: 50, costUSD: 0.1 },
      "claude-haiku-4-5": { inputTokens: 200, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.02 },
    },
    result: "done",
  };

  it("reads the per-model breakdown as the token source of record — not the cumulative usage field", () => {
    const parsed = parseResultMessage(SUCCESS);
    expect(parsed.telemetryParsed).toBe(true);
    /** 1200 ≠ the cumulative field's 900: the breakdown includes what usage excludes. */
    expect(parsed.inputTokens).toBe(1200);
    expect(parsed.outputTokens).toBe(120);
    expect(parsed.cacheReadInputTokens).toBe(400);
    expect(parsed.costEstimateUsd).toBe(0.12);
    expect(parsed.turns).toBe(4);
    expect(Object.keys(parsed.perModel ?? {})).toHaveLength(2);
  });

  it("budget-exceeded results read the breakdown, which includes the response that crossed the ceiling", () => {
    const parsed = parseResultMessage({ ...SUCCESS, subtype: "error_max_budget_usd", is_error: true });
    expect(parsed.ok).toBe(false);
    /** never the omitting cumulative field */
    expect(parsed.inputTokens).toBe(1200);
  });

  it("absent telemetry trips the breaker flag (S-4)", () => {
    const parsed = parseResultMessage({ type: "result", subtype: "success", is_error: false });
    expect(parsed.telemetryParsed).toBe(false);
  });

  it("a crash result with ZEROED telemetry is not absent and not free — flagged for the ledger (PRDR-053)", () => {
    const parsed = parseResultMessage({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 0,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
      modelUsage: {},
    });
    /** zeroed ≠ absent */
    expect(parsed.telemetryParsed).toBe(true);
    expect(parsed.crashed).toBe(true);
  });

  it("a crash keeps its OBSERVED turns — maxTurns marches, only true refusals read as zero (PRDR-072)", () => {
    const parsed = parseResultMessage({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 30,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    expect(parsed.crashed).toBe(true);
    expect(parsed.turns).toBe(30);
  });
});

describe("T-046 surface requests through the loop (oracle test_surface_request_grant_and_deny)", () => {
  it("a legitimate request is granted and logged; a protected request is denied", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    addTicket(root, { id: "t2" });

    const requesting =
      (target: string): StageFn =>
      (spec) => {
        const variable = JSON.parse(spec.promptVariable) as { surface_request_out: string };
        writeTree(path.dirname(variable.surface_request_out), {
          [path.basename(variable.surface_request_out)]: JSON.stringify({ path: target, justification: "needed" }),
        });
        return implementGreen(spec);
      };

    const backend = new MockBackend({
      "t1:implement": requesting("docs/extra.md"),
      /* protected (config) */
      "t2:implement": requesting("AGENTS.md"),
      review: reviewApprove,
    });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "sr" });
    expect(outcome.exitCode).toBe(0);

    const t1 = readTicket(root, "t1");
    expect(t1.surface).toContain("docs/extra.md");
    expect(t1.notes.map((n) => n.text).join(" ")).toContain("surface granted: docs/extra.md");

    const t2 = readTicket(root, "t2");
    expect(t2.surface).not.toContain("AGENTS.md");
    /* PRDR-183: the denial names the path AND which rule refused it. */
    const denial = t2.notes.map((n) => n.text).join(" ");
    expect(denial).toContain("surface DENIED: `AGENTS.md`");
    expect(denial, "an operator must be able to tell protected from malformed from budget-exhausted").toContain("protected");
    /** a denied expansion is not an escalation */
    expect(outcome.exitCode).toBe(0);
  });
});

/**
 * SEC-3′ (PRDR-132) — the lever cannot grant everything.
 *
 * `handleSurfaceRequest` checked the model-supplied target against
 * `config.protected` alone — never against the structural floor the same file
 * builds for the policy — and never checked it was a path at all. So a session
 * that hit one deny could write `{"path":"**"}` and have its own surface
 * widened to the whole worktree, PERSISTED onto the ticket and surviving every
 * later generation. `.git/**` was granted the same way, which matters because
 * writing into `.git` is executing: `.gitattributes` plus a `filter.*.clean`
 * entry runs a shell command on `git add`.
 */
describe("SEC-3′ a session cannot grant itself a wildcard, `.git`, or the structural floor", () => {
  /**
   * PRDR-149 widened this list. `isConcreteRepoPath` was a BLACKLIST of
   * `* ? [ ]`, and a blacklist of a glob grammar is a losing game: `"."`
   * contains none of them and, as a surface, permits every path in the tree —
   * the exact bypass `**` was blocked for. picomatch's extglob and brace forms
   * walked through the same gap, `"./"` made `matchAny` throw on every later
   * call, and `.detent` was granted as the PARENT of the floor's entries and
   * then permitted the run's own spend ledger.
   */
  const DANGEROUS = [
    "**",
    ".",
    "./",
    "!(zzz)",
    "{src,.detent}",
    ".detent",
    ".detent/ledger.jsonl",
    "node_modules",
    ".git/**",
    "/etc/**",
    ".detent/config.json",
    "../outside",
  ] as const;

  it.each(DANGEROUS)("refuses a surface request for %s, and the ticket keeps its declared surface", async (target) => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });

    const requesting: StageFn = (spec) => {
      const variable = JSON.parse(spec.promptVariable) as { surface_request_out: string };
      writeTree(path.dirname(variable.surface_request_out), {
        [path.basename(variable.surface_request_out)]: JSON.stringify({ path: target, justification: "needed" }),
      });
      return implementGreen(spec);
    };
    const backend = new MockBackend({ "t1:implement": requesting, review: reviewApprove });
    await run({ root, backend, prompts: PROMPTS, runId: "sr-deny" });

    const t1 = readTicket(root, "t1");
    expect(t1.surface).not.toContain(target);
    expect(t1.notes.map((n) => n.text).join(" ")).toContain(`surface DENIED: \`${target}\``);
  });

  /* The lever still works — this must not become "no expansion ever". */
  it("a concrete path outside the floor is still granted", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    const requesting: StageFn = (spec) => {
      const variable = JSON.parse(spec.promptVariable) as { surface_request_out: string };
      writeTree(path.dirname(variable.surface_request_out), {
        [path.basename(variable.surface_request_out)]: JSON.stringify({ path: "docs/extra.md", justification: "needed" }),
      });
      return implementGreen(spec);
    };
    const backend = new MockBackend({ "t1:implement": requesting, review: reviewApprove });
    await run({ root, backend, prompts: PROMPTS, runId: "sr-ok" });
    expect(readTicket(root, "t1").surface).toContain("docs/extra.md");
  });
});

describe("T-046 the S-4 breaker end to end (oracle test_unparsable_telemetry_is_budget_breaching)", () => {
  it("a session whose telemetry cannot be parsed is budget-breaching → NEEDS_HUMAN", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({ implement: () => okResult({ telemetryParsed: false }) });
    const outcome = await run({ root, backend, prompts: PROMPTS, runId: "tele" });
    expect(outcome.exitCode).toBe(EXIT_HUMAN_GATED);
    expect(readTicket(root, "t1").state).toBe("NEEDS_HUMAN");
    expect(readTicket(root, "t1").notes.map((n) => n.text).join(" ")).toContain("telemetry unparsable");
  });
});

/**
 * S-4 (PRDR-181) — a half-formed result message is not telemetry.
 *
 * `total_cost_usd` plus an EMPTY `modelUsage: {}` satisfied the presence check
 * and parsed as telemetry with zero tokens, so a truncated result became a $0
 * ledger row and a session the spend ceiling never saw. The existing tests
 * covered telemetry entirely ABSENT and a hand-injected `telemetryParsed:
 * false` — neither of which is this shape.
 */
describe("S-4 partial telemetry is absent telemetry", () => {
  it("refuses a cost with no usage breakdown at all", () => {
    const parsed = parseResultMessage({ type: "result", subtype: "success", total_cost_usd: 0.5, modelUsage: {}, num_turns: 3 });
    expect(parsed.telemetryParsed, "an empty breakdown carries no tokens to bound anything with").toBe(false);
  });

  it("still accepts a real breakdown, and a flat usage block", () => {
    const withModels = parseResultMessage({
      type: "result",
      subtype: "success",
      total_cost_usd: 0.5,
      modelUsage: { "claude-opus-5": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 } },
      num_turns: 3,
    });
    expect(withModels.telemetryParsed).toBe(true);
    const withUsage = parseResultMessage({
      type: "result",
      subtype: "success",
      total_cost_usd: 0.5,
      usage: { input_tokens: 10, output_tokens: 5 },
      num_turns: 3,
    });
    expect(withUsage.telemetryParsed).toBe(true);
  });
});

/**
 * SEC-3 (PRDR-183) — a denial that says what was denied.
 *
 * Observed in a live run: a session hit a real blocker (its acceptance criterion
 * needed a file outside its surface), asked for a widening twice, and left two
 * notes reading `surface DENIED:  ()` — no path, and on the second one no
 * justification either. The message was `${target} (${why})`, so an empty
 * request rendered as nothing, and the three distinct refusals — no path,
 * protected, budget exhausted — were indistinguishable.
 */
describe("SEC-3 a refused surface request says which rule refused it", () => {
  async function denialFor(request: object): Promise<string> {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    const requesting: StageFn = (spec) => {
      /* Written where the referee reads it — the absolute `surface_request_out`, not cwd. */
      const variable = JSON.parse(spec.promptVariable) as { surface_request_out: string };
      mkdirSync(path.dirname(variable.surface_request_out), { recursive: true });
      writeFileSync(variable.surface_request_out, JSON.stringify(request));
      return implementGreen(spec);
    };
    await run({ root, backend: new MockBackend({ "t1:implement": requesting, review: reviewApprove }), prompts: PROMPTS, runId: "sr-why" });
    return readTicket(root, "t1").notes.map((n) => n.text).join(" ");
  }

  it("names the missing path when the request carries none", async () => {
    const note = await denialFor({ justification: "the test script is broken and lives in package.json" });
    expect(note, "an empty target used to render as nothing at all").toContain("the request named no path");
    expect(note, "and what the session asked for survives").toContain("the test script is broken");
  }, 60_000);

  it("says nothing about a justification the session did not give", async () => {
    const note = await denialFor({});
    expect(note).toContain("the request named no path");
    expect(note, "an absent justification is absent, not an empty pair of brackets").not.toContain("()");
  }, 60_000);
});
