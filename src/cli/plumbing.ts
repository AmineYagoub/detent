import { parseArgs } from "node:util";
import { approveTicket, requeueTicket, sweepStaleClaims, unclaimTicket } from "../kernel/plumbing.js";

/**
 * T-055 — `detent approve <id>` and `detent requeue <id>` (C-12).
 *
 * Thin: parse, call the kernel's plumbing, print, map the exit code. The
 * README golden path contains exactly two commands; these are documented,
 * scriptable, and never required on it.
 */

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
    const swept = sweepStaleClaims(root, values.user as string);
    process.stdout.write(`${swept.message}\n`);
    return swept.exitCode;
  }
  const [root, id] = positionals.length === 2 ? positionals : [process.cwd(), positionals[0]];
  if (id === undefined) {
    process.stderr.write("usage: detent unclaim [root] <ticket-id> | detent unclaim [root] --stale [--user <name>]\n");
    return 2;
  }
  const result = unclaimTicket(root as string, id, values.user as string);
  process.stdout.write(`${result.message}\n`);
  return result.exitCode;
}
