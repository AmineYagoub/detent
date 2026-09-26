import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CEILINGS } from "../../src/schemas/budgets.js";
import { DEFAULT_EFFORT_ROUTING, DEFAULT_MODEL_ROUTING, ROLE_IDS } from "../../src/schemas/roles.js";
import { definitionText, definitions } from "./prd-marks.js";

/**
 * PRDR-278 — the PRD records the specification phase and the planning phase
 * rebuilt on its pack, before any code (N-6).
 *
 * The amendment changes the pipeline v3 inherits from v2 §4.1, C-3′'s "Planning
 * does not stop for a question", X-3's transition table, S-1's role set and
 * S-5′'s routing, and it lifts a non-goal. Each of those is a sentence a later
 * ticket builds against, so each is pinned here: a ticket that reads the PRD
 * must find the rule it implements, and a rule the amendment replaced must say
 * so where a reader lands on it.
 *
 * Where the code already has what the PRD states — a role's default routing,
 * a ceiling's default — the two are compared, so the PRD cannot drift from
 * the code once the tickets that build the new roles and the new ceiling land.
 * Those tickets are not named here: a ticket id cited under `tests/` reads to
 * `tickets:check` as work that has landed.
 */
const PRD = readFileSync(new URL("../../detent-prd-v3.md", import.meta.url), "utf8");
const CHECKLIST = readFileSync(new URL("../../docs/release-checklist.md", import.meta.url), "utf8");

/** Text as a reader sees it: a sentence the PRD wraps across lines is one sentence. */
const flat = (text: string): string => text.replace(/\s+/gu, " ");

/** The one definition of `mark`, line breaks kept, or an empty string when the PRD has none. */
const raw = (mark: string): string => definitionText(PRD, mark)[0] ?? "";

/** The one definition of `mark`, as a reader sees it. */
const rule = (mark: string): string => flat(raw(mark));

const NEW_MARKS = [
  "C-2⁶", "C-2⁷", "C-2⁸", "C-3⁗", "C-4⁵", "C-4⁶", "A-1⁷", "C-7″", "C-8⁵", "X-3′", "X-4⁷",
  "S-1‴", "S-5⁵", "D-5′", "V-5′", "OQ-4", "D-10′", "N-5′", "N-7′", "D-31", "D-32", "D-33",
] as const;

const INTERRUPTS = ["AWAIT_DOCS", "AWAIT_BINDING_CHOICE", "AWAIT_SETUP_CONSENT", "AWAIT_INFO", "AWAIT_APPROVAL"];

const NEW_ROLES = {
  audit: ["claude-opus-5-5", "max"],
  spec_write: ["claude-opus-5-5", "max"],
  spec_review: ["claude-opus-5-5", "max"],
  plan_review: ["claude-opus-5", "max"],
} as const;

/**
 * Every earlier rule the amendment replaces in part, with the rule that
 * replaces it. A reader who lands on the old rule — C-4⁗″'s three reads, say —
 * must learn there that it no longer holds, not by reading 1,400 lines on.
 */
const AMENDED: Record<string, readonly string[]> = {
  "C-3′": ["C-3⁗"],
  "C-3″": ["C-3⁗"],
  "C-3‴": ["C-3⁗"],
  "C-4″": ["C-4⁶", "S-1‴"],
  "C-4‴": ["C-4⁶"],
  "C-4⁗″": ["C-4⁶"],
  "C-4⁗‴": ["C-4⁶"],
  "D-28′": ["C-4⁶"],
  "D-24′": ["C-7″"],
  "C-2‴": ["C-2⁸", "A-1⁷", "C-4⁶"],
  "C-2⁗": ["A-1⁷"],
  "C-2⁵′": ["C-2⁸"],
  "A-1‴": ["A-1⁷"],
  "A-1⁵": ["A-1⁷"],
  "C-8′": ["C-8⁵"],
  "C-8″": ["C-8⁵"],
  "C-8‴": ["C-2⁸"],
  "C-8⁗": ["A-1⁷"],
  "V-1′": ["D-10′"],
  "A-1⁶": ["D-10′"],
  "X-4⁵": ["X-3′"],
  "S-1″": ["S-1‴"],
};

/** The numbers every "specification decision(s) …" or "planning decision(s) …" citation names. */
function cited(kind: "specification" | "planning"): Set<number> {
  const found = new Set<number>();
  for (const m of flat(PRD).matchAll(new RegExp(`${kind} decisions? (\\d+(?:(?:, | and )\\d+)*)`, "giu"))) {
    for (const n of (m[1] ?? "").split(/, | and /u)) found.add(Number(n));
  }
  return found;
}

/** A phase's sub-bullet inside C-2⁶, its line and its continuation lines, as a reader sees it. */
function phase(name: string): string {
  const lines = raw("C-2⁶").split("\n");
  const at = lines.findIndex((l) => l.startsWith(`  - **${name}**`));
  if (at < 0) return "";
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => /^ {2}- /u.test(l));
  return flat([lines[at], ...(end < 0 ? rest : rest.slice(0, end))].join("\n"));
}

describe("PRDR-278 the PRD records the specification phase and planning on its pack", () => {
  it("the inherited pipeline line shows AUDIT, DECIDE, WRITE and VALIDATE between DISCOVER and DETERMINE_VERIFICATION, and no ANALYZE", () => {
    const line = PRD.split("\n").find((l) => l.startsWith("The `init` pipeline (§4.1 of v2)")) ?? "";
    const pipeline = /`(INIT_FS[^`]*)`/u.exec(line)?.[1] ?? "";
    expect(pipeline.split("→").map((p) => p.trim())).toEqual([
      "INIT_FS", "DISCOVER", "[AWAIT_DOCS]", "AUDIT", "DECIDE", "[AWAIT_INFO]", "WRITE", "VALIDATE", "[AWAIT_INFO]",
      "DETERMINE_VERIFICATION", "[AWAIT_BINDING_CHOICE | AWAIT_SETUP_CONSENT]",
      "SLICE", "PLAN", "PREPARE_AGENTS", "PRESENT", "[AWAIT_INFO | AWAIT_APPROVAL]", "READY",
    ]);
    const raised = new Set([...pipeline.matchAll(/AWAIT_[A-Z_]+/gu)].map((m) => m[0]));
    expect([...raised].sort(), "C-5's five, and no sixth").toEqual([...INTERRUPTS].sort());
  });

  it("every mark the amendment adds is defined exactly once, and names PRDR-278", () => {
    const heads = definitions(PRD);
    for (const mark of NEW_MARKS) {
      expect(heads.get(mark) ?? [], `${mark} is defined once`).toHaveLength(1);
      expect(rule(mark), `${mark} names its ticket`).toContain("PRDR-278");
    }
  });

  it("each specification phase says what it reads, what it writes and when it stops", () => {
    const table: Record<string, readonly RegExp[]> = {
      AUDIT: [/reads the discovered documents/u, /writes its checkpoint/u, /never stops/u],
      DECIDE: [/reads AUDIT's checkpoint/u, /writes the decision log/u, /stops once, on a TTY/u],
      WRITE: [/reads the documents, AUDIT's checkpoint and the decision log/u, /writes the pack/u, /never stops/u],
      VALIDATE: [/reads the pack/u, /writes the conformance record/u, /stops only at the ceiling, and only for a blocker/u],
    };
    for (const [name, clauses] of Object.entries(table)) {
      const text = phase(name);
      expect(text, `${name} has its own entry in C-2⁶`).not.toBe("");
      for (const clause of clauses) expect(text, `${name}: ${String(clause)}`).toMatch(clause);
    }
  });

  it("C-3′ is amended, not contradicted: AWAIT_INFO at DECIDE and at VALIDATE, the five interrupts kept, and why a sixth was refused", () => {
    const text = rule("C-3⁗");
    for (const token of ["C-3′", "C-3″", "C-3‴", "AWAIT_INFO", "DECIDE", "VALIDATE", "C-5", "C-14′", "vetoable", "PRESENT"]) {
      expect(text, token).toContain(token);
    }
    expect(text, "headless DECIDE takes the recommended answers").toMatch(/off a TTY/iu);
  });

  it("X-3 admits PREMISE_FALSIFIED from each fix state with IN_PROGRESS's outcome, and adds no state or event", () => {
    const text = rule("X-3′");
    for (const token of ["BLIND_FIX", "INFORMED_FIX", "REVIEW_FIX", "PREMISE_FALSIFIED", "DEPENDENCY_DISCOVERED", "IN_PROGRESS"]) {
      expect(text, token).toContain(token);
    }
    expect(text).toMatch(/no state or event is added/iu);
    const machine = PRD.split("\n").find((l) => l.startsWith("- **§7 Execution State Machine (X)**")) ?? "";
    expect(machine, "the inheritance note no longer says nothing in §7 changes").not.toMatch(/nothing in it changes/u);
    expect(machine).toContain("X-3′");
  });

  it("S-1 gains four roles in one F-3 schema event, and S-5⁵ states every role's default model and effort as the code has them", () => {
    const roles = rule("S-1‴");
    for (const token of [...Object.keys(NEW_ROLES).map((r) => `\`${r}\``), "F-3", "`schema_version`", "role@hash"]) {
      expect(roles, token).toContain(token);
    }
    const routed = new Map(
      [...rule("S-5⁵").matchAll(/`([a-z_]+)`: `(claude-[a-z0-9-]+)` at `(low|medium|high|xhigh|max)`/gu)].map((m) => [m[1] ?? "", [m[2], m[3]]]),
    );
    for (const [role, pair] of Object.entries(NEW_ROLES)) expect(routed.get(role), role).toEqual(pair);
    for (const role of ROLE_IDS) {
      expect(routed.get(role), `${role} as the code routes it`).toEqual([DEFAULT_MODEL_ROUTING[role], DEFAULT_EFFORT_ROUTING[role]]);
    }
    expect([...routed.keys()].sort()).toEqual([...new Set([...ROLE_IDS, ...Object.keys(NEW_ROLES)])].sort());
  });

  it("no switch skips the phase, VALIDATE's ceiling defaults to 8, and each phase's spend is reported and never capped", () => {
    const text = rule("C-2⁶");
    expect(text).toMatch(/no switch/iu);
    expect(text).toMatch(/never capped/iu);
    const ceiling = /`spec_validation_rounds`[^.]*?default (\d+)/u.exec(phase("VALIDATE"))?.[1];
    expect(ceiling).toBe("8");
    expect(CEILINGS.spec_validation_rounds.default, "the code's default is the PRD's (PRDR-284)").toBe(8);
  });

  it("N-7 keeps the raw PRD and runs the phase headless, and the checklist records its duration and spend", () => {
    const text = rule("N-7′");
    expect(text).toContain("`detent-prd-v3.md`");
    expect(text).toMatch(/headless/u);
    const item5 = /\n5\. \*\*N-7[\s\S]*?(?=\n6\. )/u.exec(CHECKLIST)?.[0] ?? "";
    expect(item5).toMatch(/duration/u);
    expect(item5).toMatch(/spend/u);
  });

  it("the planning redesign is recorded rule by rule", () => {
    expect(rule("D-10′")).toMatch(/ANALYZE[\s\S]*DECIDE/u);
    expect(rule("C-2⁸")).toMatch(/requirement ids/u);
    expect(rule("C-4⁵")).toContain("`criterion_ids`");
    expect(rule("C-4⁵")).toContain("`spec_defects`");
    expect(rule("A-1⁷")).toMatch(/one targeted redraft/iu);
    expect(rule("A-1⁷")).toMatch(/blocks approval/iu);
    expect(rule("C-4⁶")).toContain("`plan_review`");
    expect(rule("D-5′")).toMatch(/amends D-5 and V-5 \(V-5′\), lifts NG2 and resolves OQ-4/u);
    const scope = PRD.split("\n").find((l) => l.startsWith("- **§3 Scope & Non-Goals**")) ?? "";
    expect(scope, "the inheritance note says NG2 is lifted").toMatch(/NG2 is lifted by D-5′/u);
    expect(rule("C-7″")).toContain("--accept-mixed-builds");
    expect(rule("D-33"), "the outcome rule").toMatch(/finding counts are not an outcome/iu);
  });

  it("the operator's decisions are cited: all sixteen of the specification plan's and all ten of the planning plan's", () => {
    expect([...cited("specification")].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect([...cited("planning")].sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  for (const [old, by] of Object.entries(AMENDED)) {
    it(`${old} points forward to ${by.join(" and ")}`, () => {
      const text = definitionText(PRD, old).join("\n");
      expect(text, `${old} is defined`).not.toBe("");
      for (const mark of by) expect(text, mark).toMatch(new RegExp(`Amended by [^*]*${mark}(?![′″‴⁗⁰¹²³⁴⁵⁶⁷⁸⁹])`, "u"));
    });
  }
});
