import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_SDK_PIN_SITES, PIN_CHECK_SITES } from "../../src/sessions/live.js";
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

/**
 * S-5 (PRDR-254) — the OTHER half of S-5's sentence, and why it refuses nowhere.
 *
 * `pinned.claude_code` is gated on all four spending paths. `pinned.agent_sdk`
 * is gated on none, and that is deliberate: it cannot move unless Detent moves,
 * and `docs/release-checklist.md` item 5 puts every SDK bump through the N-7
 * self-build before it ships, so S-5's vetting has already happened upstream by
 * the time a project sees it. Gating it would refuse every project initialised
 * before a Detent upgrade, since `ensureConfig` never rewrites an existing
 * config.
 *
 * Nothing said so, so PRDR-253's sweep read it as the gap PRDR-251 had just
 * closed three fields over. This is the claim, and this is its oracle.
 *
 * What this test proves: the map is TOTAL over the modules that mention the pin
 * in code, so a new reader anywhere in `src/` — destructured, renamed, wherever
 * — fails here until it declares its role. What it does NOT prove is that the
 * reporter does not refuse: a role string cannot check behaviour. That is held
 * by `tests/cli/doctor.test.ts`, which runs a mismatched SDK pin through
 * `doctor` and asserts the smoke session still happens.
 */
describe("S-5 the agent-sdk pin is advisory, and the tree says which sites touch it", () => {
  it("the map is total over the src modules that mention the pin in code", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : e.name.endsWith(".ts") ? [full] : [];
      });
    const mentions = walk(SRC)
      .filter((f) => codeOnly(readFileSync(f, "utf8")).includes("agent_sdk"))
      .map((f) => path.relative(SRC, f).split(path.sep).join("/").slice(0, -3))
      .sort();
    expect(mentions, "a module that touches the agent-sdk pin declares its role in AGENT_SDK_PIN_SITES").toEqual(
      Object.keys(AGENT_SDK_PIN_SITES).sort(),
    );
  });

  /**
   * One reporter, and it is `doctor`. Asserted separately from totality because
   * the counts are the claim: a second reporter is a second place an operator
   * could be told the pin matters, and a gate is not a reporter at all.
   */
  it("exactly one site reports the pin, and no site is named as gating on it", () => {
    const roles = Object.values(AGENT_SDK_PIN_SITES);
    expect(roles.filter((r) => r === "reporter")).toHaveLength(1);
    expect(AGENT_SDK_PIN_SITES["cli/doctor"]).toBe("reporter");
    expect(roles, "a gating role would contradict the claim above; changing it means revisiting PRDR-254").not.toContain("gate");
  });
});
