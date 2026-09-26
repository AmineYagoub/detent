import type { DecideQuestion } from "../schemas/decide.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";

/**
 * C-2¹² (PRDR-282) — what DECIDE tells the operator: what it asked and
 * settled, each recommended answer it took without asking (specification
 * decision 9 says so in `init`'s output), and what it could not sort.
 */

export interface DecideRun {
  readonly asked: readonly string[];
  readonly defaulted: readonly string[];
  readonly recommended: readonly string[];
  /** The log's entries the session cited as already settling an item. */
  readonly cited: readonly string[];
  readonly unsorted: readonly { readonly id: string; readonly kind: string; readonly summary: string }[];
}

const count = (n: number, noun: string, plural = `${noun}s`): string => `${String(n)} ${n === 1 ? noun : plural}`;
const ids = (list: readonly string[]): string => (list.length === 0 ? "" : ` (${[...new Set(list)].join(", ")})`);
const LISTED = 10;

export function decideNotes(run: DecideRun, questions: readonly DecideQuestion[], defaults: readonly { readonly id: string; readonly value: string }[]): string[] {
  const notes = [
    `DECIDE sorted what AUDIT left open: ${count(run.asked.length, "question")} asked and answered${ids(run.asked)}, ` +
      `${count(run.defaulted.length + run.recommended.length, "default")} settled without asking${ids([...run.defaulted, ...run.recommended])}, ` +
      `and ${count(new Set(run.cited).size, "entry", "entries")} the decision log already held${ids(run.cited)}. A default is vetoable: edit its ` +
      `row in ${DECISION_LOG_PATH} and re-run \`detent init\` (C-3⁗).`,
  ];
  if (run.recommended.length > 0) {
    const taken = run.recommended.map((id, n) => `    - ${id}: ${questions[n]?.question ?? ""} → ${defaults.find((d) => d.id === id)?.value ?? ""}`);
    const more = taken.length > LISTED ? [`    and ${String(taken.length - LISTED)} more, in ${DECISION_LOG_PATH}`] : [];
    notes.push(
      [
        `DECIDE took the recommended answer to ${count(run.recommended.length, "question")} without asking, since off a ` +
          "terminal nobody can be asked (specification decision 9). Each is a vetoable default:",
        ...taken.slice(0, LISTED),
        ...more,
      ].join("\n"),
    );
  }
  if (run.unsorted.length > 0) {
    notes.push(
      `DECIDE left ${count(run.unsorted.length, "item")} unsorted after its relaunch, so planning goes on from the documents ` +
        `as written for ${run.unsorted.length === 1 ? "it" : "them"} (C-2¹²): ${run.unsorted.map((i) => `${i.id} (${i.kind}) ${i.summary}`).join("; ")}`,
    );
  }
  return notes;
}

/** AWAIT_INFO at DECIDE: every question, with its options and what each means, and the two ways to answer. */
export function deferredMessage(questions: readonly DecideQuestion[]): string {
  return [
    `DECIDE has ${count(questions.length, "question")} only the founder can answer (C-3″), and the answers were deferred. ` +
      "Nothing was written to the decision log.",
    ...questions.flatMap((q, n) => [
      "",
      `  ${String(n + 1)}. ${q.question}`,
      `     why it is yours: ${q.why_asked}`,
      ...q.options.map((o, i) => `     ${String(i + 1)}) ${o.answer}${i === 0 ? " (recommended)" : ""} — ${o.consequence}`),
    ]),
    "",
    "To answer, re-run `detent init` on a terminal. Or write each answer as a row under `## Decisions` in " +
      `${DECISION_LOG_PATH} (| D-n | the question | the answer | the reason |) and re-run \`detent init\`: a question the ` +
      "log answers is not asked again (C-3⁗).",
  ].join("\n");
}
