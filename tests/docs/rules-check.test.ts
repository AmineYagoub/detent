import { describe, expect, it } from "vitest";
import { UNCHECKED_RULES, checkRules, codeOnly, violationsIn, withoutStringLiterals } from "../../scripts/check-rules.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * PRDR-176 — the gate for the AGENTS.md rules `npm run lint` does not reach.
 *
 * A checker with no negative tests is the V-1‴ shape: a gate that exits 0
 * having verified nothing. Every rule below is asserted in BOTH directions —
 * the violation is caught, and the compliant form beside it is not — because a
 * rule that fires on everything is as useless as one that fires on nothing, and
 * this file has already produced both by accident.
 */

const rulesOf = (file: string, source: string): string[] => violationsIn(file, source).map((v) => v.rule);

describe("PRDR-176 the AGENTS.md rules gate catches what it claims", () => {
  it("flags a grab-bag filename in src/, and leaves tests/helpers.ts alone", () => {
    expect(rulesOf("src/kernel/utils.ts", "export const x = 1;\n")).toContain("files/no-grab-bags");
    expect(rulesOf("src/kernel/helpers.ts", "export const x = 1;\n")).toContain("files/no-grab-bags");
    /* The rule says `src/`; the shared test harness is explicitly allowed to exist. */
    expect(rulesOf("tests/helpers.ts", "export const x = 1;\n")).toEqual([]);
    expect(rulesOf("src/kernel/escrow.ts", "export const x = 1;\n")).toEqual([]);
  });

  it("flags a TODO marker with no ticket, and accepts one that cites its ticket", () => {
    expect(rulesOf("src/a.ts", "/* TODO: split this */\n")).toContain("comments/todo-needs-ticket");
    expect(rulesOf("src/a.ts", "/* TODO: split this (PRDR-176) */\n")).toEqual([]);
    expect(rulesOf("src/a.ts", "/* TODO(PRDR-176): split this */\n")).toEqual([]);
    /* Prose about the word is not a marker — this rule flagged its own docs twice. */
    expect(rulesOf("src/a.ts", "/* a TODO carries a ticket id */\n")).toEqual([]);
  });

  it("flags console.* in src/ and not in tests/", () => {
    expect(rulesOf("src/a.ts", "console.log(x);\n")).toContain("errors/no-console");
    expect(rulesOf("src/a.ts", "console . error ( x );\n")).toContain("errors/no-console");
    expect(rulesOf("tests/a.test.ts", "console.log(x);\n")).toEqual([]);
    expect(rulesOf("src/a.ts", "deps.print(x);\n")).toEqual([]);
  });

  it("flags .only always and .skip only when it cites no ticket", () => {
    expect(rulesOf("tests/a.test.ts", 'it.only("x", () => {});\n')).toContain("tests/no-only");
    expect(rulesOf("tests/a.test.ts", 'describe.only("x", () => {});\n')).toContain("tests/no-only");
    expect(rulesOf("tests/a.test.ts", 'it.skip("x", () => {});\n')).toContain("tests/skip-needs-ticket");
    expect(rulesOf("tests/a.test.ts", 'it.skip("x — restored by PRDR-176", () => {});\n')).toEqual([]);
    expect(rulesOf("tests/a.test.ts", 'it("x", () => {});\n')).toEqual([]);
  });

  it("flags a builtin imported without the node: prefix", () => {
    expect(rulesOf("src/a.ts", 'import { readFileSync } from "fs";\n')).toContain("language/node-protocol");
    expect(rulesOf("src/a.ts", 'import { promises } from "fs/promises";\n')).toContain("language/node-protocol");
    expect(rulesOf("src/a.ts", 'import { readFileSync } from "node:fs";\n')).toEqual([]);
    /* A real package that merely shares a builtin's name prefix is not a builtin. */
    expect(rulesOf("src/a.ts", 'import x from "path-to-regexp";\n')).toEqual([]);
  });

  it("flags a relative import with no .js specifier", () => {
    expect(rulesOf("src/a.ts", 'import { x } from "./thing";\n')).toContain("language/explicit-js-specifier");
    expect(rulesOf("src/a.ts", 'import { x } from "../kernel/thing";\n')).toContain("language/explicit-js-specifier");
    expect(rulesOf("src/a.ts", 'import { x } from "./thing.js";\n')).toEqual([]);
    expect(rulesOf("src/a.ts", 'import x from "./data.json";\n')).toEqual([]);
    expect(rulesOf("src/a.ts", 'import { x } from "zod";\n')).toEqual([]);
  });

  it("flags an empty catch with no block comment, and accepts one that says why", () => {
    expect(rulesOf("src/a.ts", "try { f(); } catch { }\n")).toContain("errors/empty-catch-needs-why");
    expect(rulesOf("src/a.ts", "try { f(); } catch (e) { }\n")).toContain("errors/empty-catch-needs-why");
    expect(rulesOf("src/a.ts", "try { f(); } catch { /* absent is not an error here */ }\n")).toEqual([]);
    expect(rulesOf("src/a.ts", "try { f(); } catch { report(e); }\n")).toEqual([]);
  });

  /**
   * The scanner is why every rule above can be trusted on real files: without
   * it, a fixture string containing a rule's own trigger becomes a violation.
   */
  it("does not fire on a rule's own trigger inside a string literal", () => {
    expect(rulesOf("tests/a.test.ts", 'const recipe = "test:\\n\\t@echo TODO: nothing";\n')).toEqual([]);
    expect(rulesOf("src/a.ts", 'const s = "console.log(x)";\n')).toEqual([]);
    expect(rulesOf("src/a.ts", 'const s = `import { x } from "./thing"`;\n')).toEqual([]);
  });

  /**
   * The first scanner was a regex that treated the apostrophe in a doc comment
   * as an opening quote and backtracked to end of file; on this repository it
   * did not finish in two minutes. Comment state is what makes it linear.
   */
  it("treats an apostrophe in a comment as prose, not as an unterminated string", () => {
    const source = "/* the project's own rule, nobody's else */\nconsole.log(x);\n";
    expect(withoutStringLiterals(source)).toContain("console.log(x)");
    expect(rulesOf("src/a.ts", source)).toContain("errors/no-console");
  });

  it("blanks string contents while preserving line numbers", () => {
    const masked = withoutStringLiterals('const a = "one";\nconst b = "two";\n');
    expect(masked.split("\n")).toHaveLength(3);
    expect(masked).not.toContain("one");
    expect(masked).toContain("const a =");
  });

  /**
   * PRDR-257 — the masker's own tests. It had none: `codeOnly` was reached only
   * through two oracles, both of which use it positively, so every way it could
   * over-blank was invisible. These assert both directions on the two
   * constructs the hand-written scanner did not know about.
   */
  it("a quote inside a regex literal does not open a string", () => {
    const source = ['const SHELL = /[;&|`$()<>]/;', "export const kept = 1;", "/** a doc-block with a `tick` in it */", "console.log(x);", ""].join("\n");
    expect(codeOnly(source), "the scanner ran past the regex and blanked live code").toContain("export const kept = 1;");
    expect(codeOnly(source), "and the doc-block behind it survived the strip").not.toContain("tick");
    expect(rulesOf("src/a.ts", source), "a rule reading masked text must still see the call").toContain("errors/no-console");
  });

  it("code inside a template substitution is code", () => {
    const source = "const s = `just ${console.log(x)} end`;\n";
    expect(codeOnly(source), "`${…}` is executable text, not string content").toContain("console.log(x)");
    expect(codeOnly(source), "while the literal around it is still blanked").not.toContain("just");
  });

  it("comment blanking is total across the repository, not merely usual", () => {
    const roots = ["src", "tests", "scripts"];
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir).sort()) {
        const abs = path.join(dir, name);
        if (statSync(abs).isDirectory()) walk(abs, out);
        else if (abs.endsWith(".ts")) out.push(abs);
      }
      return out;
    };
    const standing: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const source = readFileSync(file, "utf8");
        const masked = codeOnly(source).split("\n");
        source.split("\n").forEach((raw, i) => {
          const text = raw.trim();
          const isComment = text.startsWith("*") || text.startsWith("/*") || text.startsWith("//");
          if (isComment && (masked[i] ?? "").trim() !== "") standing.push(`${file}:${String(i + 1)}`);
        });
      }
    }
    expect(standing, `prose survived the strip, so it can answer for code: ${standing.slice(0, 6).join(", ")}`).toEqual([]);
  });

  it("`withoutStringLiterals` still keeps comments and drops string contents", () => {
    const source = '/** keep me */\nconst a = "drop me";\n';
    expect(withoutStringLiterals(source)).toContain("keep me");
    expect(withoutStringLiterals(source)).not.toContain("drop me");
  });

  /** The repository itself must pass the gate it ships. */
  it("the repository has no violations", () => {
    expect(checkRules().map((v) => `${v.file}:${String(v.line)} ${v.rule}`)).toEqual([]);
  });

  /**
   * A green gate must not be read as full compliance. The judgement rules are
   * named in the tool's own output so nobody has to infer the boundary.
   */
  it("states what it does not check", () => {
    expect(UNCHECKED_RULES.length).toBeGreaterThan(0);
    expect(UNCHECKED_RULES.join(" ")).toContain("narration");
    expect(UNCHECKED_RULES.join(" ")).toContain("lint");
  });
});
