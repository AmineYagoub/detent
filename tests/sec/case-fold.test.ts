import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { guardToolUse, matchAny, type GuardPolicy } from "../../src/sessions/guard.js";
import { STRUCTURAL_PROTECTED } from "../../src/schemas/common.js";
import { removeTree, tmpTree } from "../helpers.js";

/** SEC-3 (PRDR-245) — the protected floor folds case; the surface does not. */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/**
 * SEC-3 (PRDR-245) — a protected path that does not exist yet is still protected.
 *
 * `realpathNearest` canonicalises only the EXISTING prefix of a path and rejoins
 * the rest lexically, which is what its doc-block promises. So when no part of a
 * protected path is on disk, the typed case reaches `matchAny` unchanged — and
 * `matchAny` was case-sensitive. On a case-insensitive filesystem the allowed
 * write then lands on the protected file.
 *
 * The fixture is shaped like a fresh per-ticket worktree, the default since
 * PRDR-145b: `.git/` exists, `.detent/` and `node_modules/` do not. `.git` is the
 * control — it is denied in either case today, because it exists and is therefore
 * canonicalised, which is what made the hole look closed.
 *
 * No resolver is injected. `docs/plan-audit-remediation.md` §5 retracted an
 * earlier report of this on the grounds that it was an artefact of an injected
 * identity resolver; this drives the production one.
 */
describe("SEC-3 a case variant of a protected path is protected", () => {
  const policyFor = (root: string): GuardPolicy => ({
    surface: ["**"],
    protectedGlobs: [...STRUCTURAL_PROTECTED],
    workRoot: root,
  });

  const decide = (root: string, rel: string): string =>
    guardToolUse("Write", { file_path: path.join(root, rel) }, policyFor(root)).decision;

  function freshWorktree(): string {
    const root = tmpTree({ "src/a.ts": "export const a = 1;\n" });
    mkdirSync(path.join(root, ".git"), { recursive: true });
    roots.push(root);
    return root;
  }

  it("denies a case variant of a protected path whose directory does not exist", () => {
    const root = freshWorktree();

    expect(decide(root, "node_modules/lodash/index.js"), "the control: exact case is protected").toBe("deny");
    expect(
      decide(root, "NODE_MODULES/lodash/index.js"),
      "writing a dependency is writing an executable the gate will run (PRDR-149)",
    ).toBe("deny");
    expect(decide(root, "Node_Modules/lodash/index.js"), "mixed case is the same file too").toBe("deny");

    expect(decide(root, ".detent/config.json"), "the control: exact case is protected").toBe("deny");
    expect(decide(root, ".DETENT/config.json"), "the config the run loads is immutable to sessions").toBe("deny");
  });

  it("still denies the variants whose directory DOES exist, which is why this looked closed", () => {
    const root = freshWorktree();

    expect(decide(root, ".git/hooks/pre-commit")).toBe("deny");
    expect(decide(root, ".GIT/hooks/pre-commit"), "canonicalised by realpathSync because .git exists").toBe("deny");
  });

  /**
   * Asserted on `matchAny` rather than through the guard, because the guard's
   * answer here is legitimately platform-dependent and must not be pinned: on a
   * case-insensitive filesystem `SRC/evil.ts` IS `src/evil.ts` once `src/`
   * exists, `realpathSync.native` folds it, and allowing it is correct — the
   * session is writing inside its surface. On Linux it is a different path and
   * is correctly denied. What must hold on BOTH is that the matcher itself does
   * not fold the grant direction.
   */
  it("does not fold the SURFACE side, so a pattern cannot be widened by case", () => {
    expect(matchAny("src/a.ts", ["src/**"]), "the control").toBe(true);
    expect(matchAny("SRC/evil.ts", ["src/**"]), "folding the grant direction would widen every surface").toBe(false);
    expect(matchAny("AGENTS.MD", ["AGENTS.md"]), "an exact surface entry is not folded either").toBe(false);
  });
});
