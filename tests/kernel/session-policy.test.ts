import { readFileSync } from "node:fs";
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
import { addTicket, makeRunRepo } from "../kernel/run-fixture.js";

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

async function specFromAttempt(): Promise<SessionSpec> {
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
    ensureRunBranch(repo.root, "session-policy"),
  );
  installTrailerHook(repo.root);
  expect(core.acquire("t-1").ok).toBe(true);
  await core.attempt("t-1", "IN_PROGRESS");
  const spec = backend.calls[0]?.spec;
  if (spec === undefined) throw new Error("no session launched");
  return spec;
}

describe("T-140 the session arm publishes the per-ticket policy", () => {
  it("surface = the ticket's declared surface plus ONLY the runs area", async () => {
    const spec = await specFromAttempt();
    expect(spec.policy?.surface).toEqual(["src/**", "tests/**", ".detent/runs/**"]);
    expect(spec.policy?.workRoot).toBe(spec.cwd);
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
