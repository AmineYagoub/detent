import path from "node:path";
import picomatch from "picomatch";
import { PACKAGE_MANIFESTS, ROOT_PACKAGE, touchedPackages } from "../adapter/packages.js";
import type { GateSlot } from "../schemas/gates.js";
import type { Binding } from "../schemas/records.js";
import type { Ticket } from "../schemas/ticket.js";
import type { PhaseOutcome } from "./machine.js";

/**
 * V-5′ (PRDR-295) — a ticket no gate can fail cannot be approved.
 *
 * A ticket's gates are those of the packages its surface touches, so a path
 * that lies in a package with no gate a ticket runs is a path no gate can fail
 * for. So is a package manifest a ticket writes in a directory that is not a
 * package yet: the ticket starts a package no gate is bound for. ksar-cloud's
 * plan had 69 tickets writing `dashboard/` while its gates ran Go at the root,
 * and was approved. Each such path is named at PRESENT and holds approval,
 * until the pack declares the package's gates or the package gives itself a
 * command. A ticket already DONE runs no gate again, and is not held.
 */

/** The slots a ticket's gate evaluation runs (`src/kernel/referee-gate.ts`). A package with none of them bound has no gate that can fail for a ticket. */
export const TICKET_SLOTS: readonly GateSlot[] = ["lint", "typecheck", "test"];

export interface UngatedPath {
  readonly ticket: string;
  /** The surface entry, as the ticket names it. */
  readonly path: string;
  readonly package: string;
  /** True where the path is a manifest that makes its directory a package. */
  readonly starts: boolean;
}

export function ungatedPaths(tickets: readonly Ticket[], bindings: readonly Binding[], packages: readonly string[]): UngatedPath[] {
  const gated = new Set(bindings.filter((b) => TICKET_SLOTS.includes(b.slot)).map((b) => b.package));
  const out: UngatedPath[] = [];
  for (const ticket of tickets) {
    if (ticket.state === "DONE") continue;
    for (const entry of ticket.surface) {
      const clean = entry.replace(/^\.\//u, "");
      const dir = path.posix.dirname(clean);
      if (!picomatch.scan(clean).isGlob && PACKAGE_MANIFESTS.includes(path.posix.basename(clean)) && dir !== "." && !packages.includes(dir)) {
        out.push({ ticket: ticket.id, path: entry, package: dir, starts: true });
        continue;
      }
      for (const pkg of touchedPackages([entry], packages)) {
        if (!gated.has(pkg)) out.push({ ticket: ticket.id, path: entry, package: pkg, starts: false });
      }
    }
  }
  return out;
}

const named = (pkg: string): string => (pkg === ROOT_PACKAGE ? "the root package" : pkg);

export function ungatedLine(u: UngatedPath): string {
  return u.starts
    ? `${u.ticket}: ${u.path} makes ${u.package} a package, and no gate is bound for it`
    : `${u.ticket}: ${u.path} lies in ${named(u.package)}, which has no gate a ticket runs (lint, typecheck or test)`;
}

/** What the presentation says, where anything is ungated. */
export function ungatedLines(ungated: readonly UngatedPath[]): string[] {
  if (ungated.length === 0) return [];
  return ["", `Paths no gate can fail (${String(ungated.length)}) — while one is in the plan, it cannot be approved (V-5′):`, ...ungated.map((u) => `  ${ungatedLine(u)}`)];
}

/** The AWAIT_INFO an ungated path raises, or null where none is. */
export function ungatedInterrupt(presentation: string, ungated: readonly UngatedPath[]): PhaseOutcome | null {
  if (ungated.length === 0) return null;
  const instruction =
    `${String(ungated.length)} path(s) the plan's tickets write lie where no gate can fail, so this plan cannot be approved (V-5′). ` +
    "For each package named, declare its gate commands under `## Packages` in the pack's decision log, or give the package a " +
    "`test`, `lint` or `typecheck` command of its own, and re-run `detent init`. A ticket whose surface reaches further than its " +
    "work needs can be narrowed instead.";
  return { kind: "interrupt", interrupt: "AWAIT_INFO", message: [presentation, "", instruction].join("\n"), items: ungated.map(ungatedLine) };
}
