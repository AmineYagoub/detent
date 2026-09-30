import picomatch from "picomatch";

/**
 * SEC-3″ (PRDR-330) — the globs picomatch cannot be trusted to match.
 *
 * picomatch is the one glob engine (R-6), and it compiles a glob to a
 * backtracking regular expression. Every containment decision runs one: the
 * guard, on Detent's own event loop and in the plugin hook, the protected check
 * on a surface request, the B-4 risk gate, and the kernel's readers of a
 * surface. Three kinds of glob break that. Each is refused where a plan, a
 * config or a policy hands it over, and never matched:
 *
 * - one picomatch cannot compile. It then matches with `/$^/`, which matches
 *   nothing, so a protected glob would protect nothing. Its own ReDoS safeguard
 *   builds such a regex from a caught extglob that holds a backslash escape;
 * - one whose regex repeats a group that can match other than exactly one
 *   character. Rejecting a path then tries every way to split it: `+(*)`, four
 *   characters, holds the matcher 1.7 s at 25 characters of path, and twice as
 *   long for each one more. No release bounds it. 4.0.5's safeguard for
 *   GHSA-c2c7-rcm5-vvqj catches four shapes and misses `+(*)` and `+(a|b|ab)`,
 *   and a `+` after a group is a regex quantifier to picomatch, with extglobs
 *   on or off;
 * - one with an extglob picomatch reads as its own spelling, which that
 *   safeguard does from 4.0.4: `+(a|aa)` matches only a name spelled
 *   `+(a|aa)`, so a protected or `risk` glob written that way protects or
 *   gates less than it says. The safeguard's rewrite that keeps the meaning,
 *   `+(*(a)|*(b))` to `[ab]*`, is none of these, and passes.
 *
 * The verdict reads picomatch's own output, its errors, its regex and its
 * parse, rather than a second reading of its grammar, so it is about the regex
 * that will run; the exact pin (N-3) keeps the two in step. A glob is judged as
 * written and segment by segment, which is how a surface's package reach
 * (V-5′) compiles it. The guard's directory form, `<glob>/**`, is a prefix of
 * the glob and a globstar, a one-character step, so it repeats nothing new.
 */

/** Why picomatch cannot match `glob` safely and as written; null when it can. */
export function globHazard(glob: string): string | null {
  const known = verdicts.get(glob);
  if (known !== undefined) return known;
  const verdict = judged(glob);
  verdicts.set(glob, verdict);
  return verdict;
}

/** One verdict for each glob a process meets: a ticket is read many times, and its surface does not change. */
const verdicts = new Map<string, string | null>();

function judged(glob: string): string | null {
  const forms = new Set([glob, ...glob.split("/").filter((s) => s !== "" && s !== ".")]);
  for (const form of forms) {
    const hazard = formHazard(form);
    if (hazard === null) continue;
    const subject = form === glob ? `\`${glob}\`` : `\`${glob}\` has a segment, \`${form}\`, as a surface's package reach splits it, that`;
    return `${subject} ${hazard} (SEC-3″)`;
  }
  return null;
}

function formHazard(form: string): string | null {
  let source: string;
  try {
    source = picomatch.makeRe(form, { dot: true, debug: true }).source;
  } catch (err) {
    return `cannot be compiled by picomatch (${(err as Error).message}), which then matches nothing: write it so that it compiles`;
  }
  const spelled = literalExtglob(form);
  if (spelled !== null) {
    return spelled === form
      ? "is read by picomatch as its own spelling, not as an extglob, so it matches only a name spelled that way: write it without the repeated extglob"
      : `holds \`${spelled}\`, which picomatch reads as its own spelling, not as an extglob, so that part matches only a name spelled that way: write it without that repeated extglob`;
  }
  const group = repeatedGroup(source);
  if (group !== null) {
    return (
      `makes picomatch repeat \`${group}\`, a group that is not a single character, so rejecting a path means trying every way to ` +
      "split it among the repeats, a number that grows exponentially with the path's length: write alternatives as braces (`{a,b}`) " +
      "or globs of their own, and repeat single characters only"
    );
  }
  return null;
}

/**
 * The extglob picomatch's safeguard turned into text, or null. Its parse keeps
 * such an extglob as a `text` token whose output is its value escaped; the
 * rewrite that keeps the meaning leaves the rewrite there instead.
 */
function literalExtglob(form: string): string | null {
  const token = picomatch.parse(form).tokens.find((t) => t.type === "text" && /^[*+]\(/u.test(t.value) && String(t.output) === escaped(t.value));
  return token?.value ?? null;
}

/** picomatch's own escaping (`utils.escapeRegex`): regex specials, and not the backslash. */
const escaped = (text: string): string => text.replace(/[-*+?.^${}(|)[\]]/gu, "\\$&");

/*
 * ---------------------------------------------------------------------------
 * The repeated groups of a regex source, as picomatch writes one.
 */

/** What a piece of a regex matches: nothing (an anchor, a lookaround), exactly one character, or anything else. */
type Width = "none" | "one" | "more";

interface Read {
  readonly end: number;
  readonly width: Width;
  /** The first group inside that is repeated over more than one character, as written. */
  readonly hazard: string | null;
}

/**
 * The first group `source` repeats (a maximum above one) whose body matches
 * other than exactly one character, as written; null when there is none.
 * Anchors and lookarounds match no character, so the globstar's step,
 * `(?:(?!…).)*?`, is one character. Alternation or a quantifier inside is more.
 * Lookarounds are read too, since backtracking inside one is still
 * backtracking.
 */
export function repeatedGroup(source: string): string | null {
  return alternatives(source, 0).hazard;
}

/** From `at` to the `)` that closes it, or the end. */
function alternatives(src: string, at: number): Read {
  let i = at;
  let branches = 1;
  let width: Width = "none";
  let hazard: string | null = null;
  while (i < src.length && src[i] !== ")") {
    if (src[i] === "|") {
      branches += 1;
      i += 1;
      continue;
    }
    const piece = atom(src, i);
    hazard ??= piece.hazard;
    const q = quantifier(src, piece.end);
    if (q !== null && q.many && piece.group && piece.width !== "one") hazard ??= src.slice(i, piece.end + q.length);
    width = joined(width, q === null || piece.width === "none" ? piece.width : "more");
    i = piece.end + (q?.length ?? 0);
  }
  return { end: i, width: branches > 1 ? "more" : width, hazard };
}

const joined = (a: Width, b: Width): Width => (a === "none" ? b : b === "none" ? a : "more");

/** One atom at `at`: a group, a class, an escape, an anchor or a character. */
function atom(src: string, at: number): Read & { readonly group: boolean } {
  const c = src[at];
  if (c === "(") {
    const head = /^\((?:\?(?:[:=!]|<[=!]|<[A-Za-z_$][\w$]*>))?/u.exec(src.slice(at))?.[0] ?? "(";
    const inner = alternatives(src, at + head.length);
    const around = /^\(\?<?[=!]/u.test(head);
    return { end: src[inner.end] === ")" ? inner.end + 1 : inner.end, width: around ? "none" : inner.width, group: !around, hazard: inner.hazard };
  }
  if (c === "[") {
    let j = at + 1;
    if (src[j] === "^") j += 1;
    while (j < src.length && src[j] !== "]") j += src[j] === "\\" ? 2 : 1;
    return { end: j + 1, width: "one", group: false, hazard: null };
  }
  if (c === "\\") {
    const next = src[at + 1] ?? "";
    return { end: at + 2, width: next === "b" || next === "B" ? "none" : /[1-9]/u.test(next) ? "more" : "one", group: false, hazard: null };
  }
  return { end: at + 1, width: c === "^" || c === "$" ? "none" : "one", group: false, hazard: null };
}

/** The quantifier at `at`, if any: its length, and whether it lets its atom repeat. */
function quantifier(src: string, at: number): { readonly length: number; readonly many: boolean } | null {
  const q = /^(?:([*+?])|\{(\d+)(?:(,)(\d*))?\})\??/u.exec(src.slice(at));
  if (q === null) return null;
  const [text, symbol, low, comma, high] = q;
  const many = symbol !== undefined ? symbol !== "?" : comma === undefined ? Number(low) > 1 : high === "" || Number(high) > 1;
  return { length: text.length, many };
}
