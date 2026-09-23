import { afterEach, describe, expect, it, vi } from "vitest";
import { readBindings } from "../../src/adapter/drift.js";
import { determineVerification } from "../../src/init/bind.js";
import { GREENFIELD_COMMANDS } from "../../src/init/bind.js";
import { TOOLCHAINS, currentPlatform, headExecutable, probeExecutable, toolchainFor } from "../../src/adapter/toolchain.js";
import { ANALYSIS, repo } from "./plan-fixture.js";

/**
 * PRDR-273 — greenfield proposed `go test ./...` on a machine with no Go and
 * called the phase complete. PRDR-273 made the phase stop there, and PRDR-274
 * made it install; PRDR-276 moved both to `run`, because an approved plan's
 * `init` runs no phase at all (C-8). What is left here is the table the check
 * reads, and the phase's promise to bind without looking.
 */
describe("PRDR-276 greenfield binds provisional whatever the host has", () => {
  const GO = {
    language: "Go 1.27 (multi-module monorepo under a committed root go.work)",
    runtime: "static Go binaries",
    test_framework: "Go standard-library testing",
    rationale: "D44",
    verification: { test: "go test ./...", lint: "go vet ./...", build: "go build ./..." },
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * A PATH that resolves nothing, so the assertion does not depend on the host
   * running the suite: a phase that probed `go` here would find it missing on
   * every machine, and stop.
   */
  const noToolchains = (): void => void vi.stubEnv("PATH", "/nonexistent-prdr-276");

  it("a machine with no Go still binds the documented Go gates, provisional", async () => {
    const root = repo({ "PRD.md": "# build it\n" });
    noToolchains();
    const outcome = await determineVerification({ root, greenfield: true, analysis: ANALYSIS(GO) as never });
    if (outcome.kind !== "complete") throw new Error(`expected completion, got ${outcome.kind}: ${outcome.message}`);
    const bindings = readBindings(root).bindings;
    expect(bindings.map((b) => b.slot).sort()).toEqual(["build", "lint", "test"]);
    expect(bindings.every((b) => b.status === "provisional" && b.adapter === "greenfield:go")).toBe(true);
  });

  it("a language outside the table binds its documented command without a lookup", async () => {
    const root = repo({ "PRD.md": "# build it\n" });
    noToolchains();
    const outcome = await determineVerification({
      root,
      greenfield: true,
      analysis: ANALYSIS({
        language: "Zig",
        runtime: "",
        test_framework: "",
        rationale: "",
        verification: { test: "zig build test" },
      }) as never,
    });
    expect(outcome.kind).toBe("complete");
    expect(readBindings(root).bindings.find((b) => b.slot === "test")?.resolved).toBe("zig build test");
  });
});

describe("PRDR-273 the toolchain table", () => {
  it("probeExecutable reports what the runner did, and asks with the row's own proof", () => {
    const asked: { exe: string; args: readonly string[] }[] = [];
    const record = (exe: string, args: readonly string[]): void => void asked.push({ exe, args });
    expect(probeExecutable("go", record)).toBe(true);
    /** PRDR-198's `--help` does not generalise: `go --help` exits non-zero, so the row names `version`. */
    expect(asked).toEqual([{ exe: "go", args: ["version"] }]);

    expect(probeExecutable("mvn", record)).toBe(true);
    expect(asked.at(-1)?.args).toEqual(["-v"]);

    const thrower = (): void => {
      throw new Error("spawn ENOENT");
    };
    expect(probeExecutable("go", thrower)).toBe(false);
  });

  it("currentPlatform maps the host, and everything not darwin is the apt shape", () => {
    expect(currentPlatform("darwin")).toBe("darwin");
    expect(currentPlatform("linux")).toBe("linux");
    expect(currentPlatform("freebsd")).toBe("linux");
  });

  it("the head executable of every table command is the one the table probes", () => {
    expect(headExecutable("go test ./...")).toBe("go");
    expect(headExecutable("npm run test")).toBe("npm");
    expect(headExecutable("cargo test")).toBe("cargo");
    expect(headExecutable("  pytest  ")).toBe("pytest");
    expect(headExecutable("")).toBe("");
  });

  it("every executable the greenfield table can propose has a toolchain row", () => {
    const proposed = new Set(
      Object.values(GREENFIELD_COMMANDS).flatMap((cmds) => Object.values(cmds).map((c) => headExecutable(c))),
    );
    for (const exe of proposed) expect(toolchainFor(exe), `no toolchain row for \`${exe}\``).not.toBeNull();
  });

  it("every toolchain row is reachable from some gate command", () => {
    const proposed = new Set(
      Object.values(GREENFIELD_COMMANDS).flatMap((cmds) => Object.values(cmds).map((c) => headExecutable(c))),
    );
    /** The package-manager rows exist for PRDR-115 documented overrides (`pnpm test`), not for the table. */
    const overrides = new Set(["pnpm", "yarn"]);
    for (const t of TOOLCHAINS) {
      if (overrides.has(t.exe)) continue;
      expect(proposed.has(t.exe), `toolchain row \`${t.exe}\` is claimed but no gate command proposes it`).toBe(true);
    }
  });
});
