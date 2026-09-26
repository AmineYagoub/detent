import { existsSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir, writeArtifact } from "../../src/fs/layout.js";
import { writeCheckpoint } from "../../src/fs/checkpoints.js";
import { approvalState } from "../../src/init/machine.js";
import { classifyPack, conformanceRecord, writeConformanceRecord } from "../../src/init/pack.js";
import { checkPack } from "../../src/init/pack-check.js";
import { discoverDocs } from "../../src/init/discover-docs.js";
import { MIGRATIONS, migrateState, migrationNote, stateVersionRefusal } from "../../src/kernel/migrate.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { CONFORMANCE_RECORD_PATH } from "../../src/schemas/pack.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree, tmpTree, writeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "./run-fixture.js";

/**
 * PRDR-300 — the first F-3 event (F-3″).
 *
 * An older state is built the only honest way: by writing a current one with
 * the real writers, then stamping every file one version back. Migrating it
 * must give back exactly the state the writers wrote, so each test compares
 * against the files as they were before the stamps moved.
 */

const PROMPTS = loadPromptSet();
const DEPS = { promptHashes: PROMPTS.hashes };
const OLDER = SCHEMA_VERSION - 1;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

/** Every JSON file the migration owns: under `.detent/` but not its worktrees, and the pack's record. */
function stateFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const childRel = rel === "" ? name : `${rel}/${name}`;
      if (childRel === ".detent/worktrees") continue;
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs, childRel);
      else if (name.endsWith(".json")) out.push(childRel);
    }
  };
  walk(stateDir(root), ".detent");
  if (existsSync(path.join(root, CONFORMANCE_RECORD_PATH))) out.push(CONFORMANCE_RECORD_PATH);
  return out;
}

function restamp(value: unknown, from: number, to: number): unknown {
  if (Array.isArray(value)) return value.map((v) => restamp(v, from, to));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = k === "schema_version" && v === from ? to : restamp(v, from, to);
  return out;
}

/** What each state file says, parsed, keyed by its path. */
function snapshot(root: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rel of stateFiles(root)) {
    try {
      out[rel] = JSON.parse(readFileSync(path.join(root, ...rel.split("/")), "utf8"));
    } catch {
      out[rel] = readFileSync(path.join(root, ...rel.split("/")), "utf8");
    }
  }
  return out;
}

/** The state files that carry a stamp: the ones a migration rewrites. */
function stamped(root: string): string[] {
  return Object.entries(snapshot(root))
    .filter(([, v]) => typeof v === "object" && v !== null && typeof (v as { schema_version?: unknown }).schema_version === "number")
    .map(([rel]) => rel)
    .sort();
}

function bytes(root: string): Record<string, string> {
  return Object.fromEntries(stateFiles(root).map((rel) => [rel, readFileSync(path.join(root, ...rel.split("/")), "utf8")]));
}

/** Stamp every file of the state one version back, as a build before this one wrote it. */
function age(root: string): void {
  for (const rel of stateFiles(root)) {
    const file = path.join(root, ...rel.split("/"));
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    writeFileSync(file, `${JSON.stringify(restamp(parsed, SCHEMA_VERSION, OLDER), null, 2)}\n`);
  }
}

const configStamp = (root: string): unknown =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "config.json"), "utf8")) as { schema_version?: unknown }).schema_version;

/**
 * A state holding every kind the layout stamps, and a nested stamp.
 *
 * Its assignment already names the prompt this build ships, and its config
 * already routes `audit`, `spec_write` and `spec_review`, so both of the
 * migration's transforms are no-ops here and what these tests see is the
 * restamp alone. Each transform has its own test: the re-pin below, the
 * routing in `tests/init/audit-role.test.ts` (PRDR-281, PRDR-282, PRDR-284).
 */
async function richState(): Promise<string> {
  const { root } = await makeRunRepo();
  cleanups.push(() => removeTree(root));
  const configFile = path.join(stateDir(root), "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, Record<string, unknown> | undefined>;
  writeFileSync(
    configFile,
    `${JSON.stringify({
      ...config,
      model_routing: { ...config["model_routing"], audit: "claude-opus-5-5", spec_write: "claude-opus-5-5", spec_review: "claude-opus-5-5" },
      effort_routing: { ...config["effort_routing"], audit: "max", spec_write: "max", spec_review: "max" },
    }, null, 2)}\n`,
  );
  addTicket(root, { id: "t-1" });
  writeArtifact(root, "agents/assignments.json", { assignments: { "t-1": `implement@${PROMPTS.hashes.implement}` } });
  writeArtifact(root, "research/planning/brief.json", { question: "q", answer: "a" });
  writeCheckpoint(root, "ANALYZE", "a".repeat(64), { analysis: { schema_version: SCHEMA_VERSION, summary: "nested" }, greenfield: false });
  writeTree(root, {
    ".detent/runs/t-1/g1/review.json": `${JSON.stringify({ schema_version: SCHEMA_VERSION, verdict: "approve", changes: [] })}\n`,
  });
  return root;
}

describe("PRDR-300: migrations are data, one version at a time", () => {
  it("is the 3.1.1 line's one event: the build reads version 2", () => {
    expect(SCHEMA_VERSION).toBe(2);
  });

  it("runs from version 1 to the build's, each step one version and named", () => {
    expect(MIGRATIONS.map((m) => m.from)).toEqual([...Array(SCHEMA_VERSION - 1).keys()].map((i) => i + 1));
    for (const m of MIGRATIONS) expect(m.name.length).toBeGreaterThan(0);
  });
});

describe("PRDR-300: an older state is carried to the current version", () => {
  it("rewrites every stamped file, nested stamps included, and nothing else changes", async () => {
    const root = await richState();
    const written = snapshot(root);
    age(root);
    expect(configStamp(root)).toBe(OLDER);

    const outcome = migrateState(root, DEPS);

    expect(outcome.kind).toBe("migrated");
    expect(snapshot(root)).toEqual(written);
    expect(outcome.kind === "migrated" ? [...outcome.files].sort() : []).toEqual(stamped(root));
  });

  it("says what it rewrote, from which version to which", async () => {
    const root = await richState();
    age(root);
    const outcome = migrateState(root, DEPS);
    const note = migrationNote(outcome) ?? "";
    expect(note).toContain(`schema_version ${String(OLDER)} to ${String(SCHEMA_VERSION)}`);
    expect(note).toContain(`${String(stamped(root).length)} file`);
    expect(migrationNote({ kind: "current" })).toBeNull();
  });

  it("writes config.json last, so a migration cut short is resumed by the next command", async () => {
    const root = await richState();
    const written = snapshot(root);
    age(root);
    const order: string[] = [];
    let writes = 0;
    expect(() =>
      migrateState(root, {
        ...DEPS,
        write: (abs, text) => {
          order.push(path.relative(root, abs).split(path.sep).join("/"));
          writes += 1;
          if (writes === 2) throw new Error("killed mid-migration");
          writeFileSync(abs, text);
        },
      }),
    ).toThrow(/killed mid-migration/u);
    expect(order).not.toContain(".detent/config.json");
    expect(configStamp(root)).toBe(OLDER);

    const order2: string[] = [];
    migrateState(root, {
      ...DEPS,
      write: (abs, text) => {
        order2.push(path.relative(root, abs).split(path.sep).join("/"));
        writeFileSync(abs, text);
      },
    });
    expect(order2.at(-1)).toBe(".detent/config.json");
    expect(snapshot(root)).toEqual(written);
  });

  it("changes nothing the second time", async () => {
    const root = await richState();
    age(root);
    migrateState(root, DEPS);
    const after = bytes(root);
    expect(migrateState(root, DEPS)).toEqual({ kind: "current" });
    expect(bytes(root)).toEqual(after);
  });

  it("leaves a file that is not JSON, one with no stamp, and the worktrees as they are", async () => {
    const root = await richState();
    age(root);
    const files = {
      ".detent/state/torn.json": "{ not json",
      ".detent/state/unstamped.json": '{"a":1}\n',
      ".detent/state/zero.json": '{"schema_version":0}\n',
      ".detent/state/fraction.json": '{"schema_version":1.5}\n',
      ".detent/worktrees/t-1/.detent/config.json": `${JSON.stringify({ schema_version: OLDER })}\n`,
    };
    writeTree(root, files);
    const untouched = Object.keys(files);
    const before = untouched.map((rel) => readFileSync(path.join(root, ...rel.split("/")), "utf8"));
    migrateState(root, DEPS);
    expect(untouched.map((rel) => readFileSync(path.join(root, ...rel.split("/")), "utf8"))).toEqual(before);
  });

  it("does nothing, and creates nothing, where there is no state", () => {
    const root = tmpTree({ "PRD.md": "# a product\n" });
    cleanups.push(() => removeTree(root));
    expect(migrateState(root, DEPS)).toEqual({ kind: "current" });
    expect(existsSync(stateDir(root))).toBe(false);
  });

  it("carries a conformance record where there is no `.detent/`, and creates none", () => {
    const root = tmpTree({ [CONFORMANCE_RECORD_PATH]: `${JSON.stringify({ schema_version: OLDER, hash: "0".repeat(64) }, null, 2)}\n` });
    cleanups.push(() => removeTree(root));
    expect(migrateState(root, DEPS)).toMatchObject({ kind: "migrated", files: [CONFORMANCE_RECORD_PATH] });
    /* PRDR-283: a record from before `validated` could only mean its pack was validated, and now says so. */
    expect(JSON.parse(readFileSync(path.join(root, ...CONFORMANCE_RECORD_PATH.split("/")), "utf8"))).toEqual({
      schema_version: SCHEMA_VERSION,
      hash: "0".repeat(64),
      validated: true,
    });
    expect(existsSync(stateDir(root))).toBe(false);
  });

  it("PRDR-283: keeps what an older record already says about its validation", () => {
    const record = { schema_version: OLDER, hash: "0".repeat(64), validated: false };
    const root = tmpTree({ [CONFORMANCE_RECORD_PATH]: `${JSON.stringify(record, null, 2)}\n` });
    cleanups.push(() => removeTree(root));
    migrateState(root, DEPS);
    expect(JSON.parse(readFileSync(path.join(root, ...CONFORMANCE_RECORD_PATH.split("/")), "utf8"))).toEqual({ ...record, schema_version: SCHEMA_VERSION });
  });

  it("does not follow a symbolic link out of `.detent/`", async () => {
    const root = await richState();
    const outside = tmpTree({ "brief.json": `${JSON.stringify({ schema_version: SCHEMA_VERSION, answer: "elsewhere" })}\n` });
    cleanups.push(() => removeTree(outside));
    age(root);
    writeFileSync(path.join(outside, "brief.json"), `${JSON.stringify({ schema_version: OLDER, answer: "elsewhere" })}\n`);
    symlinkSync(outside, path.join(stateDir(root), "research", "linked"));
    symlinkSync(path.join(outside, "brief.json"), path.join(stateDir(root), "state", "linked.json"));
    const before = readFileSync(path.join(outside, "brief.json"), "utf8");
    migrateState(root, DEPS);
    expect(readFileSync(path.join(outside, "brief.json"), "utf8")).toBe(before);
  });

  it("leaves a current state's other files to their readers: the config is the whole check", async () => {
    const root = await richState();
    writeTree(root, { ".detent/plan/t-9.json": `${JSON.stringify({ schema_version: SCHEMA_VERSION + 1, id: "t-9" })}\n` });
    expect(migrateState(root, DEPS)).toEqual({ kind: "current" });
  });

  it("refuses a newer file another process wrote while the lock was being taken", async () => {
    const root = await richState();
    age(root);
    writeTree(root, { ".detent/state/run.lock": `${JSON.stringify({ pid: 4_059_995, host: hostname(), at: "2026-09-26T00:00:00.000Z", phase: null })}\n` });
    const outcome = migrateState(root, {
      ...DEPS,
      alive: () => {
        writeTree(root, { ".detent/plan/t-9.json": `${JSON.stringify({ schema_version: SCHEMA_VERSION + 1, id: "t-9" })}\n` });
        return false;
      },
    });
    expect(outcome).toMatchObject({ kind: "refused", message: expect.stringMatching(/t-9\.json.*Upgrade Detent/su) });
    expect(configStamp(root)).toBe(OLDER);
  });

  it("carries what another process wrote while the lock was being taken, and says it broke a stale lock", async () => {
    const root = await richState();
    age(root);
    writeTree(root, { ".detent/state/run.lock": `${JSON.stringify({ pid: 4_059_994, host: hostname(), at: "2026-09-26T00:00:00.000Z", phase: "slicing s03" })}\n` });
    const ticket = path.join(stateDir(root), "plan", "t-1.json");
    const outcome = migrateState(root, {
      ...DEPS,
      alive: () => {
        const was = JSON.parse(readFileSync(ticket, "utf8")) as Record<string, unknown>;
        writeFileSync(ticket, `${JSON.stringify({ ...was, title: "renamed while the lock was taken" }, null, 2)}\n`);
        return false;
      },
    });
    expect(JSON.parse(readFileSync(ticket, "utf8"))).toMatchObject({ schema_version: SCHEMA_VERSION, title: "renamed while the lock was taken" });
    expect(migrationNote(outcome)).toMatch(/broke a stale run lock left by pid 4059994 on this host, which was: slicing s03/u);
    expect(existsSync(path.join(stateDir(root), "state", "run.lock"))).toBe(false);
  });
});

describe("PRDR-300: a state it cannot carry is refused, and nothing is written", () => {
  it("refuses a file stamped newer than this build, with F-3's upgrade hint", async () => {
    const root = await richState();
    age(root);
    writeTree(root, {
      ".detent/plan/t-9.json": `${JSON.stringify({ schema_version: SCHEMA_VERSION + 1, id: "t-9" })}\n`,
      ".detent/state/w.json": `${JSON.stringify({ schema_version: SCHEMA_VERSION + 2 })}\n`,
    });
    const before = bytes(root);
    const outcome = migrateState(root, DEPS);
    expect(outcome.kind).toBe("refused");
    expect(outcome.kind === "refused" ? outcome.message : "").toMatch(new RegExp(`\\.detent/plan/t-9\\.json \\(and 1 more\\).*schema_version ${String(SCHEMA_VERSION + 1)}.*supports ${String(SCHEMA_VERSION)}.*Upgrade Detent`, "su"));
    expect(bytes(root)).toEqual(before);
  });

  it("refuses a newer file even where nothing is older to carry", async () => {
    const root = await richState();
    rmSync(path.join(stateDir(root), "config.json"));
    writeTree(root, { ".detent/plan/t-9.json": `${JSON.stringify({ schema_version: SCHEMA_VERSION + 1, id: "t-9" })}\n` });
    expect(migrateState(root, DEPS)).toMatchObject({ kind: "refused", message: expect.stringMatching(/t-9\.json.*Upgrade Detent/su) });
  });

  it("refuses while a live process holds the run lock, naming it", async () => {
    const root = await richState();
    age(root);
    writeTree(root, { ".detent/state/run.lock": `${JSON.stringify({ pid: 4_059_993, host: hostname(), at: "2026-09-26T00:00:00.000Z", phase: null })}\n` });
    const before = bytes(root);
    const outcome = migrateState(root, { ...DEPS, alive: () => true });
    expect(outcome.kind).toBe("refused");
    expect(outcome.kind === "refused" ? outcome.message : "").toContain("4059993");
    expect(bytes(root)).toEqual(before);
  });
});

describe("PRDR-300: what the migration keeps true", () => {
  it("re-pins an assignment whose role's prompt changed, and keeps one that did not or that names no role this build ships (S-7)", async () => {
    const root = await richState();
    writeArtifact(root, "agents/assignments.json", {
      assignments: { "t-1": `implement@${PROMPTS.hashes.implement}`, "t-2": `diagnose@${"0".repeat(64)}`, "t-3": `ghost@${"0".repeat(64)}` },
    });
    age(root);
    migrateState(root, DEPS);
    const file = JSON.parse(readFileSync(path.join(stateDir(root), "agents", "assignments.json"), "utf8")) as { assignments: Record<string, string> };
    expect(file.assignments).toEqual({
      "t-1": `implement@${PROMPTS.hashes.implement}`,
      "t-2": `diagnose@${PROMPTS.hashes.diagnose}`,
      "t-3": `ghost@${"0".repeat(64)}`,
    });
  });

  it("keeps an approved plan approved", async () => {
    const root = await richState();
    expect(approvalState(root)).toMatchObject({ approved: true, stale: false });
    age(root);
    expect(approvalState(root).approved).toBe(false);
    migrateState(root, DEPS);
    expect(approvalState(root)).toMatchObject({ approved: true, stale: false });
  });

  it("keeps a conforming pack conforming", async () => {
    const { root } = await makeRunRepo();
    cleanups.push(() => removeTree(root));
    const fixture = path.join(import.meta.dirname, "..", "fixtures", "pack");
    for (const entry of readdirSync(fixture, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const abs = path.join(entry.parentPath, entry.name);
      writeTree(root, { [path.relative(fixture, abs).split(path.sep).join("/")]: readFileSync(abs, "utf8") });
    }
    const checker = checkPack(root, discoverDocs(root).docs, { greenfield: false });
    writeConformanceRecord(root, conformanceRecord(root, { checker, rounds: [], date: "2026-09-26", validated: true }));
    expect(classifyPack(root, { greenfield: false }).kind).toBe("conforming");
    age(root);
    migrateState(root, DEPS);
    expect(classifyPack(root, { greenfield: false }).kind).toBe("conforming");
  });
});

describe("PRDR-300: the verbs that do not migrate say which do", () => {
  it("names `detent init` and `detent run` for an older state", async () => {
    const root = await richState();
    age(root);
    const said = stateVersionRefusal(root) ?? "";
    expect(said).toContain("detent init");
    expect(said).toContain("detent run");
    expect(said).toContain(`schema_version ${String(OLDER)}`);
  });

  it("gives F-3's upgrade hint for a newer state", async () => {
    const root = await richState();
    const config = path.join(stateDir(root), "config.json");
    writeFileSync(config, `${JSON.stringify({ ...(JSON.parse(readFileSync(config, "utf8")) as object), schema_version: SCHEMA_VERSION + 1 }, null, 2)}\n`);
    expect(stateVersionRefusal(root)).toMatch(/Upgrade Detent/u);
  });

  it("is silent for a current state and for none", async () => {
    const root = await richState();
    expect(stateVersionRefusal(root)).toBeNull();
    expect(stateVersionRefusal(path.join(root, "no-such-dir"))).toBeNull();
  });
});
