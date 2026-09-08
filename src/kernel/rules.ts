import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The repository's own engineering rules, as a session is told them.
 *
 * AGENTS.md's header states the file is fed "to every session Detent
 * launches", and for the planning pipeline that was false: `src/init/session.ts`
 * declared `rulesText` and consumed it, `src/init/pipeline.ts` never supplied
 * it, and ANALYZE, SLICE, PLAN and the plan reviews were prompted with the
 * literal `(no rules file)` (PRDR-176). This lived as a private function inside
 * `referee-context.ts`, which is why the init side could not reach it without
 * importing a module ten times its size.
 *
 * `CLAUDE.md` is honoured as the second name because a repository Detent is
 * pointed at may use that convention rather than this one.
 */
export const RULES_FILENAMES: readonly string[] = ["AGENTS.md", "CLAUDE.md"];

/** What a session is told the rules are; the absence marker when there are none. */
export const NO_RULES = "(no rules file)";

export function readRules(root: string): string {
  for (const name of RULES_FILENAMES) {
    const file = path.join(root, name);
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  return NO_RULES;
}
