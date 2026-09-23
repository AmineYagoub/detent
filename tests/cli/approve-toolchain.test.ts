import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PRDR-276 — the toolchain question a terminal answers. Only an explicit yes
 * installs: the default for changing someone's machine is not changing it, so
 * an empty line, a typo and anything hedged all install nothing.
 *
 * The line reader is replaced, not the function: what is under test is how an
 * answer is read, and a real terminal is the one thing a suite cannot supply.
 */

const script: { answer: string; asked: string[]; closed: number } = { answer: "", asked: [], closed: 0 };

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: async (prompt: string): Promise<string> => {
      script.asked.push(prompt);
      return script.answer;
    },
    close: (): void => {
      script.closed += 1;
    },
  }),
}));

const { makeTtyToolchainApproval } = await import("../../src/cli/approve.js");

beforeEach(() => {
  script.asked = [];
  script.closed = 0;
});

async function answering(answer: string): Promise<boolean> {
  script.answer = answer;
  return await makeTtyToolchainApproval()("the setup message, already announced");
}

describe("PRDR-276 a terminal's answer to installing a toolchain", () => {
  it("asks once, with the default shown as no", async () => {
    await answering("y");
    expect(script.asked).toEqual(["\nInstall now? [y/N] "]);
    expect(script.closed, "the reader is released, whatever the answer").toBe(1);
  });

  it.each(["y", "yes", " Y ", "YES"])("installs on %j", async (answer) => {
    expect(await answering(answer)).toBe(true);
  });

  it.each(["", "n", "no", "sure", "yes please", "yy"])("installs nothing on %j", async (answer) => {
    expect(await answering(answer)).toBe(false);
  });
});
