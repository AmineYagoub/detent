import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { selfBuild } from "../../scripts/self-build.js";
import { removeTree } from "../helpers.js";

/**
 * T-140/T-141/T-142 — MP4's keyless body: the N-7 harness proven end-to-end
 * up to the R-10 key gate, the release pipeline shaped so no commit can spend
 * by itself, the release checklist that makes the permanent gates
 * unskippable, and the T-141 positioning surface. The live halves — the
 * budgeted self-build and the public marketplace channels — are dispatch- and
 * user-gated by construction.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const trees: string[] = [];
afterAll(() => {
  for (const tree of trees) removeTree(tree);
});

describe("T-140 the N-7 harness (dry run — spends nothing by construction)", () => {
  it("wires PRD-only folder → git init → init with the cap, and stops at the R-10 key gate", { timeout: 60_000 }, async () => {
    const result = await selfBuild({ capUsd: 1, dryRun: true });
    trees.push(result.dir);

    expect(result.phase).toBe("dry-run");
    expect(result.ok, result.detail).toBe(true);
    /** the folder contains only the PRD (plus git) — N-7's exact precondition */
    expect(readFileSync(path.join(result.dir, "detent-prd-v3.md"), "utf8")).toContain("Detent");
  });
});

describe("T-140 the release pipeline cannot spend on its own", () => {
  const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "self-build.yml"), "utf8");

  it("workflow_dispatch is the ONLY trigger — the click is the consent (R-10)", () => {
    expect(workflow).toContain("workflow_dispatch:");
    for (const trigger of ["push:", "pull_request:", "schedule:"]) {
      expect(workflow, `self-build must never fire on ${trigger}`).not.toContain(trigger);
    }
  });

  it("takes the X-1 cap as input, gates on the secret, runs the harness, uploads the journal", () => {
    expect(workflow).toContain("spend_cap_usd");
    expect(workflow).toContain("secrets.ANTHROPIC_API_KEY");
    expect(workflow).toContain("scripts/self-build.ts");
    expect(workflow).toContain("upload-artifact");
  });
});

describe("T-142 the release checklist makes the permanent gates unskippable", () => {
  const checklist = readFileSync(path.join(ROOT, "docs", "release-checklist.md"), "utf8");

  it("names the porcelain freeze, strict validation, install smoke, and the N-7 gate", () => {
    for (const token of ["C-14′", "N-7", "D-16", "plugin:validate", "install", "self-build", "detent-prd-v3.md"]) {
      expect(checklist, token).toContain(token);
    }
  });

  it("states the gate's teeth: no green, no release", () => {
    expect(checklist).toContain("No green, no release");
  });
});

describe("T-141 the README leads with the four unclaimed axes (research C.2)", () => {
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");

  it("names all four axes and the upstream-complementary framing", () => {
    for (const token of ["auditable state machine", "Hard budgets", "drift halts", "write containment", "input"]) {
      expect(readme, token).toContain(token);
    }
  });

  it("states the N-7 self-build as a permanent release requirement — the maintenance answer", () => {
    expect(readme).toContain("N-7 self-build gate");
    expect(readme).toContain("permanent");
  });

  it("documents the marketplace install without touching the golden path", () => {
    expect(readme).toContain("claude plugin marketplace add");
    expect(readme).toContain("claude plugin install detent@detent");
  });
});
