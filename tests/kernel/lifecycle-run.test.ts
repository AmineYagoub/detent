import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindAll } from "../../src/adapter/bind.js";
import { discover } from "../../src/adapter/discover/index.js";
import { writeBindings } from "../../src/adapter/drift.js";
import { bodyHash, recordApprovals } from "../../src/adapter/lifecycle.js";
import { initLayout, writeArtifact } from "../../src/fs/layout.js";
import { buildDossier, dossierSummary } from "../../src/kernel/dossier.js";
import { boundTestRunner } from "../../src/kernel/falsify.js";
import { runsDir } from "../../src/kernel/journal.js";
import { EXIT_OK, run } from "../../src/kernel/run.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, gitInit, tmpTree } from "../helpers.js";
import { addTicket, approveFixturePlan, implementGreen, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * V-1⁷ (PRDR-233), end to end through `run` with real npm: a gate that needs
 * its `pretest` goes green once an operator approved that body, and stays red
 * without it, with the red gate's record naming the script Detent did not run.
 * The falsification probe runs the same siblings, and the dossier an operator
 * reads carries the note.
 */

const PRETEST = "touch GENERATED";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function npmRepo(scripts: Record<string, string> = { pretest: PRETEST, test: "test -f GENERATED", lint: "true" }): Promise<string> {
  const root = tmpTree({
    "package.json": `${JSON.stringify({ name: "fixture", private: true, version: "1.0.0", scripts }, null, 2)}\n`,
    "src/calc.py": "def totals(x):\n    return sum(x)\n",
    "AGENTS.md": "# Rules\n- only what the ticket says\n",
    ".gitignore": "GENERATED\nnode_modules/\n",
    "PRD.md": "# demo\n",
  });
  gitInit(root);
  initLayout(root);
  writeArtifact(root, "config.json", {
    budgets: { run_spend_usd: 999 },
    protected: ["tickets/**", "AGENTS.md"],
    risk: [],
    model_routing: {},
    pinned: { agent_sdk: "0.3.280", claude_code: "2.1.191" },
  });
  const report = await bindAll(discover(root), { root, timeoutMs: 60_000, redact: (t) => t });
  if (report.interrupts.length > 0) throw new Error(`fixture binding interrupted: ${JSON.stringify(report.interrupts)}`);
  writeBindings(root, { bindings: [...report.bindings], skips: [] });
  approveFixturePlan(root);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  addTicket(root, { id: "t1" });
  return root;
}

const approvePretest = (root: string, body = PRETEST): void =>
  recordApprovals(root, [{ package: ".", script: "pretest", body, sha256: bodyHash(body) }], "2026-10-02T10:00:00.000Z", "operator");

const backend = (): MockBackend => new MockBackend({ implement: implementGreen, review: reviewApprove });

describe("V-1⁷ a run executes the approved siblings of a bound npm gate (PRDR-233)", () => {
  it("a ticket whose test needs its pretest reaches DONE once the pretest's body is approved", async () => {
    const root = await npmRepo();
    approvePretest(root);
    const outcome = await run({ root, backend: backend(), prompts: loadPromptSet(), runId: "test" });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
  }, 300_000);

  it("without the approval the gate is red, and its record names the script Detent did not run and the verb that approves it", async () => {
    const root = await npmRepo();
    approvePretest(root, "touch SOMETHING-ELSE");
    const outcome = await run({ root, backend: backend(), prompts: loadPromptSet(), runId: "test" });
    expect(outcome.exitCode).not.toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).not.toBe("DONE");
    const failure = JSON.parse(readFileSync(path.join(runsDir(root, "t1"), "last_failure.json"), "utf8")) as { lifecycle_not_run?: string };
    expect(failure.lifecycle_not_run).toContain("pretest (edited since approved)");
    expect(failure.lifecycle_not_run).toContain("detent verify lifecycle --approve <script>");
  }, 300_000);

  it("a ticket whose test needs its postinstall reaches DONE once that body is approved: the referee's install runs it", async () => {
    const root = await npmRepo({ postinstall: "touch GENERATED", test: "test -f GENERATED", lint: "true" });
    recordApprovals(root, [{ package: ".", script: "postinstall", body: "touch GENERATED", sha256: bodyHash("touch GENERATED") }], "2026-10-02T10:00:00.000Z", "operator");
    const outcome = await run({ root, backend: backend(), prompts: loadPromptSet(), runId: "test" });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, "t1").state).toBe("DONE");
  }, 300_000);

  it("the run-wide switch still lifts suppression for a project with no record, and lifts nothing for one with a record", async () => {
    vi.stubEnv("DETENT_ALLOW_LIFECYCLE_SCRIPTS", "1");
    const scripts = { install: "touch INSTALLED", test: "test -f INSTALLED", lint: "true" };
    const bare = await npmRepo(scripts);
    await run({ root: bare, backend: backend(), prompts: loadPromptSet(), runId: "test" });
    expect(readTicket(bare, "t1").state, "no record: the blunt switch, as V-1⁶ ships it").toBe("DONE");
    const recorded = await npmRepo(scripts);
    approvePretest(recorded);
    await run({ root: recorded, backend: backend(), prompts: loadPromptSet(), runId: "test" });
    expect(readTicket(recorded, "t1").state, "a record: only approved scripts run, and `install` is not one").not.toBe("DONE");
  }, 300_000);

  it("the run-wide switch lifts the gate's own suppression too, where no record exists: npm runs the pretest itself", async () => {
    vi.stubEnv("DETENT_ALLOW_LIFECYCLE_SCRIPTS", "1");
    const root = await npmRepo();
    await run({ root, backend: backend(), prompts: loadPromptSet(), runId: "test" });
    expect(readTicket(root, "t1").state, "no record and no approval: only npm itself can have run the pretest").toBe("DONE");
  }, 300_000);

  it("the falsification probe runs the approved siblings too, and only those", async () => {
    const root = await npmRepo();
    expect(await boundTestRunner(root, "HEAD", 60_000)(root, []), "red: the pretest is not approved").toBe(false);
    expect(existsSync(path.join(root, "GENERATED"))).toBe(false);
    approvePretest(root);
    expect(await boundTestRunner(root, "HEAD", 60_000)(root, [])).toBe(true);
  }, 300_000);

  it("the falsification probe reads the run-wide switch as the run does", async () => {
    vi.stubEnv("DETENT_ALLOW_LIFECYCLE_SCRIPTS", "1");
    const root = await npmRepo();
    expect(await boundTestRunner(root, "HEAD", 60_000)(root, []), "no record: npm runs the pretest itself").toBe(true);
  }, 300_000);
});

describe("V-1⁷ the dossier an operator reads carries the note (PRDR-233)", () => {
  it("puts the last red gate's note on the dossier and its one-screen summary", async () => {
    const { root } = await makeRunRepo();
    addTicket(root, { id: "t1" });
    const note = "Detent did not run these declared lifecycle scripts, which it runs only once an operator approves each body (V-1⁷): pretest (not approved).";
    mkdirSync(runsDir(root, "t1"), { recursive: true });
    writeFileSync(path.join(runsDir(root, "t1"), "last_failure.json"), `${JSON.stringify({ cmd: "npm run test", exit: 1, signature: "sig", lifecycle_not_run: note })}\n`);
    const ticket = readTicket(root, "t1");
    const dossier = buildDossier(root, ticket, "ladder exhausted");
    expect(dossier.lifecycle_not_run).toBe(note);
    expect(dossierSummary(ticket, dossier)).toContain(note);
    writeFileSync(path.join(runsDir(root, "t1"), "last_failure.json"), `${JSON.stringify({ cmd: "npm run test", exit: 1, signature: "sig" })}\n`);
    expect(buildDossier(root, ticket, "ladder exhausted").lifecycle_not_run, "absent when Detent ran every one").toBeUndefined();
  });
});
