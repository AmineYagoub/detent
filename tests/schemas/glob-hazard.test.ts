import picomatch from "picomatch";
import { describe, expect, it } from "vitest";
import { BOUNDARY_RULES } from "../../src/fs/layout.js";
import { DOC_PATTERNS } from "../../src/init/discover-docs.js";
import { STRUCTURAL_PROTECTED } from "../../src/schemas/common.js";
import { globHazard, repeatedGroup } from "../../src/schemas/glob-hazard.js";
import { PACK_PATHS } from "../../src/schemas/pack.js";

/**
 * PRDR-330 (SEC-3″): which globs picomatch 4.0.5, the pinned engine (N-3),
 * cannot match safely or as written. The entry points that refuse them are in
 * `tests/sec/glob-hazards.test.ts`; this suite pins the rule, shape by shape,
 * so a picomatch that compiles one differently shows up here by name.
 */

const source = (glob: string): string => picomatch.makeRe(glob, { dot: true }).source;

describe("PRDR-330 a glob whose regex repeats a group over more than one character is refused, naming the group", () => {
  const shapes: readonly (readonly [glob: string, group: string, why: string])[] = [
    ["+(*)", "(?:[^/]*?)+", "one branch, so none of the upstream safeguard's four shapes"],
    ["src/+(*)", "(?:[^/]*?)+", "the same, under a directory"],
    ["+(a|b|ab)", "(?:a|b|ab)+", "`ab` is `a` then `b`: overlap across characters"],
    ["*(a|b|ab)", "(?:a|b|ab)*", "the zero-or-more form"],
    ["+(ab|ab)", "(?:ab|ab)+", "a branch written twice, longer than one character"],
    ["+(x*)", "(?:x[^/]*?)+", "a star inside a repeated branch"],
    ["+(*.ts)", "(?:[^/]*?\\.ts)+", "a plausible-looking repeated file glob"],
    ["(a|b|ab)+", "(a|b|ab)+", "a `+` after a group, which picomatch passes through as a regex quantifier"],
    ["{a,b,ab}+", "(a|b|ab)+", "a `+` after a brace"],
    ["(a+)+", "(a+)+", "a quantifier inside a repeated group"],
    ["!(+(a|b|ab))", "(?:a|b|ab)+", "inside a negation, which picomatch compiles to a lookahead"],
    ["@(x|+(a|b|ab))", "(?:a|b|ab)+", "nested in a group that is not itself repeated"],
    ["src/*.+(ts|tsx)", "(?:ts|tsx)+", "safe in fact, refused all the same: braces say it (vetoable call 4)"],
    ["+([ab])", "(?:(?:\\[ab\\]|[ab]))+", "picomatch also matches a class's own spelling, `[ab]`"],
  ];
  for (const [glob, group, why] of shapes) {
    it(`\`${glob}\`: ${why}`, () => {
      const hazard = globHazard(glob) ?? "";
      expect(hazard).toContain(`\`${glob}\``);
      expect(hazard).toContain(`\`${group}\``);
      expect(hazard).toContain("SEC-3″");
    });
  }

  it("`(a|b|ab)+` is the same regex with extglobs off, so `noextglob` is no fix", () => {
    expect(picomatch.makeRe("(a|b|ab)+", { dot: true, noextglob: true }).source).toBe(source("(a|b|ab)+"));
  });
});

describe("PRDR-330 a glob picomatch reads as its own spelling is refused (SEC-3″)", () => {
  const shapes: readonly (readonly [glob: string, spelled: string])[] = [
    ["+(a|aa)", "+(a|aa)"],
    ["+(*|x)", "+(*|x)"],
    ["+(*(a)|bc)", "+(*(a)|bc)"],
    ["+(+(a))", "+(+(a))"],
    ["@(+(a|aa))", "+(a|aa)"],
    ["!(+(a|aa))", "+(a|aa)"],
    ["src/+(a|aa)/**", "+(a|aa)"],
  ];
  for (const [glob, spelled] of shapes) {
    it(`\`${glob}\` matches only a name spelled \`${spelled}\``, () => {
      expect(picomatch.isMatch(spelled, spelled, { dot: true }), "the engine does read it as its own spelling").toBe(true);
      const hazard = globHazard(glob) ?? "";
      expect(hazard).toContain(`\`${spelled}\``);
      expect(hazard).toContain("as its own spelling, not as an extglob");
    });
  }
});

describe("PRDR-330 a glob picomatch cannot compile is refused, since it would match nothing (SEC-3″)", () => {
  it("a caught extglob holding a backslash escape: the safeguard's own output does not compile", () => {
    expect(picomatch.makeRe("+(a|aa|\\+\\(x)").source, "picomatch swallows the error into `/$^/`").toBe("$^");
    expect(globHazard("+(a|aa|\\+\\(x)")).toContain("which then matches nothing");
  });

  it("the empty string, which picomatch will not compile at all", () => {
    expect(globHazard("")).toContain("cannot be compiled by picomatch");
  });
});

describe("PRDR-330 a glob picomatch can match safely and as written passes", () => {
  it("the safeguard's rewrites that keep the meaning: `+(*(a)|*(b))` to `[ab]*`, `+(*(a))` to `a*`", () => {
    expect(source("+(*(a)|*(b))")).toContain("[ab]*");
    expect(globHazard("+(*(a)|*(b))")).toBeNull();
    expect(globHazard("+(*(a))")).toBeNull();
  });

  it("extglobs that repeat one character or nothing, braces, classes, globstars and negation", () => {
    const ordinary = ["@(src|lib)/**", "!(*.d).ts", "?(a|ab)", "+([a-z])", "*([0-9])", "+(a)", "*(a)", "src/{a,b}.ts", "src/*.{ts,tsx}", "[[:alpha:]]*.md", "**/*.test.ts", "!src/**", "**", "*"];
    expect(ordinary.filter((glob) => globHazard(glob) !== null)).toEqual([]);
  });

  it("a glob spelled as text on purpose, quoted or escaped, is text and not a literalised extglob", () => {
    expect(globHazard('"+(a|aa)"')).toBeNull();
    expect(globHazard("\\+\\(a\\|aa\\)")).toBeNull();
  });

  it("every glob Detent declares: the protected floor, the documents, the pack's paths, the layout's boundaries", () => {
    const declared = [...STRUCTURAL_PROTECTED, ...DOC_PATTERNS, ...PACK_PATHS, ...BOUNDARY_RULES.flatMap((rule) => rule.patterns)];
    expect(declared.filter((glob) => globHazard(glob) !== null)).toEqual([]);
  });
});

describe("PRDR-330 a glob is judged in each form a matcher compiles", () => {
  it("segment by segment, as a surface's package reach splits it: a class holding a slash is one character whole, and not once split", () => {
    expect(source("[+(a|b|ab)/]"), "whole, it is one class").toMatch(/^\^\(\?:\[\+\(a\|b\|ab\)\/\]/u);
    const hazard = globHazard("[+(a|b|ab)/]") ?? "";
    expect(hazard).toContain("has a segment, `[+(a|b|ab)`, as a surface's package reach splits it, that makes picomatch repeat `(?:a|b|ab)+`");
  });
});

describe("PRDR-330 the reader of picomatch's regex", () => {
  it("reads the globstar's step as one character: a lookahead matches none", () => {
    expect(source("**")).toContain("(?:(?!(?:^|\\/)\\.{1,2}(?:\\/|$)).)*?");
    expect(repeatedGroup(source("**"))).toBeNull();
    expect(repeatedGroup(source("src/**/*.test.ts"))).toBeNull();
  });

  it("reads inside a lookaround: backtracking there is still backtracking", () => {
    expect(repeatedGroup("^(?!(?:a|ab)+x).*$")).toBe("(?:a|ab)+");
  });

  it("counts a bounded maximum above one as repeating, and one of at most one as not", () => {
    expect(repeatedGroup("^(ab){2,}$")).toBe("(ab){2,}");
    expect(repeatedGroup("^(ab){3}$")).toBe("(ab){3}");
    expect(repeatedGroup("^(ab){0,1}$")).toBeNull();
    expect(repeatedGroup("^(ab)?$")).toBeNull();
    expect(repeatedGroup("^(a){2,}$")).toBeNull();
  });

  it("reads a class to its closing bracket, escapes included, and a repeated class is one character", () => {
    expect(repeatedGroup("^(?:[\\])|]x)+$")).toBe("(?:[\\])|]x)+");
    expect(repeatedGroup("^[ab)|(]*$")).toBeNull();
    expect(repeatedGroup("^(?:[^/])+$")).toBeNull();
  });

  it("reads an alternation as more than one character, an empty branch included", () => {
    expect(repeatedGroup("^(?:a|)+$")).toBe("(?:a|)+");
  });

  it("names the first such group, nested or not", () => {
    expect(repeatedGroup("^(?:(?:a)+)+$")).toBe("(?:(?:a)+)+");
    expect(repeatedGroup("^x(?:y|(?:a|b)*)z$")).toBe("(?:a|b)*");
  });
});
