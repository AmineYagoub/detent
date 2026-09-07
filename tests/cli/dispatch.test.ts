import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";

/** The `detent` dispatcher (C-3, C-14): a routing table, nothing more. */

describe("detent CLI dispatch", () => {
  it("no command prints usage and exits 2", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(await main([])).toBe(2);
      expect(out.mock.calls.join("")).toContain("detent <command>");
    } finally {
      out.mockRestore();
    }
  });

  it("--help exits 0 and lists both porcelain verbs plus the plumbing", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(await main(["--help"])).toBe(0);
      const text = out.mock.calls.join("");
      for (const verb of ["init", "run", "status", "report", "doctor", "approve", "requeue"]) {
        expect(text).toContain(verb);
      }
    } finally {
      out.mockRestore();
    }
  });

  it("an unknown command exits 2 with usage", async () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(await main(["frobnicate"])).toBe(2);
      expect(err.mock.calls.join("")).toContain("unknown command: frobnicate");
    } finally {
      err.mockRestore();
    }
  });

  it("init is wired to the pipeline and enforces C-1 root-only", async () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      /** /tmp is not a git repository: C-1's other branch, reported plainly. */
      const code = await main(["init", "/tmp"]);
      expect(code).toBe(2);
      expect(`${err.mock.calls.join("")}${out.mock.calls.join("")}`).toMatch(/git repository|git root/);
    } finally {
      err.mockRestore();
      out.mockRestore();
    }
  });
});

/**
 * PRDR-141 — routed, asserted at the DISPATCHER.
 *
 * `verifySync` was implemented, tested and documented since T-027 and absent
 * from `VERBS` the whole time, while `adapter/drift.ts` tells an operator to
 * run it to clear a drift halt. Every drift-blocked ticket was therefore stuck
 * behind an instruction that answered `unknown command`. Asserting through
 * `main` is the point: the function had tests, and the routing did not.
 */
describe("PRDR-141 the sanctioned drift recovery is reachable", () => {
  it("`detent verify` routes rather than answering `unknown command`", async () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      const code = await main(["verify"]);
      const text = err.mock.calls.join("") + out.mock.calls.join("");
      expect(text, "the dispatcher must know this verb").not.toContain("unknown command");
      expect(text).toContain("detent verify sync");
      expect(code).toBe(2);
    } finally {
      err.mockRestore();
      out.mockRestore();
    }
  });

  it("the usage banner and the README both name it, and now so does the table", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      await main(["--help"]);
      expect(out.mock.calls.join("")).toContain("verify");
    } finally {
      out.mockRestore();
    }
  });
});
