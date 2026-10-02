import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import { ensureConfig, routingNote } from "../../src/init/config.js";
import { estimator } from "../../src/init/progress.js";
import { INIT_TICKET, launchInitSession, withInitJournal } from "../../src/init/session.js";
import { loadConfig } from "../../src/kernel/worstcase.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { CEILINGS } from "../../src/schemas/budgets.js";
import { DEFAULT_EFFORT_ROUTING, DEFAULT_TASK_EFFORT_ROUTING, ROLE_TASKS, TASK_KEYS, effortFor, type RoleId } from "../../src/schemas/roles.js";
import type { SessionBackend, SessionSpec } from "../../src/sessions/backend.js";
import { okResult } from "../../src/sessions/mock.js";
import { definitionText } from "../docs/prd-marks.js";
import { removeTree, tmpTree } from "../helpers.js";
import { PROMPTS, repo } from "./plan-fixture.js";

/**
 * S-5⁷ — effort routed per task where a role runs several.
 *
 * `effort_routing` gave one level per role, so AUDIT's claim checks could not
 * move without its survey and its triage, which no set measures. A
 * `role/task` key routes one task apart, and every other task of the role
 * keeps the role's level.
 */

const REPO = path.resolve(import.meta.dirname, "..", "..");
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

interface Launched {
  readonly spec: SessionSpec;
  readonly start: Record<string, unknown> | undefined;
  readonly settled: Record<string, unknown> | undefined;
  readonly row: Record<string, unknown> | undefined;
}

const lines = (file: string): Record<string, unknown>[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];

/** One init session of `role` doing `task`, routed by `routing`: what it was launched with, journaled and billed. */
async function launch(role: RoleId, task: string, routing: Readonly<Record<string, string>>): Promise<Launched> {
  const root = repo();
  let seen: SessionSpec | null = null;
  const backend: SessionBackend = {
    name: "recording",
    checkVersion: async () => undefined,
    run: async (spec) => {
      seen = spec;
      writeFileSync(spec.artifactOut, "{}\n");
      return okResult();
    },
  };
  await withInitJournal(root, async (journal) =>
    await launchInitSession(
      { root, backend, prompts: PROMPTS, spendCeiling: 100, journal, effortRouting: routing },
      { role, inputs: { task }, artifactOut: path.join(stateDir(root), "state", `${role}-artifact.json`) },
    ),
  );
  if (seen === null) throw new Error("no session was launched");
  const events = lines(path.join(stateDir(root), "runs", INIT_TICKET, "journal.jsonl"));
  return {
    spec: seen,
    start: events.find((e) => e["event"] === "start"),
    settled: events.find((e) => e["event"] === "effort_settled"),
    row: lines(path.join(stateDir(root), "ledger.jsonl")).at(-1),
  };
}

const base = (): Record<string, unknown> => ({
  schema_version: SCHEMA_VERSION,
  budgets: Object.fromEntries(Object.entries(CEILINGS).map(([k, v]) => [k, v.default])),
  pinned: { agent_sdk: "0.3.285", claude_code: "2.1.285" },
});

describe("S-5⁷ effort routed per task", () => {
  it("runs AUDIT's claim checks at their task's level, and its survey and triage at the role's", async () => {
    const routing = { audit: "max", "audit/verify_claims": "high" };
    const check = await launch("audit", "verify_claims", routing);
    expect(check.spec.effort).toBe("high");
    expect(check.start?.["effort"], "the start event names the level the session was routed to").toBe("high");
    expect(check.settled?.["routed"]).toBe("high");
    expect(check.row?.["effort"], "the ledger row bills the check at its task's level").toBe("high");
    expect(check.row?.["task"]).toBe("verify_claims");
    for (const task of ["survey", "triage"]) {
      const other = await launch("audit", task, routing);
      expect(other.spec.effort, task).toBe("max");
      expect(other.start?.["effort"], task).toBe("max");
      expect(other.row?.["effort"], task).toBe("max");
    }
  });

  it("gives a task the config does not route its role's level, and a role routed to none the SDK's own", async () => {
    const survey = await launch("audit", "survey", { "audit/verify_claims": "high" });
    expect(survey.spec.effort, "nothing routes the survey, so the SDK's own default applies").toBeUndefined();
    expect(survey.start?.["effort"]).toBe("default");
    expect((await launch("spec_review", "verify", { spec_review: "max", "spec_review/review": "high" })).spec.effort).toBe("max");
    expect((await launch("spec_review", "review", { spec_review: "max", "spec_review/review": "high" })).spec.effort).toBe("high");
  });

  it("reads a task's own key first, then its role's, then none", () => {
    expect(effortFor({ audit: "max", "audit/verify_claims": "high" }, "audit", "verify_claims")).toBe("high");
    expect(effortFor({ audit: "max", "audit/verify_claims": "high" }, "audit", "triage")).toBe("max");
    expect(effortFor({ audit: "max", "audit/verify_claims": "high" }, "audit", undefined)).toBe("max");
    expect(effortFor({ "audit/verify_claims": "high" }, "audit", "survey")).toBeUndefined();
    expect(effortFor({ "audit/verify_claims": "high" }, "spec_review", "verify_claims"), "a task key binds its own role's task only").toBeUndefined();
  });

  it("accepts a role's task as a key, and refuses one its role does not run, or a level that does not exist, naming each", () => {
    expect(loadConfig({ ...base(), effort_routing: { audit: "max", "audit/verify_claims": "high" } }).config.effort_routing).toEqual({ audit: "max", "audit/verify_claims": "high" });
    expect(() => loadConfig({ ...base(), effort_routing: { "audit/review": "high" } })).toThrow(/effort_routing has no role or task `audit\/review`/u);
    expect(() => loadConfig({ ...base(), effort_routing: { "implement/write": "high" } })).toThrow(/no role or task `implement\/write`/u);
    expect(() => loadConfig({ ...base(), effort_routing: { "audit/verify_claim": "high" } }), "PRDR-306's old name for the check").toThrow(/`audit\/verify_claim`/u);
    expect(() => loadConfig({ ...base(), effort_routing: { "audit/verify_claims": "extreme" } })).toThrow(/effort_routing\.audit\/verify_claims is `extreme`/u);
  });

  it("names every task init sends, and no task it does not", () => {
    const sent = new Set(
      readdirSync(path.join(REPO, "src", "init"))
        .filter((f) => f.endsWith(".ts"))
        .flatMap((f) => [...readFileSync(path.join(REPO, "src", "init", f), "utf8").matchAll(/\btask: (?:[a-z]+ \? )?"([a-z_]+)"(?: : "([a-z_]+)")?/gu)])
        .flatMap((m) => [m[1], m[2]].filter((t): t is string => t !== undefined)),
    );
    const named = new Set(Object.values(ROLE_TASKS).flat());
    expect([...named].sort()).toEqual([...sent].sort());
    expect(TASK_KEYS).toContain("audit/verify_claims");
    expect(TASK_KEYS).toHaveLength(named.size);
  });

  it("estimates a step's units at their task's level", () => {
    const root = tmpTree({});
    roots.push(root);
    const notes: string[] = [];
    const check = { role: "audit", task: "verify_claims" } as const;
    const step = estimator({
      root,
      note: (n) => notes.push(n),
      modelRouting: { audit: "claude-opus-5-5" },
      effortRouting: { audit: "high", "audit/verify_claims": "max" },
    }).begin({ phase: "AUDIT", step: "AUDIT's claim checks", said: "AUDIT: 2 claims to check", units: [check, check], atOnce: 4 });
    step.end();
    expect(notes.join("\n"), "the checks are routed to max, the level Detent's figure was measured at").toContain("on claude-opus-5-5 at max");
    expect(notes.join("\n")).toContain("$5.72");
  });

  it("writes a new config with the roles' levels and each task moved apart, and names every task key at init", () => {
    const root = tmpTree({});
    roots.push(root);
    ensureConfig(root, 10);
    const written = JSON.parse(readFileSync(path.join(root, ".detent", "config.json"), "utf8")) as { effort_routing: Record<string, string> };
    expect(written.effort_routing).toEqual({ ...DEFAULT_EFFORT_ROUTING, ...DEFAULT_TASK_EFFORT_ROUTING });
    for (const key of TASK_KEYS) expect(routingNote(), key).toContain(key);
    for (const [key, level] of Object.entries(DEFAULT_TASK_EFFORT_ROUTING)) expect(routingNote(), key).toMatch(new RegExp(`${key}[^;.]*→ ${level}`, "u"));
  });

  it("S-5⁷ names each task a key can route, as the code has them", () => {
    const text = (definitionText(readFileSync(path.join(REPO, "detent-prd-v3.md"), "utf8"), "S-5⁷")[0] ?? "").replace(/\s+/gu, " ");
    expect(text).toContain("`role/task`");
    for (const [role, tasks] of Object.entries(ROLE_TASKS)) {
      expect(text, role).toContain(`\`${role}\``);
      for (const task of tasks ?? []) expect(text, `${role}/${task}`).toContain(`\`${task}\``);
    }
  });
});
