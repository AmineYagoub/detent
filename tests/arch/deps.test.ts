import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";

/**
 * T-003 — ARCH-1 dependency-direction lint (D-19).
 *
 * The boundary is a normative requirement with a CI lint, not a stylistic
 * preference. These fixtures are linted through the real config so the test
 * fails if the zones are ever loosened.
 */
const cwd = path.resolve(import.meta.dirname, "../..");
const eslint = new ESLint({ cwd });

async function messagesFor(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(cwd, filePath) });
  return (result?.messages ?? []).map((m) => m.message);
}

describe("ARCH-1 dependency direction", () => {
  it("src/kernel/** may not import the session backend SDK", async () => {
    const msgs = await messagesFor(
      "src/kernel/__arch_fixture__.ts",
      `import { query } from "@anthropic-ai/claude-agent-sdk";\nexport const q = query;\n`,
    );
    expect(msgs.join(" ")).toContain("ARCH-1");
  });

  it("src/kernel/** may not reach into src/sessions internals", async () => {
    const msgs = await messagesFor(
      "src/kernel/__arch_fixture__.ts",
      `import { thing } from "../sessions/sdk.js";\nexport const t = thing;\n`,
    );
    expect(msgs.join(" ")).toContain("ARCH-1");
  });

  it("src/kernel/** MAY import the SessionBackend interface — the one sanctioned seam", async () => {
    const msgs = await messagesFor(
      "src/kernel/__arch_fixture__.ts",
      `import type { SessionBackend } from "../sessions/backend.js";\nexport type B = SessionBackend;\n`,
    );
    expect(msgs.filter((m) => m.includes("ARCH-1"))).toEqual([]);
  });

  it("src/sessions/** may not apply events or import ticket mutators", async () => {
    const applyMsgs = await messagesFor(
      "src/sessions/__arch_fixture__.ts",
      `import { apply } from "../kernel/machine.js";\nexport const a = apply;\n`,
    );
    expect(applyMsgs.join(" ")).toContain("ARCH-1");

    const mutMsgs = await messagesFor(
      "src/sessions/__arch_fixture__.ts",
      `import { save } from "../kernel/tickets/mutations.js";\nexport const s = save;\n`,
    );
    expect(mutMsgs.join(" ")).toContain("ARCH-1");
  });

  it("the zones are scoped: the same import is fine outside src/kernel", async () => {
    const msgs = await messagesFor(
      "src/sessions/__arch_fixture__.ts",
      `import { query } from "@anthropic-ai/claude-agent-sdk";\nexport const q = query;\n`,
    );
    expect(msgs.filter((m) => m.includes("ARCH-1"))).toEqual([]);
  });
});
