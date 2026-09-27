import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeFlagApproval } from "../../src/cli/approve.js";
import { checkpointPath } from "../../src/fs/checkpoints.js";
import { stateDir, writeArtifact } from "../../src/fs/layout.js";
import { EXIT_NOT_READY, run } from "../../src/kernel/run.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { readTicket } from "../../src/kernel/tickets/readers.js";
import { writeTicket } from "../../src/kernel/tickets/mutations.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { APPROVE_PLAN } from "./plan-fixture.js";
import { clear, draft, edit, planned, seeded, slicing, type Json, type Seeded } from "./seed-fixture.js";
import { ticket } from "./slicing-fixture.js";

/**
 * PRDR-293 — what code proves about a plan drives a redraft, and what survives
 * one holds approval.
 *
 * ksar-cloud's plan was approved with 34 defects code had proved: 28 names
 * consumed that no ticket provides and 6 names with two providers. They were
 * handed to the whole-plan review as `already_found`, with the instruction to
 * treat them as handled, kept out of the list the run phase reads, and
 * printed at PRESENT. Here a failing slice's drafter is sent its failures and
 * its draft, once; the checks run across the plan after every slice; and a
 * failure left over stops the plan at PRESENT, on both of approval's exits.
 */

const sliceOfInputs = (inputs: Json): string => (inputs["slice"] as { id: string }).id;
const plans = (s: Seeded, slice: string): Json[] => s.inputs.filter((i) => i["stage"] === "PLAN" && sliceOfInputs(i) === slice);
const sentTo = (input: Json | undefined): { check: string; ticket?: string; finding: string }[] =>
  (input?.["check_failures"] as { check: string; ticket?: string; finding: string }[] | undefined) ?? [];
const drafted = (input: Json | undefined): Json[] => (input?.["draft"] as Json[] | undefined) ?? [];

/** The fixture's draft of a slice, its one ticket changed by `over`. */
const changed = (inputs: Json, over: Json): Json => {
  const d = draft(inputs) as { tickets: Json[] };
  return { ...d, tickets: [{ ...d.tickets[0], ...over }] };
};
const provides = (id: string): Json[] => [{ kind: "config", id, note: `what ${id} means` }];
const consumes = (id: string): Json[] => [{ kind: "config", id }];

/** s01 holding a milestone-0 requirement and two of milestone 1, so one of its tickets can wait on a later milestone. */
const MIXED = [
  { id: "s01", requirement_ids: ["CAT-F-001", "CAT-F-002", "CAT-N-001"] },
  { id: "s02", requirement_ids: ["CHK-F-001", "CHK-F-002"], depends_on: ["s01"] },
];
const CAT_AC_01 = "CAT-AC-01: Given a product titled `Mug` priced 1500, when it is stored and read back, then the title is `Mug` and the price is 1500.";
const CAT_AC_02 = "CAT-AC-02: Given 1,000 products, when the listing is requested, then it answers within 300 ms and shows `DZD` prices.";

interface Kind {
  readonly check: string;
  readonly script?: Parameters<typeof seeded>[1];
  /** s01's first draft, which fails the check. */
  readonly first: (inputs: Json) => Json;
}

const KINDS: Readonly<Record<string, Kind>> = {
  coverage: { check: "coverage", first: (i) => changed(i, { criterion_ids: [], acceptance_criteria: ["it works"] }) },
  contracts: { check: "contracts", first: (i) => changed(i, { consumes: consumes("NOPE") }) },
  gates: { check: "gates", first: (i) => changed(i, { surface: ["src/**", "tools/package.json"] }) },
  graph: {
    check: "graph",
    first: (i) => {
      const d = changed(i, { provides: provides("A"), consumes: consumes("B") }) as { tickets: Json[] };
      return { ...d, tickets: [...d.tickets, { ...ticket("t-s01-002"), provides: provides("B"), consumes: consumes("A") }] };
    },
  },
  milestones: {
    check: "milestones",
    script: { slices: (take) => slicing(MIXED, take) },
    first: () => ({
      schema_version: SCHEMA_VERSION,
      tickets: [
        { ...ticket("t-s01-001", ["t-s01-002"]), requirement_ids: ["CAT-F-001"], criterion_ids: ["CAT-AC-01"], acceptance_criteria: [CAT_AC_01] },
        { ...ticket("t-s01-002"), requirement_ids: ["CAT-F-002", "CAT-N-001"], criterion_ids: ["CAT-AC-02"], acceptance_criteria: [CAT_AC_02] },
      ],
    }),
  },
};

describe("PRDR-293 a failing slice is redrafted once, with its failures and its draft", () => {
  for (const [name, kind] of Object.entries(KINDS)) {
    it(`${name}: the redraft receives the failure, and the checks pass on what it writes`, async () => {
      const s = seeded(undefined, {
        ...kind.script,
        draft: (take, inputs) => (sliceOfInputs(inputs) === "s01" && take === 1 ? kind.first(inputs) : draft(inputs)),
      });
      const result = await s.init();
      const [first, redraft, ...more] = plans(s, "s01");
      expect(more, "one targeted redraft, and no more").toEqual([]);
      expect(sentTo(first), "a first draft is sent no failure").toEqual([]);
      expect(sentTo(redraft).map((f) => f.check)).toContain(kind.check);
      expect(drafted(redraft).map((t) => t["id"]), "the redraft is handed the draft its failures were found in").toEqual(
        ((kind.first(first as Json) as { tickets: Json[] }).tickets).map((t) => t["id"]),
      );
      expect(drafted(redraft).every((t) => !("slice" in t)), "the slice a ticket is tagged with is Detent's, not the drafter's").toBe(true);
      expect(String(redraft?.["instruction"])).toContain("`check_failures`");
      expect(result.interrupt?.interrupt, "the redraft passed, so nothing holds approval").toBe("AWAIT_APPROVAL");
    });
  }

  it("a revision that fails a check is redrafted once too, from the revision", async () => {
    const s = seeded(undefined, {
      review: (_take, inputs) =>
        sliceOfInputs(inputs) === "s01"
          ? {
              schema_version: SCHEMA_VERSION,
              verdict: "changes",
              findings: [{ severity: "major", tag: "sizing", finding: "t-s01-001 is two sessions' work", ticket: "t-s01-001", fix: "split t-s01-001 in two" }],
            }
          : APPROVE_PLAN,
      draft: (take, inputs) => (sliceOfInputs(inputs) === "s01" && take === 2 ? changed(inputs, { consumes: consumes("NOPE") }) : draft(inputs)),
    });
    const result = await s.init();
    const [first, revision, redraft, ...more] = plans(s, "s01");
    expect(more).toEqual([]);
    expect(sentTo(first)).toEqual([]);
    expect(revision?.["review_findings"], "the revision answers the review").toBeDefined();
    expect(sentTo(revision), "the review's draft passed the checks").toEqual([]);
    expect(sentTo(redraft).map((f) => f.finding).join("\n")).toContain("`NOPE`");
    expect(drafted(redraft)[0]?.["consumes"]).toEqual(consumes("NOPE"));
    /* The slice's own checks sent it, not the checks across the plan, which would send the same failure later. */
    expect(s.notes.join("\n")).toContain("s01: its revision fails 1 check(s)");
    expect(s.notes.join("\n")).not.toContain("the checks across the plan found");
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });
});

describe("PRDR-293 after every slice, the checks run across the plan", () => {
  it("a name with two providers sends one redraft to each owner's slice", async () => {
    const s = seeded(undefined, {
      draft: (take, inputs) => {
        const slice = sliceOfInputs(inputs);
        if (slice === "s01" && take === 1) return changed(inputs, { provides: provides("SHARED") });
        if (slice === "s02") return changed(inputs, { provides: provides("SHARED") });
        return draft(inputs);
      },
    });
    const result = await s.init();
    const [, s02Redraft, ...s02More] = plans(s, "s02");
    expect(sentTo(s02Redraft).map((f) => f.check)).toEqual(["contracts"]);
    expect(s02More, "s02 was sent the failure once, by its own checks, and not again").toEqual([]);
    const [, s01Redraft, ...s01More] = plans(s, "s01");
    expect(s01More).toEqual([]);
    expect(sentTo(s01Redraft).map((f) => f.finding).join("\n")).toContain("`SHARED`");
    expect(sentTo(s01Redraft)[0]?.ticket).toBe("t-s01-001");
    expect(drafted(s01Redraft)[0]?.["provides"]).toEqual(provides("SHARED"));
    expect(s.notes.join("\n")).toContain("redrafting s01 for 1 failure(s) the checks across the plan found");
    expect(result.interrupt?.interrupt, "s01's redraft gave the name up, so it has one provider").toBe("AWAIT_APPROVAL");
  });

  it("a name nobody provides sends one redraft, to the earliest slice that consumes it", async () => {
    const s = seeded(undefined, {
      draft: (take, inputs) => {
        const slice = sliceOfInputs(inputs);
        if (slice === "s01" && take === 1) return changed(inputs, { provides: [...provides("X"), ...provides("V")] });
        if (slice === "s02" && take === 1) return changed(inputs, { consumes: consumes("X") });
        if (slice === "s02") return changed(inputs, { provides: provides("X") });
        if (slice === "s03") return changed(inputs, { consumes: consumes("X"), provides: provides("V") });
        return draft(inputs);
      },
    });
    const result = await s.init();
    const s02 = plans(s, "s02");
    expect(s02).toHaveLength(2);
    expect(sentTo(s02[1]).map((f) => f.finding).join("\n")).toMatch(/consumes the config key `X`, and no ticket in the plan provides it/u);
    const s03 = plans(s, "s03");
    expect(s03, "s03 consumes it too, and is later, so it is sent nothing for it").toHaveLength(2);
    expect(sentTo(s03[1]).map((f) => f.finding).join("\n")).toContain("`V`");
    expect(sentTo(s03[1]).map((f) => f.finding).join("\n")).not.toContain("`X`");
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });

  it("a redraft the checks across the plan sent is written down, and a resumed PLAN reuses it", async () => {
    const s = seeded(undefined, {
      draft: (take, inputs) => {
        const slice = sliceOfInputs(inputs);
        if (slice === "s01" && take === 1) return changed(inputs, { provides: provides("SHARED") });
        if (slice === "s02") return changed(inputs, { provides: provides("SHARED") });
        return draft(inputs);
      },
    });
    await s.init();
    expect(plans(s, "s01")).toHaveLength(2);
    rmSync(checkpointPath(s.root, "PLAN"), { force: true });
    clear(s);
    const again = await s.init();
    expect(planned(s), "every slice and every redraft is reused").toEqual([]);
    expect(s.notes.join("\n")).toContain("s01: its redraft for the checks across the plan is reused — already written down (C-8⁗)");
    expect(again.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });

  it("a redraft that drops an id a later slice depends on is discarded, and the slice stands", async () => {
    const s = seeded(undefined, {
      draft: (_take, inputs) => {
        const slice = sliceOfInputs(inputs);
        if (slice === "s01" && inputs["check_failures"] === undefined) return changed(inputs, { provides: provides("SHARED") });
        if (slice === "s01") return changed(inputs, { id: "t-s01-009" });
        if (slice === "s02") return changed(inputs, { provides: provides("SHARED"), depends_on: ["t-s01-001"] });
        return draft(inputs);
      },
    });
    const result = await s.init();
    const [, redraft, ...more] = plans(s, "s01");
    expect(more).toEqual([]);
    expect(redraft?.["keep_ids"], "s02 depends on it, so the redraft is told to keep it").toEqual(["t-s01-001"]);
    expect(s.notes.join("\n")).toContain("s01 redraft dropped t-s01-001, which later slices depend on — redraft discarded, the slice stands");
    expect(readTicket(s.root, "t-s01-001").provides.map((p) => p.id), "the slice stands as it was drafted").toEqual(["SHARED"]);
    expect(result.interrupt?.interrupt, "so what it was sent still fails").toBe("AWAIT_INFO");
  });

  it("a redraft that makes a failure in an earlier slice sends that slice one in the next round", async () => {
    const s = seeded(undefined, {
      draft: (take, inputs) => {
        const slice = sliceOfInputs(inputs);
        if (slice === "s01") return inputs["check_failures"] === undefined ? changed(inputs, { provides: provides("A") }) : draft(inputs);
        if (slice === "s02") return changed(inputs, { provides: provides(take === 1 ? "X" : "A") });
        return changed(inputs, { provides: provides("X") });
      },
    });
    const result = await s.init();
    /* s03's own checks redraft it for X; across the plan s02 gives X up and takes A, which s01 provides, so round two sends s01. */
    expect(planned(s)).toEqual(["PLAN:s01", "PLAN:s02", "PLAN:s03", "PLAN:s03", "PLAN:s02", "PLAN:s01"]);
    expect(sentTo(plans(s, "s01")[1]).map((f) => f.finding).join("\n")).toContain("`A`");
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });

  it("a redraft is keyed by the failures that sent it: a slice sent new ones is redrafted again, not handed the old redraft (C-8⁗)", async () => {
    let shared = "SHARED";
    const s = seeded(undefined, {
      draft: (_take, inputs) => {
        const slice = sliceOfInputs(inputs);
        if (slice === "s01") {
          const sent = JSON.stringify(inputs["check_failures"] ?? []);
          return changed(inputs, { provides: ["SHARED", "OTHER"].filter((n) => !sent.includes(`\`${n}\``)).flatMap((n) => provides(n)) });
        }
        if (slice === "s02") return changed(inputs, { provides: provides(shared) });
        return draft(inputs);
      },
    });
    expect((await s.init()).interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    clear(s);
    shared = "OTHER";
    edit(s.root, "docs/prd/01-catalog.md", ["SHOULD show its price in DZD (D-1)", "SHOULD show its price in DZD, to the dinar (D-1)"]);
    const again = await s.init();
    expect(planned(s), "s02 holds the amended requirement, and s01 is sent what s02 now shares with it").toEqual(["PLAN:s02", "PLAN:s02", "PLAN:s01"]);
    expect(sentTo(plans(s, "s01")[0]).map((f) => f.finding).join("\n")).toContain("`OTHER`");
    expect(again.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });

  it("a resumed PLAN remembers what each reused slice was sent, and sends it nothing again", async () => {
    const s = seeded(undefined, { draft: (_take, inputs) => (sliceOfInputs(inputs) === "s02" ? changed(inputs, { consumes: consumes("NOPE") }) : draft(inputs)) });
    expect((await s.init()).interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(plans(s, "s02"), "its own checks sent it one redraft").toHaveLength(2);
    rmSync(checkpointPath(s.root, "PLAN"), { force: true });
    clear(s);
    expect((await s.init()).interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(planned(s), "every slice is reused, and s02 was sent its failure already").toEqual([]);
  });

  it("a redraft is written down before the next launch, so a PLAN that dies after it resumes without paying for it again (C-8⁗)", async () => {
    let dying = true;
    const s = seeded(undefined, {
      draft: (_take, inputs) => {
        const slice = sliceOfInputs(inputs);
        if (slice === "s01" && inputs["check_failures"] === undefined) return changed(inputs, { provides: provides("SHARED") });
        if (slice === "s02") return changed(inputs, { provides: provides("SHARED") });
        if (slice === "s03" && dying) throw new Error("simulated session failure");
        return draft(inputs);
      },
    });
    await expect(s.init()).rejects.toThrow(/simulated session failure/);
    expect(planned(s), "s01's redraft across the plan ran before s03 died").toEqual(["PLAN:s01", "PLAN:s02", "PLAN:s02", "PLAN:s01", "PLAN:s03"]);
    dying = false;
    clear(s);
    const again = await s.init();
    expect(planned(s), "only the slice that died is drafted again").toEqual(["PLAN:s03"]);
    expect(s.notes.join("\n")).toContain("s01: its redraft for the checks across the plan is reused — already written down (C-8⁗)");
    expect(again.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });

  it("`--replan` sends it again: the record of the redrafts is wiped with the slice caches (C-8′)", async () => {
    /* Drafts that depend on nothing but whether they were sent failures, so the second run's key is the first's. */
    const s = seeded(undefined, {
      draft: (_take, inputs) => {
        const slice = sliceOfInputs(inputs);
        if (slice === "s01" && inputs["check_failures"] === undefined) return changed(inputs, { provides: provides("SHARED") });
        if (slice === "s02") return changed(inputs, { provides: provides("SHARED") });
        return draft(inputs);
      },
    });
    await s.init();
    /* s02's own checks redraft it once; the checks across the plan then send s01 its share of the name. */
    const first = planned(s);
    expect(first).toEqual(["PLAN:s01", "PLAN:s02", "PLAN:s02", "PLAN:s01", "PLAN:s03"]);
    clear(s);
    const again = await s.init({ replan: true });
    expect(planned(s), "a fresh planning session drafts every slice and sends every redraft").toEqual(first);
    expect(s.notes.join("\n")).not.toContain("already written down");
    expect(again.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
  });
});

describe("PRDR-293 what still fails holds approval", () => {
  const residual = (): Seeded => seeded(undefined, { draft: (_take, inputs) => (sliceOfInputs(inputs) === "s01" ? changed(inputs, { consumes: consumes("NOPE") }) : draft(inputs)) });

  it("PRESENT names each failure and raises AWAIT_INFO, and an approval flag is never asked", async () => {
    const s = residual();
    let asked = 0;
    const approve = makeFlagApproval("approve", "op");
    const result = await s.init({}, { askApproval: async (p) => ((asked += 1), await approve(p)) });
    expect(plans(s, "s01"), "the failure bought one redraft, which kept it").toHaveLength(2);
    expect(result.interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(result.interrupt?.message.split("\n")[0]).toBe("Plan drafted, and not approvable while a check below fails.");
    expect(result.interrupt?.items).toEqual([
      "contracts (t-s01-001): consumes the config key `NOPE`, and no ticket in the plan provides it — the work it depends on is either missing or unowned",
    ]);
    expect(result.interrupt?.message).toContain("edit the tickets under `.detent/plan/`");
    expect(asked).toBe(0);
    expect(existsSync(path.join(stateDir(s.root), "plan", "approval.json"))).toBe(false);
    const shown = JSON.parse(readFileSync(path.join(stateDir(s.root), "plan", "presentation.json"), "utf8")) as Json;
    expect(shown["check_failures"]).toBe(1);
  });

  it("`run` presents the plan and refuses to offer approval while a check fails", async () => {
    const s = residual();
    await s.init();
    /* `detent init` writes the run's config from the CLI; the pipeline alone does not. */
    writeArtifact(s.root, "config.json", { budgets: { run_spend_usd: 999 }, protected: [], risk: [], model_routing: {}, pinned: { agent_sdk: "0.3.280", claude_code: "2.1.191" } });
    let asked = 0;
    const outcome = await run({
      root: s.root,
      backend: new MockBackend(),
      prompts: loadPromptSet(),
      runId: "failing-checks",
      approve: async () => {
        asked += 1;
        return { kind: "approved", by: "should-never-be-asked" };
      },
    });
    expect(asked).toBe(0);
    expect(outcome.exitCode).toBe(EXIT_NOT_READY);
    expect(outcome.summary.reason).toContain("1 check(s) fail on the plan's tickets");
  }, 60_000);

  it("a DONE ticket is checked as it stands: it still covers what it delivers, and fails nothing it could be redrafted for", async () => {
    /* s02 in two tickets, so the slice is planned whether or not its DONE one is read. */
    const s = seeded(undefined, {
      draft: (_take, inputs) => {
        if (sliceOfInputs(inputs) !== "s02") return draft(inputs);
        const [first] = (draft(inputs) as { tickets: Json[] }).tickets;
        return { schema_version: SCHEMA_VERSION, tickets: [{ ...first, requirement_ids: ["CAT-F-002"] }, { ...ticket("t-s02-002"), requirement_ids: ["CAT-N-001"] }] };
      },
    });
    expect((await s.init()).interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    writeTicket(s.root, { ...readTicket(s.root, "t-s02-001"), state: "DONE", consumes: [{ kind: "config", id: "GONE" }] });
    clear(s);
    const result = await s.init();
    expect(planned(s)).toEqual([]);
    expect(result.interrupt?.interrupt, "its requirement stays covered, and the name it leans on is its own affair").toBe("AWAIT_APPROVAL");
    expect(result.interrupt?.message).not.toContain("Checks that still fail");
  });

  it("an edge an operator adds is read: a cycle the edit makes holds approval", async () => {
    const s = seeded();
    expect((await s.init()).interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    expect(readTicket(s.root, "t-s02-001").blockers, "s02 waits on s01's work").toContain("t-s01-001");
    const t = readTicket(s.root, "t-s01-001");
    writeTicket(s.root, { ...t, blockers: [...t.blockers, "t-s02-001"] });
    clear(s);
    const result = await s.init();
    expect(result.interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(result.interrupt?.items.join("\n")).toMatch(/dependency cycle \(.*t-s02-001.*\)/u);
  });

  it("an operator who edits the ticket answers the failure: PRESENT checks the tickets as they stand", async () => {
    const s = residual();
    expect((await s.init()).interrupt?.interrupt).toBe("AWAIT_INFO");
    const file = path.join(stateDir(s.root), "plan", "t-s01-001.json");
    writeFileSync(file, `${JSON.stringify({ ...(JSON.parse(readFileSync(file, "utf8")) as Json), consumes: [] }, null, 2)}\n`);
    clear(s);
    const result = await s.init({}, { askApproval: makeFlagApproval("approve", "op") });
    expect(planned(s), "nothing is planned again for an edit").toEqual([]);
    expect(result.interrupt).toBeUndefined();
    expect(existsSync(path.join(stateDir(s.root), "plan", "approval.json"))).toBe(true);
  });
});

describe("PRDR-293 the whole-plan review is gone", () => {
  it("no session reviews the plan as one thing, and none is handed what code proved as `already_found`", async () => {
    const s = seeded(undefined, {
      draft: (take, inputs) => (sliceOfInputs(inputs) === "s02" && take === 1 ? changed(inputs, { consumes: consumes("NOPE") }) : draft(inputs)),
    });
    await s.init();
    const reviews = s.inputs.filter((i) => i["stage"] === "REVIEW_PLAN");
    expect(reviews.length).toBeGreaterThan(0);
    /* C-4⁸ (PRDR-294): each read is one slice's, handed that slice and no other, and each slice is read once. */
    const slices = [...new Set(s.inputs.filter((i) => i["stage"] === "PLAN").map(sliceOfInputs))].sort();
    expect(reviews.map(sliceOfInputs).sort()).toEqual(slices);
    expect(s.inputs.some((i) => "already_found" in i)).toBe(false);
    expect(JSON.stringify(s.inputs)).not.toContain("treat it as handled");
    expect(sentTo(plans(s, "s02")[1]).map((f) => f.finding).join("\n"), "what code proved went to a redraft instead").toContain("`NOPE`");
  });
});
