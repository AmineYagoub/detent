import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makeFlagApproval } from "../../src/cli/approve.js";
import { main as initMain } from "../../src/cli/init.js";
import { initLayout } from "../../src/fs/layout.js";
import { approvalPath, presentStage } from "../../src/init/present.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * T-131 — approval as a plugin presented decision (C-7, C-1′).
 *
 * The plugin path has no readline: the model presents the plan, the human
 * answers in chat, and the model relays exactly one flag on the C-8
 * re-invocation. These tests pin the whole channel: the flag maps to the same
 * three `ApprovalDecision` outcomes `makeTtyApproval` produces, the approved
 * path records who/when/plan_hash, the other two record nothing, and the
 * flags neither bypass C-1 nor combine.
 */

const trees: string[] = [];
afterAll(() => {
  for (const tree of trees) removeTree(tree);
});

function presentRoot(): string {
  const root = tmpTree();
  trees.push(root);
  initLayout(root);
  return root;
}

const DEPS = (root: string) => ({
  root,
  tickets: [],
  bindings: [],
  skips: [],
  bootstrap: null,
  assignments: {},
});

describe("T-131 the flag relay maps to makeTtyApproval's three outcomes", () => {
  it("--approve --by records who, when, and the plan hash (C-7)", async () => {
    const root = presentRoot();
    const outcome = await presentStage({ ...DEPS(root), ask: makeFlagApproval("approve", "amine") });

    expect(outcome.kind).toBe("complete");
    const approval = JSON.parse(readFileSync(approvalPath(root), "utf8")) as Record<string, unknown>;
    expect(approval["approved_by"]).toBe("amine");
    expect(String(approval["at"])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(approval["plan_hash"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("--decline leaves the plan READY-unapproved — a dual exit, not a failure", async () => {
    const root = presentRoot();
    const outcome = await presentStage({ ...DEPS(root), ask: makeFlagApproval("decline", "amine") });

    expect(existsSync(approvalPath(root))).toBe(false);
    expect(outcome.kind).toBe("interrupt");
    if (outcome.kind !== "interrupt") throw new Error("unreachable");
    expect(outcome.interrupt).toBe("AWAIT_APPROVAL");
    expect(outcome.message).toContain("declined");
  });

  it("--defer hands presentation to the first `run` (C-7)", async () => {
    const root = presentRoot();
    const outcome = await presentStage({ ...DEPS(root), ask: makeFlagApproval("defer", "amine") });

    expect(existsSync(approvalPath(root))).toBe(false);
    expect(outcome.kind).toBe("interrupt");
    if (outcome.kind !== "interrupt") throw new Error("unreachable");
    expect(outcome.interrupt).toBe("AWAIT_APPROVAL");
    expect(outcome.message).toContain("deferred");
  });
});

describe("T-131 the flags are answers, never bypasses", () => {
  it("more than one decision flag is refused before anything runs", async () => {
    expect(await initMain(["--approve", "--decline"])).toBe(1);
    expect(await initMain(["--approve", "--defer", "--by", "x"])).toBe(1);
  });

  it("a relayed answer does not bypass the C-1 git-root rule", async () => {
    const root = tmpTree();
    trees.push(root);
    expect(await initMain([root, "--approve", "--by", "amine"])).toBe(2);
    expect(existsSync(path.join(root, ".detent"))).toBe(false);
  });
});
