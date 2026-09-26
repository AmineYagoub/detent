import { createInterface } from "node:readline/promises";
import type { AskedQuestion, DecideAnswer, DecideAsk } from "../init/decide.js";
import { DECISION_LOG_PATH } from "../schemas/pack.js";

/**
 * C-3⁗ (PRDR-282): DECIDE's questions, asked on a terminal, one screen of at
 * most four at a time. Each question says why it is the founder's, then its
 * options, the recommended one first, each with what choosing it means.
 *
 * An answer is an option's number, the founder's own words where the question
 * takes them, or `l` to answer later, which defers every question: DECIDE then
 * writes nothing and `init` stops at AWAIT_INFO. An empty line is asked again
 * rather than read as the recommendation, since what this records is the
 * founder's decision, and an Enter pressed in passing is not one.
 */

/** The terminal, as the asker uses it; a test hands in a scripted one. */
export interface DecideIo {
  readonly question: (prompt: string) => Promise<string>;
  readonly write: (text: string) => void;
  readonly close: () => void;
}

function stdio(): DecideIo {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    question: async (prompt) => await rl.question(prompt),
    write: (text) => process.stdout.write(text),
    close: () => {
      rl.close();
    },
  };
}

export function renderScreen(screen: readonly AskedQuestion[]): string {
  const first = screen[0]?.number ?? 0;
  const last = screen.at(-1)?.number ?? first;
  return [
    "",
    `Questions only you can answer (C-3″), ${first === last ? String(first) : `${String(first)}–${String(last)}`}. ` +
      `Each answer is written to ${DECISION_LOG_PATH} as a decision.`,
    ...screen.flatMap((q) => [
      "",
      `  ${String(q.number)}. ${q.question}`,
      `     why it is yours: ${q.why_asked}`,
      ...q.options.map((o, i) => `     ${String(i + 1)}) ${o.answer}${i === 0 ? " (recommended)" : ""} — ${o.consequence}`),
    ]),
    "",
  ].join("\n");
}

/** One reply read as an answer; null when it is none, and the question is asked again. */
export function readReply(reply: string, q: AskedQuestion): DecideAnswer | "later" | null {
  const text = reply.trim();
  if (text === "") return null;
  if (/^l(?:ater)?$/iu.test(text)) return "later";
  if (/^\d+$/u.test(text)) {
    const n = Number(text);
    return n >= 1 && n <= q.options.length ? { option: n - 1 } : null;
  }
  return q.ownAllowed ? { own: text } : null;
}

export function makeTtyDecisions(open: () => DecideIo = stdio): DecideAsk {
  return async (screen) => {
    const io = open();
    try {
      io.write(renderScreen(screen));
      const answers: DecideAnswer[] = [];
      for (const q of screen) {
        const range = `1-${String(q.options.length)}`;
        const prompt = `\n${String(q.number)}: [${range}]${q.ownAllowed ? ", your own answer" : ""}, or [l]ater `;
        for (;;) {
          const answer = readReply(await io.question(prompt), q);
          if (answer === "later") return "later";
          if (answer !== null) {
            answers.push(answer);
            break;
          }
          io.write(
            q.ownAllowed
              ? `  (answer with an option's number, ${range}, your own words, or l)\n`
              : `  (this question settles the stack, so answer with an option's number, ${range}, or l)\n`,
          );
        }
      }
      return answers;
    } finally {
      io.close();
    }
  };
}
