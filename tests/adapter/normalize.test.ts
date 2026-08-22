import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discover, plausible, type Candidate } from "../../src/adapter/discover/index.js";
import { CI_ENV, ciFlagsFor, normalizeInvocation, underlyingCommand } from "../../src/adapter/normalize.js";
import { removeTree, tmpTree } from "../helpers.js";

/** T-028 — invocation normalization matrix (V-4). */

const trees: string[] = [];
const tree = (files: Record<string, string>): string => {
  const root = tmpTree(files);
  trees.push(root);
  return root;
};
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
});

const pkg = (scripts: Record<string, string>, lock = "package-lock.json") => ({
  "package.json": JSON.stringify({ name: "svc", scripts }, null, 2),
  [lock]: "{}\n",
});

const testCandidate = (root: string): Candidate => plausible(discover(root).candidates, "test")[0]!;

describe("T-028 CI-mode flags", () => {
  it.each([
    ["vitest", "npm run test -- --run"],
    ["vitest run", "npm run test"],
    ["vitest --coverage", "npm run test -- --run"],
    ["jest", "npm run test -- --watchAll=false --ci"],
    ["jest --ci", "npm run test"],
    ["jest --watchAll=false", "npm run test"],
    ["pytest", "npm run test"],
    ["node --test", "npm run test"],
  ])("%s normalizes to `%s`", (script, expected) => {
    const root = tree(pkg({ test: script }));
    expect(normalizeInvocation(testCandidate(root)).command).toBe(expected);
  });

  it("inspects the script body, not the `npm run` wrapper", () => {
    const root = tree(pkg({ test: "vitest" }));
    expect(underlyingCommand(testCandidate(root))).toBe("vitest");
    expect(ciFlagsFor(testCandidate(root))).toEqual(["--run"]);
  });

  it("always sets CI=1 (V-4)", () => {
    const root = tree(pkg({ test: "vitest run" }));
    expect(normalizeInvocation(testCandidate(root)).env).toEqual(CI_ENV);
    expect(CI_ENV).toEqual({ CI: "1" });
  });
});

describe("T-028 package-manager selection happens at call time (V-4)", () => {
  it.each([
    ["package-lock.json", "npm", "npm run test -- --run"],
    ["pnpm-lock.yaml", "pnpm", "pnpm run test --run"],
    ["yarn.lock", "yarn", "yarn run test --run"],
    ["bun.lockb", "bun", "bun run test --run"],
  ])("%s ⇒ %s, with that manager's argument separator", (lock, pm, expected) => {
    const root = tree(pkg({ test: "vitest" }, lock));
    expect(discover(root).stack.pm).toBe(pm);
    expect(normalizeInvocation(testCandidate(root)).command).toBe(expected);
  });

  it("a lockfile swapped after discovery is honoured at invocation", () => {
    const root = tree(pkg({ test: "vitest run" }));
    const candidate = testCandidate(root);
    expect(candidate.pm).toBe("npm");
    /** V-4 puts pm selection at call time, so the stored binding does not pin it. */
    expect(normalizeInvocation(candidate, { pm: "pnpm" }).command).toBe("pnpm run test");
  });

  it("tsc gets the manager's exec form", () => {
    const root = tree({ ...pkg({}, "pnpm-lock.yaml"), "tsconfig.json": "{}\n" });
    const candidate = plausible(discover(root).candidates, "typecheck")[0]!;
    expect(normalizeInvocation(candidate).command).toBe("pnpm exec tsc --noEmit");
  });

  it("a command that is already an invocation passes through", () => {
    const root = tree({ "go.mod": "module x\n" });
    const candidate = plausible(discover(root).candidates, "test")[0]!;
    expect(normalizeInvocation(candidate).command).toBe("go test ./...");
  });
});

describe("T-028 F-2: normalization never edits project files", () => {
  it("the tree is byte-identical before and after normalizing every candidate", () => {
    const root = tree({
      ...pkg({ test: "vitest", lint: "eslint .", build: "tsup" }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
      Makefile: "test:\n\techo hi\n",
    });
    const before = hashTree(root);
    for (const candidate of discover(root).candidates) normalizeInvocation(candidate);
    expect(hashTree(root)).toBe(before);
  });
});

function hashTree(root: string): string {
  const h = createHash("sha256");
  const walk = (dir: string, prefix = ""): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else h.update(`${rel}\0`).update(readFileSync(abs));
    }
  };
  walk(root);
  return h.digest("hex");
}
