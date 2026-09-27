import { parseArgs } from "node:util";
import { stateVersionRefusal } from "../kernel/migrate.js";
import { describeAmendment, readAmendment } from "../kernel/amendment-store.js";
import type { AmendDecision } from "../kernel/amendment-decide.js";
import { amendPlumbing, approveTicket, requeueTicket, sweepStaleClaims, unclaimTicket } from "../kernel/plumbing.js";
import { readEditsFile } from "./escalate.js";

/**
 * T-055 — `detent approve <id>` and `detent requeue <id>` (C-12).
 *
 * Thin: parse, call the kernel's plumbing, print, map the exit code. The
 * README golden path contains exactly two commands; these are documented,
 * scriptable, and never required on it.
 */

/** F-3″ (PRDR-300): plumbing does not migrate, so an older or newer state is refused and nothing is written. */
function refused(root: string): boolean {
  const message = stateVersionRefusal(root);
  if (message !== null) process.stderr.write(`${message}\n`);
  return message !== null;
}

export function approveMain(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { user: { type: "string", default: process.env["USER"] ?? "operator" } },
  });
  const [root, id] = positionals.length === 2 ? positionals : [process.cwd(), positionals[0]];
  if (id === undefined) {
    process.stderr.write("usage: detent approve [root] <ticket-id> [--user <name>]\n");
    return 2;
  }
  if (refused(root as string)) return 2;
  const result = approveTicket(root as string, id, values.user as string);
  process.stdout.write(`${result.message}\n`);
  return result.exitCode;
}

export function requeueMain(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      user: { type: "string", default: process.env["USER"] ?? "operator" },
      guidance: { type: "string", default: "" },
    },
  });
  const [root, id] = positionals.length === 2 ? positionals : [process.cwd(), positionals[0]];
  if (id === undefined) {
    process.stderr.write("usage: detent requeue [root] <ticket-id> [--guidance <text>] [--user <name>]\n");
    return 2;
  }
  if (refused(root as string)) return 2;
  const result = requeueTicket(root as string, id, values.user as string, (values.guidance as string) || "requeued without guidance");
  process.stdout.write(`${result.message}\n`);
  return result.exitCode;
}

export function unclaimMain(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      stale: { type: "boolean", default: false },
      user: { type: "string", default: process.env["USER"] ?? "operator" },
    },
  });
  if (values.stale === true) {
    const root = (positionals[0] as string | undefined) ?? process.cwd();
    if (refused(root)) return 2;
    const swept = sweepStaleClaims(root, values.user as string);
    process.stdout.write(`${swept.message}\n`);
    return swept.exitCode;
  }
  const [root, id] = positionals.length === 2 ? positionals : [process.cwd(), positionals[0]];
  if (id === undefined) {
    process.stderr.write("usage: detent unclaim [root] <ticket-id> | detent unclaim [root] --stale [--user <name>]\n");
    return 2;
  }
  if (refused(root as string)) return 2;
  const result = unclaimTicket(root as string, id, values.user as string);
  process.stdout.write(`${result.message}\n`);
  return result.exitCode;
}

const AMEND_USAGE = "usage: detent amend [root] <AM-id> [--approve | --edit <file> | --reject <reason>] [--user <name>]\n";

/**
 * `detent amend <AM-id>` (X-4⁸, PRDR-286): with no decision, shows the
 * amendment; with one, decides it. `--edit` takes a JSON file of the
 * operator's own edits, `[{"id", "old", "new"}]`, made in place of the ones
 * the session proposed.
 */
export function amendMain(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      approve: { type: "boolean", default: false },
      edit: { type: "string" },
      reject: { type: "string" },
      user: { type: "string", default: process.env["USER"] ?? "operator" },
    },
  });
  const [root, id] = (positionals.length === 2 ? positionals : [process.cwd(), positionals[0]]) as [string, string | undefined];
  const chosen = [values.approve === true, values.edit !== undefined, values.reject !== undefined].filter(Boolean).length;
  if (id === undefined || chosen > 1) {
    process.stderr.write(AMEND_USAGE);
    return 2;
  }
  if (refused(root)) return 2;
  if (chosen === 0) {
    const record = readAmendment(root, id);
    process.stdout.write(record === null ? `no such amendment: ${id}\n` : `${describeAmendment(record)}\n`);
    return record === null ? 2 : 0;
  }
  let decision: AmendDecision;
  if (values.edit !== undefined) {
    const edits = readEditsFile(values.edit);
    if (typeof edits === "string") {
      process.stderr.write(`${edits}\n`);
      return 2;
    }
    decision = { kind: "edit", edits };
  } else {
    decision = values.reject !== undefined ? { kind: "reject", reason: values.reject.trim() === "" ? "rejected without a reason" : values.reject } : { kind: "approve" };
  }
  const result = amendPlumbing(root, id, values.user as string, decision);
  process.stdout.write(`${result.message}\n`);
  return result.ok ? 0 : 2;
}
