import { describe, expect, it } from "vitest";
import { makeTtyDecisions, readReply, renderScreen, type DecideIo } from "../../src/cli/decide.js";
import type { AskedQuestion } from "../../src/init/decide.js";

/**
 * PRDR-282 — DECIDE's questions on a terminal (C-3⁗): a screen of at most
 * four, answered by an option's number, the founder's own words where the
 * question takes them, or `l` to answer later.
 */

const PRICE: AskedQuestion = {
  number: 1,
  question: "Is borrowing free at launch?",
  why_asked: "It is the product's price.",
  options: [
    { answer: "Free in the MVP", consequence: "No revenue until pricing lands." },
    { answer: "Two dollars a day", consequence: "The payment rail ships with the MVP." },
  ],
  ownAllowed: true,
};
const HOST: AskedQuestion = { ...PRICE, number: 2, question: "Which hosting contract?", ownAllowed: false };

/** A terminal that replies from a script, and keeps everything it was told. */
function scripted(replies: string[]): { io: () => DecideIo; out: string[]; prompts: string[]; closed: () => number } {
  const out: string[] = [];
  const prompts: string[] = [];
  let closed = 0;
  return {
    io: () => ({
      question: async (prompt) => {
        prompts.push(prompt);
        return replies.shift() ?? "l";
      },
      write: (text) => out.push(text),
      close: () => {
        closed += 1;
      },
    }),
    out,
    prompts,
    closed: () => closed,
  };
}

describe("PRDR-282: a DECIDE screen", () => {
  it("shows each question, why it is the founder's, and its options, the recommended one first", () => {
    const text = renderScreen([PRICE, HOST]);
    expect(text).toContain("Questions only you can answer (C-3″), 1–2.");
    expect(text).toContain("  1. Is borrowing free at launch?\n     why it is yours: It is the product's price.");
    expect(text).toContain("     1) Free in the MVP (recommended) — No revenue until pricing lands.");
    expect(text).toContain("     2) Two dollars a day — The payment rail ships with the MVP.");
    expect(text.match(/\(recommended\)/gu)).toHaveLength(2);
    expect(text).toContain("docs/founder-decisions.md");
  });

  it("reads a number in range as an option, `l` as later, and words as the founder's own where they are taken", () => {
    expect(readReply(" 2 ", PRICE)).toEqual({ option: 1 });
    expect(readReply("L", PRICE)).toBe("later");
    expect(readReply("later", PRICE)).toBe("later");
    expect(readReply("Only members pay.", PRICE)).toEqual({ own: "Only members pay." });
    for (const none of ["", "   ", "0", "3", "12"]) expect(readReply(none, PRICE), JSON.stringify(none)).toBeNull();
    expect(readReply("Our own server", HOST), "the stack's question takes no own words").toBeNull();
  });
});

describe("PRDR-282: the terminal asker", () => {
  it("asks each question of the screen, asks again after a reply that is not an answer, and closes the terminal", async () => {
    const t = scripted(["", "7", "2", "Our own server", "1"]);
    const answers = await makeTtyDecisions(t.io)([PRICE, HOST]);
    expect(answers).toEqual([{ option: 1 }, { option: 0 }]);
    expect(t.prompts[0]).toBe("\n1: [1-2], your own answer, or [l]ater ");
    expect(t.prompts.at(-1)).toBe("\n2: [1-2], or [l]ater ");
    expect(t.out.join("")).toContain("(answer with an option's number, 1-2, your own words, or l)");
    expect(t.out.join("")).toContain("(this question settles the stack, so answer with an option's number, 1-2, or l)");
    expect(t.closed()).toBe(1);
  });

  it("defers every question on `l`, and still closes the terminal", async () => {
    const t = scripted(["1", "l"]);
    expect(await makeTtyDecisions(t.io)([PRICE, HOST])).toBe("later");
    expect(t.closed()).toBe(1);
  });
});
