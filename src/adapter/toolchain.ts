import { execFileSync } from "node:child_process";
import { platform as osPlatform } from "node:process";

/**
 * PRDR-273 — the executable a bound gate invokes, and what installs it.
 *
 * Brownfield binding has executed its candidates since C-3b: a command that
 * will not run raises `AWAIT_SETUP_CONSENT` rather than binding. Greenfield
 * proposes commands from a stack table and writes them `provisional` without
 * resolving anything, because C-4 reads the absence as "the project has not
 * built its tooling yet — bootstrap #1 will". That reading is right for a
 * `package.json` ticket #1 writes and wrong for a compiler no ticket can
 * install, and the two absences are indistinguishable at that layer.
 *
 * Keyed by EXECUTABLE rather than by language, because the command actually
 * bound is not always the table's. PRDR-115 gives the documents' own
 * `stack.verification` priority, so a TypeScript project that names
 * `pnpm test` must be probed for `pnpm` and told about `pnpm` — a row keyed
 * `typescript` would name `npm`, which is not what would have run.
 */

/** The platforms whose package managers this table knows. */
export type Platform = "darwin" | "linux";

export interface Toolchain {
  /** The executable a gate command invokes, as `headExecutable` returns it. */
  readonly exe: string;
  /** What an operator would call the thing being installed. */
  readonly provides: string;
  /**
   * Arguments that prove the executable runs, per row.
   *
   * PRDR-198 settled `--help` for the single pinned symbol server, and it does
   * not generalise: `go --help` exits non-zero, `java -version` writes to
   * stderr, and `dotnet --version` differs again. A shared convention across
   * nine toolchains would report a working install as missing, which is the
   * failure PRDR-198 itself was filed for.
   */
  readonly proof: readonly string[];
  readonly install: Readonly<Record<Platform, string>>;
}

/**
 * PRDR-273: every executable `GREENFIELD_COMMANDS` can propose, and the
 * common package managers that provide it. A row here without a gate command
 * anywhere is a claim of support nothing exercises; a gate command whose
 * executable has no row is the defect this module closes, reintroduced. The
 * suite asserts both directions.
 *
 * `linux` is Debian/apt, named as such in the message rather than implied:
 * a dnf or apk host gets a command it can translate, not a wrong one it might
 * paste.
 */
export const TOOLCHAINS: readonly Toolchain[] = [
  {
    exe: "go",
    provides: "Go",
    proof: ["version"],
    install: { darwin: "brew install go", linux: "sudo apt-get install -y golang-go" },
  },
  {
    exe: "npm",
    provides: "Node.js (npm)",
    proof: ["--version"],
    install: { darwin: "brew install node", linux: "sudo apt-get install -y nodejs npm" },
  },
  {
    exe: "pnpm",
    provides: "pnpm",
    proof: ["--version"],
    install: { darwin: "brew install pnpm", linux: "corepack enable pnpm" },
  },
  {
    exe: "yarn",
    provides: "Yarn",
    proof: ["--version"],
    install: { darwin: "brew install yarn", linux: "corepack enable yarn" },
  },
  {
    exe: "pytest",
    provides: "pytest",
    proof: ["--version"],
    install: { darwin: "uv tool install pytest", linux: "uv tool install pytest" },
  },
  {
    exe: "ruff",
    provides: "Ruff",
    proof: ["--version"],
    install: { darwin: "uv tool install ruff", linux: "uv tool install ruff" },
  },
  {
    exe: "mypy",
    provides: "mypy",
    proof: ["--version"],
    install: { darwin: "uv tool install mypy", linux: "uv tool install mypy" },
  },
  {
    exe: "cargo",
    provides: "Rust (cargo)",
    proof: ["--version"],
    install: { darwin: "brew install rust", linux: "sudo apt-get install -y cargo" },
  },
  {
    exe: "mvn",
    provides: "Maven (JVM)",
    proof: ["-v"],
    install: { darwin: "brew install maven", linux: "sudo apt-get install -y maven" },
  },
  {
    exe: "bundle",
    provides: "Ruby (bundler)",
    proof: ["--version"],
    install: { darwin: "brew install ruby", linux: "sudo apt-get install -y ruby-bundler" },
  },
  {
    exe: "dotnet",
    provides: ".NET SDK",
    proof: ["--version"],
    install: { darwin: "brew install --cask dotnet-sdk", linux: "sudo apt-get install -y dotnet-sdk-8.0" },
  },
  {
    exe: "composer",
    provides: "PHP (composer)",
    proof: ["--version"],
    install: { darwin: "brew install composer", linux: "sudo apt-get install -y composer" },
  },
];

/**
 * The executable a gate command invokes: its first word.
 *
 * Deliberately naive. A bound command is one an operator or the table wrote,
 * not a shell script — `go test ./...` and `npm run test` are the shapes that
 * exist, and a command whose first word is not its executable (`env X=1 go
 * test`) would be a binding V-1 should have rejected long before here.
 */
export function headExecutable(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

/** The row for an executable, or null when nothing in the table provides it. */
export function toolchainFor(exe: string): Toolchain | null {
  return TOOLCHAINS.find((t) => t.exe === exe) ?? null;
}

/**
 * This host, when the table knows it; Debian/apt is the fallback shape.
 *
 * PRDR-273: takes the platform string rather than reading the import directly,
 * so the branch is reachable from a fixture. A module-level `process.platform`
 * read makes one of the two outcomes untestable on any given CI host.
 */
export function currentPlatform(host: string = osPlatform): Platform {
  return host === "darwin" ? "darwin" : "linux";
}

/**
 * Whether the executable resolves AND runs. Resolving alone is not enough —
 * a shim on PATH pointing at a removed toolchain is exactly the state this
 * machine was in, with `task` left in `~/go/bin` after the Go that installed
 * it was gone.
 */
export function probeExecutable(exe: string, run: (exe: string, args: readonly string[]) => void = defaultRun): boolean {
  const row = toolchainFor(exe);
  try {
    run(exe, row?.proof ?? ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function defaultRun(exe: string, args: readonly string[]): void {
  execFileSync(exe, [...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
}

/** One missing executable, with whatever the table can say about installing it. */
export interface MissingToolchain {
  readonly exe: string;
  readonly slots: readonly string[];
  readonly toolchain: Toolchain | null;
}

/**
 * PRDR-273: the missing executables behind a set of proposed bindings, each
 * carrying the slots that need it.
 *
 * Grouped by executable rather than listed per slot: an operator missing Go is
 * missing it for `test`, `lint` and `build` at once, and three stops for one
 * absence is the same fact three times.
 */
export function missingToolchains(
  bound: readonly { readonly slot: string; readonly resolved: string }[],
  probe: (exe: string) => boolean = probeExecutable,
): MissingToolchain[] {
  const bySlot = new Map<string, string[]>();
  for (const b of bound) {
    const exe = headExecutable(b.resolved);
    if (exe === "") continue;
    bySlot.set(exe, [...(bySlot.get(exe) ?? []), b.slot]);
  }
  const missing: MissingToolchain[] = [];
  for (const [exe, slots] of bySlot) {
    if (probe(exe)) continue;
    missing.push({ exe, slots, toolchain: toolchainFor(exe) });
  }
  return missing;
}

/** PRDR-274: one attempted install, and whether the executable resolves afterwards. */
export interface InstallAttempt {
  readonly exe: string;
  /** The table's command, or null for an executable the table does not know. */
  readonly command: string | null;
  readonly resolved: boolean;
  readonly detail: string;
}

/**
 * PRDR-274 — install a REQUIRED toolchain, under an operator's explicit flag.
 *
 * The command run is `TOOLCHAINS[n].install[platform]` and nothing else. Never
 * a string from `.detent/config.json`, which is repository content; never one
 * from a planning document. PRDR-123 settled this for the symbol server and it
 * applies with more force here, because a toolchain installer is expected to
 * run with elevated privilege and to fetch from the network: an unrestricted
 * string would let a repository point the orchestrator at an executable it
 * shipped. The table is the allowlist, and a row-less executable is named but
 * never run.
 *
 * Split to argv rather than handed to a shell. Every row is a plain
 * space-separated command line, so no shell is needed — and not having one
 * means no metacharacter in any future row can become an injection.
 *
 * The exit code is not the check. `brew install` exits 0 on a formula that is
 * already installed but not linked, and `sudo apt-get` fails differently on a
 * host with no sudo than on one with no package, so each attempt is followed
 * by the same probe that found the absence.
 */
export function installToolchains(
  missing: readonly MissingToolchain[],
  platform: Platform,
  run: (exe: string, args: readonly string[]) => void,
  probe: (exe: string) => boolean = probeExecutable,
): InstallAttempt[] {
  const attempts: InstallAttempt[] = [];
  for (const m of missing) {
    if (m.toolchain === null) {
      attempts.push({ exe: m.exe, command: null, resolved: false, detail: "no install command is known; not run" });
      continue;
    }
    const command = m.toolchain.install[platform];
    const [head, ...args] = command.split(/\s+/);
    if (head === undefined) {
      attempts.push({ exe: m.exe, command, resolved: false, detail: "empty install command" });
      continue;
    }
    try {
      run(head, args);
    } catch (err) {
      attempts.push({ exe: m.exe, command, resolved: false, detail: `install failed: ${(err as Error).message.split("\n")[0] ?? "unknown"}` });
      continue;
    }
    const resolved = probe(m.exe);
    attempts.push({
      exe: m.exe,
      command,
      resolved,
      detail: resolved ? "installed and resolves" : "install reported success but the executable still does not run",
    });
  }
  return attempts;
}

/** PRDR-274: the default runner — argv, no shell. */
export function runInstallCommand(exe: string, args: readonly string[]): void {
  execFileSync(exe, [...args], { stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 });
}

/** PRDR-274: what an operator is told after an approved install did not finish the job. */
export function installReport(attempts: readonly InstallAttempt[]): string {
  return attempts.map((a) => `  ${a.exe}: ${a.command ?? "(no command)"} — ${a.detail}`).join("\n");
}

/**
 * PRDR-273: what the operator is shown. Names the platform it resolved, every
 * missing executable with the slots it blocks, and the command that installs
 * it — or says plainly that none is known, which is the honest answer for a
 * language outside the table and better than a guess an operator might paste.
 *
 * PRDR-274: offers the flag that runs them, but only when the table actually
 * has a command to run — telling an operator missing `zig` to pass
 * `--install-toolchain` would be an offer Detent cannot keep, which is the
 * doc-claim drift this repository exists to catch, in a message instead of a
 * doc-block.
 */
export function toolchainSetupMessage(missing: readonly MissingToolchain[], platform: Platform): string {
  const host = platform === "darwin" ? "macOS (Homebrew)" : "Linux (Debian/apt)";
  const lines = [
    `The verification commands for this stack need tooling this machine does not have (${host}):`,
    "",
  ];
  for (const m of missing) {
    lines.push(`  ${m.exe} — needed by ${m.slots.join(", ")}`);
    lines.push(
      m.toolchain === null
        ? `    no install command is known for \`${m.exe}\`; install it and re-run \`detent init\``
        : `    ${m.toolchain.install[platform]}      (${m.toolchain.provides})`,
    );
  }
  const installable = missing.some((m) => m.toolchain !== null);
  lines.push("", "Detent binds to what the machine has rather than changing it (D-4/F-2), so it has run nothing.");
  if (installable) {
    lines.push(
      "Re-run `detent init --install-toolchain` to have Detent run the commands above, or run them yourself and re-run `detent init`.",
    );
  } else {
    lines.push("Install what is listed above and re-run `detent init`.");
  }
  return lines.join("\n");
}
