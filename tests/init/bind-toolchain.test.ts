import { describe, expect, it } from "vitest";
import { readBindings } from "../../src/adapter/drift.js";
import { determineVerification } from "../../src/init/bind.js";
import { GREENFIELD_COMMANDS } from "../../src/init/bind.js";
import { TOOLCHAINS, currentPlatform, headExecutable, probeExecutable, toolchainFor } from "../../src/adapter/toolchain.js";
import { ANALYSIS, repo } from "./plan-fixture.js";

/**
 * PRDR-273 — greenfield proposed `go test ./...` on a machine with no Go and
 * called the phase complete. Brownfield has executed its candidates since
 * C-3b; this is the greenfield half of that check.
 */
describe("PRDR-273 a greenfield binding is not written until its executable resolves", () => {
  const GO = {
    language: "Go 1.27 (multi-module monorepo under a committed root go.work)",
    runtime: "static Go binaries",
    test_framework: "Go standard-library testing",
    rationale: "D44",
    verification: { test: "go test ./...", lint: "go vet ./...", build: "go build ./..." },
  };

  it("a machine with no toolchain asks instead of binding", async () => {
    const root = repo({ "PRD.md": "# build it\n" });
    const outcome = await determineVerification({
      root,
      greenfield: true,
      analysis: ANALYSIS(GO) as never,
      probe: () => false,
      platform: "darwin",
    });
    expect(outcome.kind).toBe("interrupt");
    if (outcome.kind !== "interrupt") return;
    expect(outcome.interrupt).toBe("AWAIT_SETUP_CONSENT");
    expect(outcome.message).toContain("go");
    expect(outcome.message).toContain("brew install go");
  });

  it("one interrupt names every missing tool, not one stop per slot", async () => {
    const root = repo({ "PRD.md": "# build it\n" });
    const outcome = await determineVerification({
      root,
      greenfield: true,
      analysis: ANALYSIS(GO) as never,
      probe: () => false,
      platform: "darwin",
    });
    if (outcome.kind !== "interrupt") throw new Error(`expected interrupt, got ${outcome.kind}`);
    /** Three slots, one toolchain, one stop — `go` named once, not three times over. */
    expect(outcome.items).toEqual(["go"]);
    expect(outcome.message.match(/brew install go/g)?.length).toBe(1);
  });

  it("a resolvable toolchain binds exactly as before", async () => {
    const root = repo({ "PRD.md": "# build it\n" });
    const outcome = await determineVerification({
      root,
      greenfield: true,
      analysis: ANALYSIS(GO) as never,
      probe: () => true,
      platform: "darwin",
    });
    expect(outcome.kind).toBe("complete");
    const bindings = readBindings(root).bindings;
    expect(bindings.map((b) => b.slot).sort()).toEqual(["build", "lint", "test"]);
    expect(bindings.every((b) => b.status === "provisional" && b.adapter === "greenfield:go")).toBe(true);
  });

  it("names the platform's own command", async () => {
    const root = repo({ "PRD.md": "# build it\n" });
    const outcome = await determineVerification({
      root,
      greenfield: true,
      analysis: ANALYSIS(GO) as never,
      probe: () => false,
      platform: "linux",
    });
    if (outcome.kind !== "interrupt") throw new Error(`expected interrupt, got ${outcome.kind}`);
    expect(outcome.message).toContain("apt-get install");
    expect(outcome.message).not.toContain("brew install");
  });

  it("a language outside the table says so rather than inventing a command", async () => {
    const root = repo({ "PRD.md": "# build it\n" });
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
      probe: () => false,
      platform: "darwin",
    });
    if (outcome.kind !== "interrupt") throw new Error(`expected interrupt, got ${outcome.kind}`);
    expect(outcome.message).toContain("zig");
    expect(outcome.message).toContain("no install command is known");
  });

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
    /** An executable with no row is still probed — it just gets the common form. */
    expect(probeExecutable("zig", record)).toBe(true);
    expect(asked.at(-1)?.args).toEqual(["--version"]);
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
