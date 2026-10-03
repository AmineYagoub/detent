import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { claimBriefSchema, claimSchema } from "../schemas/audit.js";
import { SCHEMA_VERSION, sha256Hex } from "../schemas/common.js";
import { packFindingSchema } from "../schemas/pack.js";
import { reviewFindingSchema } from "../schemas/validate.js";

/**
 * N-8 (PRDR-326) — the evaluation sets: what a lower model or effort level is
 * measured on before any routing moves to it (D-35, S-5⁷).
 *
 * A set is a directory: `set.json`, and `tree/`, every file its sessions
 * could read, byte for byte as they read them, with each file's digest in
 * `set.json`. The claims set holds claims arm A of PRDR-317's A/B test found
 * wrong and a sample of those it confirmed, each with the survey's wording and
 * arm A's brief, and its tree is the project as the survey read it. The
 * reviews set holds the areas of VALIDATE's first round whose kept reviews
 * hold a blocker, each with its reviewer's task, the key that digests it and
 * the review's blockers and majors, and its tree is the pack as the reviewers
 * read it. A set is written outside
 * this repository, which holds only the code that builds, runs and scores
 * them: a project's documents, claims and findings are its own.
 */

/** This repository's root, which no set is written into. */
export const DETENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A tree: each file's path, relative and with `/`, to the sha256 of its bytes. */
const treeSchema = z.record(z.string(), sha256Hex);
export type Tree = z.infer<typeof treeSchema>;

const builtSchema = z.strictObject({
  at: z.string(),
  /** The Detent build that built the set. */
  build: z.string(),
  /** The copy the set was read from, real path: no evaluation runs there. */
  from: z.string(),
  /** That copy's git directory, which every worktree of its repository shares. */
  git_dir: z.string(),
});

export const claimsSetSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  kind: z.literal("claims"),
  built: builtSchema,
  /** How the claims were chosen, in words, as the set's reader is told. */
  selection: z.string(),
  /** The documents being checked, which never settle a claim they make (C-2¹¹). */
  documents: z.array(z.string()),
  tree: treeSchema,
  claims: z.array(
    z.strictObject({
      claim: claimSchema,
      claim_hash: sha256Hex,
      /** What arm A found: the bar asks every `wrong` found wrong and no `confirmed` called wrong without a source (N-8). */
      expected: z.enum(["wrong", "confirmed"]),
      arm_a: claimBriefSchema,
    }),
  ),
});
export type ClaimsSet = z.infer<typeof claimsSetSchema>;

export const reviewsSetSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  kind: z.literal("reviews"),
  built: builtSchema,
  selection: z.string(),
  greenfield: z.boolean(),
  /** The `spec_review` prompt's hash the kept reviews' keys digest. */
  prompt_hash: sha256Hex,
  /** The pack's documents a reviewer is given as `pack`. */
  pack: z.array(z.string()),
  tree: treeSchema,
  areas: z.array(
    z.strictObject({
      name: z.string(),
      /** Its index among the round's areas, which names its reviewer's artifact. */
      index: z.number().int().nonnegative(),
      /** The kept review's key, which this task and the tree's files digest to (C-2²³). */
      key: sha256Hex,
      task: z.strictObject({
        foundations: z.array(z.string()),
        documents: z.array(z.string()),
        heuristic: z.array(packFindingSchema.extend({ blocks: z.boolean() })),
      }),
      /** How many findings its kept review holds. */
      findings: z.number().int().nonnegative(),
      blockers: z.array(reviewFindingSchema),
      /**
       * N-8′: its kept review's majors, which the bar asks 90% of. A set built
       * before N-8′ holds none until `eval-build --majors` adds them.
       */
      majors: z.array(reviewFindingSchema).optional(),
    }),
  ),
});
export type ReviewsSet = z.infer<typeof reviewsSetSchema>;

export const evalSetSchema = z.discriminatedUnion("kind", [claimsSetSchema, reviewsSetSchema]);
export type EvalSet = z.infer<typeof evalSetSchema>;

/** N-8′: what adds the majors to a reviews set built before the bar asked for them. */
export const ADD_MAJORS = "npx tsx scripts/eval-build.ts --majors <the reviews set>";

/** A refusal the operator can act on: nothing was built, run or written. */
export class EvalRefused extends Error {
  override readonly name = "EvalRefused";
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Where a set keeps its tree's files. */
export const treeDir = (setDir: string): string => path.join(setDir, "tree");

const setFile = (setDir: string): string => path.join(setDir, "set.json");

/** Every file under `root` a session could read, relative and sorted: `.git/` and `.detent/` are no session's to read. */
export function workingFiles(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(root, rel)).sort()) {
    if (rel === "" && (entry === ".git" || entry === ".detent")) continue;
    const child = rel === "" ? entry : `${rel}/${entry}`;
    if (statSync(path.join(root, child)).isDirectory()) out.push(...workingFiles(root, child));
    else out.push(child);
  }
  return out;
}

/** The files a commit holds, and a reader of their bytes as committed. */
export function committedFiles(root: string, rev = "HEAD"): { readonly files: string[]; readonly read: (rel: string) => Buffer } {
  const listed = execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", rev], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  return {
    files: listed.split("\0").filter((f) => f !== "").sort(),
    read: (rel) => execFileSync("git", ["cat-file", "blob", `${rev}:${rel}`], { cwd: root, maxBuffer: 256 * 1024 * 1024 }),
  };
}

export const treeOf = (files: readonly string[], read: (rel: string) => Buffer): Tree => Object.fromEntries(files.map((rel) => [rel, sha256(read(rel))]));

/** How `root`'s working files differ from `tree`: missing, changed, and there but not in it. */
export function treeDiff(root: string, tree: Tree): { readonly missing: string[]; readonly changed: string[]; readonly extra: string[] } {
  const here = new Set(workingFiles(root));
  const missing = Object.keys(tree).filter((rel) => !here.has(rel));
  const changed = Object.keys(tree).filter((rel) => here.has(rel) && sha256(readFileSync(path.join(root, ...rel.split("/")))) !== tree[rel]);
  const extra = [...here].filter((rel) => !(rel in tree));
  return { missing, changed, extra };
}

/** The real path of a git work tree's root and its git directory, or a refusal naming `what`. */
export function gitRoot(dir: string, what: string): { readonly root: string; readonly gitDir: string } {
  if (!existsSync(dir)) throw new EvalRefused(`${what} ${dir} does not exist`);
  const real = realpathSync(dir);
  let top: string;
  let common: string;
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: real }).toString("utf8").trim();
    common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: real }).toString("utf8").trim();
  } catch {
    throw new EvalRefused(`${what} ${real} is not a git work tree`);
  }
  if (realpathSync(top) !== real) throw new EvalRefused(`${what} ${real} is not the root of its git work tree, ${top}`);
  return { root: real, gitDir: realpathSync(path.resolve(real, common)) };
}

/** Whether `dir` is `root` or inside it. */
export const within = (dir: string, root: string): boolean => {
  const rel = path.relative(root, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** Refuses a set directory inside this repository or inside the copy it was read from: a set is kept where the operator says, outside both. */
export function refuseInside(dir: string, from: string): void {
  const resolved = path.resolve(dir);
  const real = existsSync(resolved) ? realpathSync(resolved) : resolved;
  if (within(real, realpathSync(DETENT_ROOT))) throw new EvalRefused(`a set is kept outside this repository, which is public, and ${real} is inside it (N-8)`);
  if (within(real, from)) throw new EvalRefused(`a set is kept outside the copy it was read from, and ${real} is inside ${from} (N-8)`);
}

/** Writes a tree's files under `setDir`, which must not exist yet: a set is built once, into a directory it makes. */
export function writeTree(setDir: string, tree: Tree, read: (rel: string) => Buffer): void {
  if (existsSync(setDir)) throw new EvalRefused(`${setDir} already exists; a set is built once, into a directory it makes`);
  for (const rel of Object.keys(tree)) {
    const to = path.join(treeDir(setDir), ...rel.split("/"));
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, read(rel));
  }
}

/** Writes `set.json` last, once its tree is written and checked: a directory without it holds no set. */
export function writeSetFile(setDir: string, set: EvalSet): void {
  writeFileSync(setFile(setDir), `${JSON.stringify(set, null, 2)}\n`);
}

/** A set, read and checked: a tree file that no longer matches its digest refuses it. */
export function readSet(setDir: string): EvalSet {
  if (!existsSync(setFile(setDir))) throw new EvalRefused(`${setDir} holds no set.json`);
  const set = evalSetSchema.parse(JSON.parse(readFileSync(setFile(setDir), "utf8")));
  const diff = treeDiff(treeDir(setDir), set.tree);
  const off = [...diff.missing, ...diff.changed, ...diff.extra];
  if (off.length > 0) throw new EvalRefused(`${setDir}: its tree is not the one set.json digests (${off.slice(0, 5).join(", ")}${off.length > 5 ? ", …" : ""})`);
  return set;
}
