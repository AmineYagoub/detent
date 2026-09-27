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
import { clean } from "./validate-fixture.js";

/**
 * PRDR-283 — what the phases after WRITE read, and what the next `init` does
 * with a pack WRITE wrote (C-2⁶, C-2¹³). The whole pipeline runs, with
 * scripted sessions, in an existing project whose lone test script binds
 * without a question. PRDR-284: VALIDATE runs after WRITE, its reviewers
 * finding nothing, so the pack planning reads is one VALIDATE validated.
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
    script: { planner, spec_review: clean().stage },
    backend: (script) => (seen.backend.current = new MockBackend(script)),
  });
  return { ...result, ...seen };
}

const sessions = (seen: Seen): string[] => seen.backend.current?.rolesLaunched() ?? [];

describe("PRDR-283: the phases after WRITE plan from the pack (C-2⁶)", () => {
  it("hands SLICE the pack and its context documents, never an original it archived", async () => {
    const root = repo(PROJECT);
    const first = await init(root, writesPack());
    expect(first.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    expect(first.planned.every((i) => i["stage"] !== undefined), "D-10′ (PRDR-290): no planner session reads the documents for a stack before SLICE").toBe(true);
    expect(first.planned.find((i) => i["stage"] === "SLICE")?.["docs"]).toEqual(PACK_DOCS);
    const drafted = first.planned.find((i) => i["stage"] === "PLAN");
    expect(drafted?.["docs"]).toEqual(["docs/prd/01-lending.md", DECISION_LOG_PATH]);
  });

  /** PRDR-284: VALIDATE's record moved WRITE's key, so WRITE runs again, writing nothing; VALIDATE's key stands, and the planning chains from it. */
  it("re-plans nothing on the next init, though DISCOVER finds the pack where the originals were", async () => {
    const root = repo(PROJECT);
    await init(root, writesPack());
    const notes: string[] = [];
    const again = await init(root, writesPack(), notes);
    expect(again.executed).toEqual(["DISCOVER", "AUDIT", "DECIDE", "WRITE"]);
    expect(again.reachedPhase, "PRESENT asks for the approval the first run deferred").toBe("PRESENT");
    expect(again.reused).toEqual(expect.arrayContaining(["VALIDATE", "DETERMINE_VERIFICATION", "SLICE", "PLAN", "PREPARE_AGENTS"]));
    expect(sessions(again), "no session of any role").toEqual([]);
    const said = notes.join("\n");
    expect(said).toMatch(/the documents are a conforming pack: they match their conformance record of \d{4}-\d{2}-\d{2}/u);
    expect(said).toContain("AUDIT: the documents are a conforming pack");
    expect(said).toContain("DECIDE: the documents are a conforming pack");
    expect(said).toContain("WRITE: the documents are a conforming pack, which is never rewritten (C-2⁶)");
    const third = await init(root, writesPack());
    expect(third.executed, "and the init after that runs nothing but PRESENT's ask").toEqual([]);
  });

  /** PRDR-284: VALIDATE re-validates the edit, and the planning replays from it. */
  it("re-runs WRITE without a session for an edit to the pack, and replays the planning phases from VALIDATE", async () => {
    const root = repo(PROJECT);
    await init(root, writesPack());
    await init(root, writesPack());
    appendFileSync(path.join(root, "docs", "prd", "01-lending.md"), "- **LND-AC-04** [M1] Given a loan, when it starts, then its tool is named (LND-F-001).\n");
    const edited = await init(root, writesPack());
    expect(edited.executed).toEqual(expect.arrayContaining(["WRITE", "VALIDATE", "SLICE", "PLAN"]));
    expect(sessions(edited).filter((r) => r === "spec_write"), "WRITE writes nothing over a pack, and VALIDATE's reviewers found nothing to fix").toEqual([]);
    expect(sessions(edited)).toContain("spec_review");
    expect(edited.replayedFrom).toBe("DISCOVER");
  });

  it("re-runs WRITE, and the planning after it, for a stack marker added since, which WRITE hands on", async () => {
    const root = repo(PROJECT);
    await init(root, writesPack());
    writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
    const again = await init(root, writesPack());
    expect(again.executed).toEqual(expect.arrayContaining(["WRITE", "DETERMINE_VERIFICATION"]));
    expect(writeOutputs(root)["stack_markers"]).toContain("tsconfig.json");
  });

  it("lets the next init through while a ticket is in flight: DISCOVER's re-run re-plans nothing, and the scan sees it (C-8″)", async () => {
    const root = repo(PROJECT);
    await init(root, writesPack());
    writeTicket(root, { ...readTicket(root, "t-s01-001"), state: "IN_PROGRESS" });
    const again = await init(root, writesPack());
    expect(again.messages.join(" ")).not.toContain("re-planning refused");
    expect(again.executed, "WRITE runs again and is not asked, since VALIDATE restarts the chain after it (PRDR-284)").toEqual(["DISCOVER", "AUDIT", "DECIDE", "WRITE"]);
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
