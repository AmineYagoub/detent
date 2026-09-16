import { describe, expect, it } from "vitest";
import { ClaudeCodeBackend } from "../../src/sessions/sdk.js";
import type { GuardPolicy } from "../../src/sessions/guard.js";

/**
 * S-5 (PRDR-260) — the pin comparison itself.
 *
 * Every other test of this gate stubs `checkVersion` and asserts against a
 * string the stub wrote: `tests/cli/pin-parity.test.ts`, `tests/cli/doctor.test.ts`
 * and `tests/kernel/run.test.ts:879` each overwrite it, and `MockBackend`'s is a
 * documented no-op. So the four CALL SITES are oracle-locked by
 * `tests/oracle/pin-parity.test.ts` while the decision they call had no coverage
 * at all — `installed.includes(pinned)` could be replaced with `if (false)` and
 * the suite stayed green. That is how a doc-block claiming `installed != pinned`
 * came to sit over a substring containment that passes for `2.1.2`.
 *
 * The probe is injected rather than mocked: this repository uses no module
 * mocking anywhere in `tests/`, and a seam is what let `queryFn` be exercised.
 */

const POLICY: GuardPolicy = { surface: ["**"], protectedGlobs: [], workRoot: "/wt" };

/** What the real CLI prints: a semver token and a banner, separated by a space. */
const backend = (reports: string): ClaudeCodeBackend =>
  new ClaudeCodeBackend({ policy: POLICY, versionProbe: () => reports });

/** `.catch()` on a `Promise<void>` widens to `void | Error`; the refusal is the point here. */
async function refusal(pending: Promise<void>): Promise<Error> {
  try {
    await pending;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected a refusal, got none");
}

describe("S-5 the pinned CLI version is compared, not merely contained", () => {
  it("accepts the version the project was verified against", async () => {
    await expect(backend("2.1.269 (Claude Code)").checkVersion("2.1.269")).resolves.toBeUndefined();
  });

  it("refuses a PREFIX of the installed version — the gate used to fail open", async () => {
    /**
     * `"2.1.2"`, `"1"` and `"Claude"` are all substrings of
     * `"2.1.269 (Claude Code)"`, and on HEAD all three were ACCEPTED: a
     * truncated or hand-typed pin silently disabled the gate on `cli/init`,
     * `cli/referee`, `kernel/run` and doctor's smoke. `src/kernel/worstcase.ts`
     * accepts any non-empty string as the pin, so nothing upstream caught it.
     */
    for (const pin of ["2.1.2", "2.1", "1", "Claude"]) {
      await expect(backend("2.1.269 (Claude Code)").checkVersion(pin), `pin ${pin} must refuse`).rejects.toThrow(/S-5/);
    }
  });

  it("refuses a real mismatch and says which file, which key, and what to set it to", async () => {
    const err = await refusal(backend("2.1.269 (Claude Code)").checkVersion("2.1.258"));

    expect(err.message).toContain("2.1.258");
    expect(err.message).toContain("2.1.269");
    expect(err.message).toContain(".detent/config.json");
    expect(err.message).toContain("pinned.claude_code");
    /** The banner is not the version; the operator must not be told to paste it. */
    expect(err.message).not.toContain("(Claude Code)");
  });

  it("names the `unknown` pin for what it is (PRDR-251)", async () => {
    const err = await refusal(backend("2.1.269 (Claude Code)").checkVersion("unknown"));
    expect(err.message).toContain("pins claude_code unknown");
  });

  it("an absent CLI is a different refusal, and still an S-5 one", async () => {
    const absent = new ClaudeCodeBackend({
      policy: POLICY,
      versionProbe: () => {
        throw new Error("ENOENT");
      },
    });
    await expect(absent.checkVersion("2.1.269")).rejects.toThrow(/not found on PATH.*2\.1\.269.*S-5/s);
  });

  it("a probe that returns the bare token with no banner still matches", async () => {
    await expect(backend("2.1.269").checkVersion("2.1.269")).resolves.toBeUndefined();
    await expect(backend("  2.1.269 \n").checkVersion("2.1.269")).resolves.toBeUndefined();
  });
});
