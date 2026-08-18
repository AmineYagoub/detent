import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { bindAll } from "../../src/adapter/bind.js";
import { discover } from "../../src/adapter/discover/index.js";
import { writeBindings } from "../../src/adapter/drift.js";
import { initLayout, writeArtifact } from "../../src/fs/layout.js";
import { createTicket, type NewTicket } from "../../src/kernel/tickets/mutations.js";
import { okResult, type StageFn } from "../../src/sessions/mock.js";
import { git, gitInit, tmpTree, writeTree } from "../helpers.js";

/**
 * T-041 test fixture: a controllable, stack-agnostic repository — the TS port
 * of the oracle's `make_repo`. Gate scripts are marker-driven so mock stage
 * functions can flip red/green deterministically:
 *
 *   scripts/test.sh : red while .fail exists (prints its content), else green
 *   scripts/lint.sh : always green
 *   .flake          : fail once with ECONNREFUSED, deleting the marker
 *
 * Verification binds through the real M1 adapter — Makefile targets discovered
 * by the make engine and probed for real — so the run loop exercises the same
 * drift surface production will.
 */

export const FAIL_OUTPUT = `FAIL tests/test_totals.py::test_totals
Traceback (most recent call last):
  File "src/calc.py", line 41, in totals
AssertionError: totals mismatch expected 71 got 70
`;

const TEST_SH = `#!/bin/sh
if [ -f .flake ]; then
  rm -f .flake
  echo "request to db failed: connect ECONNREFUSED 127.0.0.1:5432"
  exit 1
fi
if [ -f .fail ]; then
  cat .fail
  exit 1
fi
echo "all tests passed"
exit 0
`;

export interface RunRepo {
  readonly root: string;
}

export async function makeRunRepo(): Promise<RunRepo> {
  const root = tmpTree({
    "scripts/test.sh": TEST_SH,
    "scripts/lint.sh": "#!/bin/sh\nexit 0\n",
    Makefile: ".PHONY: test lint\n\ntest:\n\tsh scripts/test.sh\n\nlint:\n\tsh scripts/lint.sh\n",
    "src/calc.py": "def totals(x):\n    return sum(x)\n",
    "AGENTS.md": "# Rules\n- only what the ticket says\n",
    ".gitignore": ".fail\n.flake\n",
    "PRD.md": "# demo\n",
  });
  gitInit(root);
  initLayout(root);

  writeArtifact(root, "config.json", {
    budgets: { run_spend_usd: 999 },
    protected: ["tickets/**", "AGENTS.md"],
    risk: [],
    model_routing: {},
    pinned: { agent_sdk: "0.3.191", claude_code: "2.1.191" },
  });

  const report = await bindAll(discover(root), { root, timeoutMs: 30_000 });
  if (report.interrupts.length > 0) throw new Error(`fixture binding interrupted: ${JSON.stringify(report.interrupts)}`);
  writeBindings(root, { bindings: [...report.bindings], skips: [] });

  writeArtifact(root, "plan/approval.json", {
    approved_by: "fixture",
    at: "2026-08-18T09:00:00.000Z",
    plan_hash: createHash("sha256").update("fixture-plan").digest("hex"),
  });

  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return { root };
}

export function addTicket(root: string, input: Partial<NewTicket> & { readonly id: string }): void {
  createTicket(root, {
    type: "feature",
    title: `Ticket ${input.id}`,
    acceptance_criteria: ["scripts/test.sh exits 0"],
    surface: ["src/**", "tests/**"],
    ...input,
  });
}

// ---------------------------------------------------------------------------
// Mock stage functions — TS ports of the oracle's helpers (H.*).

export function writeArtifactStage(payload: object): StageFn {
  return (spec) => {
    writeTree(path.dirname(spec.artifactOut), { [path.basename(spec.artifactOut)]: `${JSON.stringify(payload)}\n` });
    return okResult();
  };
}

/** Implements the feature and commits — the happy path. */
export const implementGreen: StageFn = (spec) => {
  writeTree(spec.cwd, { [`src/feature-${spec.ticketId}.txt`]: "done\n" });
  git(spec.cwd, "add", "-A");
  git(spec.cwd, "commit", "-q", "-m", `${spec.ticketId}: implement`);
  return okResult();
};

/** Implements badly: plants the failure marker, commits the attempt. */
export const implementRed: StageFn = (spec) => {
  writeTree(spec.cwd, {
    ".fail": FAIL_OUTPUT,
    [`src/feature-${spec.ticketId}.txt`]: "attempt\n",
  });
  git(spec.cwd, "add", "src");
  // --allow-empty: a later generation replaying this stage produces an
  // identical tree, and a stage must not crash on "nothing to commit".
  git(spec.cwd, "commit", "-q", "--allow-empty", "-m", `${spec.ticketId}: attempt`);
  return okResult();
};

/** Leaves .fail in place — the fix fails. */
export const noopFix: StageFn = () => okResult();

/** Removes the failure marker — the fix works. */
export const fixGreen: StageFn = (spec) => {
  rmSync(path.join(spec.cwd, ".fail"), { force: true });
  return okResult();
};

/** A schema-valid A-4 brief for the fixture failure. */
export const researchValid: StageFn = (spec) => {
  let signature = "0".repeat(64);
  try {
    const failure = JSON.parse(
      readFileSync(path.join(path.dirname(spec.artifactOut), "last_failure.json"), "utf8"),
    ) as { signature?: string };
    if (failure.signature !== undefined) signature = failure.signature;
  } catch {
    /* no failure record */
  }
  return writeArtifactStage({
    schema_version: 1,
    failure_signature: signature,
    cache_key: createHash("sha256").update(signature).digest("hex"),
    root_cause: { claim: "off-by-one in totals", confidence: "high" },
    evidence: [{ source: "src/calc.py:2", claim: "sum excludes the seed row" }],
    version_facts: {},
    recommended_fix: { strategy: "add the seed row before summing" },
    what_would_falsify: "test stays red after seeding",
    sources_consulted: [{ tier: 2, ref: "src/calc.py" }],
    local_search: { docs_checked: ["PRD.md"], code_checked: ["src/calc.py"] },
  })(spec);
};

export const reviewApprove: StageFn = writeArtifactStage({ schema_version: 1, verdict: "approve" });

export const reviewChanges: StageFn = writeArtifactStage({
  schema_version: 1,
  verdict: "changes",
  changes: [{ tag: "scope", finding: "unrelated refactor" }],
});
