import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { readBindings } from "../adapter/drift.js";
import { declaredScripts, hasLifecycleRecord, npmGateScripts, readApprovals, recordApprovals, statusOf, type DeclaredScript } from "../adapter/lifecycle.js";
import { lifecycleApproved } from "../adapter/normalize.js";
import { ROOT_PACKAGE, packageDir } from "../adapter/packages.js";
import { stateVersionRefusal } from "../kernel/migrate.js";

/**
 * V-1⁷ (PRDR-233) — `detent verify lifecycle`: a project's own lifecycle
 * scripts, shown with their bodies, and approved by name.
 *
 * Without `--approve` it lists, for each package, every lifecycle script its
 * manifest declares: the install's, and the `pre` and `post` of each bound npm
 * script gate, each with its body, its hash and whether it is approved. With
 * `--approve <script>` it shows that body and records it, on a terminal after
 * a [y/N], off one only with `--yes`. The approval holds the body shown: an
 * edited body is not approved until it is approved again.
 */

const USAGE = "usage: detent verify lifecycle [root] [--approve <script>]... [--package <dir>] [--yes]\n";

export interface LifecycleDeps {
  readonly approve: readonly string[];
  readonly package: string;
  /** Asked once, after the bodies to approve are shown; refusing records nothing. */
  readonly consent: (shown: readonly DeclaredScript[]) => Promise<boolean>;
  readonly write: (text: string) => void;
  readonly now?: () => string;
  readonly user?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/** Each package's declared lifecycle scripts: the install's, and the siblings of its bound npm script gates. */
function declared(root: string): { readonly packages: readonly string[]; readonly scripts: readonly DeclaredScript[] } {
  const file = readBindings(root);
  const scripts = file.packages.flatMap((pkg) => declaredScripts(packageDir(root, pkg), pkg, npmGateScripts(pkg, file.bindings)));
  return { packages: file.packages, scripts };
}

const where = (s: DeclaredScript): string => (s.package === ROOT_PACKAGE ? s.script : `${s.package}: ${s.script}`);

function show(s: DeclaredScript, status: string): string {
  return `  ${where(s)} — ${status}\n      ${s.body}\n      sha256 ${s.sha256}\n`;
}

/** What the run-wide switch does here, now that this project may have approvals on record (V-1⁷). */
function switchLine(root: string, env: NodeJS.ProcessEnv): string | null {
  if (!lifecycleApproved(env)) return null;
  return hasLifecycleRecord(root)
    ? "DETENT_ALLOW_LIFECYCLE_SCRIPTS=1 is set, and this project has approvals on record, so it is superseded here: a run runs the approved scripts and no others.\n"
    : "DETENT_ALLOW_LIFECYCLE_SCRIPTS=1 is set, and this project has no approval on record, so a run lifts suppression for every declared script.\n";
}

export async function verifyLifecycle(root: string, deps: LifecycleDeps): Promise<number> {
  const env = deps.env ?? process.env;
  const { packages, scripts } = declared(root);
  const approvals = readApprovals(root);
  if (deps.approve.length === 0) {
    deps.write(scripts.length === 0 ? `no lifecycle script is declared in ${root} (V-1⁷)\n` : `lifecycle scripts declared in ${root} (V-1⁷):\n`);
    for (const s of scripts) deps.write(show(s, statusOf(approvals, s)));
    if (scripts.length > 0) deps.write("Detent runs a declared script only once its body is approved: `detent verify lifecycle --approve <script> [--package <dir>]`.\n");
    const line = switchLine(root, env);
    if (line !== null) deps.write(line);
    return 0;
  }
  if (!packages.includes(deps.package)) {
    deps.write(`${deps.package} is not one of this project's packages: ${packages.join(", ")}\n`);
    return 2;
  }
  const own = scripts.filter((s) => s.package === deps.package);
  const unknown = deps.approve.filter((name) => !own.some((s) => s.script === name));
  if (unknown.length > 0) {
    deps.write(`not a lifecycle script ${deps.package === ROOT_PACKAGE ? "the root's" : `${deps.package}'s`} manifest declares: ${unknown.join(", ")}\n`);
    return 2;
  }
  const named = own.filter((s) => deps.approve.includes(s.script));
  for (const s of named.filter((n) => statusOf(approvals, n) === "approved")) deps.write(`${where(s)} is already approved as it stands\n`);
  const chosen = named.filter((s) => statusOf(approvals, s) !== "approved");
  if (chosen.length === 0) return 0;
  deps.write("to approve, as declared now:\n");
  for (const s of chosen) deps.write(show(s, statusOf(approvals, s)));
  if (!(await deps.consent(chosen))) {
    deps.write("declined — nothing is recorded, and Detent still runs none of them (V-1⁷).\n");
    return 2;
  }
  recordApprovals(root, chosen, deps.now?.() ?? new Date().toISOString(), deps.user ?? "operator");
  deps.write(`approved ${chosen.map(where).join(", ")}: a run runs ${chosen.length === 1 ? "it" : "each"} where npm would, as long as the body stays the one shown.\n`);
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { approve: { type: "string", multiple: true }, package: { type: "string", default: ROOT_PACKAGE }, yes: { type: "boolean", default: false } },
    });
  } catch {
    process.stderr.write(USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    process.stderr.write(USAGE);
    return 2;
  }
  const root = positionals[0] ?? process.cwd();
  /** F-3″ (PRDR-300): like `verify sync`, an older or newer state is refused before anything is read. */
  const refused = stateVersionRefusal(root);
  if (refused !== null) {
    process.stderr.write(`${refused}\n`);
    return 2;
  }
  const approve = values.approve ?? [];
  const interactive = process.stdout.isTTY === true && process.stdin.isTTY === true;
  if (approve.length > 0 && !interactive && values.yes !== true) {
    process.stderr.write("approving a lifecycle script lets a run execute its body, and is a human decision (V-1⁷) — re-run on a terminal, or pass --yes to accept that.\n");
    return 2;
  }
  return await verifyLifecycle(root, {
    approve,
    package: values.package,
    user: process.env["USER"] ?? "operator",
    write: (text) => process.stdout.write(text),
    consent: async () => {
      if (values.yes === true) return true;
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answered = await Promise.race([
          rl.question("Approve these bodies, so that a run executes them where npm would? [y/N] "),
          new Promise<string>((resolve) => rl.once("close", () => resolve("n"))),
        ]);
        return answered.trim().toLowerCase().startsWith("y");
      } finally {
        rl.close();
      }
    },
  });
}
