import type { Binding } from "../schemas/records.js";
import { bindAll, type BindAllOptions, type BindReport } from "./bind.js";
import type { Discovery } from "./discover/types.js";
import { discoverPackages, packageDir } from "./packages.js";
import type { GateSlot } from "./run.js";

/**
 * V-5′ (PRDR-295) — every package bound, each in its own directory.
 *
 * V-1 applies to each package as it applied to the root: every candidate is
 * executed before it binds, two plausible candidates are a question, and a
 * sole candidate that cannot run is refused. Each package's probe runs with
 * the package as its working directory, which is where its gates will run.
 */

export interface PackagesReport {
  readonly packages: readonly string[];
  readonly bindings: readonly Binding[];
  /** C-3b's two questions, each naming its package. */
  readonly interrupts: BindReport["interrupts"];
  /** The slots no candidate bound, by package. */
  readonly unbound: readonly { readonly package: string; readonly slot: GateSlot }[];
  readonly notices: readonly string[];
}

/** How one package is bound: `bindAll` in production, a double in a test. */
export type Binder = (discovery: Discovery, opts: BindAllOptions) => Promise<BindReport>;

export async function bindPackages(
  root: string,
  packages: readonly string[],
  opts: Omit<BindAllOptions, "root" | "package">,
  bind: Binder = bindAll,
): Promise<PackagesReport> {
  const bindings: Binding[] = [];
  const interrupts: BindReport["interrupts"][number][] = [];
  const unbound: { package: string; slot: GateSlot }[] = [];
  const notices: string[] = [];
  const found = discoverPackages(root, packages);
  for (const [pkg, discovery] of found) {
    const report = await bind(discovery, { ...opts, root: packageDir(root, pkg), package: pkg });
    bindings.push(...report.bindings);
    interrupts.push(...report.interrupts);
    unbound.push(...report.unbound.map((slot) => ({ package: pkg, slot })));
    notices.push(...report.notices);
  }
  return { packages: [...found.keys()], bindings, interrupts, unbound, notices };
}
