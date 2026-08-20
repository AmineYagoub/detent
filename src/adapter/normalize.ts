import type { Candidate, PackageManager, StackFacts } from "./discover/types.js";

/**
 * T-028 — invocation-time normalization (V-4).
 *
 * V-4 is explicit that this is Detent's job and does not violate F-2: nothing
 * here edits a project file. A binding stores what the project declared; this
 * module decides how to *invoke* it once — package manager re-selected from the
 * lockfile at call time, CI-mode flags appended, `CI=1` in the environment.
 *
 * Stack strings belong here. The kernel never sees a runner's name.
 */

export interface Invocation {
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * V-5: an affected-filter binding stores its template with the `BASE`
 * placeholder intact, so the binding does not drift merely because a new run
 * started from a new merge-base. The placeholder is substituted here, at
 * invocation time, with the run's baseline — the merge-base of the run branch
 * and the base branch it was created from (resolved once per run, T-042).
 */
const BASE_PLACEHOLDER = /\bBASE\b/g;

export function needsBaseRef(command: string): boolean {
  BASE_PLACEHOLDER.lastIndex = 0;
  return BASE_PLACEHOLDER.test(command);
}

export function substituteBase(command: string, baseRef: string): string {
  if (baseRef.trim() === "") throw new Error("V-5: an empty base ref is not a baseline");
  return command.replace(BASE_PLACEHOLDER, baseRef);
}

/** V-4: `CI=1`. Runners that watch by default fall back to a single run. */
export const CI_ENV: Readonly<Record<string, string>> = { CI: "1" };

/**
 * How each package manager forwards extra arguments to a script. npm and pnpm
 * need the `--` separator; yarn (classic) and bun pass them through.
 */
const ARG_SEPARATOR: Record<PackageManager, string> = {
  npm: " -- ",
  pnpm: " -- ",
  yarn: " ",
  bun: " ",
};

const EXEC: Record<PackageManager, string> = {
  npm: "npx",
  pnpm: "pnpm exec",
  yarn: "yarn",
  bun: "bunx",
};

interface RunnerRule {
  readonly runner: RegExp;
  /** Already CI-safe: adding the flags again would be noise or an error. */
  readonly satisfied: RegExp;
  readonly flags: readonly string[];
}

/** The matrix. One row per runner that watches unless told otherwise. */
const RUNNER_RULES: readonly RunnerRule[] = [
  { runner: /\bvitest\b/, satisfied: /\bvitest\s+run\b|--run\b/, flags: ["--run"] },
  { runner: /\bjest\b/, satisfied: /--watchAll=false|--ci\b/, flags: ["--watchAll=false", "--ci"] },
  { runner: /\bkarma\s+start\b/, satisfied: /--single-run/, flags: ["--single-run"] },
  { runner: /\bng\s+test\b/, satisfied: /--watch=false/, flags: ["--watch=false"] },
];

/**
 * The command text the runner rules inspect. For a script binding that is the
 * script's *body* — `npm run test` says nothing about whether vitest watches.
 */
export function underlyingCommand(candidate: Candidate): string {
  if (candidate.adapter !== "node-scripts") return candidate.resolved;
  const eq = candidate.config_region.indexOf("=");
  return eq === -1 ? candidate.resolved : candidate.config_region.slice(eq + 1);
}

export function ciFlagsFor(candidate: Candidate): string[] {
  const underlying = underlyingCommand(candidate);
  for (const rule of RUNNER_RULES) {
    if (rule.runner.test(underlying) && !rule.satisfied.test(underlying)) return [...rule.flags];
  }
  return [];
}

/**
 * Re-resolve the command for this invocation. `facts` supplies the *current*
 * package manager: V-4 puts pm selection at call time, so a lockfile swapped
 * after discovery is honoured rather than baked into the stored binding.
 */
export interface InvocationFacts extends Pick<StackFacts, "pm"> {
  /** The run's resolved baseline for `BASE` templates (V-5). */
  readonly baseRef?: string;
}

export function normalizeInvocation(candidate: Candidate, facts?: InvocationFacts): Invocation {
  const pm = facts?.pm ?? candidate.pm;
  const flags = ciFlagsFor(candidate);
  let command = withPackageManager(candidate, pm, flags);
  /**
   * Left intact when no baseline is supplied: resolving one is the caller's
   * job (T-042), and an unresolvable baseline must fall back to the root
   * command rather than run against a guess (V-5).
   */
  if (facts?.baseRef !== undefined && needsBaseRef(command)) {
    command = substituteBase(command, facts.baseRef);
  }
  return { command, env: { ...CI_ENV } };
}

function withPackageManager(candidate: Candidate, pm: PackageManager | null, flags: readonly string[]): string {
  if (candidate.adapter === "node-scripts") {
    const chosen = pm ?? "npm";
    const base = `${chosen} run ${candidate.ref}`;
    return flags.length === 0 ? base : `${base}${ARG_SEPARATOR[chosen]}${flags.join(" ")}`;
  }

  if (candidate.adapter === "tsc") {
    const chosen = pm ?? "npm";
    return `${EXEC[chosen]} tsc --noEmit`;
  }

  /* make, just, go, cargo, pytest: the command is already the invocation. */
  return flags.length === 0 ? candidate.resolved : `${candidate.resolved} ${flags.join(" ")}`;
}
