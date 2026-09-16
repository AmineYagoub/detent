import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PIN_CHECK_SITES } from "../../src/sessions/live.js";
import { codeOnly } from "../../scripts/check-rules.js";

/**
 * S-5 (PRDR-251) — every path that can spend checks the pinned CLI version.
 *
 * PRDR-181 added the check to `kernel/run.ts` and wrote the claim in the
 * present indicative: "the pinned CLI version is CHECKED, on the path that
 * runs". Two of the three spending entrypoints did not check it, and `doctor`
 * reported the pin as "checked at run time" on their behalf. Nothing detected
 * the gap, because a doc-block cannot be wrong in a way a test notices.
 *
 * So the claim is a map, and this is its oracle. Two properties, and the first
 * is the one that matters: the map must be TOTAL over the entrypoints that
 * actually obtain a live backend, derived from the tree rather than listed. A
 * fifth verb that builds one fails here until its row exists.
 */

const SRC = path.resolve(__dirname, "../../src");

/**
 * PRDR-172/179: comments AND string literals blanked, using the rules gate's
 * own scanner — so neither a doc-block nor a log message can vouch for code
 * that does not make the call. The same reasoning as the P6 budgets oracle,
 * which exists because both of those had already happened once.
 */
function code(rel: string): string {
  return codeOnly(readFileSync(path.join(SRC, `${rel}.ts`), "utf8"));
}

/** A module obtains a live backend if it constructs one or calls the builder. */
function buildsLiveBackend(rel: string): boolean {
  const text = code(rel);
  return text.includes("new ClaudeCodeBackend") || text.includes("buildLiveBackend");
}

describe("S-5 the pin check covers every spending entrypoint (ARCH-2)", () => {
  it("the map is total over the cli verbs that obtain a live backend", () => {
    const verbs = readdirSync(path.join(SRC, "cli"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `cli/${f.slice(0, -3)}`)
      .filter(buildsLiveBackend)
      .sort();
    expect(verbs, "a verb that can build a live backend needs a PIN_CHECK_SITES row").toEqual(
      Object.keys(PIN_CHECK_SITES).sort(),
    );
  });

  it("each named checker actually calls checkVersion, in code and not in prose", () => {
    for (const [entry, checker] of Object.entries(PIN_CHECK_SITES)) {
      expect(code(checker), `${entry}'s pin check is named as ${checker}, which never calls checkVersion`).toContain(
        "checkVersion(",
      );
    }
  });

  /**
   * The row that is not its own checker is the one worth asserting: `cli/run`
   * delegates, and the delegation is the claim. If `kernel/run.ts` ever stops
   * being reached from `cli/run.ts`, the row above still passes and this does
   * not.
   */
  it("cli/run delegates to the headless driver that holds its refusal", () => {
    expect(PIN_CHECK_SITES["cli/run"]).toBe("kernel/run");
    expect(code("cli/run")).toContain("run(");
    expect(code("cli/run")).not.toContain("checkVersion");
  });
});
