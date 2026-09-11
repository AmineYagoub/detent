import { afterEach, describe, expect, it } from "vitest";
import { readBindings, writeBindings } from "../../src/adapter/drift.js";
import { BOOTSTRAP_TICKET_ID } from "../../src/init/plan-write.js";
import { ensureRunBranch } from "../../src/kernel/git.js";
import { EXIT_OK, run } from "../../src/kernel/run.js";
import { writeTicket } from "../../src/kernel/tickets/mutations.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import type { Binding } from "../../src/schemas/records.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { git, removeTree, writeTree } from "../helpers.js";
import { addTicket, approveFixturePlan, makeRunRepo, reviewApprove } from "./run-fixture.js";

/**
 * PRDR-218 — a baseline taken from the wrong tree.
 *
 * C-4 finalizes greenfield's provisional bindings when bootstrap #1's gates
 * pass, by rediscovering the tooling the bootstrap created. `finalizeDone` ran
 * that discovery on the ROOT, before the merge — and under B-2″'s default
 * worktrees the scaffold is not there yet. gate-313 noted, twice, "test, lint,
 * typecheck, build stayed provisional — nothing discoverable backs them", and
 * V-3 was exempt for the whole build. The 3.1.0 gate, run without worktrees,
 * promoted 4 of 4.
 */

const PROMPTS = loadPromptSet();
const SLOTS = ["test", "lint", "typecheck", "build"] as const;
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const provisional = (slot: string): Binding => ({
  schema_version: 1,
  slot: slot as Binding["slot"],
  adapter: "greenfield:typescript",
  ref: `npm run ${slot}`,
  resolved: `npm run ${slot}`,
  config_hash: "a".repeat(64),
  executed_at: "2026-09-11T00:00:00.000Z",
  approved_by: "auto",
  status: "provisional",
});

/** A greenfield root: the documents, no tooling, four provisional bindings, and the bootstrap ticket. */
async function greenfieldRepo(): Promise<string> {
  const { root } = await makeRunRepo();
  roots.push(root);
  git(root, "rm", "-q", "-r", "Makefile", "scripts");
  git(root, "commit", "-q", "-m", "greenfield: the documents and nothing else");
  writeBindings(root, { bindings: SLOTS.map(provisional), skips: [] });
  addTicket(root, { id: BOOTSTRAP_TICKET_ID, surface: ["**"] });
  return root;
}

const SCAFFOLD = JSON.stringify(
  { name: "new", private: true, scripts: Object.fromEntries(SLOTS.map((s) => [s, 'node -e "process.exit(0)"'])) },
  null,
  2,
);

/** Bootstrap #1: writes the scaffold into ITS OWN tree and commits it. */
const scaffoldGreen: StageFn = (spec) => {
  writeTree(spec.cwd, { "package.json": `${SCAFFOLD}\n` });
  git(spec.cwd, "add", "-A");
  git(spec.cwd, "commit", "-q", "-m", `${spec.ticketId}: scaffold`);
  return okResult();
};

const statuses = (root: string): Record<string, string> =>
  Object.fromEntries(readBindings(root).bindings.map((b) => [b.slot, `${b.status}:${b.adapter}`]));

describe("PRDR-218 the bootstrap's baseline is taken from the tree that passed", () => {
  it("in worktree mode, every provisional slot the scaffold backs is promoted at finalize", async () => {
    const root = await greenfieldRepo();
    const outcome = await run({
      root,
      backend: new MockBackend({ implement: scaffoldGreen, review: reviewApprove }),
      prompts: PROMPTS,
      runId: "bootstrap",
      worktree: true,
      ecosystems: [],
    });
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(readTicket(root, BOOTSTRAP_TICKET_ID).state).toBe("DONE");
    /* Before PRDR-218: all four `provisional:greenfield:typescript` — discovery ran on a root without the scaffold. */
    expect(statuses(root)).toEqual(Object.fromEntries(SLOTS.map((s) => [s, "approved:node-scripts"])));
    expect(JSON.stringify(readTicket(root, BOOTSTRAP_TICKET_ID).notes)).toContain("4 provisional binding(s) finalized");
  }, 60_000);

  it("a root the defect already left behind heals at the next pool: DONE bootstrap, merged scaffold, provisional bindings", async () => {
    const root = await greenfieldRepo();
    /* The aftermath, built directly: the scaffold is on the run branch, the bootstrap is DONE, the bindings never moved. */
    ensureRunBranch(root, "late");
    writeTree(root, { "package.json": `${SCAFFOLD}\n` });
    git(root, "add", "package.json");
    git(root, "commit", "-q", "-m", "merge t-001-bootstrap");
    const ticket = readTicket(root, BOOTSTRAP_TICKET_ID);
    const [generation] = ticket.generations;
    writeTicket(root, { ...ticket, state: "DONE", generations: [{ ...generation!, outcome: "done", ended_at: "2026-09-11T08:04:34.000Z" }] });
    approveFixturePlan(root);
    expect(statuses(root)[SLOTS[0]]).toBe("provisional:greenfield:typescript");

    const outcome = await run({ root, backend: new MockBackend({}), prompts: PROMPTS, runId: "late", worktree: true, ecosystems: [] });
    expect(outcome.exitCode).toBe(EXIT_OK);
    /* Before PRDR-218: nothing looked at the bindings again; provisional for the rest of the build. */
    expect(statuses(root)).toEqual(Object.fromEntries(SLOTS.map((s) => [s, "approved:node-scripts"])));
    expect(JSON.stringify(readTicket(root, BOOTSTRAP_TICKET_ID).notes)).toContain("PRDR-218");
  }, 60_000);
});


/** Audit of PRDR-218: a slot nothing backs stays provisional WITHOUT a note per pool. */
describe("audit of PRDR-218: the late promotion speaks only when it promotes", () => {
  const lateNotes = (root: string): number =>
    readTicket(root, BOOTSTRAP_TICKET_ID).notes.filter((n) => n.text.includes("late (PRDR-218)")).length;

  it("two slots backed, two not: one note on the first pool, none on the next", async () => {
    const root = await greenfieldRepo();
    ensureRunBranch(root, "partial");
    const partial = { name: "new", private: true, scripts: { test: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"' } };
    writeTree(root, { "package.json": `${JSON.stringify(partial, null, 2)}\n` });
    git(root, "add", "package.json");
    git(root, "commit", "-q", "-m", "merge t-001-bootstrap");
    const ticket = readTicket(root, BOOTSTRAP_TICKET_ID);
    const [generation] = ticket.generations;
    writeTicket(root, { ...ticket, state: "DONE", generations: [{ ...generation!, outcome: "done", ended_at: "2026-09-11T08:04:34.000Z" }] });
    approveFixturePlan(root);

    const options = { root, prompts: PROMPTS, worktree: true, ecosystems: [] } as const;
    expect((await run({ ...options, backend: new MockBackend({}), runId: "partial" })).exitCode).toBe(EXIT_OK);
    expect(statuses(root)).toEqual({
      test: "approved:node-scripts",
      lint: "approved:node-scripts",
      typecheck: "provisional:greenfield:typescript",
      build: "provisional:greenfield:typescript",
    });
    expect(lateNotes(root)).toBe(1);

    /* A second run: typecheck and build are still unbacked, and that is not news. */
    expect((await run({ ...options, backend: new MockBackend({}), runId: "partial-2" })).exitCode).toBe(EXIT_OK);
    expect(lateNotes(root), "no note for a pool that promoted nothing").toBe(1);
  }, 60_000);
});
