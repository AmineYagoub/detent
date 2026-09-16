/**
 * X-1 (PRDR-249) — the complete JSON objects a crash glued onto a torn line.
 *
 * `appendLedger` writes `JSON.stringify(row) + "\n"`, so a line torn mid-append
 * has no trailing newline and the NEXT append concatenates onto it. PRDR-151
 * established that such a line is skipped rather than fatal — refusing one
 * bricked a root, forever, with no repair instruction — and that stands. What
 * PRDR-151 got wrong was the size of the loss: it recorded "at most the row
 * glued to the torn one", and a tear at the record separator leaves TWO complete
 * rows on one line, both of which `JSON.parse` rejects for trailing content.
 *
 * This recovers what was fully written. The torn fragment itself is never
 * recovered: its bytes stopped mid-flight and its cost is genuinely unknown.
 *
 * Its own module because it is a pure string fact with no ledger vocabulary in
 * it, and because the shapes are fiddly enough to deserve their own tests rather
 * than only the ledger totals they feed.
 */

/** Beyond this many candidate starts a line is pathological, not a crash artifact. */
const MAX_FALLBACK_ATTEMPTS = 64;

function parseOrNull(text: string): { readonly value: unknown } | null {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    /* not an object boundary — the caller tries the next candidate */
    return null;
  }
}

/**
 * Two passes, because the two glue shapes need different handling.
 *
 * A balanced scan finds every object that both opens and closes on the line,
 * which is `<row A><row B>`. It is useless for `<fragment><row B>` when the
 * fragment died inside a string, because the unterminated quote makes every
 * later brace read as string content — so the fallback parses from each `{`
 * right to left and takes the first that consumes the whole remainder.
 */
export function recoverObjects(line: string): unknown[] {
  const found: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const parsed = parseOrNull(line.slice(start, i + 1));
        if (parsed !== null) found.push(parsed.value);
        start = -1;
      }
    }
  }
  if (found.length > 0) return found;

  const starts: number[] = [];
  for (let i = 0; i < line.length; i += 1) if (line[i] === "{") starts.push(i);
  for (const i of starts.reverse().slice(0, MAX_FALLBACK_ATTEMPTS)) {
    const parsed = parseOrNull(line.slice(i));
    if (parsed !== null) return [parsed.value];
  }
  return [];
}
