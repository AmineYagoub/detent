import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * S-6‴ — the foundations a VALIDATE round hands its reviewers as their system
 * prompt, where the config's `review_foundations` is `given`.
 *
 * Every reviewer of a round reads the same foundations first (C-2¹⁴), each
 * into its own context, so each wrote them to the cache: on tabachir 24
 * documents and 198 KB, about 55K tokens a reviewer at $8 a million on Opus
 * 5.5. Handed as the system prompt, the same bytes for the whole round, they
 * are written by the round's first reviewers and read from the cache by the
 * rest. The text is built from the files alone, in the round's order, so
 * nothing that differs between reviewers is in it.
 *
 * Each document is under its path, its lines numbered as the Read tool
 * numbers them, so a reviewer quotes a handed line at its number as it would
 * a line it read.
 */

const HEADER =
  "The pack's foundations, handed alike to every reviewer of this round: each document whole, under its path, " +
  "with its lines numbered. They are what the files held when the round began.";

/** One document as the Read tool shows it: each line after its number and a tab. */
function numbered(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, i) => `${String(i + 1)}\t${line}`).join("\n");
}

export function foundationsPrompt(root: string, foundations: readonly string[]): string {
  const documents = foundations.map((rel) => `<document path="${rel}">\n${numbered(readFileSync(path.join(root, rel), "utf8"))}\n</document>`);
  return [HEADER, ...documents].join("\n\n");
}
