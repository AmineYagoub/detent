import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { RunJournal } from "../../src/kernel/journal.js";
import { launchInitSession } from "../../src/init/session.js";
import type { SessionSpec } from "../../src/sessions/backend.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { SANDBOX_EXEC, SCRATCH_OUTPUT_LIMIT, SCRATCH_SERVER, SCRATCH_TIME_LIMIT_MS, SCRATCH_TOOL, scratchRunner, type Sandbox, type ScratchGrant } from "../../src/sessions/sandbox.js";
import { probeSandbox } from "../../src/sessions/sandbox-probe.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { buildOptions } from "../../src/sessions/sdk.js";
import { commitRecord, oracleRecord, packRepo } from "./pack-fixture.js";
import { PROMPTS, repo } from "./plan-fixture.js";
import type { Json } from "./decide-fixture.js";
import { inputsOf } from "./slicing-fixture.js";
import { RAW, writesPack } from "./write-fixture.js";
import { FEE_RULE, appliesAll, finding, initThroughValidate, review, type Writer } from "./validate-fixture.js";

/**
 * PRDR-285 — VALIDATE's reviewers may simulate (S-1‴, specification decision 7).
 *
 * With the sandbox on, each round makes a scratch directory outside the
 * repository and `.detent/`, gives it to every reviewer of the round with the
 * tool that runs a script there, and removes it once they are done; the writer
 * never has it. With the sandbox off, each round says why, and a reviewer
 * judges an invariant by reading. The probe runs once, and only for a
 * validation that runs a round.
 */

const NODE = { name: "node", path: process.execPath, version: "v0-test", roots: [] } as const;
const PY = { name: "python3", path: "/usr/bin/python3", version: "3.0-test", roots: [] } as const;
const ON: Sandbox = { kind: "on", exec: SANDBOX_EXEC, interpreters: [NODE, PY] };
const OFF_REASON = "no sandbox is built for linux, only macOS's Seatbelt";
const OFF: Sandbox = { kind: "off", reason: OFF_REASON };
const probe = (sandbox: Sandbox, calls = { n: 0 }) => ({
  sandbox: async () => {
    calls.n += 1;
    return sandbox;
  },
});

const envTmp = process.env["TMPDIR"];
afterEach(() => {
  if (envTmp === undefined) delete process.env["TMPDIR"];
  else process.env["TMPDIR"] = envTmp;
});

interface Seen {
  readonly round: number;
  readonly area: string;
  readonly spec: SessionSpec;
  readonly there: boolean;
  readonly simulation: unknown;
}

/** Reviewers who report `per(round, area)`, and remember each session they were launched as. */
function watching(per: (round: number, area: string) => readonly Json[] = () => [], act?: (spec: SessionSpec, inputs: Json) => Promise<Json[]>) {
  const seen: Seen[] = [];
  const inputs: Json[] = [];
  const stage: StageFn = async (spec) => {
    const given = inputsOf(spec) as Json;
    inputs.push(given);
    const round = given["round"] as number;
    const area = given["area"] as string;
    seen.push({ round, area, spec, there: spec.scratch !== undefined && existsSync(spec.scratch.dir), simulation: given["simulation"] });
    const found = act === undefined ? per(round, area) : await act(spec, given);
    writeFileSync(spec.artifactOut, `${JSON.stringify(review(given, found))}\n`);
    return okResult({ turns: 4 });
  };
  return { seen, reviewers: { stage, inputs } };
}

/** A writer that applies everything, and remembers each session it was launched as. */
function writing(): { writer: Writer; specs: SessionSpec[] } {
  const inner = appliesAll();
  const specs: SessionSpec[] = [];
  const stage: StageFn = (spec) => {
    specs.push(spec);
    return inner.stage(spec);
  };
  return { specs, writer: { inputs: inner.inputs, stage } };
}

const lendingMajorOnce = (round: number, area: string): readonly Json[] => (round === 1 && area === "Lending" ? [finding()] : []);
const outside = (root: string, dir: string): boolean => path.relative(realpathSync(root), dir).startsWith("..");

describe("PRDR-285: each round's reviewers get a scratch directory (S-1‴)", () => {
  it("makes one for the round, outside the repository and .detent/, gives it to every reviewer of the round, and removes it after", async () => {
    const root = repo(RAW);
    const { seen, reviewers } = watching(lendingMajorOnce);
    const { writer } = writing();
    await initThroughValidate(root, { reviewers, writer, more: probe(ON) });
    const dirs = (round: number) => [...new Set(seen.filter((s) => s.round === round).map((s) => s.spec.scratch?.dir))];
    expect(seen.map((s) => [s.round, s.area])).toEqual([[1, "foundations"], [1, "Lending"], [2, "foundations"], [2, "Lending"]]);
    expect(dirs(1)).toHaveLength(1);
    expect(dirs(2)).toHaveLength(1);
    expect(dirs(1)[0], "a round's directory is its own").not.toBe(dirs(2)[0]);
    for (const s of seen) {
      const dir = s.spec.scratch?.dir ?? "";
      expect(s.there, "it exists while the reviewer runs").toBe(true);
      expect(existsSync(dir), "and is gone once the round's reviewers are done").toBe(false);
      expect(outside(root, dir), "outside the repository, and so outside .detent/").toBe(true);
      expect(path.relative(stateDir(root), dir).startsWith("..")).toBe(true);
      expect(s.spec.scratch?.interpreters).toEqual([NODE, PY]);
      expect(s.spec.allowedTools).toContain(SCRATCH_TOOL);
    }
  });

  it("gives it to no writer: VALIDATE's writer changes the pack, and runs nothing", async () => {
    const root = repo(RAW);
    const { writer, specs } = writing();
    await initThroughValidate(root, { reviewers: watching(lendingMajorOnce).reviewers, writer, more: probe(ON) });
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(spec.scratch).toBeUndefined();
      expect(spec.allowedTools).not.toContain(SCRATCH_TOOL);
    }
  });

  it("tells each reviewer the tool, the interpreters with their versions, and the limits, and says once which it offers", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const { seen, reviewers } = watching(lendingMajorOnce);
    await initThroughValidate(root, { reviewers, writer: writing().writer, notes, more: probe(ON) });
    for (const s of seen) {
      expect(s.simulation).toEqual({
        tool: SCRATCH_TOOL,
        interpreters: [
          { name: "node", version: "v0-test" },
          { name: "python3", version: "3.0-test" },
        ],
        time_limit_seconds: SCRATCH_TIME_LIMIT_MS / 1000,
        output_limit_bytes: SCRATCH_OUTPUT_LIMIT,
      });
    }
    expect(notes.filter((n) => n.includes("node v0-test"))).toEqual([
      "VALIDATE: each round's reviewers may run simulations in a scratch directory macOS's Seatbelt sandboxes, with node v0-test and python3 3.0-test (S-1⁗)",
    ]);
    expect(notes.filter((n) => n.includes("no reviewer can run a simulation"))).toEqual([]);
  });
});

describe("PRDR-285: with no sandbox, each round says so (S-1‴)", () => {
  it("says in each round why no reviewer can simulate, and a reviewer's simulation input is null", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    const { seen, reviewers } = watching(lendingMajorOnce);
    await initThroughValidate(root, { reviewers, writer: writing().writer, notes, more: probe(OFF) });
    expect(notes.filter((n) => n.includes("simulation")), "each round's note, and no other of the sandbox").toEqual([
      `VALIDATE round 1: no reviewer can run a simulation, since ${OFF_REASON}, so the invariants the pack states are read and not run (S-1⁗)`,
      `VALIDATE round 2: no reviewer can run a simulation, since ${OFF_REASON}, so the invariants the pack states are read and not run (S-1⁗)`,
    ]);
    expect(notes.filter((n) => n.includes("scratch directory one needs is not built")), "the sandbox is built, and no note says otherwise").toEqual([]);
    for (const s of seen) {
      expect(s.simulation).toBeNull();
      expect(s.spec.scratch).toBeUndefined();
      expect(s.spec.allowedTools).not.toContain(SCRATCH_TOOL);
    }
  });

  it("turns simulation off when the system's temporary directory is inside the repository, since a scratch directory there would be in it", async () => {
    const root = repo(RAW);
    mkdirSync(path.join(root, "tmp"));
    process.env["TMPDIR"] = path.join(root, "tmp");
    const notes: string[] = [];
    const { seen, reviewers } = watching();
    await initThroughValidate(root, { reviewers, writer: writing().writer, notes, more: probe(ON) });
    expect(notes.find((n) => n.startsWith("VALIDATE round 1: no reviewer can run a simulation"))).toContain("inside the repository");
    expect(seen.every((s) => s.spec.scratch === undefined && s.simulation === null)).toBe(true);
    expect(readdirSync(path.join(root, "tmp")).filter((f) => f.startsWith("detent-")), "and no scratch directory was made there").toEqual([]);
  });

  it("turns simulation off when the system's temporary directory cannot be used, and says so", async () => {
    const root = repo(RAW);
    process.env["TMPDIR"] = path.join(root, "no-such-directory");
    const notes: string[] = [];
    const { seen, reviewers } = watching();
    await initThroughValidate(root, { reviewers, writer: writing().writer, notes, more: probe(ON) });
    expect(notes.find((n) => n.startsWith("VALIDATE round 1: no reviewer can run a simulation"))).toContain("cannot be used");
    expect(seen.every((s) => s.spec.scratch === undefined)).toBe(true);
  });

  it("probes once for a validation that runs rounds, and not at all for one that runs none", async () => {
    const calls = { n: 0 };
    await initThroughValidate(repo(RAW), { reviewers: watching(lendingMajorOnce).reviewers, writer: writing().writer, more: probe(ON, calls) });
    expect(calls.n, "two rounds, one probe").toBe(1);
    const conforming = packRepo();
    commitRecord(conforming, oracleRecord(conforming));
    const none = { n: 0 };
    await initThroughValidate(conforming, { more: probe(ON, none) }, writesPack());
    expect(none.n, "a conforming pack runs no round, and no probe").toBe(0);
  });
});

describe("PRDR-285: the sandbox is spec_review's alone (S-1‴)", () => {
  const grant: ScratchGrant = { dir: "/private/tmp/scratch-1", exec: SANDBOX_EXEC, interpreters: [NODE] };

  async function launched(role: "spec_review" | "spec_write" | "audit", scratch?: ScratchGrant): Promise<SessionSpec | Error> {
    const root = repo();
    const journal = RunJournal.open(root);
    const backend = new MockBackend({
      [role]: (spec: SessionSpec) => {
        writeFileSync(spec.artifactOut, "{}\n");
        return okResult();
      },
    });
    try {
      await launchInitSession(
        { root, backend, prompts: PROMPTS, spendCeiling: 0, journal },
        { role, inputs: {}, artifactOut: path.join(stateDir(root), "state", "a.json"), ...(scratch === undefined ? {} : { scratch }) },
      );
      return backend.calls[0]?.spec ?? new Error("no session");
    } catch (err) {
      expect(backend.calls, "refused before any session starts").toEqual([]);
      return err as Error;
    } finally {
      journal.close();
    }
  }

  it("gives a reviewer the tool and its directory with the grant, and neither without", async () => {
    const withIt = (await launched("spec_review", grant)) as SessionSpec;
    expect(withIt.scratch).toEqual(grant);
    expect(withIt.allowedTools).toContain(SCRATCH_TOOL);
    const without = (await launched("spec_review")) as SessionSpec;
    expect(without.scratch).toBeUndefined();
    expect(without.allowedTools).not.toContain(SCRATCH_TOOL);
  });

  it("refuses the grant to any other role, before its session starts", async () => {
    for (const role of ["spec_write", "audit"] as const) {
      const refused = await launched(role, grant);
      expect(refused, role).toBeInstanceOf(Error);
      expect((refused as Error).message).toMatch(/spec_review/u);
    }
  });

  it("builds the tool's server into a session that carries the grant, beside any other, and none into one without", () => {
    const spec: SessionSpec = { role: "spec_review", ticketId: "init", promptPrefix: "p", promptVariable: "{}", cwd: "/wt", artifactOut: "/wt/a.json", allowedTools: [], permissionMode: "", model: "" };
    const policy = { surface: [], protectedGlobs: [], workRoot: "/wt" };
    const servers = (s: SessionSpec) => Object.keys(buildOptions(s, { policy }).mcpServers ?? {});
    expect(servers({ ...spec, scratch: grant })).toEqual([SCRATCH_SERVER]);
    expect(servers({ ...spec, scratch: grant, mcpServers: { symbols: { type: "stdio", command: "x" } } }).sort()).toEqual([SCRATCH_SERVER, "symbols"].sort());
    expect(servers(spec)).toEqual([]);
    expect(Object.hasOwn(buildOptions(spec, { policy }), "mcpServers"), "a session with neither is given no server key at all").toBe(false);
    expect(buildOptions({ ...spec, scratch: grant }, { policy }).mcpServers?.[SCRATCH_SERVER]).toMatchObject({ type: "sdk", name: SCRATCH_SERVER });
  });

  it("is told when to simulate, how, and what a simulated finding carries, in the role's own prompt", () => {
    const prompt = (loadPromptSet().prompts as Readonly<Record<string, string>>)["spec_review"] ?? "";
    expect(prompt).toContain("`simulation`, when it is not null, lets you run what reading cannot settle");
    expect(prompt).toContain("Run it with the tool `simulation.tool` names, the whole script as `source` and one of `simulation.interpreters` as `interpreter`");
    expect(prompt).toContain("its `why` gives the seed, the sequence, the step at which the invariant broke, and how many sequences of how many broke it");
    expect(prompt).toContain("When `simulation` is null, this machine has no sandbox, and you judge every invariant by reading");
  });
});

const onMac = process.platform === "darwin" && existsSync(SANDBOX_EXEC);
/** PRDR-285: the sandbox is macOS's Seatbelt; this case runs a real simulation in it. */
const itMac = onMac ? it : it.skip;

/**
 * Splits an amount among three shares, each rounded to the cent, and checks
 * that the shares add up to the amount: a seeded search for the stranded cent.
 */
const SIMULATION = `
let seed = 285;
const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
let broke = 0, first = null;
const runs = 8000;
for (let i = 0; i < runs; i++) {
  const cents = 100 + Math.floor(random() * 99900);
  const shares = [1, 2, 3].map(() => Math.round(cents / 3));
  if (shares.reduce((a, b) => a + b, 0) !== cents) { broke++; first ??= { step: i, cents, shares }; }
}
console.log(JSON.stringify({ seed: 285, runs, broke, first }));
`;

describe("PRDR-285: a simulation's finding reaches the writer, and nothing of it stays (S-1‴)", () => {
  itMac("runs a reviewer's simulation in the sandbox, hands its finding on with the sequence, and leaves nothing behind", async () => {
    const root = repo(RAW);
    const ran: string[] = [];
    const { seen, reviewers } = watching(undefined, async (spec, given) => {
      if (given["area"] !== "Lending" || given["round"] !== 1 || spec.scratch === undefined) return [];
      const text = await scratchRunner(spec.scratch)({ interpreter: "node", source: SIMULATION });
      ran.push(text);
      const result = JSON.parse(text.trim().split("\n").at(-1) ?? "{}") as { seed: number; runs: number; broke: number; first: unknown };
      return [finding({ severity: "blocker", category: "invariant", places: [FEE_RULE], why: `seed ${String(result.seed)}: ${String(result.broke)} of ${String(result.runs)} sequences strand a cent, first ${JSON.stringify(result.first)}`, fix: "give the remainder cent to the first share" })];
    });
    const { writer } = writing();
    await initThroughValidate(root, { reviewers, writer, more: { sandbox: async () => await probeSandbox({ root }) } });
    expect(ran[0]).toContain("run-1.js");
    const why = ((writer.inputs[0]?.["findings"] as Json[] | undefined)?.[0]?.["why"] as string | undefined) ?? "";
    expect(why).toMatch(/^seed 285: \d+ of 8000 sequences strand a cent, first \{"step":\d+/u);
    expect(why).not.toMatch(/^seed 285: 0 of/u);
    for (const s of seen) expect(existsSync(s.spec.scratch?.dir ?? ""), "the round's directory is gone").toBe(false);
    const files = readdirSync(root, { recursive: true, encoding: "utf8" });
    expect(files.filter((f) => path.basename(f).startsWith("run-")), "and no script reached the repository").toEqual([]);
  });
});
