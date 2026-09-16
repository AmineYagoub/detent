import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INIT_PHASES, INTERRUPTS, INTERRUPT_PHASE } from "../../src/schemas/init.js";
import { EXIT_ERROR, EXIT_HUMAN_GATED, EXIT_NOT_READY, EXIT_OK } from "../../src/kernel/run.js";

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
    for (const verb of ["status", "report", "doctor", "approve", "requeue", "unclaim", "verify sync"]) {
      expect(plumbing, verb).toContain(verb);
    }
  });

  it("the README documents C-11's exit codes as public API", () => {
    /**
     * PRDR-172: the code must be PAIRED with its meaning.
     *
     * This checked four backtick-wrapped digits were present somewhere in the
     * file. Scrambling all four rows of the README's exit-code table, so every
     * code named the wrong outcome, left all 13 tests green — including this
     * one, titled "the README documents C-11's exit codes as public API".
     * Each row is now matched against the constant it documents.
     */
    const rows: [string, number, RegExp][] = [
      ["EXIT_OK", EXIT_OK, /ready|ok|success|complete/i],
      ["EXIT_ERROR", EXIT_ERROR, /error|fail/i],
      ["EXIT_NOT_READY", EXIT_NOT_READY, /not ready|interrupt|answer/i],
      ["EXIT_HUMAN_GATED", EXIT_HUMAN_GATED, /human|escalat|gated/i],
    ];
    for (const [name, code, meaning] of rows) {
      const line = README.split("\n").find((l) => new RegExp(`\\\`${code}\\\``).test(l) && /\|/.test(l));
      expect(line, `${name} (${code}) has no row in the README's exit-code table`).toBeDefined();
      expect(line ?? "", `the README's row for ${code} does not describe ${name}`).toMatch(meaning);
    }
    expect(README).toContain("public API");
  });
});

describe("T-069 C-5: the interrupt set is frozen at five", () => {
  it("exactly five interrupt classes exist", () => {
    expect(INTERRUPTS).toHaveLength(5);
  });
});

/**
 * PRDR-256 — the inventory of modules that can block on a human.
 *
 * Five modules in `src/` can put a question in front of a person, by two
 * different acts, so there are two tiers. A module OPENS a transport when it
 * imports `node:readline`, builds a line reader and reads an answer from it. A
 * module WIRES one when it hands a `makeTty*` asker to something that will call
 * it, opening nothing itself. `cli/run.ts` and `cli/init.ts` do the second and
 * not the first, which is why the check this replaces could not see them: it
 * searched for the string `readline`, and neither file contains it. It reported
 * an empty offender list while two of the three live TTY prompts were raised
 * from modules it had never heard of, and PRDR-255 made that worse by wiring
 * the approval asker into `run` — where nothing was looking.
 *
 * Exactly one of these five decisions is a C-5 interrupt: `makeTtyApproval`
 * answers AWAIT_APPROVAL. The escalation in `cli/escalate.ts` is C-10/X-8's and
 * the re-baseline consent in `cli/verify.ts` is V-1's, and neither is a member
 * of `INTERRUPTS`. So this is an inventory of the places that can block on a
 * human; it is not a proof that the interrupt set is five. That proof is the
 * `INTERRUPTS` tuple and the skill assertion below.
 *
 * Matched against the RAW body, with no mask, and that is measured rather than
 * assumed: raw and `codeOnly` return the identical file set for every pattern
 * here, so a mask buys nothing while costing three blind channels (PRDR-257).
 * Every pattern requires a `(`, and this repository writes identifiers in prose
 * inside backticks without one — which is the discrimination a mask was hired
 * for. The half that was dropped, a bare `prompt(`, never matched code in any
 * commit and does match ordinary prose: the block this replaces contained the
 * words "prompt (C-7)", so the check could fail on its own doc-block (V-6).
 *
 * The bound, stated because it is not enforced: this is text matching over
 * `src/`. An asker imported under an alias, a transport from a package other
 * than `node:readline`, a prompt raised from `prompts/`, `skills/`, `hooks/` or
 * `scripts/`, a prompt raised by a child process inheriting fd 0, and
 * `for await (const chunk of process.stdin)` are all outside what it can see —
 * and that last idiom already ships at `src/plugin/hook-entry.ts`. This holds a
 * declared inventory honest against drift, which is the failure that produced
 * it. It does not resist someone trying to evade it: an adversarial version is
 * an AST rule over the import graph, which is a separate and unbuilt check.
 */
interface PromptSite {
  readonly constructs: readonly string[];
  readonly reason: string;
}

/** Constructs that OPEN a line reader: importing one, building one, reading an answer from one. */
const OPENS_CONSTRUCTS: Record<string, RegExp> = {
  "node:readline": /^[ \t]*import\b[^\n]*\bfrom\s*"(?:node:)?readline(?:\/promises)?"/m,
  "createInterface(": /\bcreateInterface\s*\(/,
  /**
   * `question` is live vocabulary here — `src/init/questions.ts`, `openQuestions`,
   * `similarQuestions`. Measured at zero matches on code in every commit, but a
   * `q.question(i)` accessor would fire, so the headroom is recorded rather than assumed.
   */
  ".question(": /\.question\s*\(/,
};

/** A CALL to a TTY asker factory. The lookbehind is what makes a declaration not a call. */
const ASKER_CALL = /(?<!\bfunction\s)\b(makeTty[A-Z][A-Za-z]*)\s*\(/g;

/** Modules that open a line reader of their own. */
const OPENS: Record<string, PromptSite> = {
  "cli/approve.ts": {
    constructs: ["node:readline", "createInterface(", ".question("],
    reason: "C-7's approval prompt — AWAIT_APPROVAL, the one C-5 interrupt any of these five presents",
  },
  "cli/escalate.ts": {
    constructs: ["node:readline", "createInterface(", ".question("],
    reason: "C-10/X-8's in-run escalation — approve / requeue / skip / quit; not a member of INTERRUPTS",
  },
  "cli/verify.ts": {
    constructs: ["node:readline", "createInterface(", ".question("],
    reason: "V-1's re-baseline consent inside `verify sync`, C-12 plumbing; not a member of INTERRUPTS",
  },
};

/** Modules that hand an asker to something that will call it, and open no transport themselves. */
const WIRES: Record<string, PromptSite> = {
  "cli/init.ts": {
    constructs: ["makeTtyApproval"],
    reason: "C-7's first exit — the approval asker passed to the init pipeline behind this file's TTY gate",
  },
  "cli/run.ts": {
    constructs: ["makeTtyEscalation", "makeTtyApproval"],
    reason: "C-10's escalation and C-7's second exit (PRDR-255), both behind the one TTY gate the file computes once",
  },
};

function opensIn(body: string): string[] {
  return Object.entries(OPENS_CONSTRUCTS)
    .filter(([, re]) => re.test(body))
    .map(([name]) => name);
}

function wiresIn(body: string): string[] {
  return [...new Set([...body.matchAll(ASKER_CALL)].map((m) => m[1] as string))];
}

/** Every module the walk can see, read once — the key set every assertion below derives from. */
function modules(): { rel: string; body: string }[] {
  return walkTs(SRC).map((file) => ({
    rel: path.relative(SRC, file).split(path.sep).join("/"),
    body: readFileSync(file, "utf8"),
  }));
}

describe("PRDR-256: every module that can block on a human is declared", () => {
  it("sees a prompt wired from a module that never names `readline`", () => {
    const run = modules().find((m) => m.rel === "cli/run.ts")?.body ?? "";
    expect(/readline/.test(run), "the premise: `cli/run.ts` contains no `readline`").toBe(false);
    expect(
      wiresIn(run),
      "`cli/run.ts` hands makeTtyEscalation and makeTtyApproval to the kernel and contains no `readline`, " +
        "so the predicate this replaces returned false for it — the check reported no offenders while two of " +
        "the three live TTY prompts were raised from a module it had never heard of",
    ).toEqual(["makeTtyEscalation", "makeTtyApproval"]);
  });

  it("every declared site exists, and still does what it is exempt for", () => {
    const seen = new Map(modules().map((m) => [m.rel, m.body]));
    for (const [tier, sites, found] of [
      ["OPENS", OPENS, opensIn],
      ["WIRES", WIRES, wiresIn],
    ] as [string, Record<string, PromptSite>, (body: string) => string[]][]) {
      for (const [rel, site] of Object.entries(sites)) {
        const body = seen.get(rel);
        expect(body, `${tier} declares ${rel}, which is not a module in src/`).toBeDefined();
        for (const construct of site.constructs) {
          expect(
            found(body ?? ""),
            `${tier} exempts ${rel} for ${construct}, which it no longer contains — ${site.reason}`,
          ).toContain(construct);
        }
      }
    }
  });

  it("no undeclared module opens a prompt transport", () => {
    const offenders = modules()
      .filter((m) => OPENS[m.rel] === undefined && opensIn(m.body).length > 0)
      .map((m) => `${m.rel} opens a prompt transport (${opensIn(m.body).join(", ")})`);
    /** A WIRES module is undeclared HERE, so a wirer that starts opening one fails this. */
    expect(offenders, `an undeclared module opens a line reader: ${offenders.join("; ")}`).toEqual([]);
  });

  it("no undeclared module wires a TTY asker", () => {
    const offenders = modules()
      .filter((m) => WIRES[m.rel] === undefined && wiresIn(m.body).length > 0)
      .map((m) => `${m.rel} wires a TTY asker (${wiresIn(m.body).join(", ")})`);
    expect(offenders, `an undeclared module hands out an asker: ${offenders.join("; ")}`).toEqual([]);
  });

  it("src/ holds nothing this walk cannot open", () => {
    expect(
      walkAny(SRC).filter((f) => !f.endsWith(".ts")),
      "a `.mts` or `.cts` under src/ is invisible to this walk, to eslint's `src/**/*.ts`, " +
        "to tsconfig's include and to scripts/check-rules.ts at once",
    ).toEqual([]);
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

/** Every file, whatever its extension — the walk `walkTs` narrows, so the narrowing can be checked. */
function walkAny(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walkAny(abs));
    else out.push(path.relative(SRC, abs).split(path.sep).join("/"));
  }
  return out;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walkTs(abs));
    else if (name.endsWith(".ts")) out.push(abs);
  }
  return out;
}
