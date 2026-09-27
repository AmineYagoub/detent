import path from "node:path";
import picomatch from "picomatch";
import { PACKAGE_MANIFESTS, ROOT_PACKAGE, touchedPackages } from "../adapter/packages.js";
import type { GateSlot } from "../schemas/gates.js";

/**
 * V-5′ (PRDR-295) — a path no gate can fail, which A-1⁷ checks (PRDR-293).
 *
 * A ticket's gates are those of the packages its surface touches, so a path
 * that lies in a package with no gate a ticket runs is a path no gate can fail
 * for. So is a package manifest a ticket writes in a directory that is not a
 * package yet: the ticket starts a package no gate is bound for. ksar-cloud's
 * plan had 69 tickets writing `dashboard/` while its gates ran Go at the root,
 * and was approved. A ticket already DONE runs no gate again, and `checkPlan`
 * names no DONE ticket in a failure.
 */

/** The slots a ticket's gate evaluation runs (`src/kernel/referee-gate.ts`). A package with none of them bound has no gate that can fail for a ticket. */
export const TICKET_SLOTS: readonly GateSlot[] = ["lint", "typecheck", "test"];

/** The packages a plan is checked against, and what each binds. */
export interface Gates {
  readonly bindings: readonly { readonly package: string; readonly slot: GateSlot }[];
  readonly packages: readonly string[];
}

export interface UngatedPath {
  readonly ticket: string;
  /** The surface entry, as the ticket names it. */
  readonly path: string;
  readonly package: string;
  /** True where the path is a manifest that makes its directory a package. */
  readonly starts: boolean;
}

export function ungatedPaths(tickets: readonly { readonly id: string; readonly surface: readonly string[] }[], gates: Gates): UngatedPath[] {
  const gated = new Set(gates.bindings.filter((b) => TICKET_SLOTS.includes(b.slot)).map((b) => b.package));
  const out: UngatedPath[] = [];
  for (const ticket of tickets) {
    for (const entry of ticket.surface) {
      const clean = entry.replace(/^\.\//u, "");
      const dir = path.posix.dirname(clean);
      if (!picomatch.scan(clean).isGlob && PACKAGE_MANIFESTS.includes(path.posix.basename(clean)) && dir !== "." && !gates.packages.includes(dir)) {
        out.push({ ticket: ticket.id, path: entry, package: dir, starts: true });
        continue;
      }
      for (const pkg of touchedPackages([entry], gates.packages)) {
        if (!gated.has(pkg)) out.push({ ticket: ticket.id, path: entry, package: pkg, starts: false });
      }
    }
  }
  return out;
}

const named = (pkg: string): string => (pkg === ROOT_PACKAGE ? "the root package" : pkg);

/** What an ungated path is, in words a drafter can act on: it names the package, and how a surface stops reaching it. */
export function ungatedFinding(u: UngatedPath): string {
  return u.starts
    ? `writes \`${u.path}\`, which makes ${u.package} a package, and no gate is bound for it: a ticket there cannot be verified, so the package's gates are the operator's to declare before its tickets can run`
    : `has \`${u.path}\` in its surface, which lies in ${named(u.package)}, where no gate a ticket runs (lint, typecheck or test) is bound: narrow the surface to where the ticket's work lies, or the package needs gates the operator declares`;
}
