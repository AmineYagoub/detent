import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import { MockBackend, type StageFn } from "../../src/sessions/mock.js";
import { LONE_CANDIDATE, repo } from "./plan-fixture.js";
import { scriptedPlanner, ticket } from "./slicing-fixture.js";
import type { Json } from "./decide-fixture.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { writeTicket } from "../../src/kernel/tickets/mutations.js";
import { RAW, WROTE, initThroughWrite, packFor, read, write, writeOutputs, writesPack, type Write } from "./write-fixture.js";

/**
 * PRDR-283 — what the phases after WRITE read, and what the next `init` does
 * with a pack WRITE wrote (C-2⁶, C-2¹³). The whole pipeline runs, with
 * scripted sessions, in an existing project whose lone test script binds
 * without a question.
 */

const PROJECT = { ...LONE_CANDIDATE, ...RAW };
const PACK_DOCS = ["README.md", DECISION_LOG_PATH, "docs/prd/01-lending.md", "docs/prd/index.md", "docs/research/verified-facts.md"];

const LENDING_SLICE = {
  schema_version: SCHEMA_VERSION,
  slices: [
    { id: "s01", title: "lending", goal: "loans work", requirement_ids: ["LND-F-001"], baseline_items: [], docs: ["docs/prd/01-lending.md"], depends_on: [], expected_tickets: 2, rationale: "" },
  ],
  questions: [],
};
const draft = (): object => ({ schema_version: SCHEMA_VERSION, tickets: [ticket("t-s01-001"), ticket("t-s01-002", ["t-s01-001"])], questions: [] });
const approve = (): object => ({ schema_version: SCHEMA_VERSION, verdict: "approve", findings: [] });

interface Seen {
  readonly backend: { current: MockBackend | null };
  readonly planned: Json[];
}

/** One `init` of the whole pipeline; `seen` keeps its backend and every planner session's inputs. */
async function init(root: string, stub: Write, notes: string[] = []): Promise<Awaited<ReturnType<typeof initThroughWrite>> & Seen> {
  const seen: Seen = { backend: { current: null }, planned: [] };
  const planner: StageFn = scriptedPlanner({ slices: LENDING_SLICE, draft, review: approve }, [], seen.planned);
  const result = await initThroughWrite(root, stub, {
    all: true,
    notes,
    script: { planner },
    backend: (script) => (seen.backend.current = new MockBackend(script)),
  });
  return { ...result, ...seen };
}

const sessions = (seen: Seen): string[] => seen.backend.current?.rolesLaunched() ?? [];

describe("PRDR-283: the phases after WRITE plan from the pack (C-2⁶)", () => {
  it("hands ANALYZE and SLICE the pack and its context documents, never an original it archived", async () => {
    const root = repo(PROJECT);
    const first = await init(root, writesPack());
    expect(first.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    const analyze = first.planned.find((i) => i["stage"] === undefined && i["expected_output"] !== undefined);
    expect(analyze?.["docs"]).toEqual(PACK_DOCS);
    expect(first.planned.find((i) => i["stage"] === "SLICE")?.["docs"]).toEqual(PACK_DOCS);
    const drafted = first.planned.find((i) => i["stage"] === "PLAN");
    expect(drafted?.["docs"]).toEqual(["docs/prd/01-lending.md", DECISION_LOG_PATH]);
  });

  it("re-plans nothing on the next init, though DISCOVER finds the pack where the originals were", async () => {
    const root = repo(PROJECT);
    await init(root, writesPack());
    const notes: string[] = [];
    const again = await init(root, writesPack(), notes);
    expect(again.executed).toEqual(["DISCOVER", "AUDIT", "DECIDE"]);
    expect(again.reachedPhase, "PRESENT asks for the approval the first run deferred").toBe("PRESENT");
    expect(again.reused).toEqual(expect.arrayContaining(["WRITE", "ANALYZE", "DETERMINE_VERIFICATION", "SLICE", "PLAN", "PREPARE_AGENTS"]));
    expect(sessions(again), "no session of any role").toEqual([]);
    const said = notes.join("\n");
    expect(said).toMatch(/the documents are the pack WRITE wrote on \d{4}-\d{2}-\d{2}, which nothing has validated/u);
    expect(said).toContain("AUDIT: the documents are the pack WRITE wrote from documents AUDIT already read, so nothing is audited again");
    expect(said).toContain("DECIDE: the documents are the pack WRITE wrote from what DECIDE decided, so nothing is decided again");
  });

  it("re-runs WRITE without a session for an edit to the pack, and replays the planning phases from it", async () => {
    const root = repo(PROJECT);
    await init(root, writesPack());
    await init(root, writesPack());
    appendFileSync(path.join(root, "docs", "prd", "01-lending.md"), "- **LND-F-004** [M1] A loan MUST name its tool (X-1).\n");
    const edited = await init(root, writesPack());
    expect(edited.executed).toEqual(expect.arrayContaining(["WRITE", "ANALYZE", "SLICE", "PLAN"]));
    expect(sessions(edited).filter((r) => r === "spec_write"), "WRITE writes nothing over a pack").toEqual([]);
    expect(edited.replayedFrom).toBe("DISCOVER");
  });

  it("re-runs WRITE, and the planning after it, for a stack marker added since, which WRITE hands on", async () => {
    const root = repo(PROJECT);
    await init(root, writesPack());
    writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
    const again = await init(root, writesPack());
    expect(again.executed).toEqual(expect.arrayContaining(["WRITE", "ANALYZE", "DETERMINE_VERIFICATION"]));
    expect(writeOutputs(root)["stack_markers"]).toContain("tsconfig.json");
  });

  it("lets the next init through while a ticket is in flight: DISCOVER's re-run re-plans nothing, and the scan sees it (C-8″)", async () => {
    const root = repo(PROJECT);
    await init(root, writesPack());
    writeTicket(root, { ...readTicket(root, "t-s01-001"), state: "IN_PROGRESS" });
    const again = await init(root, writesPack());
    expect(again.messages.join(" ")).not.toContain("re-planning refused");
    expect(again.executed).toEqual(["DISCOVER", "AUDIT", "DECIDE"]);
    expect(again.reachedPhase).toBe("PRESENT");
  });

  it("presents a default WRITE added to the log beside DECIDE's, vetoable like them (C-3⁗)", async () => {
    const root = repo(PROJECT);
    const adds = write((_, inputs, r) => {
      const files = packFor(inputs);
      const log = read(r, DECISION_LOG_PATH).replace(/(\| X-3 \|[^\n]*\n)/u, "$1| X-4 | A loan lasts seven days. | The documents imply a week. |\n");
      return {
        files: { ...files, [DECISION_LOG_PATH]: log, "docs/prd/01-lending.md": `${files["docs/prd/01-lending.md"] ?? ""}- **LND-F-004** [M1] A loan MUST last seven days (X-4).\n- **LND-AC-04** [M1] Given a loan started on day 0, when day 7 ends, then it is due (LND-F-004).\n` },
        artifact: WROTE(),
      };
    });
    const first = await init(root, adds);
    const shown = first.interrupt?.message ?? "";
    expect(shown).toContain("Defaults (4)");
    expect(shown).toContain("  X-4: A loan lasts seven days.\n      because: The documents imply a week.");
  });
});
