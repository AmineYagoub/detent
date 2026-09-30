import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { checkpointPath } from "../fs/checkpoints.js";
import { stateDir } from "../fs/layout.js";
import { auditBriefPath } from "../init/audit-claims.js";
import { INIT_TICKET } from "../init/session.js";
import { liveRunLock } from "../kernel/run-lock.js";
import { DETENT_ROOT, EvalRefused, gitRoot, treeDiff, treeDir, within, type EvalSet } from "./sets.js";

/**
 * N-8 (PRDR-326) — the disposable copy an evaluation runs on.
 *
 * An evaluation launches real sessions, and they read the copy as a project.
 * So the copy is never the project a set came from: not the copy the set was
 * read from, nor any worktree of its repository, nor this repository. Its
 * files are the set's tree exactly, so the sessions read what the set's own
 * sessions read, and a copy whose files differ is refused. The operator may
 * ask for the tree to be staged instead: it is committed to a branch of the
 * copy, which leaves every earlier commit as it was, and only a copy with
 * nothing uncommitted outside `.detent/` is staged, so nothing is lost.
 *
 * AUDIT checks only a claim no brief of which is committed, and VALIDATE's
 * first round reviews an area no review of which is kept, so none of their
 * sessions can find the answer it is asked for. A copy holds such answers: the
 * run it was cloned with left them, or an evaluation before. Each is removed
 * before a session starts (`clearAnswers`), and what this evaluation's
 * sessions commit is kept in its results.
 */

const git = (root: string, args: readonly string[]): string => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");

type Diff = ReturnType<typeof treeDiff>;

const describe = (diff: Diff): string => {
  const parts = [
    ...diff.missing.map((rel) => `${rel} missing`),
    ...diff.changed.map((rel) => `${rel} changed`),
    ...diff.extra.map((rel) => `${rel} not in the set`),
  ];
  return `${parts.slice(0, 6).join(", ")}${parts.length > 6 ? `, and ${String(parts.length - 6)} more` : ""}`;
};

const same = (diff: Diff): boolean => diff.missing.length + diff.changed.length + diff.extra.length === 0;

/** The branch a set's tree is staged on. */
export const stagedBranch = (set: EvalSet): string => `detent-eval/${set.kind}`;

function stageTree(root: string, set: EvalSet, setDir: string): void {
  const dirty = git(root, ["status", "--porcelain", "--untracked-files=all", "-z"])
    .split("\0")
    .filter((entry) => entry !== "")
    .map((entry) => entry.slice(3))
    .filter((rel) => !rel.startsWith(".detent/"));
  if (dirty.length > 0) throw new EvalRefused(`${root} holds changes no commit has, which staging would lose: ${dirty.slice(0, 5).join(", ")}`);
  git(root, ["checkout", "-q", "-B", stagedBranch(set)]);
  git(root, ["rm", "-r", "-q", "--ignore-unmatch", "--", ".", ":(exclude).detent"]);
  for (const rel of Object.keys(set.tree)) {
    const to = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(path.join(treeDir(setDir), ...rel.split("/")), to);
  }
  git(root, ["add", "-A", "--", ".", ":(exclude).detent"]);
  git(root, [
    "-c",
    "user.name=Detent evaluation",
    "-c",
    "user.email=evaluation@detent.invalid",
    "commit",
    "-q",
    "--no-verify",
    "--allow-empty",
    "-m",
    `N-8: the ${set.kind} set's tree, as its sessions read it`,
  ]);
}

const CHECK_ARTIFACT = /^audit-claim-[0-9a-f]{12}\.json$/u;
const REVIEW_ARTIFACT = /^review-artifact-\d+\.json$/u;

/** Removes each record the copy holds of a verdict on a unit of the set, and returns their paths in the copy. */
export function clearAnswers(root: string, set: EvalSet): string[] {
  const state = path.join(stateDir(root), "state");
  const named = (pattern: RegExp): string[] => (existsSync(state) ? readdirSync(state).filter((n) => pattern.test(n)).map((n) => path.join(state, n)) : []);
  const records =
    set.kind === "claims"
      ? [...set.claims.map((c) => auditBriefPath(root, c.claim_hash)), ...named(CHECK_ARTIFACT), checkpointPath(root, "AUDIT")]
      : [path.join(state, "validate"), ...named(REVIEW_ARTIFACT), checkpointPath(root, "VALIDATE")];
  /* The journal records each session's last words, and a check's end with its verdict. */
  records.push(path.join(stateDir(root), "runs", INIT_TICKET, "journal.jsonl"));
  const gone = records.filter((p) => existsSync(p));
  for (const p of gone) rmSync(p, { recursive: true, force: true });
  return gone.map((p) => path.relative(root, p).split(path.sep).join("/"));
}

/** The copy's real path, once it is proven a copy the set may run on and its files are the set's tree. */
export function prepareCopy(copy: string, set: EvalSet, setDir: string, stage: boolean, note: (text: string) => void): string {
  const { root, gitDir } = gitRoot(copy, "the copy an evaluation runs on,");
  if (root === set.built.from) throw new EvalRefused(`${root} is the copy the set was read from, and no evaluation runs there (N-8)`);
  if (gitDir === set.built.git_dir) throw new EvalRefused(`${root} is a worktree of the repository the set was read from, and no evaluation runs there (N-8)`);
  if (within(root, DETENT_ROOT)) throw new EvalRefused(`${root} is inside Detent's own repository, and no evaluation runs there (N-8)`);
  const held = liveRunLock(root);
  if (held !== null) throw new EvalRefused(`${root} is held by process ${String(held.pid)} on ${held.host}, and an evaluation waits for it to end`);
  const before = treeDiff(root, set.tree);
  if (same(before)) return root;
  if (!stage) {
    throw new EvalRefused(`${root}'s files are not the set's tree: ${describe(before)}. Pass --stage to commit the set's tree to the branch ${stagedBranch(set)} of the copy`);
  }
  stageTree(root, set, setDir);
  const after = treeDiff(root, set.tree);
  if (!same(after)) throw new EvalRefused(`staging left ${root}'s files other than the set's tree: ${describe(after)}`);
  note(`N-8: the ${set.kind} set's tree is committed to the branch ${stagedBranch(set)} of ${root}`);
  return root;
}
