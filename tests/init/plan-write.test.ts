import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildPipeline } from "../../src/init/pipeline.js";
import { runInit } from "../../src/init/machine.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { allTickets, readTicket } from "../../src/kernel/tickets/readers.js";
import { claim } from "../../src/kernel/tickets/mutations.js";
import { ticketPath } from "../../src/kernel/tickets/paths.js";
import { BOOTSTRAP_TICKET_ID, capstoneBlockers } from "../../src/init/plan-write.js";
import { normaliseDraft } from "../../src/init/plan-slices.js";
import type { SliceSpec } from "../../src/schemas/init.js";
import { ANALYSIS, APPROVE_PLAN, BUDGETS, LONE_CANDIDATE, PROMPTS, repo } from "./plan-fixture.js";

/**
 * PRDR-118 — the write half of planning, and the guards around it.
 *
 * Everything here was reachable and unobserved: the whole path from a drafted
 * ticket to a file on disk was exercised only end to end, by fixtures that
 * always drafted well-formed ids and acyclic edges. A model does neither
 * reliably, and each of these was a way for one bad draft to corrupt state,
 * deadlock the pool, or destroy work a run was in the middle of.
 */

const ticket = (id: string, deps: string[] = [], title = `t ${id}`) => ({
  id,
  type: "feature" as const,
  title,
  description: "",
  acceptance_criteria: ["it works"],
  non_goals: [],
  surface: ["src/**"],
  depends_on: deps,
  provides: [],
  consumes: [],
  requirement_ids: [],
  baseline_ids: [],
  risk_label: false,
});

const SLICE = (id: string, dependsOn: string[] = []): SliceSpec => ({
  id,
  title: `slice ${id}`,
  goal: "g",
  requirement_ids: [],
  baseline_items: [],
  docs: [],
  depends_on: dependsOn,
  expected_tickets: 5,
  rationale: "",
});

const ONE_SLICE = { schema_version: 1, slices: [SLICE("s01")], questions: [] };

/** A planner whose PLAN draft is supplied per call, so a test can hand it a hostile one. */
const GREENFIELD_STACK = { language: "typescript", runtime: "node", test_framework: "vitest", rationale: "PRD" };

function plannerWith(draft: object, slices: object = ONE_SLICE, stack: object | null = null): StageFn {
  return (spec: SessionSpec) => {
    const artifact = spec.artifactOut.endsWith("plan-draft.json")
      ? draft
      : spec.artifactOut.endsWith("plan-review.json")
        ? APPROVE_PLAN
        : spec.artifactOut.endsWith("slices.json")
          ? slices
          : ANALYSIS(stack);
    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };
}

describe("PRDR-118 a drafted id is a file name, and the model writes it", () => {
  it("an id that would escape the plan directory is renamed; nothing outside it is touched", async () => {
    const root = repo(LONE_CANDIDATE);
    const victim = path.join(root, "package.json");
    const before = readFileSync(victim, "utf8");
    const backend = new MockBackend({
      planner: plannerWith({ schema_version: 1, tickets: [ticket("../../package"), ticket("t-s01-002")], questions: [] }),
    });

    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    expect(readFileSync(victim, "utf8"), "a ticket id must never reach a path outside the plan directory").toBe(before);
    expect(allTickets(root).map((t) => t.id)).toEqual(["t-s01-001", "t-s01-002"]);
  });

  it("two ids differing only in case become two distinct tickets, not one file and a deadlock", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({
      planner: plannerWith({
        schema_version: 1,
        tickets: [ticket("t-s01-001"), ticket("T-S01-001"), ticket("t-s01-002", ["T-S01-001"])],
        questions: [],
      }),
    });

    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    /** On a case-insensitive filesystem the plan claimed three tickets and the disk held two. */
    const ids = allTickets(root).map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
    const plan = JSON.parse(readFileSync(path.join(root, ".detent", "plan", "plan.json"), "utf8")) as { tickets: string[] };
    expect(plan.tickets.every((id) => existsSync(ticketPath(root, id)))).toBe(true);
    for (const t of allTickets(root)) for (const b of t.blockers) expect(ids).toContain(b);
  });

  it("a dependency cycle is broken and reported — it used to reach disk and deadlock the pool silently", async () => {
    const root = repo(LONE_CANDIDATE);
    const backend = new MockBackend({
      planner: plannerWith({
        schema_version: 1,
        tickets: [ticket("t-s01-001", ["t-s01-002"]), ticket("t-s01-002", ["t-s01-001"])],
        questions: [],
      }),
    });

    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    /** Something must be claimable, or the whole plan is dead on arrival. */
    const startable = allTickets(root).filter((t) => t.blockers.length === 0);
    expect(startable.length).toBeGreaterThan(0);
    expect(result.interrupt?.message).toContain("dependency cycle");
  });
});

describe("PRDR-118 slice order survives the shape the planner is told to write", () => {
  it("a ticket naming one earlier ticket is still gated by the rest of that slice", () => {
    const s01 = [ticket("t-s01-001"), ticket("t-s01-002", ["t-s01-001"]), ticket("t-s01-003", ["t-s01-002"])].map((t) => ({ ...t, slice: "s01" }));
    /** The planner is instructed to name the specific ticket it needs — the commonest shape there is. */
    const linked = { ...ticket("t-s02-001", ["t-s01-001"]), slice: "s02" };
    const all = [...s01, linked];
    const slices = [SLICE("s01"), SLICE("s02", ["s01"])];

    const blockers = capstoneBlockers(linked, slices, all);

    /** Its own edge reaches only the FIRST ticket of s01; the capstone still gates it. */
    expect(blockers).toContain("t-s01-003");
    const unlinked = { ...ticket("t-s02-002"), slice: "s02" };
    expect(capstoneBlockers(unlinked, slices, [...all, unlinked])).toEqual(["t-s01-003"]);
  });

  it("a cycle inside an earlier slice does not erase that slice's gate", () => {
    const s01 = [ticket("t-s01-001", ["t-s01-002"]), ticket("t-s01-002", ["t-s01-001"])].map((t) => ({ ...t, slice: "s01" }));
    const later = { ...ticket("t-s02-001"), slice: "s02" };
    const normalised = normaliseDraft(SLICE("s01"), s01, [], undefined);
    const blockers = capstoneBlockers(later, [SLICE("s01"), SLICE("s02", ["s01"])], [...normalised.tickets, later]);
    expect(blockers.length, "with the cycle broken, s01 has a capstone again").toBeGreaterThan(0);
  });
});

describe("PRDR-118 re-planning does not destroy work", () => {
  it("a plain `detent init` refuses to re-plan while a ticket is claimed — the guard covered only --replan", async () => {
    const root = repo(LONE_CANDIDATE);
    const draft = { schema_version: 1, tickets: [ticket("t-s01-001"), ticket("t-s01-002")], questions: [] };
    const deps = { root, backend: new MockBackend({ planner: plannerWith(draft) }), prompts: PROMPTS, budgets: BUDGETS };
    await runInit(root, buildPipeline(deps));

    claim(root, "t-s01-001", "worker-1");
    const claimed = readTicket(root, "t-s01-001");

    /** PRESENT tells the human to answer questions in the documents and re-run — while a run executes. */
    writeFileSync(path.join(root, "PRD.md"), "# spec, with the answer\n");
    const again = await runInit(root, buildPipeline(deps));

    expect(again.exitCode).toBe(2);
    expect(again.messages.join(" ")).toContain("re-planning refused");
    expect(again.messages.join(" ")).toContain("t-s01-001");
    /** Nothing moved: the claimed ticket still holds its state and its generation. */
    expect(readTicket(root, "t-s01-001")).toEqual(claimed);
    expect(allTickets(root)).toHaveLength(2);
  });

  it("deleting the plan directory re-plans from the slice caches instead of reporting READY over nothing", async () => {
    const root = repo(LONE_CANDIDATE);
    const draft = { schema_version: 1, tickets: [ticket("t-s01-001")], questions: [] };
    let planned = 0;
    const backend = new MockBackend({
      planner: (spec: SessionSpec) => {
        if (spec.artifactOut.endsWith("plan-draft.json")) planned += 1;
        return plannerWith(draft)(spec);
      },
    });
    const deps = { root, backend, prompts: PROMPTS, budgets: BUDGETS };
    await runInit(root, buildPipeline(deps));
    expect(planned).toBe(1);

    rmSync(path.join(root, ".detent", "plan"), { recursive: true, force: true });
    mkdirSync(path.join(root, ".detent", "plan"), { recursive: true });
    const again = await runInit(root, buildPipeline(deps));

    expect(allTickets(root).map((t) => t.id)).toEqual(["t-s01-001"]);
    expect(again.messages.join(" ")).toContain("no longer on disk");
    /** The slice cache is intact, so the plan is rewritten without paying to plan it again. */
    expect(planned, "re-planning a deleted directory must not re-run the planner").toBe(1);
  });

  it("a DONE bootstrap is preserved, and a stale blocker it carries is dropped rather than crashing the write", async () => {
    const root = repo({ "PRD.md": "# build it\n" });
    const first = { schema_version: 1, tickets: [ticket("t-s01-001"), ticket("t-s01-002", ["t-s01-001"])], questions: [] };
    const backend = new MockBackend({ planner: plannerWith(first, ONE_SLICE, GREENFIELD_STACK) });
    await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));

    /** Finish the scaffolding and one ticket, as a real run would. */
    for (const id of [BOOTSTRAP_TICKET_ID, "t-s01-002"]) {
      const t = readTicket(root, id);
      writeFileSync(ticketPath(root, id), `${JSON.stringify({ ...t, state: "DONE" }, null, 2)}\n`);
    }
    const bootstrapBefore = readTicket(root, BOOTSTRAP_TICKET_ID);

    /** The new plan drops t-s01-001, which the DONE t-s01-002 still names as a blocker. */
    const second = { schema_version: 1, tickets: [ticket("t-s01-002"), ticket("t-s01-003")], questions: [] };
    const backend2 = new MockBackend({ planner: plannerWith(second, ONE_SLICE, GREENFIELD_STACK) });
    const again = await runInit(root, buildPipeline({ root, backend: backend2, prompts: PROMPTS, budgets: BUDGETS }), { replan: true });

    expect(again.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    /** The bootstrap keeps its DONE state and its history rather than being rebuilt. */
    expect(readTicket(root, BOOTSTRAP_TICKET_ID)).toEqual(bootstrapBefore);
    expect(readTicket(root, BOOTSTRAP_TICKET_ID).state).toBe("DONE");
    /** The plan artifact exists and names nothing it does not contain. */
    const plan = JSON.parse(readFileSync(path.join(root, ".detent", "plan", "plan.json"), "utf8")) as { tickets: string[]; edges: { from: string }[] };
    expect(plan.edges.every((e) => plan.tickets.includes(e.from))).toBe(true);
    expect(readTicket(root, "t-s01-002").blockers).not.toContain("t-s01-001");
  });

  it("a DONE ticket whose id the new plan reuses for different work is kept and flagged, never silently swapped", async () => {
    const root = repo(LONE_CANDIDATE);
    const first = { schema_version: 1, tickets: [ticket("t-s01-001", [], "Add health endpoint")], questions: [] };
    await runInit(root, buildPipeline({ root, backend: new MockBackend({ planner: plannerWith(first) }), prompts: PROMPTS, budgets: BUDGETS }));
    const done = readTicket(root, "t-s01-001");
    writeFileSync(ticketPath(root, "t-s01-001"), `${JSON.stringify({ ...done, state: "DONE" }, null, 2)}\n`);

    const second = { schema_version: 1, tickets: [ticket("t-s01-001", [], "Implement OAuth callback")], questions: [] };
    const again = await runInit(
      root,
      buildPipeline({ root, backend: new MockBackend({ planner: plannerWith(second) }), prompts: PROMPTS, budgets: BUDGETS }),
      { replan: true },
    );

    expect(readTicket(root, "t-s01-001").title).toBe("Add health endpoint");
    expect(again.interrupt?.message).toContain("Implement OAuth callback");
    expect(again.interrupt?.message).toContain("is NOT in the plan");
  });
});

/** A-1⁶ (PRDR-206): the analysis names the scaffold; the bootstrap provides it; the check resolves it. */
describe("A-1⁶ the bootstrap ticket provides the scaffold files the analysis names", () => {
  it("provides each as a file contract, and a ticket consuming one is no longer a finding at PRESENT", async () => {
    /* Greenfield: a document and nothing else, so ANALYZE chooses the stack and C-4 constructs the bootstrap. */
    const root = repo({ "PRD.md": "# build it\n" });
    const stack = { language: "TypeScript", runtime: "Node.js 22", test_framework: "vitest", rationale: "", scaffold_files: ["package.json", "tsconfig.json"] };
    const draft = {
      schema_version: 1,
      tickets: [
        ticket("t-s01-001"),
        { ...ticket("t-s01-002", ["t-s01-001"]), consumes: [{ kind: "file", id: "package.json" }] },
      ],
      questions: [],
    };
    const backend = new MockBackend({ planner: plannerWith(draft, ONE_SLICE, stack) });
    const result = await runInit(root, buildPipeline({ root, backend, prompts: PROMPTS, budgets: BUDGETS }));
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");

    const bootstrap = readTicket(root, BOOTSTRAP_TICKET_ID);
    expect(bootstrap.provides.map((p) => `${p.kind}:${p.id}`)).toEqual(["file:package.json", "file:tsconfig.json"]);
    /* Before PRDR-206 PRESENT said `consumes the file package.json, which no ticket creates` — proved by code, and false. */
    expect(result.interrupt?.message ?? "").not.toContain("`package.json`, which no ticket creates");
  });
});
