import { describe, expect, it } from "vitest";
import { installToolchains, installReport, toolchainFor, type MissingToolchain } from "../../src/adapter/toolchain.js";

/**
 * PRDR-274 — a REQUIRED toolchain is installable under an operator's explicit
 * flag. The command run is the table's and nothing else, and the exit code is
 * not the check: `brew install` exits 0 on a formula already installed but not
 * linked.
 */
describe("PRDR-274 installing a required toolchain", () => {
  const goMissing: MissingToolchain = { exe: "go", slots: ["test", "lint", "build"], toolchain: toolchainFor("go") };

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

  it("an executable the table does not know is NEVER run", () => {
    const calls: string[] = [];
    const attempts = installToolchains(
      [{ exe: "zig", slots: ["test"], toolchain: null }],
      "darwin",
      (exe) => void calls.push(exe),
      () => true,
    );
    expect(calls, "an operator who approved installing Go approved nothing else").toEqual([]);
    expect(attempts[0]?.resolved).toBe(false);
    expect(attempts[0]?.command).toBeNull();
    expect(attempts[0]?.detail).toContain("no install command is known");
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
