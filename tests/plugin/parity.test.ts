import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../../src/kernel/git.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { RefereeCore } from "../../src/kernel/referee.js";
import { runWithConfig } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { TOOL_NAMES } from "../../src/referee/registry.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "../kernel/run-fixture.js";
import { SKILL_TABLE_STATES, skillDriver } from "./skill-driver.js";

/**
 * T-120/T-123 — the model driver's program, executed scripted (D-27, R-2,
 * C-9′…C-13′).
 *
 * T-120's keyless AC: the skill's published program completes a run over the
 * referee against the fixture backend, using nothing but the R-1 tools.
 * T-123's AC: on twin repositories with a FIXED injected clock and the same
 * run id, the scripted model driver and the headless deterministic driver
 * produce **byte-identical `transitions.jsonl`** — the admitted sequence does
 * not depend on who sequences. The live halves (a real model executing the
 * same skill; budgets provably hard in-session) are T-124's exit.
 */

const NOW = 1_770_000_000_000;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

const GREEN_SCRIPT = () => ({ implement: implementGreen, review: reviewApprove });

async function modelDrive(root: string): Promise<Awaited<ReturnType<typeof skillDriver>>> {
  const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(root), "config.json"), "utf8")));
  const journal = RunJournal.open(root);
  try {
    const runBranch = ensureRunBranch(root, "parity");
    installTrailerHook(root);
    const core = new RefereeCore(
      { root, backend: new MockBackend(GREEN_SCRIPT()), prompts: loadPromptSet(), now: () => NOW },
      loaded,
      journal,
      runBranch,
    );
    return await skillDriver(core);
  } finally {
    journal.close();
  }
}

function journalBytes(root: string): string {
  return readFileSync(path.join(stateDir(root), "transitions.jsonl"), "utf8");
}

describe("T-120 the skill's program completes a run over the referee (scripted model)", () => {
  it("single ticket: claim → implement → review → close-check → DONE, via referee tools alone", { timeout: 60_000 }, async () => {
    const repo = await makeRunRepo();
    cleanups.push(() => removeTree(repo.root));
    addTicket(repo.root, { id: "t-1" });

    const outcome = await modelDrive(repo.root);

    expect(outcome.exit).toBe("ok");
    expect(readTicket(repo.root, "t-1").state).toBe("DONE");
    for (const tool of outcome.toolsUsed) {
      expect(TOOL_NAMES as readonly string[], `${tool} is not an R-1 tool`).toContain(tool);
    }
  });

  it("the skill body documents every state the driver's table handles (the program IS the doc)", () => {
    const body = readFileSync(path.join(import.meta.dirname, "..", "..", "skills", "run", "SKILL.md"), "utf8");
    for (const state of [...SKILL_TABLE_STATES, "DONE", "NEEDS_HUMAN", "BLOCKED"]) {
      expect(body, state).toContain(state);
    }
  });

  it("the D-13 escalate reason is ONE literal across driver, harness, and skill", () => {
    /**
     * The green fixture never enters INFORMED_FIX, so byte-parity cannot pin
     * this string — a docs lock does. Three tellers, one sentence.
     */
    const literal = "informed fix failed — the ladder cannot reopen (D-13)";
    const roots = path.join(import.meta.dirname, "..", "..");
    for (const file of ["src/kernel/driver.ts", "tests/plugin/skill-driver.ts", "skills/run/SKILL.md"]) {
      expect(readFileSync(path.join(roots, file), "utf8"), file).toContain(literal);
    }
  });
});

describe("T-123 cross-driver parity (ARCH-2)", () => {
  it("twin repos, fixed clock: model-driven and headless journals are byte-identical", { timeout: 120_000 }, async () => {
    const model = await makeRunRepo();
    const headless = await makeRunRepo();
    cleanups.push(() => removeTree(model.root));
    cleanups.push(() => removeTree(headless.root));
    for (const root of [model.root, headless.root]) {
      addTicket(root, { id: "t-1" });
      addTicket(root, { id: "t-2" });
    }

    const modelOutcome = await modelDrive(model.root);

    const loaded = loadConfig(JSON.parse(readFileSync(path.join(stateDir(headless.root), "config.json"), "utf8")));
    const headlessOutcome = await runWithConfig(
      {
        root: headless.root,
        backend: new MockBackend(GREEN_SCRIPT()),
        prompts: loadPromptSet(),
        now: () => NOW,
        runId: "parity",
        worker: "w1",
      },
      loaded,
    );

    expect(modelOutcome.exit).toBe("ok");
    expect(headlessOutcome.exitCode).toBe(0);
    expect(readTicket(model.root, "t-2").state).toBe("DONE");

    const modelJournal = journalBytes(model.root);
    expect(modelJournal.length).toBeGreaterThan(0);
    expect(modelJournal).toBe(journalBytes(headless.root));
  });
});
