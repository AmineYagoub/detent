import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import type { Binding } from "../schemas/records.js";

/**
 * V-3⁵ (PRDR-231) — the record that a gate configuration was ever EXECUTED and
 * approved.
 *
 * V-3⁗ judges a ticket's tree against the config at its fork commit, and
 * adopted whatever that commit happened to carry. Because worktrees are the
 * default and the gate arm is the only production drift assertion, that left
 * `.detent/bindings.json` with no enforcement role for any slot the fork
 * defines: the safety argument was an induction — config reaches the run branch
 * only through a ticket whose own change was blocked and accepted — and an
 * induction is not a control. A configuration that arrives by any other path is
 * adopted silently by every worktree cut after it.
 *
 * So a hash is admissible as a baseline only if it appears here. Rows are
 * appended wherever an approved binding is written, which is one funnel:
 * `writeBindings`. Under `state/`, which no session surface and no artifact
 * root admits — and, since PRDR-232, nothing the judged tree declares runs
 * under the referee to reach it either.
 */

interface ApprovalRow {
  readonly slot: string;
  readonly adapter: string;
  readonly ref: string;
  readonly config_hash: string;
}

export function approvalsPath(root: string): string {
  return path.join(stateDir(root), "state", "approvals.jsonl");
}

function key(row: ApprovalRow): string {
  return [row.slot, row.adapter, row.ref, row.config_hash].join("|");
}

export function hasApprovals(root: string): boolean {
  return existsSync(approvalsPath(root));
}

/** Append-only, and only for bindings an operator's execution actually approved. */
export function recordApprovals(root: string, bindings: readonly Binding[], at: string, note?: string): void {
  const rows = bindings
    .filter((b) => b.status === "approved")
    .map((b) =>
      JSON.stringify({
        schema_version: 1,
        at,
        slot: b.slot,
        adapter: b.adapter,
        ref: b.ref,
        resolved: b.resolved,
        config_hash: b.config_hash,
        approved_by: b.approved_by,
        ...(note === undefined ? {} : { note }),
      }),
    );
  if (rows.length === 0) return;
  const file = approvalsPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${rows.join("\n")}\n`);
}

export function approvedHashes(root: string): ReadonlySet<string> {
  const out = new Set<string>();
  if (!hasApprovals(root)) return out;
  for (const line of readFileSync(approvalsPath(root), "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line) as Partial<ApprovalRow>;
      if (
        typeof row.slot === "string" &&
        typeof row.adapter === "string" &&
        typeof row.ref === "string" &&
        typeof row.config_hash === "string"
      ) {
        out.add(key({ slot: row.slot, adapter: row.adapter, ref: row.ref, config_hash: row.config_hash }));
      }
    } catch {
      /* A torn last line is what a crash produces; every whole row before it still counts. */
    }
  }
  return out;
}

export function isApproved(approved: ReadonlySet<string>, binding: Binding, hash: string): boolean {
  return approved.has(key({ slot: binding.slot, adapter: binding.adapter, ref: binding.ref, config_hash: hash }));
}
