import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { UNRECORDED_BUILD, buildOf, detentBuild, isMixed } from "../../src/kernel/build.js";
import type * as Build from "../../src/kernel/build.js";
import { readConformanceRecord } from "../../src/init/pack.js";
import { redraftRecordPath } from "../../src/init/machine.js";
import { buildLines, planBuilds, type BuildShare } from "../../src/init/plan-builds.js";
import { MIXED_BUILDS_REFUSED, approvalPath, presentStage, readPresentation, type ApprovalDecision, type PresentDeps } from "../../src/init/present.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { approvalSchema, presentationSchema } from "../../src/schemas/records.js";
import { removeTree, tmpTree, writeTree } from "../helpers.js";
import { CONFORMING_PACK } from "./pack-fixture.js";
import { clear, draft, edit, seeded, sliced, type Json } from "./seed-fixture.js";

/**
 * PRDR-297 (N-5″) — a plan's builds are recorded and shown, and a plan more
 * than one build made is approved as a toolchain install is (PRDR-276).
 *
 * At least four Detent builds assembled ksar-cloud's plan, all on one version,
 * and one of its slices was the draft of an experiment run against the live
 * tree. Nothing recorded which build wrote a checkpoint, so nothing could say
 * so, and the plan's outcomes could not be attributed to any one build.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

const CURRENT = detentBuild();
const FOREIGN = "3.0.9+0123456789ab";
const PACK = "c".repeat(64);

function root(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "detent-builds-"));
  roots.push(dir);
  mkdirSync(path.join(stateDir(dir), "state", "plan"), { recursive: true });
  return dir;
}

const put = (dir: string, rel: string, value: object): void => {
  const file = path.join(stateDir(dir), "state", ...rel.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ schema_version: SCHEMA_VERSION, ...value })}\n`);
};
const readState = (dir: string, rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(stateDir(dir), "state", ...rel.split("/")), "utf8")) as Record<string, unknown>;

describe("PRDR-297: every planning record names the build that wrote it (N-5″)", () => {
  it("names a build by its version and a digest of what it runs, the same on every call", () => {
    const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
    expect(CURRENT).toMatch(new RegExp(`^${version.replaceAll(".", "\\.")}\\+[0-9a-f]{12}$`, "u"));
    expect(detentBuild()).toBe(CURRENT);
  });

  it("is a digest of the source, the prompts and the manifest, and of nothing else in the tree", () => {
    const tree = tmpTree({ "package.json": '{"version":"9.9.9"}\n', "src/a.ts": "a\n", "prompts/p.md": "p\n", "README.md": "r\n" });
    roots.push(tree);
    const first = buildOf(tree);
    expect(first).toMatch(/^9\.9\.9\+[0-9a-f]{12}$/u);
    writeTree(tree, { "README.md": "another readme\n", "docs/x.md": "x\n" });
    expect(buildOf(tree), "a document is not what runs").toBe(first);
    const moved = new Set([first]);
    for (const [file, text] of [
      ["src/a.ts", "a2\n"],
      ["src/deep/b.ts", "b\n"],
      ["prompts/p.md", "p2\n"],
      ["package.json", '{"version":"9.9.9","dependencies":{"x":"1"}}\n'],
    ] as const) {
      writeTree(tree, { [file]: text });
      const now = buildOf(tree);
      expect(moved.has(now), `${file} moved the build`).toBe(false);
      moved.add(now);
    }
  });

  /*
   * PRDR-311 (N-5‴): tabachir's `init` loaded 247a2b9 at 08:56 and wrote its
   * first checkpoint at 09:52, from a checkout that had moved on in between.
   * The stamp named that tree, 517b414e313b, which never ran; 65e7283f323d,
   * the build that did, was named nowhere.
   */
  it("is the tree the process loaded, not the tree as it stands at the first stamp (PRDR-311)", async () => {
    const tree = tmpTree({ "package.json": '{"version":"9.9.9"}\n', "src/kernel/build.ts": readFileSync("src/kernel/build.ts", "utf8"), "prompts/p.md": "p\n" });
    roots.push(tree);
    const loaded = buildOf(tree);
    const copy = (await import(pathToFileURL(path.join(tree, "src", "kernel", "build.ts")).href)) as typeof Build;
    writeTree(tree, { "prompts/p.md": "edited after the process loaded\n" });
    expect(copy.buildOf(tree), "the tree itself moved").not.toBe(loaded);
    expect(copy.detentBuild()).toBe(loaded);
  });

  it("counts a record that names no build as a build of its own, and never as the one build", () => {
    expect(isMixed([])).toBe(false);
    expect(isMixed([CURRENT])).toBe(false);
    expect(isMixed([CURRENT, CURRENT])).toBe(false);
    expect(isMixed([CURRENT, FOREIGN])).toBe(true);
    expect(isMixed([UNRECORDED_BUILD]), "it may have been several").toBe(true);
  });

  it("stamps every checkpoint, the cut, each slice's cache and the presentation with the build that wrote them", async () => {
    const s = seeded();
    const result = await s.init();
    expect(result.interrupt?.interrupt).toBe("AWAIT_APPROVAL");
    for (const phase of result.executed) expect(readState(s.root, `${phase}.json`)["build"], phase).toBe(CURRENT);
    for (const slice of ["s01", "s02", "s03"]) expect(readState(s.root, `plan/${slice}.json`)["build"], slice).toBe(CURRENT);
    expect(readState(s.root, "slicing.json")["builds"]).toEqual([CURRENT]);
    const pack = readConformanceRecord(s.root)?.hash ?? "";
    expect(readPresentation(s.root)).toMatchObject({ builds: [CURRENT], pack_hash: pack });
    expect(result.interrupt?.message).toContain(`Made by one Detent build, ${CURRENT}, from pack ${pack.slice(0, 12)} (N-5″).`);
  });

  it("stamps each redraft the checks across the plan sent with the build that drafted it", async () => {
    /* s01's first draft and s02's both provide one name, so the checks across the plan send s01 a redraft (A-1⁷). */
    const shared = (inputs: Json): Json => {
      const d = draft(inputs) as { tickets: Json[] };
      return { ...d, tickets: [{ ...d.tickets[0], provides: [{ kind: "config", id: "SHARED", note: "what SHARED means" }] }] };
    };
    const s = seeded(undefined, {
      draft: (take, inputs) => {
        const slice = (inputs["slice"] as { id: string }).id;
        return (slice === "s01" && take === 1) || slice === "s02" ? shared(inputs) : draft(inputs);
      },
    });
    await s.init();
    const redrafts = (JSON.parse(readFileSync(redraftRecordPath(s.root), "utf8")) as { redrafts: Record<string, unknown>[] }).redrafts;
    expect(redrafts.map((r) => r["slice"])).toContain("s01");
    for (const r of redrafts) expect(r["build"], String(r["slice"])).toBe(CURRENT);
    expect(planBuilds(s.root, [{ id: "s01" }, { id: "s02" }, { id: "s03" }])).toEqual([
      expect.objectContaining({ build: CURRENT, made: expect.arrayContaining(["s01's redraft"]) as unknown as string[] }),
    ]);
  });

  it("keeps the builds that cut what SLICE keeps, and adds its own for what it adds", async () => {
    const checkout = "docs/prd/02-checkout.md";
    const chk = "- **CHK-F-002** [M1] [E2E] Checkout MUST accept DZD only (D-1).";
    const last = "`order.placed` event carries the order id, and a EUR cart answers `409` (CHK-F-001–CHK-F-002).";
    const s = seeded(CONFORMING_PACK, {
      additions: () => ({ schema_version: SCHEMA_VERSION, placed: [{ requirement_id: "CHK-F-003", slice: "s03" }], new_slices: [] }),
    });
    await s.init();
    const recorded = readState(s.root, "slicing.json");
    delete recorded["builds"];
    put(s.root, "slicing.json", recorded);

    clear(s);
    edit(s.root, checkout, [chk, "- **CHK-F-002** [M1] [E2E] Checkout MUST accept DZD only, and say so at the cart (D-1)."]);
    await s.init();
    expect(sliced(s), "the cut on record stands, and no session runs").toEqual([]);
    expect(readState(s.root, "slicing.json")["builds"], "so it is still the builds' that cut it, which went unrecorded").toEqual([UNRECORDED_BUILD]);
    put(s.root, "slicing.json", { ...readState(s.root, "slicing.json"), builds: [FOREIGN] });

    edit(
      s.root,
      checkout,
      ["- **CHK-F-002** [M1] [E2E] Checkout MUST accept DZD only, and say so at the cart (D-1).", "- **CHK-F-002** [M1] [E2E] Checkout MUST accept DZD only, and say so at the cart (D-1).\n- **CHK-F-003** [M1] Checkout MUST record how the order was paid."],
      [last, `${last}\n- **CHK-AC-03** [M1] Given a paid order, when it is read back, then it names \`card\` as how it was paid (CHK-F-003).`],
    );
    await s.init();
    expect(sliced(s)).toEqual(["SLICE:add"]);
    expect(readState(s.root, "slicing.json")["builds"]).toEqual([FOREIGN, CURRENT]);
  });
});

describe("PRDR-297: PRESENT names each build that made the plan, and what it made (C-7″)", () => {
  it("reads what `--replan` makes again, and neither the specification phases nor the scans before them", () => {
    const dir = root();
    put(dir, "INIT_FS.json", { build: FOREIGN });
    put(dir, "AUDIT.json", { build: FOREIGN });
    put(dir, "DETERMINE_VERIFICATION.json", { build: CURRENT });
    put(dir, "SLICE.json", {});
    put(dir, "PLAN.json", { build: FOREIGN });
    put(dir, "PREPARE_AGENTS.json", { build: CURRENT });
    put(dir, "slicing.json", { builds: [FOREIGN] });
    put(dir, "plan/s01.json", { build: CURRENT });
    put(dir, "plan/s02.json", {});
    put(dir, "plan-checks.json", { redrafts: [{ slice: "s02", build: FOREIGN }, { slice: "s01" }] });
    /* PRESENT's own checkpoint, from an approval before, made nothing it presents. */
    put(dir, "PRESENT.json", { build: "3.0.1+ffffffffffff" });
    /* A cache that will not parse vouches for no build. */
    writeFileSync(path.join(stateDir(dir), "state", "plan", "s04.json"), "{ torn");
    expect(planBuilds(dir, [{ id: "s01" }, { id: "s02" }, { id: "s03" }, { id: "s04" }])).toEqual([
      { build: CURRENT, made: ["DETERMINE_VERIFICATION", "PREPARE_AGENTS", "s01"] },
      { build: UNRECORDED_BUILD, made: ["SLICE", "s02", "s04", "s01's redraft"] },
      { build: FOREIGN, made: ["PLAN", "the cut", "s02's redraft"] },
    ]);
  });

  it("says one build made it, or lists each build with what it made", () => {
    expect(buildLines([{ build: CURRENT, made: ["PLAN"] }], PACK)).toEqual(["", `Made by one Detent build, ${CURRENT}, from pack ${PACK.slice(0, 12)} (N-5″).`]);
    expect(buildLines([{ build: CURRENT, made: ["PLAN"] }], null)[1]).toContain("without a pack");
    const width = Math.max(CURRENT.length, FOREIGN.length, UNRECORDED_BUILD.length);
    expect(
      buildLines(
        [
          { build: CURRENT, made: ["PLAN", "s01"] },
          { build: FOREIGN, made: ["s02"] },
          { build: UNRECORDED_BUILD, made: ["SLICE"] },
        ],
        PACK,
      ),
    ).toEqual([
      "",
      `Made from pack ${PACK.slice(0, 12)} by these Detent builds — a plan more than one build made, or with a part that names no build, is approved only once you accept that (N-5″):`,
      `  ${CURRENT.padEnd(width)}  PLAN, s01`,
      `  ${FOREIGN.padEnd(width)}  s02`,
      `  ${UNRECORDED_BUILD.padEnd(width)}  SLICE — written before a checkpoint recorded its build`,
    ]);
    expect(buildLines([], PACK), "nothing to name, nothing said").toEqual([]);
  });
});

const MIXED: readonly BuildShare[] = [
  { build: CURRENT, made: ["PLAN"] },
  { build: FOREIGN, made: ["s02"] },
];

/** PRESENT on an empty plan, with the builds given and a record of what was put to the operator. */
async function presentWith(builds: readonly BuildShare[], deps: Partial<PresentDeps>, log: string[]) {
  const dir = root();
  const outcome = await presentStage({
    root: dir,
    tickets: [],
    bindings: [],
    skips: [],
    bootstrap: null,
    assignments: {},
    builds,
    packHash: PACK,
    print: (text) => log.push(`print:${text.includes("Made ") ? "with builds" : "without builds"}`),
    ...deps,
  });
  return { dir, outcome };
}

const approves = (log: string[]) => async (): Promise<ApprovalDecision> => {
  log.push("ask");
  return { kind: "approved", by: "the operator" };
};
const never = (what: string) => async (): Promise<boolean> => {
  throw new Error(`${what} must not be asked`);
};
const approvalOf = (dir: string) => approvalSchema.parse(JSON.parse(readFileSync(approvalPath(dir), "utf8")));

describe("PRDR-297: a plan more than one build made is approved as a toolchain install is (planning decision 8)", () => {
  it("names the builds, then asks, and a no offers no approval", async () => {
    const log: string[] = [];
    const accept = async (builds: readonly string[]): Promise<boolean> => {
      log.push(`accept:${builds.join(",")}`);
      return false;
    };
    const { dir, outcome } = await presentWith(MIXED, { ask: approves(log), acceptMixedBuilds: accept }, log);
    expect(log, "printed with its builds, then asked, and the approval question never put").toEqual(["print:with builds", `accept:${CURRENT},${FOREIGN}`]);
    expect(outcome).toMatchObject({ kind: "interrupt", interrupt: "AWAIT_APPROVAL", message: MIXED_BUILDS_REFUSED });
    expect(existsSync(approvalPath(dir))).toBe(false);
  });

  it("offers approval on a yes, and the approval lists the builds and the pack", async () => {
    const log: string[] = [];
    const { dir, outcome } = await presentWith(MIXED, { ask: approves(log), acceptMixedBuilds: async () => true }, log);
    expect(outcome.kind).toBe("complete");
    expect(log).toEqual(["print:with builds", "ask"]);
    expect(approvalOf(dir)).toMatchObject({ approved_by: "the operator", builds: [CURRENT, FOREIGN], pack_hash: PACK });
  });

  it("refuses a relayed approval that did not accept the builds", async () => {
    const log: string[] = [];
    const { dir, outcome } = await presentWith(MIXED, { ask: approves(log) }, log);
    expect(outcome).toMatchObject({ kind: "interrupt", interrupt: "AWAIT_APPROVAL" });
    expect(outcome.kind === "interrupt" ? outcome.message : "").toContain("`--accept-mixed-builds` beside `--approve`");
    expect(log).not.toContain("ask");
    expect(existsSync(approvalPath(dir))).toBe(false);
  });

  it("asks nothing more of a plan one build made, and its approval names that build", async () => {
    const log: string[] = [];
    const { dir } = await presentWith([{ build: CURRENT, made: ["PLAN"] }], { ask: approves(log), acceptMixedBuilds: never("the mixed-build question") }, log);
    expect(log).toEqual(["print:with builds", "ask"]);
    expect(approvalOf(dir).builds).toEqual([CURRENT]);
  });

  it("carries the presentation in the refusal where an asker has nothing to print on", async () => {
    const dir = root();
    const outcome = await presentStage({
      root: dir,
      tickets: [],
      bindings: [],
      skips: [],
      bootstrap: null,
      assignments: {},
      builds: MIXED,
      packHash: PACK,
      ask: async () => ({ kind: "approved", by: "the operator" }),
    });
    expect(outcome.kind === "interrupt" ? outcome.message : "").toMatch(new RegExp(`^Plan ready for approval\\.[\\s\\S]*  ${FOREIGN.replaceAll(".", "\\.").replace("+", "\\+")}  s02[\\s\\S]*\\n\\nNot approved: `, "u"));
  });

  it("records what made the plan beside the counts, required, and an approval's optional, so one given before it stands", () => {
    const shown = { schema_version: SCHEMA_VERSION, presentation: "Plan ready for approval.", plan_hash: "a".repeat(64), spec_defects: 0, check_failures: 0, builds: [CURRENT], pack_hash: null };
    expect(presentationSchema.safeParse(shown).success).toBe(true);
    const { builds, pack_hash, ...before } = shown;
    expect(presentationSchema.safeParse({ ...before, pack_hash }).success, "no builds").toBe(false);
    expect(presentationSchema.safeParse({ ...before, builds }).success, "no pack hash").toBe(false);
    const approval = { schema_version: SCHEMA_VERSION, approved_by: "the operator", at: "2026-09-27T09:00:00.000Z", plan_hash: "a".repeat(64) };
    expect(approvalSchema.safeParse(approval).success, "an approval given before builds were recorded").toBe(true);
    expect(approvalSchema.safeParse({ ...approval, builds, pack_hash }).success).toBe(true);
  });

  it("asks nothing off a terminal: the plan waits, carried by the interrupt, and its record names the builds for `run`", async () => {
    const log: string[] = [];
    const { dir, outcome } = await presentWith(MIXED, { acceptMixedBuilds: never("the mixed-build question") }, log);
    expect(log, "nothing asks, so the interrupt shows it").toEqual([]);
    expect(outcome).toMatchObject({ kind: "interrupt", interrupt: "AWAIT_APPROVAL" });
    expect(outcome.kind === "interrupt" ? outcome.message : "").toContain(`  ${FOREIGN}`);
    expect(readPresentation(dir)).toMatchObject({ builds: [CURRENT, FOREIGN], pack_hash: PACK });
  });

  it("finds a slice an older build planned on disk, names it, and asks before approval", async () => {
    const s = seeded();
    await s.init();
    put(s.root, "SLICE.json", { ...readState(s.root, "SLICE.json"), build: FOREIGN });
    const unrecorded = readState(s.root, "plan/s02.json");
    delete unrecorded["build"];
    put(s.root, "plan/s02.json", unrecorded);

    const log: string[] = [];
    let shown = "";
    const result = await s.init(
      {},
      {
        print: (text) => {
          shown = text;
          log.push("print");
        },
        acceptMixedBuilds: async () => {
          log.push("accept");
          return true;
        },
        askApproval: async () => {
          log.push("ask");
          return { kind: "approved", by: "the operator" };
        },
      },
    );
    expect(result.reachedPhase).toBe("READY");
    expect(log).toEqual(["print", "accept", "ask"]);
    const width = Math.max(CURRENT.length, FOREIGN.length, UNRECORDED_BUILD.length);
    expect(shown).toContain(`  ${CURRENT.padEnd(width)}  DETERMINE_VERIFICATION, PLAN, PREPARE_AGENTS, the cut, s01, s03`);
    expect(shown).toContain(`  ${FOREIGN.padEnd(width)}  SLICE`);
    expect(shown).toContain(`  ${UNRECORDED_BUILD.padEnd(width)}  s02 — written before a checkpoint recorded its build`);
    expect(approvalOf(s.root).builds).toEqual([CURRENT, FOREIGN, UNRECORDED_BUILD]);
  });
});
