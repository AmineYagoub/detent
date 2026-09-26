import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as doctorMain } from "../../src/cli/doctor.js";
import { main as initMain } from "../../src/cli/init.js";
import { approveMain, requeueMain, unclaimMain } from "../../src/cli/plumbing.js";
import { main as refereeMain } from "../../src/cli/referee.js";
import { main as runMain } from "../../src/cli/run.js";
import { main as reportMain } from "../../src/cli/report.js";
import { main as statusMain } from "../../src/cli/status.js";
import { main as verifyMain } from "../../src/cli/verify.js";
import { readBindings } from "../../src/adapter/drift.js";
import { stateDir } from "../../src/fs/layout.js";
import { run } from "../../src/kernel/run.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { removeTree } from "../helpers.js";
import { addTicket, makeRunRepo } from "../kernel/run-fixture.js";

/**
 * PRDR-300 — who migrates an older state (F-3″).
 *
 * `init`, `run` and the referee migrate, under the run lock, before they read
 * their config. Every other verb refuses an older state with the two commands
 * that migrate it, and writes nothing. The inventory at the end holds every
 * verb the dispatcher knows to one side or the other, so a new verb cannot
 * arrive unclassified.
 */

const OLDER = SCHEMA_VERSION - 1;
const PROMPTS = loadPromptSet();

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function restamp(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restamp);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "schema_version" && v === SCHEMA_VERSION ? OLDER : restamp(v)]));
}

/** Stamp every JSON file of the state one version back, as a build before this one wrote it. */
function age(root: string): void {
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) {
        walk(abs);
        continue;
      }
      if (!name.endsWith(".json")) continue;
      try {
        writeFileSync(abs, `${JSON.stringify(restamp(JSON.parse(readFileSync(abs, "utf8"))), null, 2)}\n`);
      } catch {
        /* not JSON: nothing to stamp */
      }
    }
  };
  walk(stateDir(root));
}

const configStamp = (root: string): unknown =>
  (JSON.parse(readFileSync(path.join(stateDir(root), "config.json"), "utf8")) as { schema_version?: unknown }).schema_version;

/** An approved plan, stamped one version back; with a ticket for the verbs that name one. */
async function olderState(ticket: boolean): Promise<string> {
  const { root } = await makeRunRepo();
  cleanups.push(() => removeTree(root));
  if (ticket) addTicket(root, { id: "t-1" });
  age(root);
  return root;
}

function captured(): { readonly err: () => string; readonly out: () => string } {
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  return { err: () => err.mock.calls.map((c) => String(c[0])).join(""), out: () => out.mock.calls.map((c) => String(c[0])).join("") };
}

describe("PRDR-300: a verb that does not migrate refuses an older state and writes nothing", () => {
  const verbs: readonly (readonly [string, (root: string) => number | Promise<number>])[] = [
    ["status", (root) => statusMain([root])],
    ["report", (root) => reportMain([root])],
    ["doctor", (root) => doctorMain([root])],
    ["approve", (root) => approveMain([root, "t-1"])],
    ["requeue", (root) => requeueMain([root, "t-1"])],
    ["unclaim", (root) => unclaimMain([root, "t-1"])],
    ["unclaim --stale", (root) => unclaimMain([root, "--stale"])],
    ["verify", (root) => verifyMain(["sync", root])],
  ];
  for (const [verb, invoke] of verbs) {
    it(`\`${verb}\` names the commands that migrate it`, async () => {
      const root = await olderState(true);
      const out = captured();
      expect(await invoke(root)).toBe(2);
      expect(out.err()).toContain("detent init");
      expect(out.err()).toContain("detent run");
      expect(configStamp(root)).toBe(OLDER);
    });
  }
});

describe("PRDR-300: `init`, `run` and the referee migrate before they read", () => {
  it("`run` migrates the state, says so, and reads the config it wrote", async () => {
    const root = await olderState(false);
    const said: string[] = [];
    const outcome = await run({ root, backend: new MockBackend({}), prompts: PROMPTS, ecosystems: [], announce: (m) => said.push(m) });
    expect(configStamp(root)).toBe(SCHEMA_VERSION);
    expect(said.join("\n")).toContain(`schema_version ${String(OLDER)} to ${String(SCHEMA_VERSION)}`);
    expect(outcome.summary.reason ?? "").not.toMatch(/config rejected/u);
  });

  it("`detent run` migrates before it builds the backend, which reads the bindings", async () => {
    const root = await olderState(false);
    const out = captured();
    /* The live builder reads `bindings.json`; this one does the same, and runs nothing. */
    const code = await runMain([root], {
      buildBackend: (r) => {
        readBindings(r);
        return new MockBackend({});
      },
    });
    expect(configStamp(root)).toBe(SCHEMA_VERSION);
    expect(out.out()).toContain(`schema_version ${String(OLDER)} to ${String(SCHEMA_VERSION)}`);
    expect(code).toBe(0);
  });

  it("`init` migrates the state before anything else reads it", async () => {
    const root = await olderState(false);
    /* The migration comes before the live-auth probe, so the probe's refusal is where this `init` stops. */
    vi.stubEnv("DETENT_NO_LIVE", "1");
    captured();
    await initMain([root], { buildBackend: () => new MockBackend({}) });
    expect(configStamp(root)).toBe(SCHEMA_VERSION);
  });

  it("the referee migrates the state before it reads its config", async () => {
    const root = await olderState(false);
    rmSync(path.join(stateDir(root), "plan", "approval.json"));
    const out = captured();
    expect(await refereeMain(["--root", root])).toBe(2);
    expect(configStamp(root)).toBe(SCHEMA_VERSION);
    expect(out.err()).toContain("no approved plan");
  });
});

describe("PRDR-300: `init`, `run` and the referee refuse a newer state and write nothing", () => {
  /** A state whose config a newer build wrote: F-3's refusal, not a guess. */
  async function newerState(): Promise<{ readonly root: string; readonly before: string }> {
    const { root } = await makeRunRepo();
    cleanups.push(() => removeTree(root));
    const config = path.join(stateDir(root), "config.json");
    writeFileSync(config, `${JSON.stringify({ ...(JSON.parse(readFileSync(config, "utf8")) as object), schema_version: SCHEMA_VERSION + 1 }, null, 2)}\n`);
    return { root, before: readFileSync(config, "utf8") };
  }
  const verbs: readonly (readonly [string, (root: string) => Promise<{ readonly code: number; readonly said: string }>])[] = [
    [
      "run",
      async (root) => {
        const outcome = await run({ root, backend: new MockBackend({}), prompts: PROMPTS, ecosystems: [] });
        return { code: outcome.exitCode, said: outcome.summary.reason ?? "" };
      },
    ],
    [
      "init",
      async (root) => {
        const out = captured();
        return { code: await initMain([root], { buildBackend: () => new MockBackend({}) }), said: out.err() };
      },
    ],
    [
      "referee",
      async (root) => {
        const out = captured();
        return { code: await refereeMain(["--root", root]), said: out.err() };
      },
    ],
  ];
  for (const [verb, invoke] of verbs) {
    it(`\`${verb}\` gives F-3's upgrade hint`, async () => {
      const { root, before } = await newerState();
      vi.stubEnv("DETENT_NO_LIVE", "1");
      const { code, said } = await invoke(root);
      expect(code).toBe(2);
      expect(said).toMatch(new RegExp(`config\\.json.*schema_version ${String(SCHEMA_VERSION + 1)}.*Upgrade Detent`, "su"));
      expect(readFileSync(path.join(stateDir(root), "config.json"), "utf8")).toBe(before);
    });
  }
});

describe("PRDR-300: `detent run` refuses before it builds the backend", () => {
  it("reports a newer state the way `run()` reports a refusal, and builds nothing", async () => {
    const { root } = await makeRunRepo();
    cleanups.push(() => removeTree(root));
    /* A newer build wrote both: the config says the state is newer, and building the live backend would read the bindings. */
    for (const name of ["config.json", "bindings.json"]) {
      const file = path.join(stateDir(root), name);
      writeFileSync(file, `${JSON.stringify({ ...(JSON.parse(readFileSync(file, "utf8")) as object), schema_version: SCHEMA_VERSION + 1 }, null, 2)}\n`);
    }
    const out = captured();
    let built = false;
    const code = await runMain([root], {
      buildBackend: (r) => {
        built = true;
        readBindings(r);
        return new MockBackend({});
      },
    });
    expect(code).toBe(2);
    expect(built).toBe(false);
    expect(JSON.parse(out.out())).toMatchObject({ exit: 2, reason: expect.stringMatching(/bindings\.json \(and 1 more\).*Upgrade Detent/su) });
  });
});

describe("PRDR-300: every verb is one that migrates or one that refuses", () => {
  const SRC = fileURLToPath(new URL("../../src", import.meta.url));
  const source = (rel: string): string => readFileSync(path.join(SRC, ...rel.split("/")), "utf8");
  /** `run` migrates twice over: the CLI before it builds the backend, and `run()` for its other callers. */
  const MIGRATES: Readonly<Record<string, readonly string[]>> = {
    init: ["cli/init.ts"],
    run: ["cli/run.ts", "kernel/run.ts"],
    referee: ["cli/referee.ts"],
  };
  const REFUSES: Readonly<Record<string, string>> = {
    status: "cli/status.ts",
    report: "cli/report.ts",
    doctor: "cli/doctor.ts",
    approve: "cli/plumbing.ts",
    requeue: "cli/plumbing.ts",
    unclaim: "cli/plumbing.ts",
    verify: "cli/verify.ts",
  };

  it("classifies exactly the verbs the dispatcher knows", () => {
    const table = /const VERBS: Record<string, Verb> = \{([^}]*)\}/u.exec(source("cli/index.ts"))?.[1] ?? "";
    const known = [...table.matchAll(/^\s*([a-z]+):/gmu)].map((m) => m[1]).sort();
    expect(known).toEqual([...Object.keys(MIGRATES), ...Object.keys(REFUSES)].sort());
  });

  it("each module calls what its class names", () => {
    for (const file of Object.values(MIGRATES).flat()) expect(source(file), file).toMatch(/\bmigrateState\(/u);
    for (const file of new Set(Object.values(REFUSES))) expect(source(file), file).toMatch(/\bstateVersionRefusal\(/u);
  });
});
