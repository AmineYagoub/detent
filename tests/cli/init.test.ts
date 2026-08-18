import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { main } from "../../src/cli/init.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * Port of the oracle's `test_extra.py::test_mode1_stub_detected` (T-060).
 *
 * The reference reads git-presence *as* the greenfield signal: a PRD-only
 * folder with no `.git` is "mode 1", and mode-1 bootstrap is a stub that just
 * prints a note and returns 2. Detent deliberately separates the two questions
 * the oracle conflates — C-1 requires a git root, and greenfield (D-10) is the
 * absence of *stack markers* inside a repo, decided later in ANALYZE. But the
 * behaviour this test guards survives the split intact: a PRD-only, non-git
 * folder is detected as not-a-runnable-project and `detent init` returns
 * EXIT_NOT_READY (2) rather than pretending it can build — exactly as the
 * oracle's mode 1 returned 2, and needing no live backend to say so.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

describe("T-060 mode-1 parity: a PRD-only, non-git folder is not a runnable project", () => {
  it("`detent init` on it returns exit 2 and creates no .detent/ (oracle test_mode1_stub_detected)", async () => {
    const root = tmpTree({ "PRD.md": "# product\n" });
    roots.push(root);

    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      // The oracle's exact scenario: PRD.md, no `.git`. It returned 2; so do we.
      expect(await main([root])).toBe(2);
      expect(err.mock.calls.join("")).toMatch(/not a git repository/);
    } finally {
      err.mockRestore();
    }

    // C-1's refusal is pure: nothing is written into the folder it declined.
    expect(existsSync(path.join(root, ".detent"))).toBe(false);
  });
});
