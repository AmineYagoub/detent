import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_HUMAN_GATED, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { STRUCTURAL_PROTECTED } from "../../src/schemas/common.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import type { GuardPolicy } from "../../src/sessions/guard.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { ClaudeCodeBackend, buildOptions, buildPreToolUseHook, parseResultMessage, type SdkBackendConfig } from "../../src/sessions/sdk.js";
import { isOutage } from "../../src/init/session.js";
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

  it("S-3⁵ (PRDR-213): the hook judges a `git rm` per pathspec, and an allowed one carries no rewrite", async () => {
    const hooks = buildPreToolUseHook(CONFIG.policy);
    const callback = hooks.PreToolUse?.[0]?.hooks[0];
    expect(callback).toBeDefined();
    const judge = async (command: string) =>
      (await callback!(
        { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: "x" } as never,
        undefined,
        { signal: new AbortController().signal },
      )) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; updatedInput?: unknown } };
    const denied = await judge("git rm -f /wt/AGENTS.md");
    expect(denied.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(denied.hookSpecificOutput?.permissionDecisionReason).toContain("protected");
    const allowed = await judge("git rm -f src/a.ts");
    expect(allowed.hookSpecificOutput?.permissionDecision).toBe("allow");
    expect(allowed.hookSpecificOutput?.updatedInput).toBeUndefined();
    /* A `git add` is still the allowlist's call — the hook says nothing either way. */
    expect((await judge("git add src/a.ts")).hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it("D-28″ (PRDR-215): the hook denies a sub-agent spawn — the platform would otherwise grant it without the allowlist", async () => {
    const hooks = buildPreToolUseHook(CONFIG.policy);
    const callback = hooks.PreToolUse?.[0]?.hooks[0];
    const output = (await callback!(
      { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { prompt: "delete the probe", subagent_type: "general-purpose" }, tool_use_id: "x" } as never,
      undefined,
      { signal: new AbortController().signal },
    )) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain("D-28");
  });

  /**
   * PRDR-205 — the k draws of one review are TOLD one artifact path, so their
   * first turns are byte-identical and the prompt cache serves all but the
   * first (S-6); each draw's file is its own. A write to the told path is
   * carried out at the file the draw has, and judged there.
   */
  it("a write to the artifact the session was TOLD is carried out at the artifact it HAS, and allowed (PRDR-205)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "detent-alias-"));
    roots.push(root);
    const told = path.join(root, ".detent", "state", "plan-review.json");
    const actual = path.join(root, ".detent", "state", "draws", "2", "plan-review.json");
    /* An init session's policy (S-1″): the one file it may write, and the structural floor. */
    const policy: GuardPolicy = { surface: [path.relative(root, actual)], protectedGlobs: [...STRUCTURAL_PROTECTED], workRoot: root, artifactRoot: actual };
    const [matcher] = buildPreToolUseHook(policy, { told, actual }).PreToolUse ?? [];
    const callback = matcher?.hooks[0];
    expect(callback).toBeDefined();
    type Output = { hookSpecificOutput?: { permissionDecision?: string; updatedInput?: Record<string, unknown> } };
    const call = async (tool: string, tool_input: Record<string, unknown>): Promise<Output> =>
      (await callback!({ hook_event_name: "PreToolUse", tool_name: tool, tool_input, tool_use_id: "x" } as never, undefined, {
        signal: new AbortController().signal,
      })) as Output;

    const write = await call("Write", { file_path: told, content: "{}" });
    expect(write.hookSpecificOutput?.permissionDecision, "the draw's own file is its artifact (B-2″)").toBe("allow");
    expect(write.hookSpecificOutput?.updatedInput?.["file_path"], "carried out where the file goes").toBe(actual);
    expect(write.hookSpecificOutput?.updatedInput?.["content"], "and nothing else about the call moves").toBe("{}");

    /* The alias is exactly one path; anything else is judged as before. */
    const elsewhere = await call("Write", { file_path: path.join(root, ".detent", "state", "other.json"), content: "" });
    expect(elsewhere.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(elsewhere.hookSpecificOutput?.updatedInput).toBeUndefined();

    /* Reads are not this guard's business (S-2‴), alias or not. */
    const read = await call("Read", { file_path: told });
    expect(read.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(read.hookSpecificOutput?.updatedInput).toBeUndefined();
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

/**
 * S-4 / PRDR-187 — an absent-telemetry result keeps its REASON.
 *
 * The no-telemetry branch returned `rawTail: ""`, discarding `result` along
 * with the usage — so a session limit arriving before any tokens were spent
 * surfaced as "planner session failed" with nothing after the colon, and
 * PRDR-185's outage retry, which reads that message, could not fire. The one
 * shape it exists for was the one shape it could not see.
 *
 * PRDR-181 caused it: before that fix, `total_cost_usd` with an empty
 * `modelUsage` counted as telemetry and the tail came from the path below.
 * Tightening the check correctly moved this shape here — and here threw the
 * reason away.
 */
describe("S-4 a result with no telemetry still carries why it failed", () => {
  const limit = "Claude Code returned an error result: You've hit your session limit · resets 5:20pm";

  it("keeps `result` as the tail when the usage breakdown is empty", () => {
    const parsed = parseResultMessage({
      type: "result",
      subtype: "success",
      is_error: true,
      result: limit,
      total_cost_usd: 0,
      modelUsage: {},
      num_turns: 1,
    } as never);
    expect(parsed.ok, "an error result is not ok").toBe(false);
    expect(parsed.telemetryParsed, "and its telemetry is still absent").toBe(false);
    expect(parsed.rawTail, "but the reason is not telemetry and must survive").toContain("session limit");
  });

  it("is what makes the init outage retry reachable at all", () => {
    const parsed = parseResultMessage({
      type: "result",
      subtype: "success",
      is_error: true,
      result: limit,
      total_cost_usd: 0,
      modelUsage: {},
      num_turns: 1,
    } as never);
    /* Verbatim the message `launchOnce` throws, which `launchInitSession` matches on. */
    const thrown = `planner session failed${parsed.rawTail === "" ? "" : `: ${parsed.rawTail.slice(-300)}`}`;
    expect(isOutage(thrown), "PRDR-185 reads this message; an empty tail makes it blind").toBe(true);
  });

  it("still reports no tail when the result genuinely carries none", () => {
    const parsed = parseResultMessage({ type: "result", subtype: "success", total_cost_usd: 0, modelUsage: {} } as never);
    expect(parsed.rawTail).toBe("");
  });
});

/**
 * PRDR-197 — effort is configurable per role.
 *
 * `model_routing` routes each role to a model but not to an effort, and the
 * judgement roles are already on the strongest model — so effort is the only
 * lever left on exactly the roles PRDR-196 identifies as the bottleneck, and it
 * did not exist. `settingSources: []` means it cannot come from outside either.
 *
 * A knob and a default that changes nothing: with no effort configured, the
 * options a session is built with must be what they were before.
 */
describe("PRDR-197 a session carries the effort its role is routed to", () => {
  const spec = (over: Record<string, unknown> = {}) =>
    ({
      cwd: "/repo",
      ticketId: "t-1",
      role: "planner",
      model: "",
      prompt: "p",
      allowedTools: ["Read"],
      artifactOut: "/repo/out.json",
      permissionMode: "",
      ...over,
    }) as never;

  it("passes the configured effort into the options a session is actually built with", () => {
    const options = buildOptions(spec({ effort: "xhigh" }), CONFIG);
    expect((options as { effort?: string }).effort).toBe("xhigh");
  });

  /** The default must be invisible: a spec with no effort produces today's options. */
  it("omits the key entirely when no effort is routed", () => {
    const options = buildOptions(spec(), CONFIG);
    expect("effort" in options).toBe(false);
  });
});

/**
 * C-4⁗⁵ (PRDR-210) — the stagger's signal is the first response's BEGINNING.
 *
 * `onFirstResponse` fired on the stream's first `assistant` frame, which is a
 * completed turn. The prompt cache is readable once the first response begins,
 * and on gate-313 three of fourteen slices waited the full 60 s for a reviewer
 * whose first turn was a long generation, then launched the other draws cold.
 * With partial messages requested, the SDK yields one `stream_event` per
 * Messages API streaming event; `message_start` is the response beginning.
 */
describe("C-4⁗⁵ the first response's beginning, not its completion", () => {
  const RESULT = {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 5 },
    modelUsage: { "claude-opus-5": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 } },
    result: "ok",
  };
  const INIT = { type: "system", subtype: "init" };
  const START = { type: "stream_event", event: { type: "message_start" }, parent_tool_use_id: null };
  const DELTA = { type: "stream_event", event: { type: "content_block_delta" }, parent_tool_use_id: null };
  const ASSISTANT = { type: "assistant", message: { content: [] } };

  /** A backend over a scripted stream that records after WHICH frame the callback fired. */
  function scripted(frames: readonly object[]): {
    readonly run: () => Promise<{ readonly firedAfter: number | null; readonly turns: number; readonly cost: number; readonly parsed: boolean }>;
  } {
    let fired = false;
    let firedAfter: number | null = null;
    const backend = new ClaudeCodeBackend({
      policy: { surface: ["**"], protectedGlobs: [], workRoot: "/wt" },
      queryFn: () =>
        (async function* () {
          for (const [i, frame] of frames.entries()) {
            yield frame;
            if (fired && firedAfter === null) firedAfter = i;
          }
        })(),
    });
    return {
      run: async () => {
        const result = await backend.run(spec({ onFirstResponse: () => { fired = true; } }));
        return { firedAfter, turns: result.turns, cost: result.costEstimateUsd, parsed: result.telemetryParsed };
      },
    };
  }

  it("fires when the first response BEGINS — the message_start event — not when the turn completes", async () => {
    const { firedAfter } = await scripted([INIT, START, DELTA, ASSISTANT, RESULT]).run();
    /* Before PRDR-210 this is 3: the completed `assistant` frame. */
    expect(firedAfter, "fired while the message_start event was being handled").toBe(1);
  });

  it("a stream that carries no events still fires on the first assistant frame", async () => {
    const { firedAfter } = await scripted([INIT, ASSISTANT, RESULT]).run();
    expect(firedAfter).toBe(1);
  });

  it("telemetry reads the same values with stream events interleaved", async () => {
    const withEvents = await scripted([INIT, START, DELTA, ASSISTANT, START, DELTA, ASSISTANT, RESULT]).run();
    const without = await scripted([INIT, ASSISTANT, ASSISTANT, RESULT]).run();
    expect([withEvents.turns, withEvents.cost, withEvents.parsed]).toEqual([without.turns, without.cost, without.parsed]);
  });

  it("a crash counts completed turns, not the events they streamed (PRDR-072's observed count)", async () => {
    /* The stream dies after two turns; the wrap reports the turns it saw, and no event is a turn. */
    const frames = [INIT, START, DELTA, ASSISTANT, START, DELTA, ASSISTANT];
    const backend = new ClaudeCodeBackend({
      policy: { surface: ["**"], protectedGlobs: [], workRoot: "/wt" },
      queryFn: () =>
        (async function* () {
          for (const f of frames) yield f;
          throw new Error("transport died");
        })(),
    });
    const result = await backend.run(spec({ onFirstResponse: () => {} }));
    expect(result.ok).toBe(false);
    expect(result.turns, "two assistant frames, six events").toBe(2);
  });

  it("partial messages are requested only for a session someone is waiting on", () => {
    expect(buildOptions(spec({ onFirstResponse: () => {} }), CONFIG).includePartialMessages).toBe(true);
    expect("includePartialMessages" in buildOptions(spec(), CONFIG)).toBe(false);
  });
});

/**
 * PRDR-211 — the Stop hook's scoped gate runs where the session works.
 *
 * `buildLiveBackend` ran it in the ROOT; since B-2″ the session works in a
 * per-ticket worktree, so the hook tested a tree the session was not changing.
 * On gate-313 that was `npm test` in a root with no `package.json` — the ENOENT
 * the bootstrap session misread as proof the gate runner had npm.
 */
describe("PRDR-211 the scoped gate runs in the session's directory", () => {
  it("hands the runner the spec's cwd", async () => {
    const seen: (string | undefined)[] = [];
    const config: SdkBackendConfig = {
      ...CONFIG,
      gateCmd: "true",
      runScopedGate: async (_command, cwd) => {
        seen.push(cwd);
        return { green: true, outputTail: "" };
      },
    };
    const options = buildOptions(spec({ cwd: "/wt/.detent/worktrees/t1" }), config);
    const stop = options.hooks?.Stop?.[0]?.hooks[0];
    expect(stop).toBeDefined();
    await stop!({ hook_event_name: "Stop", stop_hook_active: false } as never, undefined, { signal: new AbortController().signal });
    expect(seen).toEqual(["/wt/.detent/worktrees/t1"]);
  });
});
