import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PRDR-176 — the AGENTS.md rules that `npm run lint` does not reach.
 *
 * AGENTS.md marks its lint-enforced rules `[lint]` and says the rest are
 * "enforced by review". Review is a person remembering, which is the mechanism
 * every defect in this repository's audit history got past. Seven of those
 * rules are mechanically decidable, and this is the gate for them.
 *
 * It deliberately does NOT duplicate eslint: enums, default exports, line
 * comments, `eqeqeq`, `max-lines`, type-only imports, `no-explicit-any` and the
 * `prefer-*` family are already errors there, and a second opinion on them
 * would only drift.
 *
 * It also deliberately does not guess at the judgement rules — "no narration",
 * "one module, one job", "public data shapes are readonly", "no `Date.now()` in
 * decision paths without an injectable seam". Those need a reader. A checker
 * that approximated them would produce noise on every run, and a warning that
 * fires constantly is one nobody reads (V-1‴ learned that the expensive way).
 * `violationsIn` returns only what it can decide.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface RuleViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly detail: string;
}

/** Directories whose contents are generated or vendored, and are nobody's to fix here. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".detent"]);

export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/**
 * Blank out string and template literals so a rule cannot fire on data.
 *
 * A make-recipe fixture containing `@echo "TODO"` is not a TODO, and a test
 * asserting on the text `console.log` is not a `console.log`. Newlines and
 * lengths are preserved so reported line numbers stay true.
 *
 * The first version was a regex, `/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g`, which
 * treats the apostrophe in a doc comment — "nobody's", "the project's" — as an
 * opening quote, scans to end of file looking for its partner, and backtracks;
 * on this repository's comment density it did not finish in two minutes. The
 * second was a hand-written scanner that tracked comment and string state,
 * which fixed that and was linear, and it is what PRDR-257 replaced: see the
 * note on `mask` below for what it could not see.
 */
export function withoutStringLiterals(source: string): string {
  return mask(source, false);
}

/**
 * Blank comments AS WELL, leaving only executable text.
 *
 * `tests/oracle/budgets.test.ts` asks "does this file actually READ this
 * ceiling", and prose must not answer for code — neither a doc comment (the
 * hole PRDR-172 closed) nor a log message (the hole it opened by closing the
 * first with a comment-only strip). One scanner, so the gate and that test
 * cannot disagree about what counts as code.
 *
 * PRDR-257: "only executable text" is now true in both directions. It used to
 * be false in both — code inside a `${…}` substitution was blanked with the
 * literal around it, and a quote inside a regex literal desynchronised the
 * scanner so that prose survived.
 */
export function codeOnly(source: string): string {
  return mask(source, true);
}

/**
 * PRDR-257 — the parse decides what is code, because a scanner that does not
 * know the language gets this wrong in both directions.
 *
 * The hand-written version tracked comments and strings and knew nothing of a
 * regex literal, so the first quote or backtick inside one opened string mode
 * and ran until it found a partner — which was a doc-block, hundreds of lines
 * later. `src/init/allowlist.ts:63` and `src/sessions/git-rm.ts:37` each hold a
 * backtick inside a character class; between them they blanked 40 lines of live
 * code and left comment text standing in the files a rule was scanning. It also
 * blanked `${…}` substitutions, which are executable text: 32,347 characters
 * across 188 of 261 files, measured against this parse.
 *
 * Literal spans come from the AST, so a substitution falls outside every span
 * by construction rather than by a rule about braces. Comments come from every
 * TOKEN's trivia and not every node's: a comment before a closing brace is
 * leading trivia of the brace, and a node-only walk leaves 68 of them standing.
 * Lengths and newlines are preserved exactly as before, so line numbers hold.
 *
 * `typescript` is already a dependency here and `scripts/` sits in no ARCH-1
 * zone. The gate reports the same clean result it did before this change — the
 * instrument was repaired, not the standard.
 */
function mask(source: string, blankComments: boolean): string {
  const out = source.split("");
  const blank = (a: number, b: number): void => {
    for (let i = a; i < Math.min(b, out.length); i += 1) if (out[i] !== "\n") out[i] = " ";
  };
  const sf = ts.createSourceFile("m.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const seen = new Set<number>();
  const visit = (n: ts.Node): void => {
    const k = n.kind;
    if (k === ts.SyntaxKind.StringLiteral || k === ts.SyntaxKind.NoSubstitutionTemplateLiteral) blank(n.getStart(sf) + 1, n.end - 1);
    else if (k === ts.SyntaxKind.TemplateHead || k === ts.SyntaxKind.TemplateMiddle) blank(n.getStart(sf) + 1, n.end - 2);
    else if (k === ts.SyntaxKind.TemplateTail) blank(n.getStart(sf) + 1, n.end - 1);
    if (blankComments) {
      const full = n.getFullStart();
      if (!seen.has(full)) {
        seen.add(full);
        for (const r of ts.getLeadingCommentRanges(source, full) ?? []) blank(r.pos, r.end);
        for (const r of ts.getTrailingCommentRanges(source, full) ?? []) blank(r.pos, r.end);
      }
    }
    for (const c of n.getChildren(sf)) visit(c);
  };
  visit(sf);
  if (blankComments) for (const r of ts.getTrailingCommentRanges(source, sf.endOfFileToken.end) ?? []) blank(r.pos, r.end);
  return out.join("");
}

const TICKET_ID = /(PRDR-\d+|T-\d+|t-[\w-]+|[A-Z]{1,4}-\d+)/;

/** Every rule this gate can decide, applied to one file. */
export function violationsIn(rel: string, source: string): RuleViolation[] {
  const found: RuleViolation[] = [];
  const inSrc = rel.startsWith("src/");
  const isTest = rel.endsWith(".test.ts") || rel.startsWith("tests/");
  const scrubbed = withoutStringLiterals(source);
  const lines = scrubbed.split("\n");
  /**
   * Some rules must IGNORE string contents and some must READ them, and the
   * mask cannot serve both. `TODO` and `console.` are code constructs, so they
   * are matched on the masked line — a fixture containing either is data. An
   * import specifier and a skip's ticket citation live INSIDE strings, so they
   * are read from the raw line, gated on the masked line first: a real import
   * statement still begins with `import` after masking, whereas a string that
   * merely contains one collapses to spaces. Found by this file's own tests,
   * which caught all three rules reading the wrong text.
   */
  const rawLines = source.split("\n");
  const add = (line: number, rule: string, detail: string): void => {
    found.push({ file: rel, line, rule, detail });
  };

  /**
   * AGENTS.md §Files: no `helpers.ts`/`utils.ts` grab-bags in `src/`.
   *
   * Exactly the two names the rule states. An earlier version also flagged
   * `common`, `misc` and `shared`, which caught `src/schemas/common.ts` — a
   * file PRDR-132 deliberately created as the shared floor and which several
   * tickets name. Whether that file is a grab-bag is the "one module, one job"
   * judgement, and this gate does not make judgements: inventing a prohibition
   * the rules file does not state is how a checker starts lying about its own
   * authority. `tests/helpers.ts` is untouched — the rule says `src/`.
   */
  if (inSrc && /(^|\/)(helpers|utils)\.ts$/.test(rel)) {
    add(1, "files/no-grab-bags", `\`${path.basename(rel)}\` names a bucket, not a job — name the file after the thing it owns`);
  }

  lines.forEach((text, index) => {
    const line = index + 1;

    /**
     * AGENTS.md §Comments: a TODO without a ticket id does not merge.
     *
     * A MARKER, not the word: the marker form is the word followed by a colon,
     * optionally with a parenthesised id between them. Prose that mentions the
     * word is not a marker — the first version of this rule flagged its own
     * documentation twice, and the second flagged the sentence that described
     * the fix, which is why this one does not spell the marker out. Missing a
     * bare marker written without the colon is the harmless direction; a
     * checker that fires on prose trains people to ignore it.
     */
    if (/\bTODO\s*(?:\([^)]*\))?\s*:/.test(text) && !TICKET_ID.test(text)) {
      add(line, "comments/todo-needs-ticket", "a TODO carries the id of the ticket that will close it");
    }

    /** AGENTS.md §Errors: no `console.*` in `src/` — text flows through the caller's seams. */
    if (inSrc && /\bconsole\s*\.\s*\w+\s*\(/.test(text)) {
      add(line, "errors/no-console", "user-facing text flows through the caller's print/note/announce seam");
    }

    /** AGENTS.md §Tests: `.only`/`.skip` never merge; a kept skip carries its ticket id. */
    if (isTest && /\b(?:it|test|describe)\s*\.\s*only\s*[.(]/.test(text)) {
      add(line, "tests/no-only", "`.only` silently shrinks the suite to one case");
    }
    const raw = rawLines[index] ?? "";
    if (isTest && /\b(?:it|test|describe)\s*\.\s*skip\s*[.(]/.test(text) && !TICKET_ID.test(raw)) {
      add(line, "tests/skip-needs-ticket", "a skip that must stay names the ticket that will restore it");
    }

    /* A real import or export statement, not a string that quotes one. */
    if (!/^\s*(?:import|export)\b/.test(text)) return;

    /** AGENTS.md §Language: `node:`-prefixed builtins. */
    const builtin = /\bfrom\s+"(assert|buffer|child_process|crypto|events|fs|http|https|net|os|path|process|readline|stream|timers|tty|url|util|worker_threads|zlib)(?:\/[a-z]+)?"/.exec(raw);
    if (builtin !== null) {
      add(line, "language/node-protocol", `import "node:${builtin[1]}" — the prefix says it is a builtin, not a package`);
    }

    /** AGENTS.md §Language: explicit `.js` specifiers on relative imports (NodeNext). */
    const relative = /\bfrom\s+"(\.\.?\/[^"]*)"/.exec(raw);
    if (relative !== null) {
      const spec = relative[1] ?? "";
      if (!spec.endsWith(".js") && !spec.endsWith(".json")) {
        add(line, "language/explicit-js-specifier", `"${spec}" needs an explicit .js specifier under NodeNext resolution`);
      }
    }
  });

  /**
   * AGENTS.md §Errors: an empty `catch` carries a block comment saying why
   * swallowing is correct. Matched on the scrubbed source so a `catch` inside a
   * string cannot trigger it; a body holding only a `/* … *\/` block passes.
   */
  const emptyCatch = /catch\s*(?:\([^)]*\)\s*)?\{([^{}]*)\}/g;
  for (const match of scrubbed.matchAll(emptyCatch)) {
    const body = match[1] ?? "";
    if (body.trim() === "") {
      const line = scrubbed.slice(0, match.index).split("\n").length;
      add(line, "errors/empty-catch-needs-why", "an empty catch says why swallowing is correct, in a block comment");
    }
  }

  return found;
}

export function checkRules(root: string = ROOT): RuleViolation[] {
  const found: RuleViolation[] = [];
  for (const dir of ["src", "tests", "scripts"]) {
    const full = path.join(root, dir);
    try {
      statSync(full);
    } catch {
      /* A tree without one of these directories is not a violation; nothing to scan. */
      continue;
    }
    for (const file of sourceFiles(full)) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      found.push(...violationsIn(rel, readFileSync(file, "utf8")));
    }
  }
  return found;
}

/** What a green run of this gate does and does not mean. */
export const UNCHECKED_RULES: readonly string[] = [
  "no narration in comments — needs a reader",
  "one module, one job — needs a reader",
  "public data shapes are readonly; interfaces over type aliases — needs a reader",
  "no Date.now()/randomness in decision paths without an injectable seam — needs a reader",
  "every rule AGENTS.md marks [lint], which `npm run lint` owns",
];

function main(): number {
  const violations = checkRules();
  if (violations.length === 0) {
    process.stdout.write(
      `AGENTS.md: ${String(UNCHECKED_RULES.length)} rule families are not mechanically checkable and are not claimed here.\n` +
        "rules:check clean.\n",
    );
    return 0;
  }
  for (const v of violations) {
    process.stderr.write(`${v.file}:${String(v.line)}  [${v.rule}]  ${v.detail}\n`);
  }
  process.stderr.write(`\n${String(violations.length)} AGENTS.md violation(s). The rule text is in AGENTS.md; the fix is the rule.\n`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
