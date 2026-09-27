import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * S-1⁗ (PRDR-285) — the sandbox a VALIDATE reviewer's scripts run in: macOS's
 * Seatbelt, through `sandbox-exec`, under a profile written for each run.
 *
 * Running code is a containment change the hook cannot make. The hook sees a
 * tool call, not what the script it names then does, so the script runs below
 * it, in a process the operating system confines: it reads the system, its
 * interpreter's install and its own directory, writes its own directory,
 * reaches no network, and starts no other process, so stopping it stops
 * everything the script did.
 *
 * The reviewer never holds a shell. It hands Detent a script through one tool
 * (`scratchRunner`), and Detent writes the script into the session's own
 * directory and runs it there. What comes back is the exit and the output, and
 * that output is the only way anything a script computed leaves the sandbox.
 */

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/**
 * A run's wall clock. ksarjs's money simulations ran 40,000 random sequences
 * in throwaway Python, seconds of work; two minutes is room for that many
 * times over, and short of a session left waiting on a loop that never ends.
 */
export const SCRATCH_TIME_LIMIT_MS = 120_000;

/** What a run may print, both streams together: a reviewer reads all of it, so a flood costs turns and says nothing. */
export const SCRATCH_OUTPUT_LIMIT = 64 * 1024;

/** A script's size. A simulation is a page or two; a script this long is not one. */
export const SCRATCH_SOURCE_LIMIT = 128 * 1024;

export const SCRATCH_SERVER = "detent_scratch";

/** The tool's name as a session calls it, and as `allowedTools` grants it. */
export const SCRATCH_TOOL = `mcp__${SCRATCH_SERVER}__run`;

export type InterpreterName = "python3" | "node";

export interface SandboxInterpreter {
  readonly name: InterpreterName;
  /** Its real path, links resolved: Seatbelt judges the file a process opens, not the name it was given. */
  readonly path: string;
  readonly version: string;
  /** Its install, as real paths: the one place outside the system a script may read. */
  readonly roots: readonly string[];
}

/** The interpreters a sandbox offers: at least one, or it is off. */
export type Interpreters = readonly [SandboxInterpreter, ...SandboxInterpreter[]];

/** What the probe found: a sandbox and the interpreters that start in it, or why there is none. */
export type Sandbox = { readonly kind: "on"; readonly exec: string; readonly interpreters: Interpreters } | { readonly kind: "off"; readonly reason: string };

/** What a reviewer's session is given: its round's scratch directory, and the sandbox to run scripts there with. */
export interface ScratchGrant {
  /** A real path outside the repository and `.detent/`, made for the round and removed after it. */
  readonly dir: string;
  readonly exec: string;
  readonly interpreters: Interpreters;
}

export interface SandboxRun {
  readonly exit: number | null;
  readonly signal: string | null;
  /** The limit that stopped the run, if one did. */
  readonly stopped: "time" | "output" | null;
  readonly output: string;
}

const SYSTEM_READS = ["/System", "/usr"] as const;
const DEVICE_READS = ["/dev/null", "/dev/random", "/dev/urandom"] as const;

/** A path as the profile's grammar quotes it. One it cannot quote exactly is refused, never quoted loosely. */
function quoted(p: string): string {
  if (!path.isAbsolute(p)) throw new Error(`the sandbox profile names absolute paths, and ${p} is not one`);
  if (/["\\\p{Cc}]/u.test(p)) throw new Error(`the sandbox profile cannot quote ${JSON.stringify(p)}`);
  return `"${p}"`;
}

const ancestors = (p: string): string[] => {
  const above: string[] = [];
  for (let at = path.dirname(p); ; at = path.dirname(at)) {
    above.push(at);
    if (at === path.dirname(at)) return above;
  }
};

/**
 * The profile a run is confined by. It denies by default and allows only what
 * starting an interpreter and running a script in `writable` need, measured on
 * macOS 26 against python3 3.14 and node 22:
 * - starting the interpreter, and reading the system's settings, without
 *   which node dies and python3 cannot count its processors or name its
 *   platform;
 * - reading `/`, the system, the interpreter's install and `writable`, and the
 *   metadata of those paths and the directories above them, so a script reads
 *   neither the repository nor the operator's home;
 * - writing `writable` and `/dev/null`;
 * - no network, local included, and no Mach lookup, so a script cannot ask a
 *   system service such as LaunchServices or AppleScript to act for it;
 * - no fork and no spawn, so a run is the one process Detent started, and no
 *   signal but to itself, which Seatbelt allows unasked.
 */
export function seatbeltProfile(writable: string, roots: readonly string[]): string {
  const reads = [...SYSTEM_READS, ...roots, writable].map(quoted);
  const above = [...new Set([...SYSTEM_READS, ...roots, writable].flatMap(ancestors))].map(quoted);
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow sysctl-read)",
    `(allow file-read-metadata ${above.map((a) => `(literal ${a})`).join(" ")})`,
    `(allow file-read* (literal "/") ${reads.map((r) => `(subpath ${r})`).join(" ")} ${DEVICE_READS.map((d) => `(literal ${quoted(d)})`).join(" ")})`,
    `(allow file-write* (subpath ${quoted(writable)}))`,
    '(allow file-write-data (literal "/dev/null"))',
    "(deny network*)",
  ].join("\n");
}

/** `-I`: isolated, so no `PYTHON*` variable, user site or script directory reaches the run. */
const INTERPRETER_ARGS: Readonly<Record<InterpreterName, readonly string[]>> = { python3: ["-I"], node: [] };

/**
 * A CPU limit, set before the sandbox is entered, of twice the wall clock.
 * Detent's clock stops a run; this stops one Detent no longer can, as when
 * Detent itself ends mid-run, and a script's threads spend it together. Node
 * sets no resource limit, so a shell sets it and then becomes the sandbox,
 * keeping its pid.
 */
const WITH_CPU_LIMIT = 'ulimit -t "$1" || exit 125; shift; exec "$@"';

/** No variable of Detent's crosses (SEC-4): the script's home and temporary directory are its own. */
const runEnv = (dir: string): NodeJS.ProcessEnv => ({ PATH: "/usr/bin:/bin", HOME: dir, TMPDIR: dir, LANG: "en_US.UTF-8" });

export interface RunRequest {
  readonly exec: string;
  readonly dir: string;
  readonly interpreter: SandboxInterpreter;
  readonly file: string;
  readonly timeLimitMs?: number;
  readonly outputLimit?: number;
}

/**
 * Runs `file` in `dir`, confined, and settles once the run ends: when the
 * script exits, or when a limit stops it, which kills it. It never throws for
 * what the script did; that is the run's result.
 */
export async function runSandboxed(req: RunRequest): Promise<SandboxRun> {
  const timeLimit = req.timeLimitMs ?? SCRATCH_TIME_LIMIT_MS;
  const outputLimit = req.outputLimit ?? SCRATCH_OUTPUT_LIMIT;
  const cpuSeconds = String(Math.ceil((2 * timeLimit) / 1000));
  const argv = ["-c", WITH_CPU_LIMIT, "detent-scratch", cpuSeconds, req.exec, "-p", seatbeltProfile(req.dir, req.interpreter.roots)];
  argv.push(req.interpreter.path, ...INTERPRETER_ARGS[req.interpreter.name], req.file);
  const child = spawn("/bin/sh", argv, { cwd: req.dir, env: runEnv(req.dir), stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  let size = 0;
  let stopped: SandboxRun["stopped"] = null;
  const stop = (limit: "time" | "output"): void => {
    stopped ??= limit;
    child.kill("SIGKILL");
  };
  const take = (chunk: Buffer): void => {
    const kept = chunk.subarray(0, Math.max(0, outputLimit - size));
    chunks.push(kept);
    size += kept.length;
    if (kept.length < chunk.length) stop("output");
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  return await new Promise<SandboxRun>((resolve) => {
    const timer = setTimeout(() => stop("time"), timeLimit);
    const settle = (exit: number | null, signal: string | null): void => {
      clearTimeout(timer);
      resolve({ exit, signal, stopped, output: Buffer.concat(chunks).toString("utf8") });
    };
    child.on("error", (err) => {
      chunks.push(Buffer.from(err.message));
      settle(null, null);
    });
    child.on("close", settle);
  });
}

export interface ScratchLimits {
  readonly timeLimitMs?: number;
  readonly outputLimit?: number;
}

function ending(run: SandboxRun, limits: ScratchLimits): string {
  if (run.stopped === "time") return `stopped at the time limit, ${String((limits.timeLimitMs ?? SCRATCH_TIME_LIMIT_MS) / 1000)} s; what it printed before follows`;
  if (run.stopped === "output") return `stopped: its output passed the limit, ${String((limits.outputLimit ?? SCRATCH_OUTPUT_LIMIT) / 1024)} KiB; what it printed first follows`;
  if (run.exit !== null) return `exit ${String(run.exit)}`;
  return `ended by ${run.signal ?? "a signal"}${run.signal === "SIGXCPU" ? ", the CPU limit" : ""}`;
}

/**
 * The tool a reviewer runs its scripts with, one per session. The session's
 * first script makes its own directory inside the round's, so one reviewer's
 * scripts are not another's; each script is written there as `run-<n>` and
 * run there. A script over the size limit, or for an interpreter the sandbox
 * does not offer, is refused, and nothing is written or run.
 */
export function scratchRunner(grant: ScratchGrant, limits: ScratchLimits = {}): (input: { readonly interpreter: string; readonly source: string }) => Promise<string> {
  let own: string | null = null;
  let runs = 0;
  return async ({ interpreter, source }) => {
    const chosen = grant.interpreters.find((i) => i.name === interpreter);
    if (chosen === undefined) return `refused: ${interpreter} is not one of ${grant.interpreters.map((i) => i.name).join(", ")}; nothing ran`;
    if (Buffer.byteLength(source, "utf8") > SCRATCH_SOURCE_LIMIT) return `refused: the script is over ${String(SCRATCH_SOURCE_LIMIT / 1024)} KiB, the limit; nothing ran`;
    own ??= mkdtempSync(path.join(grant.dir, "session-"));
    runs += 1;
    const name = `run-${String(runs)}${chosen.name === "python3" ? ".py" : ".js"}`;
    writeFileSync(path.join(own, name), source);
    const run = await runSandboxed({ exec: grant.exec, dir: own, interpreter: chosen, file: path.join(own, name), ...limits });
    return `${name}, ${chosen.name} ${chosen.version}: ${ending(run, limits)}\n${run.output}`;
  };
}
