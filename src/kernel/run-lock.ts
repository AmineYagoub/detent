import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { pidAlive } from "./tickets/mutations.js";

/**
 * X-1‴ (PRDR-147) — one run per root.
 *
 * `OPEN_ROOTS` in the journal is a process-local `Set`, and its own comment is
 * honest that cross-process protection is NG4 ground, "documented, not silently
 * claimed". The documentation was accurate; the cost was not stated. Two runs
 * on one root each enforce `run_spend_usd` against their own view and jointly
 * spend past it — silently, because per-ticket claims correctly keep them off
 * the same ticket, so nothing else looks wrong. The only guard standing between
 * an operator and that today is a `pgrep` in a supervisor shell script written
 * for this project: advisory, out-of-product, and easy not to have.
 *
 * This does not make concurrent runs SAFE. It makes the second one refuse,
 * which is the honest answer while NG4 stands.
 *
 * The primitive is the one the claim mechanism already proves under eight
 * barrier-synchronised subprocesses: `openSync(path, "wx")` is `O_CREAT|O_EXCL`,
 * so exactly one caller can create the file. A lock whose holder is verifiably
 * dead ON THIS HOST is breakable on the same terms `claimBreakable` applies —
 * a crashed run must not leave a root unusable, and pid liveness means nothing
 * across machines.
 */

export interface RunLockInfo {
  readonly pid: number;
  readonly host: string;
  readonly at: string;
  /**
   * PRDR-190: what the holder was last doing.
   *
   * SIGKILL cannot be caught, so a signal handler alone would have explained
   * none of the six deaths that produced that ticket. This field is what makes
   * an uncatchable death diagnosable after the fact: a lock left behind by a
   * dead pid says WHICH SLICE it died in, so a later reader can tell
   * "died while planning s09" from "exited cleanly after s09".
   */
  readonly phase: string | null;
}

export type RunLockResult =
  | { readonly ok: true; readonly release: () => void; readonly brokeStale: RunLockInfo | null }
  | { readonly ok: false; readonly heldBy: RunLockInfo | null };

/**
 * Under `state/`, which `fs/layout.ts` declares `tracking: "local"` and the
 * generated `.gitignore` excludes.
 *
 * It sat at `.detent/run.lock` — committed territory — and `finalizeDone` runs
 * `git add -A` in the default non-worktree mode, so a run would have COMMITTED
 * its own lock. On another machine the host would not match, so
 * `runLockBreakable` would refuse to break it: a lock that travels is a lock
 * nobody can clear. Local run state never travels between machines (F-1).
 */
function lockPath(root: string): string {
  return path.join(stateDir(root), "state", "run.lock");
}

function readLock(root: string): RunLockInfo | null {
  try {
    const raw = JSON.parse(readFileSync(lockPath(root), "utf8")) as Partial<RunLockInfo>;
    if (typeof raw.pid !== "number" || typeof raw.host !== "string") return null;
    return {
      pid: raw.pid,
      host: raw.host,
      at: typeof raw.at === "string" ? raw.at : "",
      /* Additive: a lock written before PRDR-190 reads back with no phase rather than failing. */
      phase: typeof raw.phase === "string" && raw.phase !== "" ? raw.phase : null,
    };
  } catch {
    /* Unreadable or half-written: held by someone, on the R-3 rule that an
       unreadable claim is a held one. Breaking it would be the guess. */
    return null;
  }
}

/**
 * R-3, matching `claimBreakable`: only a dead pid on THIS host. An unreadable
 * lock is held, not stale — the same direction the claim reader already takes.
 */
export function runLockBreakable(info: RunLockInfo | null, alive: (pid: number) => boolean, host: string): boolean {
  if (info === null) return false;
  if (info.host !== host) return false;
  return !alive(info.pid);
}

export function acquireRunLock(
  root: string,
  deps: { readonly pid?: number; readonly host?: string; readonly alive?: (pid: number) => boolean; readonly now?: () => string } = {},
): RunLockResult {
  const pid = deps.pid ?? process.pid;
  const host = deps.host ?? hostname();
  const alive = deps.alive ?? pidAlive;
  const at = (deps.now ?? (() => new Date().toISOString()))();
  const file = lockPath(root);

  const take = (): boolean => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const fd = openSync(file, "wx");
      closeSync(fd);
      /* Written after the atomic create: a lock that exists but is empty still reads as held. */
      writeFileSync(file, `${JSON.stringify({ pid, host, at, phase: null }, null, 2)}\n`);
      return true;
    } catch {
      return false;
    }
  };

  if (take()) return { ok: true, release: () => rmSync(file, { force: true }), brokeStale: null };

  const held = readLock(root);
  if (!runLockBreakable(held, alive, host)) return { ok: false, heldBy: held };

  rmSync(file, { force: true });
  if (!take()) return { ok: false, heldBy: readLock(root) };
  return { ok: true, release: () => rmSync(file, { force: true }), brokeStale: held };
}

/**
 * PRDR-190: record what the holder is doing, so a lock it leaves behind explains
 * itself.
 *
 * Best-effort by construction. This runs on every progress line of a live run,
 * and a run must not die because its own liveness marker could not be written —
 * the marker exists to explain a death, not to cause one.
 */
export function noteRunPhase(root: string, phase: string): void {
  const file = lockPath(root);
  try {
    const held = readLock(root);
    if (held === null) return;
    writeFileSync(file, `${JSON.stringify({ pid: held.pid, host: held.host, at: held.at, phase }, null, 2)}\n`);
  } catch {
    /* An unwritable marker is not worth failing a run over; see the doc-block. */
  }
}

/** How a stale lock's holder is described when one is broken or refused. */
export function lockPhaseSuffix(info: RunLockInfo | null): string {
  return info?.phase == null ? "" : `, which was: ${info.phase}`;
}

/** What the operator is told when the root is busy. */
export function runLockRefusal(held: RunLockInfo | null): string {
  const who =
    held === null
      ? "another process"
      : `pid ${held.pid} on ${held.host}${held.at === "" ? "" : ` since ${held.at}`}${lockPhaseSuffix(held)}`;
  return (
    `another run holds this root (${who}) — a second run would enforce its own spend ceiling and the two would ` +
    "jointly spend past it (X-1). Wait for it to finish, or remove .detent/state/run.lock if that process is gone."
  );
}
