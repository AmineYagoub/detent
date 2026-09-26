/**
 * PRDR-287, PRDR-288, PRDR-278 — how `detent-prd-v3.md` defines a requirement
 * mark, read one way by every docs test that asks.
 *
 * A definition is a bold id at the head of a bullet — one id, ids joined by
 * `/`, or a range joined by `…` — or a decision-log row, or a bold id followed
 * at once by its release in parentheses anywhere in a line, which is how the
 * inherited §5 bullet defines F-1′. A bold sentence that merely OPENS with an
 * id cites it: D-29's row opens "**D-22 splits by driver.**" and defines
 * nothing.
 *
 * One parser, because two readings of one question drift apart: PRDR-287's
 * uniqueness test and PRDR-278's amendment test must agree on what the PRD
 * defines, or one of them passes on a mark the other cannot see.
 */
const MARK = "[′″‴⁗⁰¹²³⁴⁵⁶⁷⁸⁹]*";
const ONE = `(?:[A-Z]{1,4}-\\d+[a-z]?|P\\d+)${MARK}`;
const LEAD = new RegExp(`^(${ONE}(?:\\s*[/…]\\s*${ONE})*)(?=$|[\\s.:(])`, "u");
const INLINE = new RegExp(`^(${ONE}) \\((?:draft\\.\\d+|\\d+\\.\\d+(?:\\.\\d+)?)[,)]`, "u");
const ROW = new RegExp(`^\\|\\s*(D-\\d+${MARK})\\s*\\|`, "u");
const PARTS = new RegExp(`^([A-Z]{1,4}-)(\\d+)(${MARK})$`, "u");
const BULLET = /^\s*[-*]\s+\*\*([^*]+?)\*\*/u;

/** `C-9′…C-13′` names five marks, and a reader looking up C-12′ lands on it. */
function expand(part: string): string[] {
  const [from, to] = part.split("…");
  if (from === undefined || to === undefined) return [part];
  const a = PARTS.exec(from.trim());
  const b = PARTS.exec(to.trim());
  if (a === null || b === null || a[1] !== b[1] || a[3] !== b[3]) return [from.trim(), to.trim()];
  const [lo, hi] = [Number(a[2]), Number(b[2])];
  return Array.from({ length: hi - lo + 1 }, (_, i) => `${a[1] ?? ""}${String(lo + i)}${a[3] ?? ""}`);
}

/** The marks one line defines, each with the bold head that defines it. */
function defined(line: string): { id: string; head: string }[] {
  const out: { id: string; head: string }[] = [];
  const row = ROW.exec(line);
  if (row?.[1] !== undefined) out.push({ id: row[1], head: `${row[1]} (decision log)` });
  const bullet = BULLET.exec(line);
  const lead = bullet?.[1] === undefined ? null : LEAD.exec(bullet[1]);
  if (bullet?.[1] !== undefined && lead?.[1] !== undefined) {
    for (const id of lead[1].split(/\s*\/\s*/u).flatMap(expand)) out.push({ id, head: bullet[1] });
  }
  for (const span of line.matchAll(/\*\*([^*]+?)\*\*/gu)) {
    if (bullet !== null && span.index === bullet[0].indexOf("**")) continue;
    const inline = INLINE.exec(span[1] ?? "");
    if (inline?.[1] !== undefined) out.push({ id: inline[1], head: span[1] ?? "" });
  }
  return out;
}

/** Every mark the PRD defines, with the bold head of each definition that names it, in document order. */
export function definitions(text: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    for (const { id, head } of defined(line)) {
      found.set(id, [...(found.get(id) ?? []), head.replace(/[.:]$/u, "").trim()]);
    }
  }
  return found;
}

/**
 * The whole text of each definition of `mark`: its line and every line after
 * it up to a blank line, the next top-level bullet, a heading or a table row.
 * §4's bullets are separated by blank lines and §8's are not, so the next
 * top-level bullet ends a definition as surely as a blank line does. A
 * decision-log row is its one line.
 */
export function definitionText(text: string, mark: string): string[] {
  const lines = text.split("\n");
  const found: string[] = [];
  lines.forEach((line, i) => {
    if (!defined(line).some(({ id }) => id === mark)) return;
    if (ROW.test(line)) {
      found.push(line);
      return;
    }
    const block = [line];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() === "" || /^[-*] |^#|^\|/u.test(next)) break;
      block.push(next);
    }
    found.push(block.join("\n"));
  });
  return found;
}
