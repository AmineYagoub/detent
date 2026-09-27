import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { launchInitSession, withInitJournal } from "../../src/init/session.js";
import { run } from "../../src/kernel/run.js";
import type { RoleId } from "../../src/schemas/roles.js";
import type { SessionBackend, SessionSpec } from "../../src/sessions/backend.js";
import { toolsForRole } from "../../src/sessions/guard.js";
import { MockBackend, okResult } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { buildOptions, type SdkBackendConfig } from "../../src/sessions/sdk.js";
import { removeTree } from "../helpers.js";
import { PROMPTS as INIT_PROMPTS, repo } from "../init/plan-fixture.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "../kernel/run-fixture.js";

/**
 * PRDR-302 (S-1⁵) — a headless session's built-in tools are the ones its role
 * was given.
 *
 * S-1‴ sets tools per role, and the plugin's agent files bind them. The SDK
 * backend ran every session in the `default` mode with its role's allowlist,
 * and passed a base set of built-in tools for the planning roles alone (C-4⁵).
 * The mode approves a read-only shell command before any allow rule is read,
 * so on tabachir's first live `init` an `audit` session, whose allowlist is
 * Read, Grep, Glob, WebSearch and its artifact's write, ran `ls` and `git log`.
 */

const CONFIG: SdkBackendConfig = { policy: { surface: ["src/**"], protectedGlobs: [], workRoot: "/wt" } };
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const sorted = (tools: unknown): string[] => [...((tools as string[] | undefined) ?? [])].sort();

/** A bare spec for `role` whose allowlist is `allowedTools`. */
const bare = (role: RoleId, allowedTools: readonly string[]): SessionSpec => ({
  role,
  ticketId: "t1",
  promptPrefix: "p",
  promptVariable: "{}",
  cwd: "/wt",
  artifactOut: `/wt/.detent/runs/t1/${role}.json`,
  allowedTools,
  permissionMode: "",
  model: "",
});

/** The spec an init launch of `role` hands its backend. */
async function initSpec(role: "audit" | "spec_write" | "planner", extra: { readonly surface?: readonly string[]; readonly stage?: string } = {}): Promise<SessionSpec> {
  const root = repo();
  roots.push(root);
  let seen: SessionSpec | undefined;
  const backend: SessionBackend = {
    name: "capturing",
    checkVersion: async () => {},
    run: async (spec) => {
      seen = spec;
      writeFileSync(spec.artifactOut, "{}\n");
      return okResult();
    },
  };
  await withInitJournal(root, async (journal) =>
    await launchInitSession(
      { root, backend, prompts: INIT_PROMPTS, spendCeiling: 100, journal },
      {
        role,
        inputs: extra.stage === undefined ? {} : { stage: extra.stage },
        artifactOut: path.join(stateDir(root), "state", `${role}.json`),
        ...(extra.surface === undefined ? {} : { surface: extra.surface }),
      },
    ),
  );
  return seen as SessionSpec;
}

describe("PRDR-302 a headless session's built-in tools are the ones its role was given (S-1⁵)", () => {
  it("AC 6: an `audit` session is given Read, Grep, Glob, WebSearch and its artifact's Write, and no shell", async () => {
    const spec = await initSpec("audit");

    const options = buildOptions(spec, CONFIG);

    expect(sorted(options.tools)).toEqual(["Glob", "Grep", "Read", "WebSearch", "Write"]);
    expect(options.tools).not.toContain("Bash");
  });

  it("each rule's specifier names its tool, and an MCP tool is no built-in", () => {
    const allowed = ["Read", "Write(//wt/.detent/x.json)", "Bash(git add:*)", "Bash(git commit:*)", "WebFetch(domain:docs.example.org)", "mcp__symbols__find_symbol"];

    expect(buildOptions(bare("implement", allowed), CONFIG).tools).toEqual(["Read", "Write", "Bash", "WebFetch"]);
  });

  it("a session that declares a surface is given Edit and Write for it, and still no shell (S-1‴)", async () => {
    const spec = await initSpec("spec_write", { surface: ["docs/**"] });

    expect(sorted(buildOptions(spec, CONFIG).tools)).toEqual(["Edit", "Glob", "Grep", "Read", "Write"]);
  });

  it("a spec that names its own base set keeps it: the planning roles' (C-4⁵)", async () => {
    const spec = await initSpec("planner", { stage: "PLAN" });

    expect(spec.tools).toEqual(["Read", "Grep", "Glob", "Write"]);
    expect(buildOptions(spec, CONFIG).tools).toEqual(["Read", "Grep", "Glob", "Write"]);
    /* The planners' set is also what their allowlist names; one that is not shows the spec's own is what is kept. */
    expect(buildOptions({ ...bare("review", ["Read", "Grep", "Glob"]), tools: ["Read"] }, CONFIG).tools).toEqual(["Read"]);
  });

  it("an MCP server's tools stay reachable where the allowlist names them", () => {
    const options = buildOptions(bare("review", ["Read", "Grep", "Glob", "mcp__symbols__find_symbol", "Write(//wt/.detent/runs/t1/review.json)"]), CONFIG);

    expect(sorted(options.tools)).toEqual(["Glob", "Grep", "Read", "Write"]);
    expect(options.allowedTools).toContain("mcp__symbols__find_symbol");
  });

  it("`run`'s sessions too: a review has no shell, and an implement session has its git verbs' Bash", { timeout: 60_000 }, async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t1" });
    const backend = new MockBackend({ implement: implementGreen, review: reviewApprove });

    await run({ root, backend, prompts: loadPromptSet(), runId: "tools" });

    const toolsOf = (role: string): string[] => sorted(buildOptions(backend.calls.find((c) => c.role === role)!.spec, CONFIG).tools);
    expect(toolsOf("review")).toEqual(["Glob", "Grep", "Read", "Write"]);
    expect(toolsOf("implement")).toEqual(["Bash", "Edit", "Glob", "Grep", "Read", "Write"]);
    /* One list, the guard's, which the plugin build writes into each agent file (ARCH-2). */
    expect(backend.calls.find((c) => c.role === "implement")!.spec.allowedTools).toEqual(expect.arrayContaining(toolsForRole("implement")));
  });

  it("the two drivers agree: each agent file's tools are the headless base set of its role's list", () => {
    for (const role of ["review", "diagnose", "research", "implement"] as const) {
      const file = readFileSync(path.join("agents", `${role}.md`), "utf8");
      const listed = (/^tools: (.*)$/mu.exec(file)?.[1] ?? "").split(", ").map((t) => t.replace(/\(.*$/su, ""));
      expect(sorted(buildOptions(bare(role, toolsForRole(role)), CONFIG).tools), role).toEqual([...new Set(listed)].sort());
    }
  });
});
