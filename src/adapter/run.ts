import { spawn } from "node:child_process";
import { constants } from "node:os";
import { GATE_SLOTS, type GateSlot } from "../schemas/gates.js";
import { CEILINGS } from "../schemas/budgets.js";

/**
 * T-020 — the gate runner (V-4).
 *
 * This module executes a bound verification command and reports what happened,
 * in normalized form. It deliberately does **not** classify the failure or
 * compute a signature: it *feeds* X-5/X-7 rather than implementing them, so the
 * classifier stays in the kernel where P2's "trusts exit codes" rule lives and
 * the adapter keeps no upward dependency on it.
 *
 * The three things V-4 asks of an invocation are all here: a timeout that
 * cannot be outlived (watch-mode detection, V-1), captured output bounded so a
 * runaway test suite cannot exhaust memory, and an exit code normalized across
 * the three ways a process can fail to give one.
 */

export { GATE_SLOTS };
export type { GateSlot };

/** GNU `timeout`'s convention, reused so the figure is not invented here. */
export const TIMEOUT_EXIT = 124;
/** POSIX shells report a command they cannot find as 127. */
export const NOT_FOUND_EXIT = 127;

/** X-1's `gate_timeout_ms` default — the table is the single source (PRDR-061). */
const DEFAULT_TIMEOUT_MS: number = CEILINGS.gate_timeout_ms.default;
const DEFAULT_TAIL_BYTES = 64 * 1024;
/** How long a killed process group gets before SIGKILL. */
const DEFAULT_KILL_GRACE_MS = 2_000;

export interface GateSpec {
  /** The literal command Detent runs — V-2's `resolved`, verbatim. */
  readonly command: string;
  readonly cwd: string;
  readonly slot?: GateSlot;
  readonly timeoutMs?: number;
  /** Merged over `process.env`; T-028 composes the CI-mode additions. */
  readonly env?: NodeJS.ProcessEnv;
  readonly tailBytes?: number;
  readonly killGraceMs?: number;
}

/**
 * How the process ended, normalized. `not-found` and `timed-out` are the two
 * ways a command yields no exit status of its own, and V-1 treats them very
 * differently — the first is a broken binding, the second is watch-mode.
 */
type GateOutcome = "exited" | "timed-out" | "not-found";

export interface GateResult {
  readonly slot: GateSlot | null;
  readonly command: string;
  readonly cwd: string;
  readonly outcome: GateOutcome;
  readonly green: boolean;
  /** `null` whenever the process did not exit on its own — the classifier reads this (X-5). */
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Always a number: 124 for a timeout, 127 for not-found, 128+n for a signal. */
  readonly normalizedExit: number;
  /** The last `tailBytes` of merged stdout+stderr. */
  readonly output: string;
  /** Bytes produced before truncation, so a caller can report what it lost. */
  readonly outputBytes: number;
  readonly truncated: boolean;
  readonly durationMs: number;
}

/**
 * A command that exited on its own, whatever its status. The oracle's contract
 * gate raised on `rc == 127 or rc is None`; this is that predicate, named.
 * A command exiting 127 for its own reasons is indistinguishable from one the
 * shell could not find — the reference had the same limitation.
 */
export function runnable(result: GateResult): boolean {
  /* A 127 exit is already normalized to `not-found` by `build`. */
  return result.outcome === "exited";
}

/** V-1: a candidate that has to be killed is watch-mode, not a gate. */
export function looksLikeWatchMode(result: GateResult): boolean {
  return result.outcome === "timed-out";
}

export function evidence(result: GateResult): string {
  return `${result.slot ?? "gate"}:exit=${result.exitCode ?? "none"}:outcome=${result.outcome}`;
}

const SIGNAL_NUMBERS = constants.signals as unknown as Record<string, number | undefined>;

export async function runGate(spec: GateSpec): Promise<GateResult> {
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const graceMs = spec.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const tail = new TailBuffer(spec.tailBytes ?? DEFAULT_TAIL_BYTES);
  const started = Date.now();

  return await new Promise<GateResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let spawnFailed = false;
    let killTimer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;

    /**
     * `detached` makes the shell a process-group leader so a test runner that
     * spawns workers can be killed whole. Killing only the shell would leave
     * the children holding the pipes open and the timeout would not end.
     */
    const child = spawn(spec.command, {
      shell: true,
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    /*
     * stdout and stderr are merged in arrival order rather than through a
     * single fd, so interleaving between the two streams is approximate. The
     * reference merged at the fd level; nothing downstream reads across the
     * boundary, and X-7 normalizes over volatile detail anyway.
     */
    child.stdout?.on("data", (c: Buffer) => tail.push(c));
    child.stderr?.on("data", (c: Buffer) => tail.push(c));

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, "SIGTERM");
      killTimer = setTimeout(() => killGroup(child, "SIGKILL"), graceMs);
    }, timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (drainTimer !== undefined) clearTimeout(drainTimer);
      resolve(
        build(spec, {
          exitCode,
          signal,
          timedOut,
          spawnFailed,
          tail,
          durationMs: Date.now() - started,
        }),
      );
    };

    child.on("error", () => {
      /* The shell itself could not be started (a missing cwd, most often). */
      spawnFailed = true;
      finish(null, null);
    });

    /*
     * `close` waits for the pipes, so output is complete when it fires. A
     * daemonized grandchild can hold them open past its parent's exit, so
     * `exit` arms a bounded drain rather than being ignored.
     */
    child.on("close", (code, signal) => finish(code, signal));
    child.on("exit", (code, signal) => {
      if (settled) return;
      drainTimer ??= setTimeout(() => finish(code, signal), graceMs);
    });
  });
}

function killGroup(child: { pid?: number | undefined; kill: (s: NodeJS.Signals) => boolean }, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    /* Negative pid targets the group created by `detached: true`. */
    process.kill(-pid, signal);
  } catch {
    /*
     * The group is already gone, or this platform refused; fall back to the
     * process itself, which is still better than leaking the timeout.
     */
    try {
      child.kill(signal);
    } catch {
      /* already reaped */
    }
  }
}

interface Ending {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly spawnFailed: boolean;
  readonly tail: TailBuffer;
  readonly durationMs: number;
}

function build(spec: GateSpec, end: Ending): GateResult {
  const outcome: GateOutcome = end.timedOut
    ? "timed-out"
    : end.spawnFailed || end.exitCode === NOT_FOUND_EXIT
      ? "not-found"
      : "exited";

  /** A killed process reports no code; a timed-out one reports the timeout. */
  const exitCode = end.timedOut ? null : end.spawnFailed ? NOT_FOUND_EXIT : end.exitCode;

  return {
    slot: spec.slot ?? null,
    command: spec.command,
    cwd: spec.cwd,
    outcome,
    green: outcome === "exited" && exitCode === 0,
    exitCode,
    signal: end.signal,
    normalizedExit: normalizeExit(end, exitCode),
    output: end.tail.text(),
    outputBytes: end.tail.bytes,
    truncated: end.tail.truncated,
    durationMs: end.durationMs,
  };
}

/**
 * V-4 exit normalization. Every ending becomes a number so that a caller
 * comparing gate outcomes never has to special-case `null`.
 */
function normalizeExit(end: Ending, exitCode: number | null): number {
  if (end.timedOut) return TIMEOUT_EXIT;
  if (end.spawnFailed) return NOT_FOUND_EXIT;
  if (exitCode !== null) return exitCode;
  if (end.signal !== null) return 128 + (SIGNAL_NUMBERS[end.signal] ?? 0);
  return NOT_FOUND_EXIT;
}

/**
 * Keeps only the last `limit` bytes. A gate that prints a gigabyte must not be
 * able to exhaust the kernel's memory, and only the tail carries the failure.
 */
class TailBuffer {
  private readonly chunks: Buffer[] = [];
  private held = 0;
  /** Total produced, including what was dropped. */
  bytes = 0;

  constructor(private readonly limit: number) {
    this.limit = Math.max(1, limit);
  }

  push(chunk: Buffer): void {
    this.bytes += chunk.length;
    this.chunks.push(chunk);
    this.held += chunk.length;
    while (this.chunks.length > 1 && this.held - (this.chunks[0]?.length ?? 0) >= this.limit) {
      this.held -= this.chunks.shift()?.length ?? 0;
    }
  }

  get truncated(): boolean {
    return this.bytes > this.limit;
  }

  text(): string {
    const all = Buffer.concat(this.chunks);
    if (all.length <= this.limit) return all.toString("utf8");
    return trimPartialCodepoint(all.subarray(all.length - this.limit)).toString("utf8");
  }
}

/** Drop continuation bytes left at the front by a byte-aligned cut. */
function trimPartialCodepoint(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length && i < 4 && ((buf[i] ?? 0) & 0xc0) === 0x80) i += 1;
  return buf.subarray(i);
}
