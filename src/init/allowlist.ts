/**
 * T-065 — the setup-command allowlist (C-6a, D-15).
 *
 * A closed, versioned template set held as **data**: extending it is a spec
 * PR, not a code change someone slips in. Anything outside the set is never
 * executed by Detent, even with consent — it is printed with rationale for
 * the user to run in their own shell, after which re-running `init` resumes
 * from checkpoint.
 *
 * The templates are deliberately narrow. Each one either establishes a
 * repository (`git init`) or lets an ecosystem's own tool mediate a
 * dependency change — never a direct edit to a manifest, which C-6's third
 * rule forbids outright.
 */

type AllowlistCategory = "repository" | "dependency-install" | "config-create";

export interface CommandTemplate {
  readonly id: string;
  readonly category: AllowlistCategory;
  /** Anchored: a template matches a whole command, never a prefix of one. */
  readonly pattern: RegExp;
  readonly description: string;
}

/**
 * v1's closed set. `pip install` and friends accept a package argument;
 * everything else is fixed. No template admits a shell metacharacter — that
 * is what keeps "matches a template" from meaning "starts with something
 * familiar and then does whatever it likes".
 */
export const COMMAND_TEMPLATES: readonly CommandTemplate[] = [
  { id: "git-init", category: "repository", pattern: /^git init$/, description: "initialize a git repository (C-1)" },
  { id: "npm-install", category: "dependency-install", pattern: /^npm install$/, description: "install node dependencies" },
  { id: "npm-ci", category: "dependency-install", pattern: /^npm ci$/, description: "install node dependencies from the lockfile" },
  { id: "pnpm-install", category: "dependency-install", pattern: /^pnpm install$/, description: "install node dependencies" },
  { id: "yarn-install", category: "dependency-install", pattern: /^yarn install$/, description: "install node dependencies" },
  {
    id: "npm-install-package",
    category: "dependency-install",
    pattern: /^npm install (?:--save-dev |-D )?[@a-z0-9._/-]+$/i,
    description: "install a named node package through npm",
  },
  {
    id: "pip-install",
    category: "dependency-install",
    pattern: /^pip install [a-z0-9._[\]-]+$/i,
    description: "install a named python package through pip",
  },
  { id: "go-mod-download", category: "dependency-install", pattern: /^go mod download$/, description: "download go modules" },
  { id: "cargo-fetch", category: "dependency-install", pattern: /^cargo fetch$/, description: "fetch rust dependencies" },
];

/** Shell metacharacters that would let a matched template do something else. */
const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\\]/;

export interface AllowlistDecision {
  readonly allowed: boolean;
  readonly template?: CommandTemplate;
  /** Why a command was refused — printed for the user to run themselves. */
  readonly reason?: string;
}

/**
 * D-15: the only question this answers is "may Detent execute this". A `false`
 * is not a prompt to try harder — the command is printed with rationale and
 * the user runs it themselves.
 */
export function checkCommand(command: string): AllowlistDecision {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized === "") return { allowed: false, reason: "empty command" };

  if (SHELL_METACHARACTERS.test(normalized)) {
    return {
      allowed: false,
      reason:
        "contains shell metacharacters — a template match must describe the whole command, " +
        "and a pipeline or substitution can do anything (D-15)",
    };
  }

  const template = COMMAND_TEMPLATES.find((t) => t.pattern.test(normalized));
  if (template === undefined) {
    return {
      allowed: false,
      reason: `no template in the v1 allowlist matches this command; extending the set is a spec PR (C-6a)`,
    };
  }
  return { allowed: true, template };
}

/** The message shown for an off-list command the user must run themselves. */
export function offListMessage(command: string, decision: AllowlistDecision, rationale: string): string {
  return [
    "Detent will not run this command — it is outside the v1 setup allowlist (C-6a/D-15).",
    `  command:   ${command}`,
    `  why asked: ${rationale}`,
    `  refused:   ${decision.reason ?? "not on the allowlist"}`,
    "",
    "Run it yourself if you agree with it, then re-run `detent init` — the pipeline resumes from its checkpoint.",
  ].join("\n");
}
