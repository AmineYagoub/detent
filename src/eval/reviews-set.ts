import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stateDir } from "../fs/layout.js";
import { isGreenfield } from "../init/greenfield.js";
import { keptReviewsPath, reviewKey } from "../init/validate-kept.js";
import { reviewable } from "../init/validate-scope.js";
import { roundTasks } from "../init/validate.js";
import { detentBuild } from "../kernel/build.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { reviewFindingSchema } from "../schemas/validate.js";
import type { BuiltSet } from "./claims-set.js";
import { EvalRefused, gitRoot, refuseInside, treeDir, treeOf, workingFiles, writeSetFile, writeTree, type ReviewsSet } from "./sets.js";

/**
 * N-8 (PRDR-326) — the reviews set, read from a copy whose first VALIDATE
 * round kept its reviews (C-2²³).
 *
 * A kept review is keyed by what its reviewer was given and by the contents
 * of every file it was given to read (`reviewKey`). The tree is the copy's
 * working files, and the set's builder computes each area's round-1 task from
 * that tree with VALIDATE's own code: a kept review whose key a task gives is
 * that area's reviewer's, and proves the tree is what it read. A kept review
 * no task gives was made of an earlier pack, and is left out. The set is the
 * areas whose proven review holds a blocker, each with its task and its
 * blockers; the reviewers' other findings are counted, not kept.
 */

const keptSchema = z.object({
  reviews: z.array(z.object({ key: z.string(), round: z.number(), area: z.string(), findings: z.array(reviewFindingSchema) })),
});

/** Whether the copy's project had code when it was discovered: the pack checker reads a greenfield pack differently. */
function greenfieldOf(root: string): boolean {
  const file = path.join(stateDir(root), "state", "DISCOVER.json");
  try {
    const markers = (JSON.parse(readFileSync(file, "utf8")) as { outputs?: { stack_markers?: unknown } }).outputs?.stack_markers;
    if (Array.isArray(markers)) return isGreenfield(markers as string[]);
  } catch {
    /* Read below as absent, which refuses the set with the file named. */
  }
  throw new EvalRefused(`${file} names no stack markers, so whether the pack is greenfield cannot be told`);
}

/** Builds the reviews set from `from`, into `setDir`, which must not exist yet; `promptHash` is the `spec_review` prompt's the keys digest. */
export function buildReviewsSet(from: string, setDir: string, opts: { readonly promptHash: string; readonly now?: () => Date }): BuiltSet<ReviewsSet> {
  const { root, gitDir } = gitRoot(from, "the copy the set is read from,");
  refuseInside(setDir, root);
  const greenfield = greenfieldOf(root);
  let kept: z.infer<typeof keptSchema>["reviews"];
  try {
    kept = keptSchema.parse(JSON.parse(readFileSync(keptReviewsPath(root), "utf8"))).reviews;
  } catch {
    throw new EvalRefused(`${root} keeps no reviews this build can read at ${keptReviewsPath(root)}`);
  }
  const files = workingFiles(root);
  const read = (rel: string): Buffer => readFileSync(path.join(root, ...rel.split("/")));
  const tree = treeOf(files, read);
  writeTree(setDir, tree, read);
  const snapshot = treeDir(setDir);
  const { docs, areas, tasks } = roundTasks(snapshot, greenfield, null, null, null);
  /* The key digests the round, so no later round's review answers a round-1 task. */
  const proven = tasks.flatMap((task) => {
    const key = reviewKey(snapshot, 1, task, opts.promptHash);
    const review = kept.find((r) => r.key === key);
    return review === undefined ? [] : [{ task, key, review }];
  });
  const withBlockers = proven.filter((p) => p.review.findings.some((f) => f.severity === "blocker"));
  if (withBlockers.length === 0) {
    rmSync(setDir, { recursive: true, force: true });
    throw new EvalRefused(
      `of ${String(kept.length)} kept reviews, ${String(proven.length)} are proven by their keys and none holds a blocker; ` +
        "a key holds only for the pack its reviewer read and the spec_review prompt it was given, so a different prompt hash may be needed",
    );
  }
  const set: ReviewsSet = {
    schema_version: SCHEMA_VERSION,
    kind: "reviews",
    built: { at: (opts.now?.() ?? new Date()).toISOString(), build: detentBuild(), from: root, git_dir: gitDir },
    selection: "every area of VALIDATE's first round whose kept review holds a blocker, each review proven by its key against this tree",
    greenfield,
    prompt_hash: opts.promptHash,
    pack: docs.filter(reviewable),
    tree,
    areas: withBlockers.map(({ task, key, review }) => ({
      name: task.area.name,
      index: areas.indexOf(task.area),
      key,
      task: { foundations: [...task.foundations], documents: [...task.documents], heuristic: task.heuristic.map((f) => ({ ...f, blocks: false })) },
      findings: review.findings.length,
      blockers: review.findings.filter((f) => f.severity === "blocker"),
    })),
  };
  writeSetFile(setDir, set);
  const findings = proven.reduce((n, p) => n + p.review.findings.length, 0);
  const blockers = set.areas.reduce((n, a) => n + a.blockers.length, 0);
  return {
    set,
    report: [
      `kept reviews: ${String(kept.length)}, ${String(proven.length)} proven by their keys as first-round reviews of this tree (the rest reviewed an earlier pack or round), holding ${String(findings)} findings`,
      `the reviews set: ${String(blockers)} blockers in ${String(set.areas.length)} areas, with a tree of ${String(files.length)} files as the reviewers read them`,
    ],
  };
}
