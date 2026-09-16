import { afterEach, describe, expect, it, vi } from "vitest";
import { main as initMain } from "../../src/cli/init.js";
import { main as refereeMain } from "../../src/cli/referee.js";
import { MockBackend } from "../../src/sessions/mock.js";
import type { SessionBackend } from "../../src/sessions/backend.js";
import { acquireRunLock } from "../../src/kernel/run-lock.js";
import { removeTree } from "../helpers.js";
import { makeRunRepo } from "../kernel/run-fixture.js";

/**
 * S-5 (PRDR-251) — the pinned CLI version is checked on every path that spends.
 *
 * PRDR-181 wrote the rule into `kernel/run.ts` as "the pinned CLI version is
 * CHECKED, on the path that runs", and wired it to that one driver. Detent has
 * three entrypoints that can spend: `run` (headless), `referee` (the plugin's
 * MCP driver), and `init` — the one verb with no fixture path at all, whose
 * sessions are the first genuinely billed ones in a project's life. Two of the
 * three verified nothing, while `doctor` reported the pin as "checked at run
 * time".
 *
 * The fixture's config pins `2.1.191`, so the value asserted below is the one
 * the config carries and not a constant this test invented.
 */

const PINNED = "2.1.191";
const MISMATCH = `backend version mismatch (S-5): pinned=${PINNED} installed=9.9.9`;

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
  vi.unstubAllEnvs();
});

function refusing(seen: string[]): SessionBackend {
  /* Typed as the interface, whose `checkVersion` takes the pin — `MockBackend` declares it without the parameter. */
  const backend: SessionBackend = new MockBackend();
  backend.checkVersion = async (pinned: string): Promise<void> => {
    seen.push(pinned);
    throw new Error(MISMATCH);
  };
  return backend;
}

function accepting(seen: string[]): SessionBackend {
  const backend: SessionBackend = new MockBackend();
  backend.checkVersion = async (pinned: string): Promise<void> => {
    seen.push(pinned);
  };
  return backend;
}

describe("S-5 `detent init` verifies the pinned backend version before it spends", () => {
  it("refuses a pin mismatch, names it, and never launches", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    /* The live-auth probe is not what this test is about: PRDR-158's trap. */
    vi.stubEnv("DETENT_NO_LIVE", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-fixture");

    const seen: string[] = [];
    const backend = refusing(seen);
    let launched = 0;
    backend.run = async () => {
      launched += 1;
      throw new Error("a refused pin must not reach a session");
    };

    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    let code: number;
    let said: string;
    try {
      code = await initMain([root], { buildBackend: () => backend });
    } finally {
      /* `mockRestore` resets the recorded calls, so the text is taken first. */
      said = err.mock.calls.join("");
      err.mockRestore();
      out.mockRestore();
    }

    expect(code, "a pin mismatch is a precondition failure (C-11 exit 2), not a crash").toBe(2);
    expect(said, "and it names the mismatch").toContain("pinned=");
    expect(seen, "the pin comes from the config init just loaded, not a constant").toEqual([PINNED]);
    expect(launched, "nothing may launch behind a failed precondition").toBe(0);
  }, 60_000);

  it("a matching pin is read from config and does not refuse (the control)", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    vi.stubEnv("DETENT_NO_LIVE", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-fixture");

    const seen: string[] = [];
    const backend = accepting(seen);
    backend.run = async () => {
      throw new Error("SENTINEL past the pin gate");
    };

    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    let said: string;
    try {
      await initMain([root], { buildBackend: () => backend });
    } finally {
      said = err.mock.calls.join("");
      err.mockRestore();
      out.mockRestore();
    }

    expect(seen, "the check ran, against the config's pin").toEqual([PINNED]);
    expect(said, "and said nothing about a mismatch").not.toContain("pinned=");
  }, 60_000);
});

describe("S-5 the plugin referee verifies the pin too (ARCH-2 driver parity)", () => {
  it("refuses a pin mismatch before the run lock, so the refusal touches nothing", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);

    const seen: string[] = [];
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    let code: number;
    let said: string;
    try {
      code = await refereeMain(["--root", root], { buildBackend: () => refusing(seen) });
    } finally {
      said = err.mock.calls.join("");
      err.mockRestore();
    }

    expect(code, "the MCP driver refuses on the same terms as the headless one").toBe(2);
    expect(said).toContain("pinned=");
    expect(seen).toEqual([PINNED]);

    /**
     * PRDR-181 placed the lock "after the preconditions above so a refusal
     * touches nothing". A lock left behind here would be a stale lock the next
     * referee has to break, so the property is asserted rather than assumed.
     */
    const lock = acquireRunLock(root);
    expect(lock.ok, "a refused referee must leave no run lock behind").toBe(true);
    if (lock.ok) {
      expect(lock.brokeStale, "and none to break").toBe(null);
      lock.release();
    }
  }, 60_000);
});
