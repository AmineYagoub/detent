import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBindings } from "../../src/adapter/drift.js";
import { HOOK_STAGE_FILE, HOOK_SURFACE_FILE, stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RUN_REFEED_TEXT } from "../../src/kernel/hook-policy.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { callTool, isToolError, type RefereeToolError } from "../../src/referee/registry.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "../kernel/run-fixture.js";

/**
 * T-120/T-121 — the referee's side of the plugin containment hook (D-21,
 * D-27, D-28): the ONLY writer of `.detent/active_surface.json` and
 * `.detent/stage.json`. Claim-scoped surface (published on acquire, cleared
 * on release and on a drift unwind), run-scoped re-feed (standing while work
 * remains, gone the moment it does not), and every file TTL-bounded by the
 * X-1 wall-clock ceiling so a crashed driver cannot leave a repo's ordinary
 * sessions denied forever.
 */

const NOW = 1_770_000_000_000;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

async function makeCore(): Promise<{ root: string; core: RefereeCore }> {
  const repo = await makeRunRepo();
  cleanups.push(() => removeTree(repo.root));
  const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(repo.root), "config.json"), "utf8")));
  const journal = RunJournal.open(repo.root);
  cleanups.push(() => journal.close());
  const runBranch = ensureRunBranch(repo.root, "hook-policy");
  installTrailerHook(repo.root);
  const core = new RefereeCore(
    { root: repo.root, backend: new MockBackend(), prompts: loadPromptSet(), now: () => NOW },
    loaded,
    journal,
    runBranch,
  );
  return { root: repo.root, core };
}

const surfacePath = (root: string): string => path.join(stateDir(root), HOOK_SURFACE_FILE);
const stagePath = (root: string): string => path.join(stateDir(root), HOOK_STAGE_FILE);
const readJson = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8"));

describe("T-120/T-121 claim-scoped surface policy", () => {
  it("acquire publishes the driver policy: empty surface, D-28 denies, wall-clock TTL", async () => {
    const { root, core } = await makeCore();
    addTicket(root, { id: "t-1" });

    expect(core.acquire("t-1").ok).toBe(true);
    const policy = readJson(surfacePath(root));

    expect(policy["driver"]).toBe(true);
    expect(policy["ticket_id"]).toBe("t-1");
    expect(policy["surface"]).toEqual([]);
    expect(policy["deny_tools"]).toEqual(["Task"]);
    const bound = readBindings(root).bindings.map((b) => b.resolved);
    expect(bound.length).toBeGreaterThan(0);
    expect(policy["deny_bash_containing"]).toEqual(bound);
    expect(policy["expires_at_ms"]).toBe(NOW + 3_600_000);
  });

  it("release clears the surface policy", async () => {
    const { root, core } = await makeCore();
    addTicket(root, { id: "t-1" });
    core.acquire("t-1");
    expect(existsSync(surfacePath(root))).toBe(true);

    core.releaseTicket("t-1");
    expect(existsSync(surfacePath(root))).toBe(false);
  });
});

describe("T-120 run-scoped re-feed", () => {
  it("stands while work remains — pool entries or a live claim — and names the loop", async () => {
    const { root, core } = await makeCore();
    addTicket(root, { id: "t-1" });

    core.pool();
    const stage = readJson(stagePath(root));
    expect(stage["run_refeed"]).toBe(RUN_REFEED_TEXT);
    expect(stage["gate_cmd"]).toBeNull();

    core.acquire("t-1");
    core.pool();
    /** claimed and therefore pool-empty, but in flight: the re-feed stands */
    expect(readJson(stagePath(root))["run_refeed"]).toBe(RUN_REFEED_TEXT);
  });

  it("clears the moment no work remains", async () => {
    const { root, core } = await makeCore();
    writeFileSync(stagePath(root), `${JSON.stringify({ stale: true })}\n`);

    core.pool();
    expect(existsSync(stagePath(root))).toBe(false);
  });
});

describe("T-120 drift unwind clears both files", () => {
  it("a GATE_DRIFT halt sweeps claims AND the published policy", { timeout: 60_000 }, async () => {
    const { root, core } = await makeCore();
    addTicket(root, { id: "t-1" });

    const call = async (name: string, input: unknown): Promise<Record<string, unknown>> =>
      (await callTool(core, name, input)) as Record<string, unknown>;
    const acquired = await call("claim", { op: "acquire", ticket_id: "t-1" });
    await call("transition", { ticket_id: "t-1", ref: acquired["claimed_ref"] });
    expect(existsSync(surfacePath(root))).toBe(true);
    expect(existsSync(stagePath(root))).toBe(true);

    /** V-3: verification changes under the run — remove the bound targets. */
    writeFileSync(path.join(root, "Makefile"), ".PHONY: nothing\n\nnothing:\n\ttrue\n");
    const halted = await call("gate", { ticket_id: "t-1" });
    expect(isToolError(halted)).toBe(true);
    expect((halted as unknown as RefereeToolError).error.code).toBe("DRIFT_HALT");

    const swept = await call("record", { kind: "drift_halt" });
    expect(String(swept["reason"])).toContain("re-baseline");
    expect(existsSync(surfacePath(root))).toBe(false);
    expect(existsSync(stagePath(root))).toBe(false);
  });
});
