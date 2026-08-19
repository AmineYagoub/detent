import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INIT_PHASES, INTERRUPTS, INTERRUPT_PHASE } from "../../src/schemas/init.js";

/**
 * T-069 — the porcelain freeze (C-14, N-6).
 *
 * C-14 freezes the golden path at exactly two commands and the five C-5
 * interrupts. Adding either is a major-version decision requiring a PRD
 * amendment — so both counts are asserted here, and the README's snapshot is
 * the docs half of N-6.
 */

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const README = readFileSync("README.md", "utf8");

/** Every fenced bash block in the README's golden-path section. */
function goldenPathCommands(): string[] {
  const start = README.indexOf("## The golden path");
  const end = README.indexOf("\n## ", start + 1);
  const section = README.slice(start, end === -1 ? undefined : end);
  return [...section.matchAll(/```bash\n([\s\S]*?)```/g)]
    .flatMap((m) => (m[1] as string).split("\n"))
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

describe("T-069 C-14: the porcelain is exactly two commands", () => {
  it("the README golden path contains exactly `detent init` and `detent run`", () => {
    expect(goldenPathCommands()).toEqual(["detent init", "detent run"]);
  });

  it("no other detent verb appears in the golden-path section", () => {
    const commands = goldenPathCommands();
    expect(commands.filter((c) => c.startsWith("detent "))).toHaveLength(2);
  });

  it("plumbing is documented but explicitly OFF the golden path (C-12)", () => {
    const plumbing = README.slice(README.indexOf("## Plumbing"));
    expect(plumbing).toContain("never required on the golden path");
    for (const verb of ["status", "report", "doctor", "approve", "requeue", "verify sync"]) {
      expect(plumbing, verb).toContain(verb);
    }
  });

  it("the README documents C-11's exit codes as public API", () => {
    for (const code of ["`0`", "`10`", "`2`", "`1`"]) expect(README).toContain(code);
    expect(README).toContain("public API");
  });
});

describe("T-069 C-5: the interrupt set is frozen at five", () => {
  it("exactly five interrupt classes exist", () => {
    expect(INTERRUPTS).toHaveLength(5);
  });

  it("no module raises a prompt outside the closed set (C-5's lint half)", () => {
    /**
     * Prompting primitives may appear only where an interrupt is legitimately
     * presented: escalation (X-8), `verify sync` drift confirmation, and the
     * init CLI's inline AWAIT_APPROVAL prompt (C-7). Each presents one of the
     * five closed interrupts; a `readline` anywhere else would be a sixth
     * interrupt class in disguise.
     */
    const SANCTIONED = new Set(["cli/escalate.ts", "cli/verify.ts", "cli/approve.ts"]);
    const offenders: string[] = [];
    for (const file of walkTs(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (SANCTIONED.has(rel)) continue;
      const body = readFileSync(file, "utf8");
      if (/readline|\bprompt\s*\(/.test(body)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("T-130/T-132 C-14′: the plugin surface carries the same freeze (MP3 exit)", () => {
  const SKILLS = fileURLToPath(new URL("../../skills", import.meta.url));
  const initSkill = readFileSync(path.join(SKILLS, "init", "SKILL.md"), "utf8");

  it("the plugin's commands are exactly the two workflows", () => {
    expect(readdirSync(SKILLS).sort()).toEqual(["init", "run"]);
  });

  it("the init skill presents the five decisions and not a sixth (C-5 closed set)", () => {
    const named = new Set([...initSkill.matchAll(/AWAIT_[A-Z_]+/g)].map((m) => m[0]));
    expect([...named].sort()).toEqual([...INTERRUPTS].sort());
  });

  it("T-130: the seven phases appear in C-4.1 order", () => {
    const positions = INIT_PHASES.map((phase) => initSkill.indexOf(`\`${phase}\``));
    for (const [i, at] of positions.entries()) {
      expect(at, `${INIT_PHASES[i]} missing from the init skill`).toBeGreaterThan(-1);
      if (i > 0) expect(at, `${INIT_PHASES[i]} out of order`).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it("T-130: each decision is documented at its bracketed phase (C-4.1 positions)", () => {
    for (const [interrupt, phase] of Object.entries(INTERRUPT_PHASE)) {
      const block = initSkill.slice(initSkill.indexOf(`\`${interrupt}\``));
      expect(block.slice(0, 200), interrupt).toContain(`raised at \`${phase}\``);
    }
  });

  it("T-131: the approval decision names its three outcomes and the relay flags", () => {
    for (const token of ["approve", "decline", "defer", "--approve", "--decline", "--defer", "--by"]) {
      expect(initSkill, token).toContain(token);
    }
    expect(initSkill).toContain("who, when, and the hash");
  });
});

describe("T-069 N-6: the release checklist carries the freeze", () => {
  it("the plan's M4 exit names the porcelain-freeze checklist item", () => {
    const plan = readFileSync("docs/implementation-plan.md", "utf8");
    expect(plan).toContain("T-069");
    expect(plan).toMatch(/porcelain freeze|C-14/i);
  });

  it("the README states what Detent will never do — the four load-bearing refusals", () => {
    const section = README.slice(README.indexOf("## What Detent will never do"));
    expect(section).toContain("base branch");
    expect(section).toContain("Own your tooling");
    expect(section).toContain("artifacts and exit codes");
    expect(section).toContain("re-baseline");
  });
});

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walkTs(abs));
    else if (name.endsWith(".ts")) out.push(abs);
  }
  return out;
}
