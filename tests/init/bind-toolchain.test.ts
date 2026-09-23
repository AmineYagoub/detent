import { describe, expect, it } from "vitest";
import { readBindings } from "../../src/adapter/drift.js";
import { determineVerification } from "../../src/init/bind.js";
import { GREENFIELD_COMMANDS } from "../../src/init/bind.js";
import { TOOLCHAINS, currentPlatform, headExecutable, probeExecutable, toolchainFor } from "../../src/adapter/toolchain.js";
import { ANALYSIS, repo } from "./plan-fixture.js";
import { buildPipeline } from "../../src/init/pipeline.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { CEILINGS } from "../../src/schemas/budgets.js";
import type { Budgets } from "../../src/schemas/budgets.js";

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
    /** PRDR-274: the table has a command, so the flag that runs it is offered. */
    expect(outcome.message).toContain("detent init --install-toolchain");
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
    /** PRDR-274: no row, no offer — a flag that cannot help this operator is not named to them. */
    expect(outcome.message).not.toContain("--install-toolchain");
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

/**
 * PRDR-274 — the same absence, now installable. Only under the operator's own
 * flag, only a command from Detent's table, and only believed once the same
 * probe that found the absence re-runs.
 */
describe("PRDR-274 a required toolchain is installable under explicit approval", () => {
  const GO = {
    language: "Go 1.27 (multi-module monorepo under a committed root go.work)",
    runtime: "static Go binaries",
    test_framework: "Go standard-library testing",
    rationale: "D44",
    verification: { test: "go test ./...", lint: "go vet ./...", build: "go build ./..." },
  };

  it("without the flag nothing is run — PRDR-273's behaviour, unchanged", async () => {
    const ran: string[] = [];
    const outcome = await determineVerification({
      root: repo({ "PRD.md": "# build it\n" }),
      greenfield: true,
      analysis: ANALYSIS(GO) as never,
      probe: () => false,
      platform: "darwin",
      runInstall: (exe) => void ran.push(exe),
    });
    expect(outcome.kind).toBe("interrupt");
    expect(ran, "a runner passed but not approved is still never called").toEqual([]);
  });

  it("with the flag the named command runs and the binding completes", async () => {
    const ran: { exe: string; args: readonly string[] }[] = [];
    let installed = false;
    const root = repo({ "PRD.md": "# build it\n" });
    const outcome = await determineVerification({
      root,
      greenfield: true,
      analysis: ANALYSIS(GO) as never,
      probe: () => installed,
      platform: "darwin",
      installToolchain: true,
      runInstall: (exe, args) => {
        ran.push({ exe, args });
        installed = true;
      },
    });
    expect(ran).toEqual([{ exe: "brew", args: ["install", "go"] }]);
    expect(outcome.kind).toBe("complete");
    expect(readBindings(root).bindings.map((b) => b.slot).sort()).toEqual(["build", "lint", "test"]);
  });

  it("an install that resolves nothing raises the interrupt again, saying what it tried", async () => {
    const notes: string[] = [];
    const outcome = await determineVerification({
      root: repo({ "PRD.md": "# build it\n" }),
      greenfield: true,
      analysis: ANALYSIS(GO) as never,
      probe: () => false,
      platform: "darwin",
      installToolchain: true,
      runInstall: () => undefined,
      note: (text) => void notes.push(text),
    });
    if (outcome.kind !== "interrupt") throw new Error(`expected interrupt, got ${outcome.kind}`);
    expect(outcome.message).toContain("did not resolve");
    expect(outcome.message).toContain("brew install go");
    expect(outcome.items).toEqual(["go"]);
    /** PRDR-211's precedent: a command Detent ran on the operator's machine is recorded. */
    expect(notes.some((n) => n.includes("PRDR-274") && n.includes("brew install go"))).toBe(true);
  });

  it("an approved install is not approval to run something the table does not know", async () => {
    const ran: string[] = [];
    const outcome = await determineVerification({
      root: repo({ "PRD.md": "# build it\n" }),
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
      installToolchain: true,
      runInstall: (exe) => void ran.push(exe),
    });
    expect(ran).toEqual([]);
    if (outcome.kind !== "interrupt") throw new Error(`expected interrupt, got ${outcome.kind}`);
    expect(outcome.message).toContain("no install command is known");
  });
});

/**
 * PRDR-274 — the wiring, not the adapter.
 *
 * PRDR-156's note in `pipeline.ts` records the failure this guards: a feature
 * complete and covered at the adapter layer, forwarded by every handler but
 * one, therefore unreachable, therefore green. `installToolchain` reaching
 * `determineVerification` is asserted through the handler the pipeline builds
 * rather than by reading the call site.
 */
describe("PRDR-274 the DETERMINE handler forwards the approval and its seams", () => {
  const BUDGETS = Object.fromEntries(
    Object.entries(CEILINGS).map(([k, spec]) => [k, "default" in spec ? (spec as { default: number }).default : 25]),
  ) as Budgets;

  const GO = {
    language: "Go",
    runtime: "static Go binaries",
    test_framework: "Go standard-library testing",
    rationale: "D44",
    verification: { test: "go test ./...", lint: "go vet ./...", build: "go build ./..." },
  };

  function determineHandler(root: string, extra: Record<string, unknown>) {
    const handlers = buildPipeline({
      root,
      backend: new MockBackend(),
      prompts: loadPromptSet(),
      budgets: BUDGETS,
      ...extra,
    } as never);
    const handler = handlers.find((h) => h.phase === "DETERMINE_VERIFICATION");
    if (handler === undefined) throw new Error("no DETERMINE_VERIFICATION handler");
    return handler;
  }

  /**
   * What `runInit` hands a handler. `analysisFromOutputs` reads
   * `outputs.ANALYZE.analysis` and returns null for anything it cannot parse —
   * and a null analysis raises its OWN `AWAIT_SETUP_CONSENT`, so the first
   * assertion below names the toolchain message rather than just the kind.
   */
  const ctx = { outputs: { ANALYZE: { greenfield: true, analysis: ANALYSIS(GO) } } };

  it("an unapproved run reaches the adapter with no approval and installs nothing", async () => {
    const ran: string[] = [];
    const outcome = await determineHandler(repo({ "PRD.md": "# build it\n" }), {
      probe: () => false,
      runInstall: (exe: string) => void ran.push(exe),
    }).run(ctx as never);
    if (outcome.kind !== "interrupt") throw new Error(`expected interrupt, got ${outcome.kind}`);
    expect(outcome.message, "the toolchain stop, not the no-stack one").toContain("brew install go");
    expect(ran).toEqual([]);
  });

  it("an approved run reaches the adapter with the approval, and the install runs", async () => {
    const ran: string[] = [];
    let installed = false;
    const outcome = await determineHandler(repo({ "PRD.md": "# build it\n" }), {
      installToolchain: true,
      probe: () => installed,
      runInstall: (exe: string, args: readonly string[]) => {
        ran.push([exe, ...args].join(" "));
        installed = true;
      },
    }).run(ctx as never);
    expect(ran, "the table's command, reached through the pipeline").toEqual(["brew install go"]);
    expect(outcome.kind).toBe("complete");
  });
});
