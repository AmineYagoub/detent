import { readFileSync } from "node:fs";
import { auditBriefPath, checkOneClaim } from "../init/audit-claims.js";
import { verifyClaimsInputs } from "../init/audit.js";
import { inBatches } from "../init/batches.js";
import { launchInitSession, type InitSessionDeps } from "../init/session.js";
import { reviewKey } from "../init/validate-kept.js";
import { reviewArea } from "../init/validate-round.js";
import { withRoundScratch } from "../init/validate-scratch.js";
import { reviewable } from "../init/validate-scope.js";
import { roundTasks } from "../init/validate.js";
import { claimBriefSchema, type ClaimBrief } from "../schemas/audit.js";
import type { PromptSet } from "../sessions/backend.js";
import type { Sandbox } from "../sessions/sandbox.js";
import { probeSandbox } from "../sessions/sandbox-probe.js";
import { BudgetReached, type EvalBudget } from "./budget.js";
import type { AreaResult, ClaimResult } from "./results.js";
import { EvalRefused, type ClaimsSet, type ReviewsSet } from "./sets.js";

/**
 * N-8 (PRDR-326) — a set's units, run through `init`'s own code: each claim
 * checked by AUDIT's `checkOneClaim` on AUDIT's inputs, and each area reviewed
 * by VALIDATE's `reviewArea` on the task VALIDATE's round 1 gives it, with
 * the round's scratch directory where this machine's sandbox holds. Every
 * session asks the budget before it starts. The first it refuses leaves its
 * unit unfinished and starts no later one; a unit whose session failed is
 * unfinished too, and the rest go on, since an evaluation measures the units
 * that ran and says which did not.
 */

export interface UnitDeps {
  readonly root: string;
  readonly launch: InitSessionDeps;
  readonly budget: EvalBudget;
  readonly atOnce: number;
  readonly note: (text: string) => void;
  /** What the evaluation has spent so far, for the note after each unit. */
  readonly spent: () => number;
}

const clip = (text: string, n = 90): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** Why a unit did not finish, and whether no later unit may start. */
function unfinished(err: unknown): { readonly why: string; readonly stop: boolean } {
  if (err instanceof BudgetReached) return { why: err.message, stop: true };
  return { why: `a session failed: ${clip((err as Error).message, 300)}`, stop: false };
}

/** The brief a check committed for `hash`, or none where it committed none: the copy held none before it (`clearAnswers`). */
function committed(root: string, hash: string): ClaimBrief | null {
  try {
    const parsed = claimBriefSchema.safeParse(JSON.parse(readFileSync(auditBriefPath(root, hash), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    /* No brief: the check left the claim unchecked, and its verdict says so. */
    return null;
  }
}

/** The claims an evaluation checks: all of the set's, or only those arm A found wrong. */
export const claimsToCheck = (set: ClaimsSet, only: "wrong" | undefined): ClaimsSet["claims"] => (only === "wrong" ? set.claims.filter((c) => c.expected === "wrong") : set.claims);

/** Each claim of the set checked as AUDIT checks it, `atOnce` at a time; with `only`, just those arm A found wrong. */
export async function checkSet(set: ClaimsSet, deps: UnitDeps & { readonly only?: "wrong" | undefined }): Promise<{ readonly claims: ClaimResult[] }> {
  const claims = claimsToCheck(set, deps.only);
  const out = new Map<string, ClaimResult>();
  let stopped: string | null = null;
  await inBatches(claims, deps.atOnce, async (c) => {
    if (stopped !== null) {
      out.set(c.claim_hash, { claim_hash: c.claim_hash, checked: false, unfinished: stopped });
      return;
    }
    try {
      const { verdict } = await checkOneClaim(
        { claim: c.claim, hash: c.claim_hash },
        {
          root: deps.root,
          documents: set.documents,
          note: deps.note,
          launch: async (pending, artifactOut, previous) => {
            const result = await deps.budget.within(async () => await launchInitSession(deps.launch, { role: "audit", inputs: verifyClaimsInputs(pending, previous), artifactOut }));
            return { toolCalls: Math.max(1, result.turns) };
          },
        },
      );
      const brief = committed(deps.root, c.claim_hash);
      out.set(c.claim_hash, {
        claim_hash: c.claim_hash,
        verdict: verdict.verdict,
        checked: verdict.checked,
        ...(verdict.source === undefined ? {} : { source: verdict.source }),
        ...(verdict.correction === undefined ? {} : { correction: verdict.correction }),
        ...(brief === null ? {} : { brief }),
      });
    } catch (err) {
      const why = unfinished(err);
      if (why.stop) stopped = why.why;
      out.set(c.claim_hash, { claim_hash: c.claim_hash, checked: false, unfinished: why.why });
    }
    const got = out.get(c.claim_hash);
    deps.note(`N-8 [${String(out.size)}/${String(claims.length)}] "${clip(c.claim.claim)}": ${got?.verdict ?? "not finished"}, arm A's ${c.expected}; $${deps.spent().toFixed(2)} spent`);
  });
  return { claims: claims.map((c) => out.get(c.claim_hash) ?? { claim_hash: c.claim_hash, checked: false, unfinished: "it was not run" }) };
}

/** Each area of the set reviewed as VALIDATE's round 1 reviews it, `atOnce` at a time, once its task is proven the set's. */
export async function reviewSet(set: ReviewsSet, deps: UnitDeps & { readonly prompts: PromptSet; readonly sandbox?: (() => Promise<Sandbox>) | undefined }): Promise<{ readonly areas: AreaResult[] }> {
  const { docs, areas, tasks } = roundTasks(deps.root, set.greenfield, null, null, null);
  const pack = docs.filter(reviewable);
  if (JSON.stringify(pack) !== JSON.stringify(set.pack)) throw new EvalRefused("the copy's pack is not the one the set's reviewers were given");
  const chosen = set.areas.map((area) => {
    const task = tasks.find((t) => t.area.name === area.name);
    if (task === undefined || reviewKey(deps.root, 1, task, set.prompt_hash) !== area.key) {
      throw new EvalRefused(`${area.name}: the task VALIDATE gives it on this copy is not the one its kept review was given, so a review of it would measure something else`);
    }
    return { name: area.name, task, index: areas.indexOf(task.area) };
  });
  if (deps.prompts.hashes.spec_review !== set.prompt_hash) {
    deps.note("N-8: the spec_review prompt is not the one the set's reviewers were given, so this evaluation measures the prompt's change as well");
  }
  const sandbox = await (deps.sandbox ?? (async () => await probeSandbox({ root: deps.root })))();
  const out = new Map<string, AreaResult>();
  let stopped: string | null = null;
  await withRoundScratch(deps.root, 1, sandbox, deps.note, async (scratch) => {
    await inBatches(chosen, deps.atOnce, async ({ name, task, index }) => {
      if (stopped !== null) {
        out.set(name, { name, unfinished: stopped });
        return;
      }
      try {
        const findings = await reviewArea(
          {
            root: deps.root,
            greenfield: set.greenfield,
            note: deps.note,
            review: async (inputs, artifactOut, grant) => {
              await deps.budget.within(
                async () => await launchInitSession(deps.launch, { role: "spec_review", inputs, artifactOut, ...(grant === null ? {} : { scratch: grant }) }),
              );
            },
            fix: () => Promise.reject(new Error("an evaluation runs no writer (N-8)")),
          },
          1,
          task,
          pack,
          scratch,
          index,
        );
        out.set(name, { name, findings });
      } catch (err) {
        const why = unfinished(err);
        if (why.stop) stopped = why.why;
        out.set(name, { name, unfinished: why.why });
      }
      const got = out.get(name)?.findings;
      const blockers = got?.filter((f) => f.severity === "blocker").length ?? 0;
      const summary = got === undefined ? "not finished" : `${String(got.length)} findings, ${String(blockers)} blockers`;
      deps.note(`N-8 [${String(out.size)}/${String(chosen.length)}] ${name}: ${summary}; $${deps.spent().toFixed(2)} spent`);
    });
  });
  return { areas: set.areas.map((a) => out.get(a.name) ?? { name: a.name, unfinished: "it was not run" }) };
}
