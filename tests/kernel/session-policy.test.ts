import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { buildOptions } from "../../src/sessions/sdk.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { removeTree } from "../helpers.js";
import { addTicket, diagnoseValid, makeRunRepo, reviewApprove } from "../kernel/run-fixture.js";
import { guardToolUse, type GuardPolicy } from "../../src/sessions/guard.js";
import { driftAcceptPath } from "../../src/kernel/drift-base.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { claim } from "../../src/kernel/tickets/mutations.js";

/**
 * T-140 — the per-ticket D-21 policy reaches the hook (S-2′, SEC-3).
 *
 * Found by the self-build preparation: `SessionSpec` carried no policy, so
 * every live worker session ran under the backend's one construction-time
 * policy and the ticket's declared surface never reached the PreToolUse
 * hook. These tests pin the seam end-to-end: the referee's session arm puts
 * the ticket surface (plus only the runs area) and a STRUCTURAL protected
 * floor on the spec, and `buildOptions` prefers the spec's policy over the
 * constructor's.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function specFromAttempt(stage: "implement" | "review" | "diagnose" = "implement"): Promise<SessionSpec> {
  const repo = await makeRunRepo();
  cleanups.push(() => removeTree(repo.root));
  addTicket(repo.root, { id: "t-1" });
  const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(repo.root), "config.json"), "utf8")));
  const journal = RunJournal.open(repo.root);
  cleanups.push(() => journal.close());
  const backend = new MockBackend({ implement: () => okResult(), review: reviewApprove, diagnose: diagnoseValid });
  const core = new RefereeCore(
    { root: repo.root, backend, prompts: loadPromptSet() },
    loaded,
    journal,
    ensureRunBranch(repo.root, "session-policy"),
  );
  installTrailerHook(repo.root);
  expect(core.acquire("t-1").ok).toBe(true);
  if (stage === "implement") await core.attempt("t-1", "IN_PROGRESS");
  else await core.recordStage("t-1", stage);
  const spec = backend.calls[0]?.spec;
  if (spec === undefined) throw new Error("no session launched");
  return spec;
}

describe("T-140 the session arm publishes the per-ticket policy", () => {
  it("surface = the ticket's declared surface; the artifact area is the artifact root, not a surface entry (PRDR-228)", async () => {
    const spec = await specFromAttempt();
    expect(spec.policy?.surface).toEqual(["src/**", "tests/**"]);
    expect(spec.policy?.artifactRoot).toBe(path.join(spec.cwd, ".detent", "runs", "t-1"));
    expect(spec.policy?.workRoot).toBe(spec.cwd);
  });

  /**
   * S-1′ (PRDR-170) — asserted on the spec `SessionArm.launch` actually builds,
   * not on a policy the test composed for itself.
   *
   * `allowedTools` was narrowed for read-only roles and the POLICY was not,
   * while `sdk.ts`'s own comment records that a hook answering `allow` "ended
   * the evaluation and overrode `allowedTools`" — so the guard handed
   * review/diagnose/research an unconditional allow to edit the implementation
   * they exist to judge.
   */
  it("a read-only role's surface is its artifact, never the ticket's code", async () => {
    const spec = await specFromAttempt("review");
    /* PRDR-228: the artifact area is the artifact root; the surface itself is empty. */
    expect(spec.policy?.surface, "review must not carry the implementation surface").toEqual([]);
    const policy = spec.policy as GuardPolicy;
    expect(guardToolUse("Edit", { file_path: path.join(spec.cwd, "src/payments.ts") }, policy).decision).toBe("deny");
    expect(
      guardToolUse("Write", { file_path: path.join(spec.cwd, ".detent/runs/t-1/review.json") }, policy).decision,
      "but it still writes its own verdict",
    ).toBe("allow");
  });

  /**
   * S-1′ (PRDR-178) — `diagnose` is read-only and still writes a repro test.
   *
   * `prompts/diagnose.md` grants "your artifact AND a reproduction test inside
   * the ticket surface" in its first sentence. PRDR-170 narrowed every
   * read-only role to its artifact and so denied that write, while its own
   * ticket claimed it changed nothing about what a read-only role writes. The
   * prompt is the contract; `review` and `research` grant only the artifact.
   */
  it("diagnose keeps the ticket surface its prompt grants, while review does not", async () => {
    const diagnose = await specFromAttempt("diagnose");
    expect(diagnose.policy?.surface, "the prompt promises a repro test inside the surface").toEqual(["src/**", "tests/**"]);
    const repro = path.join(diagnose.cwd, "tests/repro_t-1.test.ts");
    expect(guardToolUse("Write", { file_path: repro }, diagnose.policy as GuardPolicy).decision).toBe("allow");

    const review = await specFromAttempt("review");
    expect(review.policy?.surface, "review grants only its artifact — through the artifact root").toEqual([]);
    expect(guardToolUse("Write", { file_path: repro }, review.policy as GuardPolicy).decision).toBe("deny");
  });

  /**
   * B-2″ (PRDR-180) — the artifact write, in the DEFAULT configuration.
   *
   * `artifactOut` is `<root>/.detent/runs/<ticket>/…` while `workRoot` is the
   * per-ticket worktree, and PRDR-145b made worktrees the default. So the
   * artifact every read-only role exists to produce resolved to a sibling of
   * its work root and the guard denied it as an escape. Every test missed it by
   * running non-worktree, where the two paths coincide — which is why this one
   * builds the worktree shape explicitly.
   */
  it("a session may write its own artifact from inside a worktree, and nothing else outside it", async () => {
    const spec = await specFromAttempt("review");
    const worktree = path.join(spec.cwd, ".detent", "worktrees", "t-1");
    mkdirSync(worktree, { recursive: true });
    const runs = path.join(spec.cwd, ".detent", "runs", "t-1");
    mkdirSync(runs, { recursive: true });
    /**
     * The PRODUCTION policy, with only `workRoot` moved to the worktree as
     * `run` does by default. `artifactRoot` is taken from the spec, not
     * supplied here — the first version of this test passed its own and so
     * stayed green when production stopped setting it, which is the trap this
     * whole chain keeps falling into.
     */
    expect(spec.policy?.artifactRoot, "the session arm must publish where the artifact goes").toBe(runs);
    const policy = { ...(spec.policy as GuardPolicy), workRoot: worktree };

    expect(
      guardToolUse("Write", { file_path: path.join(runs, "review.json") }, policy).decision,
      "the artifact a review session exists to produce",
    ).toBe("allow");
    for (const [label, file] of [
      ["another ticket's artifacts", path.join(spec.cwd, ".detent", "runs", "t-2", "review.json")],
      ["the operator's own checkout", path.join(spec.cwd, "src", "payments.ts")],
      ["the spend ledger", path.join(spec.cwd, ".detent", "ledger.jsonl")],
      /* PRDR-228: the worktree-relative runs path is INSIDE the product tree — t-s01-007 shipped an artifact through it. */
      ["the worktree's own relative runs path", path.join(worktree, ".detent", "runs", "t-1", "review.json")],
      /* PRDR-230: the record that ACCEPTS a verification change must not be writable by the session it judges (SEC-5). */
      ["its own drift acceptance", driftAcceptPath(spec.cwd, "t-1")],
    ] as [string, string][]) {
      expect(guardToolUse("Write", { file_path: file }, policy).decision, label).toBe("deny");
    }
  });

  it("protected carries the project globs PLUS the structural SEC-3 floor", async () => {
    const spec = await specFromAttempt();
    for (const structural of [".detent/tickets/**", ".detent/config.json", ".detent/bindings.json", ".detent/plan/**"]) {
      expect(spec.policy?.protectedGlobs, structural).toContain(structural);
    }
    expect(spec.policy?.protectedGlobs).toContain("AGENTS.md");
  });
});

describe("T-140 buildOptions prefers the spec's policy (S-2′)", () => {
  const constructorPolicy = { surface: ["**"], protectedGlobs: [], workRoot: "/anywhere" };
  const base: SessionSpec = {
    role: "implement",
    ticketId: "t-1",
    promptPrefix: "p",
    promptVariable: "v",
    cwd: "/wt",
    artifactOut: "/wt/.detent/runs/t-1/impl.json",
    allowedTools: ["Edit", "Write"],
    permissionMode: "",
    model: "",
    maxTurns: 5,
  };

  async function decideWith(spec: SessionSpec, filePath: string): Promise<string> {
    const options = buildOptions(spec, { policy: constructorPolicy });
    const hook = options.hooks?.["PreToolUse"]?.[0]?.hooks?.[0];
    if (hook === undefined) throw new Error("no PreToolUse hook built");
    const output = (await hook({ tool_name: "Write", tool_input: { file_path: filePath } } as never, undefined, {} as never)) as {
      hookSpecificOutput?: { permissionDecision?: string };
    };
    return output.hookSpecificOutput?.permissionDecision ?? "none";
  }

  it("with a spec policy, the ticket surface decides — the broad constructor policy is ignored", async () => {
    const spec: SessionSpec = {
      ...base,
      policy: { surface: ["src/**"], protectedGlobs: ["AGENTS.md"], workRoot: "/wt" },
    };
    expect(await decideWith(spec, "/wt/src/a.ts")).toBe("allow");
    expect(await decideWith(spec, "/wt/README.md")).toBe("deny");
    expect(await decideWith(spec, "/wt/AGENTS.md")).toBe("deny");
  });

  it("without a spec policy, the constructor policy still applies (init sessions, fixtures)", async () => {
    expect(await decideWith(base, "/anywhere/README.md")).toBe("allow");
  });
});

/**
 * PRDR-173 — the kernel wiring that TELLS an operator a session degraded.
 *
 * `isModelUnavailable` and the `mcpFailures` parsing are tested at the session
 * layer; the translation into `appendNote` + `appendTicketEvent` — the only
 * place an operator learns their session ran on the wrong model or without its
 * configured tools — was not. Deleting the entire 18-line wiring block left the
 * suite green.
 */
describe("PRDR-173 a degraded session is recorded where a human will see it", () => {
  it("notes a model fallback on the ticket and in the journal", async () => {
    const repo = await makeRunRepo();
    cleanups.push(() => removeTree(repo.root));
    addTicket(repo.root, { id: "t-1" });
    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(repo.root), "config.json"), "utf8")));
    const journal = RunJournal.open(repo.root);
    cleanups.push(() => journal.close());
    const backend = new MockBackend({
      implement: () => okResult({ modelFallback: { requested: "claude-fable-5-1", reason: "not served on this runtime" } }),
    });
    const core = new RefereeCore(
      { root: repo.root, backend, prompts: loadPromptSet() },
      loaded,
      journal,
      ensureRunBranch(repo.root, "degraded"),
    );
    installTrailerHook(repo.root);
    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");

    const notes = readTicket(repo.root, "t-1").notes.map((n) => n.text).join("\n");
    expect(notes, "the operator must be told the routed model was not the one that ran").toContain("model fallback");
    expect(notes).toContain("claude-fable-5-1");
    const events = readFileSync(journal.ticketJournalPath("t-1"), "utf8");
    expect(events, "and the journal carries it as a machine-readable event").toContain("model_fallback");
  });

  /**
   * SEC-4 (PRDR-179) — the extraction-site scrubs, which the seam does not cover.
   *
   * PRDR-169 scrubs at `appendNote`, so reverting any of the four extraction
   * scrubs left every note test green and all four were effectively untested.
   * What they uniquely protect is the JOURNAL: `appendTicketEvent` does not go
   * through `appendNote`, so a runtime-supplied `modelFallback.reason` reaches
   * `journal.jsonl` scrubbed only because it was scrubbed where it was read.
   */
  it("scrubs a secret out of the journal event, not only out of the note", async () => {
    const repo = await makeRunRepo();
    cleanups.push(() => removeTree(repo.root));
    addTicket(repo.root, { id: "t-1" });
    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(repo.root), "config.json"), "utf8")));
    const journal = RunJournal.open(repo.root);
    cleanups.push(() => journal.close());
    const backend = new MockBackend({
      implement: () =>
        okResult({
          modelFallback: { requested: "claude-fable-5-1", reason: "runtime refused: token=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
        }),
    });
    const core = new RefereeCore(
      { root: repo.root, backend, prompts: loadPromptSet() },
      loaded,
      journal,
      ensureRunBranch(repo.root, "scrub-journal"),
    );
    installTrailerHook(repo.root);
    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");

    const events = readFileSync(journal.ticketJournalPath("t-1"), "utf8");
    expect(events, "the journal is a record, and a record must not carry a credential").not.toContain(
      "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(events).toContain("REDACTED");
  });

  it("notes an MCP server that was configured and unavailable", async () => {
    const repo = await makeRunRepo();
    cleanups.push(() => removeTree(repo.root));
    addTicket(repo.root, { id: "t-1" });
    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(repo.root), "config.json"), "utf8")));
    const journal = RunJournal.open(repo.root);
    cleanups.push(() => journal.close());
    const backend = new MockBackend({
      implement: () => okResult({ mcpFailures: [{ name: "serena", status: "failed" }] }),
    });
    const core = new RefereeCore(
      { root: repo.root, backend, prompts: loadPromptSet() },
      loaded,
      journal,
      ensureRunBranch(repo.root, "degraded-mcp"),
    );
    installTrailerHook(repo.root);
    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");

    const notes = readTicket(repo.root, "t-1").notes.map((n) => n.text).join("\n");
    expect(notes, "a session that ran without its configured tools is not a silent success").toContain("MCP server unavailable");
    expect(notes).toContain("serena");
  });
});

/**
 * D-19 (PRDR-181) — a session launches only on a claimed ticket.
 *
 * `attempt` is driver-facing and read neither the claim nor the state, so
 * calling it on a READY, unclaimed ticket launched a real backend session from
 * the root checkout — with the claim's work directory, base snapshot and hook
 * policy all absent, because `acquire` is what establishes them.
 */
describe("D-19 attempt refuses what no claim makes legal", () => {
  async function coreFor(): Promise<{ core: RefereeCore; backend: MockBackend; root: string }> {
    const repo = await makeRunRepo();
    cleanups.push(() => removeTree(repo.root));
    addTicket(repo.root, { id: "t-1" });
    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(repo.root), "config.json"), "utf8")));
    const journal = RunJournal.open(repo.root);
    cleanups.push(() => journal.close());
    const backend = new MockBackend({ implement: () => okResult() });
    const core = new RefereeCore(
      { root: repo.root, backend, prompts: loadPromptSet() },
      loaded,
      journal,
      ensureRunBranch(repo.root, "unclaimed"),
    );
    installTrailerHook(repo.root);
    return { core, backend, root: repo.root };
  }

  it("refuses an unclaimed ticket without launching anything", async () => {
    const { core, backend } = await coreFor();
    await expect(core.attempt("t-1", "IN_PROGRESS")).rejects.toThrow(/not claimed/);
    expect(backend.calls, "a refused attempt must not have spent").toHaveLength(0);
  });

  it("refuses a ticket another worker holds", async () => {
    const { core, backend, root } = await coreFor();
    claim(root, "t-1", "someone-else", () => new Date().toISOString());
    await expect(core.attempt("t-1", "IN_PROGRESS")).rejects.toThrow(/claimed by someone-else/);
    expect(backend.calls).toHaveLength(0);
  });

  it("allows the claim holder, which is the whole point of the claim", async () => {
    const { core, backend } = await coreFor();
    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");
    expect(backend.calls, "the holder launches normally").toHaveLength(1);
  });
});

/**
 * PRDR-221 — a session with a symbol server is TOLD.
 *
 * The four read tools were allowlisted and never named: the prompt says
 * "reading and searching the repository", the session reads Read, Grep and
 * Glob, and gate-313's 113 sessions called Serena zero times. The names now
 * ride in the variable inputs when the server is ready — and only then, so a
 * root without symbols keeps its byte-identical prefix and variable (S-6).
 */
describe("PRDR-221 the inputs name the symbol tools when the server is attached", () => {
  let repo: { root: string };
  async function launchedInputs(ready: boolean): Promise<Record<string, unknown>> {
    repo = await makeRunRepo();
    cleanups.push(() => removeTree(repo.root));
    addTicket(repo.root, { id: "t-1" });
    const configPath = path.join(stateDir(repo.root), "config.json");
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const loaded = loadConfig({ ...raw, symbols: { enabled: true, command: "serena", pinned: "0.1.4" } });
    const journal = RunJournal.open(repo.root);
    cleanups.push(() => journal.close());
    const backend = new MockBackend({ implement: () => okResult() });
    const core = new RefereeCore(
      {
        root: repo.root,
        backend,
        prompts: loadPromptSet(),
        /* The seam: readiness is a probe of the machine, and the test decides the machine. */
        probeSymbols: () => (ready ? { kind: "ready", command: "serena" } : { kind: "off" }),
      },
      loaded,
      journal,
      ensureRunBranch(repo.root, ready ? "symbols-on" : "symbols-off"),
    );
    installTrailerHook(repo.root);
    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");
    const spec = backend.calls[0]?.spec;
    if (spec === undefined) throw new Error("no session launched");
    return (JSON.parse(spec.promptVariable) as { inputs: Record<string, unknown> }).inputs;
  }

  it("ready: `symbol_tools` carries the four read tools by their callable names", async () => {
    const inputs = await launchedInputs(true);
    /* PRDR-223: three — `find_implementations` was a phantom the pinned Serena never had. */
    expect(inputs["symbol_tools"]).toEqual(["mcp__serena__find_symbol", "mcp__serena__find_referencing_symbols", "mcp__serena__get_symbols_overview"]);
    expect(existsSync(path.join(repo.root, ".detent", "state", "serena-context.yml")), "the context file is written before launch").toBe(true);
  });

  it("not ready: the field is absent — the variable is what it always was", async () => {
    const inputs = await launchedInputs(false);
    expect(inputs).not.toHaveProperty("symbol_tools");
  });
});

/**
 * PRDR-229 — the right tool on the wrong tree. `symbolServer()` built the
 * server config from the ROOT, so under B-2″ every Serena process gate-313
 * launched indexed the run branch checkout while the session worked in its
 * worktree: a symbol the session just added was "not defined", its callers
 * were the last merge's. The server is now started on the work directory.
 */
describe("PRDR-229 the symbol server is started on the session's work directory", () => {
  it("under worktrees, --project names the worktree the session edits, not the root", async () => {
    const repo = await makeRunRepo();
    cleanups.push(() => removeTree(repo.root));
    addTicket(repo.root, { id: "t-1" });
    const configPath = path.join(stateDir(repo.root), "config.json");
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const loaded = loadConfig({ ...raw, symbols: { enabled: true, command: "serena", pinned: "0.1.4" } });
    const journal = RunJournal.open(repo.root);
    cleanups.push(() => journal.close());
    const backend = new MockBackend({ implement: () => okResult() });
    const core = new RefereeCore(
      { root: repo.root, backend, prompts: loadPromptSet(), worktree: true, probeSymbols: () => ({ kind: "ready", command: "serena" }) },
      loaded,
      journal,
      ensureRunBranch(repo.root, "symbols-worktree"),
    );
    installTrailerHook(repo.root);
    expect(core.acquire("t-1").ok).toBe(true);
    await core.attempt("t-1", "IN_PROGRESS");
    const spec = backend.calls[0]?.spec;
    if (spec === undefined) throw new Error("no session launched");
    expect(spec.cwd, "the session works in its worktree").toBe(path.join(repo.root, ".detent", "worktrees", "t-1"));
    const serena = (spec.mcpServers as { serena: { args: string[] } }).serena;
    expect(serena.args[serena.args.indexOf("--project") + 1], "and its symbol server indexes that tree").toBe(spec.cwd);
  });
});
