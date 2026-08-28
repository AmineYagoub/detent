import { afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { CEILINGS, type Budgets } from "../../src/schemas/budgets.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { okResult, type StageFn } from "../../src/sessions/mock.js";
import { gitInit, removeTree, tmpTree } from "../helpers.js";

/** Shared init-test fixture: one planner mock, one repo shape, one budget set. */

export const PROMPTS = loadPromptSet();
export const BUDGETS = Object.fromEntries(
  Object.entries(CEILINGS).map(([k, s]) => [k, s.default]),
) as Budgets;

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

export function repo(files: Record<string, string> = {}): string {
  const root = tmpTree(files);
  roots.push(root);
  gitInit(root);
  return root;
}

export const ANALYSIS = (stack: object | null): object => ({
  schema_version: 1,
  summary: "s",
  stack,
  questions: [],
  assumptions: [],
  docs_read: ["PRD.md"],
});

export const DRAFT = (ids: string[]): object => ({
  schema_version: 1,
  tickets: ids.map((id, i) => ({
    id,
    type: "feature",
    title: `t ${id}`,
    description: "",
    acceptance_criteria: ["it works"],
    non_goals: [],
    surface: ["src/**"],
    depends_on: i === 0 ? [] : [ids[0]],
    risk_label: false,
  })),
});

export const APPROVE_PLAN = { schema_version: 1, verdict: "approve", findings: [] };

/** The planner answers whichever artifact the spec asks for (three stages since PRDR-084). */
export const planner =
  (analysis: object, draft: object, review: object = APPROVE_PLAN): StageFn =>
  (spec) => {
    const artifact = spec.artifactOut.endsWith("plan-draft.json")
      ? draft
      : spec.artifactOut.endsWith("plan-review.json")
        ? review
        : analysis;
    writeFileSync(spec.artifactOut, `${JSON.stringify(artifact)}\n`);
    return okResult();
  };

/** A brownfield repo whose lone `test` script binds without a question. */
export const LONE_CANDIDATE = {
  "PRD.md": "# spec\n",
  "package.json": JSON.stringify({ name: "svc", scripts: { test: "sh scripts/test.sh" } }, null, 2),
  "package-lock.json": "{}\n",
  "scripts/test.sh": "#!/bin/sh\nexit 0\n",
};
