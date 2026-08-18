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
