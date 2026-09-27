import { createHash } from "node:crypto";
import { ROOT_PACKAGE, comparePackages, gateLabel } from "../adapter/packages.js";
import { SCHEMA_VERSION } from "../schemas/common.js";
import { GATE_SLOTS, type GateSlot } from "../schemas/gates.js";
import type { Binding } from "../schemas/records.js";

/**
 * V-5′ (PRDR-295) — the packages a pack declares, and what their commands bind.
 *
 * A pack may declare packages and their gate commands under `## Packages`
 * (C-2⁷), and declared commands are the bindings as documented commands are
 * (V-1′): provisional, since nothing has executed them, and exempt from drift
 * until something discoverable backs them. In a new project every package is
 * declared, since there is nothing yet to discover. In an existing one the
 * package's own manifest is what its gates run, so a declared command binds
 * only where no candidate bound its slot: in a package no manifest backs yet,
 * or for a slot the manifest defines no command for. Where the two disagree,
 * the operator is told, and the manifest's command stays bound.
 */

/** A package the pack declares, `.` for the root, with its gate command for each slot it declares. */
export interface DeclaredPackage {
  readonly path: string;
  readonly gates: Partial<Record<GateSlot, string>>;
}

export const DECLARED_ADAPTER = "declared";

/** One declared command, bound as the pack wrote it. */
export function declaredBinding(pkg: string, slot: GateSlot, command: string, at: string): Binding {
  return {
    schema_version: SCHEMA_VERSION,
    package: pkg,
    slot,
    adapter: DECLARED_ADAPTER,
    ref: command,
    resolved: command,
    config_hash: createHash("sha256").update(`${DECLARED_ADAPTER}:${pkg}:${slot}:${command}`).digest("hex"),
    executed_at: at,
    approved_by: "auto",
    status: "provisional",
  };
}

/** Every command a package declares, in slot order. */
export function declaredBindings(pkg: DeclaredPackage, at: string): Binding[] {
  return GATE_SLOTS.flatMap((slot) => {
    const command = pkg.gates[slot];
    return command === undefined ? [] : [declaredBinding(pkg.path, slot, command, at)];
  });
}

/** Grouped by package, root first; within a package, as bound. */
const byPackage = (a: Binding, b: Binding): number => comparePackages(a.package, b.package);

/**
 * An existing project's bindings with the declared commands no candidate bound
 * added, and a notice for each declared command a package's manifest answers
 * differently.
 */
export function withDeclared(bound: readonly Binding[], declared: readonly DeclaredPackage[], at: string): { readonly bindings: Binding[]; readonly notices: string[] } {
  const bindings = [...bound];
  const notices: string[] = [];
  for (const pkg of declared) {
    for (const binding of declaredBindings(pkg, at)) {
      const existing = bound.find((b) => b.package === binding.package && b.slot === binding.slot);
      if (existing === undefined) bindings.push(binding);
      else if (existing.resolved !== binding.resolved) {
        notices.push(
          `${gateLabel(existing)}: the pack declares \`${binding.resolved}\` under ## Packages, and the package's own manifest gives ` +
            `\`${existing.resolved}\`. The manifest's command is bound, since it is what the package runs (V-5′); amend one so they agree.`,
        );
      }
    }
  }
  return { bindings: bindings.sort(byPackage), notices };
}

/** The root, every package found, and every package declared, root first. */
export function packagesWith(found: readonly string[], declared: readonly DeclaredPackage[]): string[] {
  return [...new Set([ROOT_PACKAGE, ...found, ...declared.map((d) => d.path)])].sort(comparePackages);
}
