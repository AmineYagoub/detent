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

/**
 * PRDR-273: what the operator is shown. Names the platform it resolved, every
 * missing executable with the slots it blocks, and the command that installs
 * it — or says plainly that none is known, which is the honest answer for a
 * language outside the table and better than a guess an operator might paste.
 *
 * States that Detent will not run these itself (D-4/F-2). PRDR-274 revisits
 * that for a REQUIRED toolchain under explicit approval; until it lands, this
 * sentence is true.
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
  lines.push("", "Detent does not install tooling — it binds to what the machine has (D-4/F-2).");
  lines.push("Install what is listed above and re-run `detent init`.");
  return lines.join("\n");
}
