import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { main as runMain } from "../../src/cli/run.js";
import { approvalPath, presentStage, type ApprovalDecision } from "../../src/init/present.js";
import { readBindings } from "../../src/adapter/drift.js";
import { allTickets } from "../../src/kernel/tickets/readers.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "../kernel/run-fixture.js";

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
    expect(said.out).toContain(`"schema_version": 1`);
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

  it("a plan with a blocking question is presented but not approvable", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-100" });
    rmSync(approvalPath(root), { force: true });
    const stored = readBindings(root);
    /**
     * C-3′: `init` returns AWAIT_INFO here rather than offering approval, so the
     * second exit must not become the way around the first one's gate. The
     * blocking count travels with the rendering for exactly this check.
     */
    const outcome = await presentStage({
      root,
      tickets: allTickets(root),
      bindings: stored.bindings,
      skips: stored.skips as never[],
      bootstrap: null,
      assignments: {},
      questions: [{ id: "q-1", question: "which database?", assumption: "postgres", blocking: true }],
    });
    expect(outcome.kind, "a blocking question interrupts before any approval is offered").toBe("interrupt");

    let asked = 0;
    const said = await runWith(root, {
      approve: async () => {
        asked += 1;
        return { kind: "approved", by: "should-never-be-asked" };
      },
    });

    expect(asked, "`run` does not offer what `init` refused to offer").toBe(0);
    expect(said.code).toBe(2);
    expect(said.out, "and it says which gate stopped it").toContain("blocking question");
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
