import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { main as runMain } from "../../src/cli/run.js";
import { stateDir } from "../../src/fs/layout.js";
import { approvalPath, presentStage, type ApprovalDecision } from "../../src/init/present.js";
import { readBindings } from "../../src/adapter/drift.js";
import { allTickets } from "../../src/kernel/tickets/readers.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "../kernel/run-fixture.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";

/**
 * C-7 (PRDR-255) — the second exit. `detent run` presents a deferred plan.
 *
 * C-7 is dual-exit: "offered inline at the end of `init` (TTY), and, if
 * deferred or non-TTY, presented by the first `detent run`", with the AC
 * "unapproved plan → `run` presents it before executing; declining leaves state
 * READY-unapproved, exit 2". Only the init half existed. `run` refused with a
 * string pointing back at `init`, and `renderPresentation` had exactly one
 * production caller — `presentStage`, one line away in its own file.
 *
 * These tests drive `src/cli/run.ts` main(), the entry point the operator runs.
 * The expected text is not rendered here: it is taken from what `presentStage`
 * itself produced, so the assertion compares two production outputs rather than
 * re-deriving one. That is the flaw in `tests/init/backhalf.test.ts`'s
 * predecessor to this file, whose NAME claimed the run leg while its body
 * called the renderer itself and compared init's message to init's own line.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
  vi.unstubAllEnvs();
});

/**
 * The state a non-TTY `init` leaves behind: a drafted plan, no approval, and
 * whatever PRESENT persisted for the second exit to replay. Returns the
 * presentation exactly as `init` rendered it, sliced off the interrupt message
 * that carries it.
 */
async function deferred(root: string): Promise<string> {
  rmSync(approvalPath(root), { force: true });
  const stored = readBindings(root);
  const outcome = await presentStage({
    root,
    tickets: allTickets(root),
    bindings: stored.bindings,
    skips: stored.skips as never[],
    bootstrap: null,
    assignments: {},
  });
  if (outcome.kind !== "interrupt") throw new Error("a plan with no asker defers (C-7)");
  const marker = "\n\nApproval deferred";
  const cut = outcome.message.indexOf(marker);
  if (cut < 0) throw new Error(`the deferral message changed shape: ${outcome.message.slice(-120)}`);
  return outcome.message.slice(0, cut);
}

interface Said {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function runWith(root: string, deps: Parameters<typeof runMain>[1] = {}): Promise<Said> {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  let code: number;
  let said: string;
  let cried: string;
  try {
    code = await runMain([root, "--backend", "mock", "--no-worktree"], deps);
  } finally {
    /* PRDR-251: `mockRestore` resets the recorded calls, so the text is taken first. */
    said = out.mock.calls.join("");
    cried = err.mock.calls.join("");
    out.mockRestore();
    err.mockRestore();
  }
  return { code, out: said, err: cried };
}

describe("C-7 `detent run` presents a plan that was never approved", () => {
  it("prints the presentation `init` rendered, byte for byte, before refusing", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-100" });
    const shown = await deferred(root);

    const said = await runWith(root);

    expect(said.out, "C-7: the deferred plan is presented by the first `run`").toContain(shown);
    expect(said.code, "and an unapproved plan is still not ready (C-11)").toBe(2);
    expect(
      existsSync(approvalPath(root)),
      "presenting is not approving — nothing is recorded without an answer",
    ).toBe(false);
  }, 60_000);

  it("still emits C-10's machine-readable summary on the same refusal", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-100" });
    await deferred(root);

    const said = await runWith(root);

    /**
     * C-10/C-11: `src/cli/run.ts` is the single writer of this envelope, and the
     * presentation must not become a second exit path that writes a different
     * shape. Exit 2 is the case C-11 names — "not ready (no/unapproved plan)".
     */
    expect(said.out).toContain(`"exit": 2`);
    expect(said.out).toContain(`"schema_version": ${String(SCHEMA_VERSION)}`);
  }, 60_000);

  it("a yes at the prompt records who approved it, and the run proceeds", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    await deferred(root);

    const seen: string[] = [];
    const approve = async (presentation: string): Promise<ApprovalDecision> => {
      seen.push(presentation);
      return { kind: "approved", by: "reviewer-human" };
    };
    const said = await runWith(root, { approve });

    expect(seen.length, "the human is asked exactly once").toBe(1);
    expect(said.code, "an approved plan with an empty pool completes (C-11)").toBe(0);
    expect(existsSync(approvalPath(root)), "C-7: approval is recorded").toBe(true);
  }, 60_000);

  it("a no leaves the plan READY-unapproved and exits 2, having spent nothing", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-100" });
    const shown = await deferred(root);

    let launched = 0;
    const said = await runWith(root, {
      approve: async () => ({ kind: "declined" }),
      buildBackend: () => {
        launched += 1;
        throw new Error("a declined plan must not build a backend");
      },
    });

    expect(said.out, "the operator still saw what they declined").toContain(shown);
    expect(said.code, "C-7 AC: declining leaves state READY-unapproved, exit 2").toBe(2);
    expect(existsSync(approvalPath(root)), "and records nothing").toBe(false);
    expect(launched, "nothing is spent behind a refusal").toBe(0);
  }, 60_000);

  /**
   * PRDR-292 (C-4⁵, C-7″): a spec defect planning found holds approval until
   * the pack is amended, on this exit as on `init`'s.
   */
  it("a plan with an open spec defect is presented but not approvable", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-100" });
    rmSync(approvalPath(root), { force: true });
    const stored = readBindings(root);
    const outcome = await presentStage({
      root,
      tickets: allTickets(root),
      bindings: stored.bindings,
      skips: stored.skips as never[],
      bootstrap: null,
      assignments: {},
      specDefects: [{ slice: "s01", kind: "gap", passages: [{ id: "CAT-F-001", quote: "MUST store every product" }], defect: "The pack does not say how long a product is kept." }],
    });
    expect(outcome.kind === "interrupt" ? outcome.interrupt : outcome.kind, "an open spec defect interrupts before any approval is offered").toBe("AWAIT_INFO");

    let asked = 0;
    const said = await runWith(root, {
      approve: async () => {
        asked += 1;
        return { kind: "approved", by: "should-never-be-asked" };
      },
    });

    expect(asked, "`run` does not offer what `init` refused to offer").toBe(0);
    expect(said.code).toBe(2);
    expect(said.out, "and it says which gate stopped it").toContain("spec defect");
    expect(existsSync(approvalPath(root))).toBe(false);
  }, 60_000);

  /**
   * F-3: the migration leaves a presentation as it was. Every build that wrote
   * one before PRDR-296 counted its blocking questions in `blocking`, which
   * this build does not write, so such a record does not parse: `run` refuses
   * it as it refuses any record it cannot read, and sends the operator to
   * `detent init`, which presents the plan again. PRDR-295's count of ungated
   * paths, which PRDR-293 folded into the checks, is refused the same way. No
   * released build wrote a presentation: the record came with PRDR-255.
   */
  it("a presentation an earlier build wrote, which counts questions, is refused, and the operator is sent to `detent init`", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    await deferred(root);
    const file = path.join(stateDir(root), "plan", "presentation.json");
    const older = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, `${JSON.stringify({ ...older, blocking: 0 })}\n`);

    let asked = 0;
    const said = await runWith(root, {
      approve: async () => {
        asked += 1;
        return { kind: "approved", by: "reviewer-human" };
      },
    });

    expect(asked, "nothing is offered from a record this build cannot read").toBe(0);
    expect(said.code).toBe(2);
    expect(said.out).toContain("re-run `detent init` to draft and present it");
    expect(existsSync(approvalPath(root))).toBe(false);
  }, 60_000);

  it("the asker is never consulted for a plan that is already approved (the control)", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-100" });

    let asked = 0;
    const said = await runWith(root, {
      approve: async () => {
        asked += 1;
        return { kind: "approved", by: "nobody" };
      },
    });

    expect(asked, "an approved plan is not re-presented — C-7's exit is for an unapproved one").toBe(0);
    expect(said.out, "and the presentation is not printed over a normal run").not.toContain("Plan ready for approval.");
  }, 60_000);

  it("with no asker — every non-TTY invocation — it presents and refuses, and synthesizes nothing", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-100" });
    const shown = await deferred(root);

    const said = await runWith(root);

    expect(said.out, "the plan is shown even where it cannot be approved").toContain(shown);
    expect(said.code).toBe(2);
    expect(
      existsSync(approvalPath(root)),
      "C-5: an absent human is never an approving one — the seam's absence refuses",
    ).toBe(false);
  }, 60_000);
});

/**
 * PRDR-297 (N-5″): the second exit asks what the first asks. The presentation
 * `run` replays names the builds that made the plan, and a plan more than one
 * made is offered for approval only once that is accepted.
 */
describe("PRDR-297 `detent run` approves a plan more than one build made only once that is accepted", () => {
  const BUILDS = ["3.1.0+aaaaaaaaaaaa", "3.0.9+0123456789ab"];

  async function mixed(root: string): Promise<void> {
    rmSync(approvalPath(root), { force: true });
    const stored = readBindings(root);
    await presentStage({
      root,
      tickets: allTickets(root),
      bindings: stored.bindings,
      skips: stored.skips as never[],
      bootstrap: null,
      assignments: {},
      builds: [
        { build: BUILDS[0] ?? "", made: ["PLAN"] },
        { build: BUILDS[1] ?? "", made: ["s02"] },
      ],
      packHash: "c".repeat(64),
    });
  }

  it("asks before the approval question, and a no refuses without putting it", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    await mixed(root);

    const asked: string[] = [];
    const said = await runWith(root, {
      acceptMixedBuilds: async (builds) => {
        asked.push(`builds:${builds.join(",")}`);
        return false;
      },
      approve: async () => {
        asked.push("approve");
        return { kind: "approved", by: "reviewer-human" };
      },
    });

    expect(asked).toEqual([`builds:${BUILDS.join(",")}`]);
    expect(said.code).toBe(2);
    expect(said.out, "the plan was shown, with its builds").toContain(`  ${BUILDS[1] ?? ""}  s02`);
    expect(said.out).toContain("more than one Detent build made this plan");
    expect(existsSync(approvalPath(root))).toBe(false);
  }, 60_000);

  it("takes no answer for the builds as a no: an approver alone is never asked", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    await mixed(root);

    let asked = 0;
    const said = await runWith(root, {
      approve: async (): Promise<ApprovalDecision> => {
        asked += 1;
        return { kind: "approved", by: "reviewer-human" };
      },
    });

    expect(asked).toBe(0);
    expect(said.code).toBe(2);
    expect(said.out).toContain("more than one Detent build made this plan");
    expect(existsSync(approvalPath(root))).toBe(false);
  }, 60_000);

  it("a yes puts the approval question, and the approval lists the builds and the pack", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    await mixed(root);

    const said = await runWith(root, {
      acceptMixedBuilds: async () => true,
      approve: async () => ({ kind: "approved", by: "reviewer-human" }),
    });

    expect(said.code, "an approved plan with an empty pool completes (C-11)").toBe(0);
    const approval = JSON.parse(readFileSync(approvalPath(root), "utf8")) as Record<string, unknown>;
    expect(approval).toMatchObject({ approved_by: "reviewer-human", builds: BUILDS, pack_hash: "c".repeat(64) });
  }, 60_000);
});
