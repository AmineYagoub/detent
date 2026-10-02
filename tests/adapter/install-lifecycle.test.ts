import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ECOSYSTEMS, ensureDependencies, installNeeded, readMark } from "../../src/adapter/install.js";
import { bodyHash, readApprovals, recordApprovals } from "../../src/adapter/lifecycle.js";
import { gateEnv } from "../../src/adapter/normalize.js";
import { runGate } from "../../src/adapter/run.js";
import { removeTree } from "../helpers.js";

/**
 * V-1⁷ (PRDR-233), with real npm — the install keeps V-1⁶'s suppression and
 * runs the approved scripts of the manifest itself, where npm would have run
 * them; an edited body is not run; an approval given after an install installs
 * again; and for a project with approvals on record the run-wide switch no
 * longer lifts suppression.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

function project(scripts: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "detent-install-lifecycle-"));
  roots.push(dir);
  writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "x", private: true, version: "1.0.0", scripts }, null, 2)}\n`);
  return dir;
}

const approve = (root: string, scripts: Record<string, string>): void =>
  recordApprovals(
    root,
    Object.entries(scripts).map(([script, body]) => ({ package: ".", script, body, sha256: bodyHash(body) })),
    "2026-10-02T10:00:00.000Z",
    "operator",
  );

const NODE = ECOSYSTEMS[0]!;

async function install(root: string, env: NodeJS.ProcessEnv = {}): ReturnType<typeof ensureDependencies> {
  return await ensureDependencies(
    root,
    (command) => runGate({ command, cwd: root, timeoutMs: 120_000, env: gateEnv(root, env) }),
    ECOSYSTEMS,
    null,
    { approvals: readApprovals(root), package: "." },
  );
}

describe("V-1⁷ the install runs the approved scripts, and no others (PRDR-233)", () => {
  it("runs an approved preinstall before the install and the approved rest after it, and not an unapproved one", async () => {
    const scripts = {
      preinstall: "test ! -f package-lock.json && echo pre >> ORDER",
      install: "touch INST",
      postinstall: "test -f package-lock.json && echo post >> ORDER",
      prepare: "touch PREPARED",
    };
    const root = project(scripts);
    approve(root, { preinstall: scripts.preinstall, postinstall: scripts.postinstall, prepare: scripts.prepare });
    const outcome = await install(root);
    expect(outcome.kind, JSON.stringify(outcome).slice(0, 400)).toBe("installed");
    expect(readFileSync(path.join(root, "ORDER"), "utf8"), "preinstall before the install, postinstall after it").toBe("pre\npost\n");
    expect(existsSync(path.join(root, "PREPARED"))).toBe(true);
    expect(existsSync(path.join(root, "INST")), "an unapproved script still does not run").toBe(false);
    expect(outcome.kind === "installed" && outcome.notRun).toEqual([{ package: ".", script: "install", status: "not approved" }]);
  }, 180_000);

  it("does not run a body edited since its approval, and says so", async () => {
    const root = project({ postinstall: "touch EDITED" });
    approve(root, { postinstall: "touch APPROVED" });
    const outcome = await install(root);
    expect(outcome.kind).toBe("installed");
    expect(existsSync(path.join(root, "EDITED"))).toBe(false);
    expect(outcome.kind === "installed" && outcome.notRun).toEqual([{ package: ".", script: "postinstall", status: "edited since approved" }]);
  }, 180_000);

  it("installs again once a script is approved after an install, so the approval takes effect, and then not again", async () => {
    const root = project({ postinstall: "touch GENERATED" });
    expect((await install(root)).kind).toBe("installed");
    expect(existsSync(path.join(root, "GENERATED"))).toBe(false);
    expect(installNeeded(root, NODE)).toBeNull();
    approve(root, { postinstall: "touch GENERATED" });
    const again = await install(root);
    expect(again.kind).toBe("installed");
    expect(again.kind === "installed" ? again.reason : "").toContain("lifecycle scripts approved to run with the install changed");
    expect(existsSync(path.join(root, "GENERATED"))).toBe(true);
    expect((await install(root)).kind, "the mark records what ran").toBe("none");
    expect(readMark(root, NODE), "the mark the referee journals is still the install's timestamp").toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/u);
  }, 180_000);

  it("fails the install when an approved script fails, with that script as the red gate", async () => {
    const root = project({ postinstall: "echo the-script-failed; exit 4" });
    approve(root, { postinstall: "echo the-script-failed; exit 4" });
    const outcome = await install(root);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.result.command).toBe("npm run 'postinstall'");
    expect(outcome.result.output).toContain("the-script-failed");
    expect(installNeeded(root, NODE), "no mark: the next gate installs again").not.toBeNull();
  }, 180_000);

  it("for a project with approvals on record, the run-wide switch lifts nothing; for one without, it still lifts everything", async () => {
    const switched = { DETENT_ALLOW_LIFECYCLE_SCRIPTS: "1" };
    const recorded = project({ install: "touch INST", postinstall: "touch POST" });
    approve(recorded, { postinstall: "touch POST" });
    expect((await install(recorded, switched)).kind).toBe("installed");
    expect(existsSync(path.join(recorded, "POST"))).toBe(true);
    expect(existsSync(path.join(recorded, "INST")), "the finer verb supersedes the switch").toBe(false);

    const bare = project({ install: "touch INST", postinstall: "touch POST" });
    expect((await install(bare, switched)).kind).toBe("installed");
    expect(existsSync(path.join(bare, "INST")), "the blunt instrument, as V-1⁶ ships it").toBe(true);
    expect(existsSync(path.join(bare, "POST"))).toBe(true);
  }, 180_000);
});
