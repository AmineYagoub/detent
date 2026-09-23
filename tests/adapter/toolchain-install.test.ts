import { describe, expect, it } from "vitest";
import {
  installToolchains,
  installReport,
  missingToolchains,
  probeExecutable,
  toolchainFor,
  toolchainSetupMessage,
  type MissingToolchain,
  type Toolchain,
} from "../../src/adapter/toolchain.js";

/**
 * PRDR-274 — a REQUIRED toolchain is installable on an operator's explicit
 * answer. The command run is the table's and nothing else, and the exit code is
 * not the check: `brew install` exits 0 on a formula already installed but not
 * linked.
 */

function row(exe: string): Toolchain {
  const t = toolchainFor(exe);
  if (t === null) throw new Error(`no toolchain row for ${exe}`);
  return t;
}

describe("PRDR-274 installing a required toolchain", () => {
  const goMissing: MissingToolchain = { exe: "go", slots: ["test", "lint", "build"], toolchain: row("go") };

  it("runs the table's command as argv, never through a shell", () => {
    const calls: { exe: string; args: readonly string[] }[] = [];
    const attempts = installToolchains(
      [goMissing],
      "darwin",
      (exe, args) => void calls.push({ exe, args }),
      () => true,
    );
    expect(calls).toEqual([{ exe: "brew", args: ["install", "go"] }]);
    expect(attempts[0]?.resolved).toBe(true);
    expect(attempts[0]?.command).toBe("brew install go");
  });

  it("uses the platform's own command", () => {
    const calls: { exe: string; args: readonly string[] }[] = [];
    installToolchains([goMissing], "linux", (exe, args) => void calls.push({ exe, args }), () => true);
    expect(calls[0]).toEqual({ exe: "sudo", args: ["apt-get", "install", "-y", "golang-go"] });
  });

  it("a command that exits 0 but leaves nothing on PATH is not resolved", () => {
    const attempts = installToolchains([goMissing], "darwin", () => undefined, () => false);
    expect(attempts[0]?.resolved, "brew exits 0 on an unlinked formula").toBe(false);
    expect(attempts[0]?.detail).toContain("still does not run");
  });

  it("a failing install carries its reason and does not resolve", () => {
    const attempts = installToolchains(
      [goMissing],
      "darwin",
      () => {
        throw new Error("brew: command not found\nstack noise");
      },
      () => true,
    );
    expect(attempts[0]?.resolved).toBe(false);
    expect(attempts[0]?.detail).toContain("install failed: brew: command not found");
    expect(attempts[0]?.detail, "only the first line").not.toContain("stack noise");
  });

  it("the report names each executable, its command and its outcome", () => {
    const attempts = installToolchains([goMissing], "darwin", () => undefined, () => false);
    const text = installReport(attempts);
    expect(text).toContain("go:");
    expect(text).toContain("brew install go");
    expect(text).toContain("still does not run");
  });
});

/**
 * PRDR-276 — only a table executable is probed, at either layer. A binding's
 * head may be the project's own script, which the plan itself may create (C-4);
 * probing it would execute project code before a single gate had run.
 */
describe("PRDR-276 the table is the only thing probed", () => {
  const BOUND = [
    { slot: "test", resolved: "go test ./..." },
    { slot: "lint", resolved: "./scripts/lint.sh --strict" },
    { slot: "build", resolved: "go build ./..." },
    { slot: "typecheck", resolved: "zig build check" },
  ];

  it("missingToolchains never probes a head the table does not know", () => {
    const probed: string[] = [];
    const missing = missingToolchains(BOUND, (exe) => {
      probed.push(exe);
      return false;
    });
    expect(probed, "each table executable once, and nothing else").toEqual(["go"]);
    expect(missing.map((m) => m.exe)).toEqual(["go"]);
    expect(missing[0]?.slots, "every slot the one absence blocks").toEqual(["test", "build"]);
  });

  it("a head the table knows and that runs is not missing", () => {
    expect(missingToolchains(BOUND, () => true)).toEqual([]);
  });

  it("probeExecutable executes nothing for an executable with no row", () => {
    const asked: string[] = [];
    const record = (exe: string): void => void asked.push(exe);
    expect(probeExecutable("./scripts/lint.sh", record)).toBe(false);
    expect(probeExecutable("zig", record)).toBe(false);
    expect(asked, "no row, no execution — not even `--version`").toEqual([]);
  });
});

describe("PRDR-276 what the operator is shown before `run` asks", () => {
  const missing: MissingToolchain[] = [{ exe: "go", slots: ["test", "lint", "build"], toolchain: row("go") }];

  it("names the executable once, the slots it blocks, and the platform's command", () => {
    const text = toolchainSetupMessage(missing, "darwin");
    expect(text).toContain("macOS (Homebrew)");
    expect(text).toContain("go — needed by test, lint, build");
    expect(text.match(/brew install go/g)?.length, "one absence, one command").toBe(1);
    expect(text).toContain("only with your approval");
  });

  it("on Linux it names apt, and never the other platform's command", () => {
    const text = toolchainSetupMessage(missing, "linux");
    expect(text).toContain("Linux (Debian/apt)");
    expect(text).toContain("sudo apt-get install -y golang-go");
    expect(text).not.toContain("brew install");
  });

  it("sends the operator nowhere else — `init` no longer checks or installs", () => {
    expect(toolchainSetupMessage(missing, "darwin")).not.toContain("init");
  });
});
