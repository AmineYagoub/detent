import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CEILINGS, type Budgets, type CeilingKey } from "../src/schemas/budgets.js";
import type { GuardContext } from "../src/kernel/machine.js";

export const DEFAULT_BUDGETS: Budgets = Object.fromEntries(
  (Object.keys(CEILINGS) as CeilingKey[]).map((k) => [
    k,
    "default" in CEILINGS[k] ? (CEILINGS[k] as { default: number }).default : 25,
  ]),
) as Budgets;

export function ctx(type: "feature" | "bug" = "feature", budgets: Budgets = DEFAULT_BUDGETS): GuardContext {
  return { ticket: { type }, budgets };
}

// ---------------------------------------------------------------------------
// Filesystem fixtures (M1). The adapter and fs tickets all need a scratch tree.

/** A scratch directory; the caller removes it with `removeTree`. */
export function tmpTree(files: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "detent-"));
  writeTree(root, files);
  return root;
}

/** Paths are POSIX-relative; parent directories are created as needed. */
export function writeTree(root: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
}

export function removeTree(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** A git repo with identity configured, so tests commit without a global config. */
export function gitInit(root: string): void {
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.email", "fixture@detent.test");
  git(root, "config", "user.name", "Detent Fixture");
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
}
