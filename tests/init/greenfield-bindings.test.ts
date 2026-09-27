import { describe, expect, it } from "vitest";
import { readBindings } from "../../src/adapter/drift.js";
import { determineVerification, languageKey } from "../../src/init/bind.js";
import { STACK, repo } from "./plan-fixture.js";

/**
 * PRDR-115 — greenfield init refused a Go project whose documents named all
 * three canonical gates: the planner wrote `stack.language` as a sentence and
 * the exact-match table lookup found nothing. The documents win now, and a
 * known language named anywhere in the string still finds its row. Since D-10′
 * (PRDR-290) the stack is the decision log's entry, whose gates are the
 * documented commands by slot, where ANALYZE's session copied them out.
 */
describe("PRDR-115 greenfield bindings come from the documents first", () => {
  it("a prose language string still resolves to its table row", () => {
    expect(languageKey("Go 1.27 (multi-module monorepo: controlplane/, agent/ under a committed root go.work)")).toBe("go");
    expect(languageKey("TypeScript")).toBe("typescript");
    expect(languageKey("Python 3.13 with uv")).toBe("python");
    expect(languageKey("COBOL")).toBeNull();
  });

  it("ksar's own case: Go named as prose, gates named by the documents", async () => {
    const root = repo({ "PRD.md": "# build it\n" });
    const outcome = await determineVerification({
      root,
      greenfield: true,
      stack: STACK("Go 1.27 (multi-module monorepo under a committed root go.work; NATS JetStream; containerd)", {
        test: "go test ./...",
        lint: "go vet ./...",
        build: "go build ./...",
      }),
    });
    if (outcome.kind !== "complete") throw new Error(`expected completion, got ${outcome.kind}: ${outcome.message}`);
    const bindings = readBindings(root).bindings;
    expect(bindings.map((b) => [b.slot, b.resolved]).sort()).toEqual([
      ["build", "go build ./..."],
      ["lint", "go vet ./..."],
      ["test", "go test ./..."],
    ]);
    expect(bindings.every((b) => b.status === "provisional" && b.adapter === "greenfield:go")).toBe(true);
  });

  it("documented commands override the table even when the language is known", async () => {
    const root = repo({ "PRD.md": "# build it\n" });
    const outcome = await determineVerification({
      root,
      greenfield: true,
      stack: STACK("TypeScript", { test: "pnpm test", lint: "pnpm lint" }),
    });
    expect(outcome.kind).toBe("complete");
    const bindings = readBindings(root).bindings;
    expect(bindings.find((b) => b.slot === "test")?.resolved).toBe("pnpm test");
    expect(bindings.find((b) => b.slot === "lint")?.resolved).toBe("pnpm lint");
    /** The table's typecheck/build rows are NOT mixed in: the documents' set is the set. */
    expect(bindings.find((b) => b.slot === "typecheck")).toBeUndefined();
  });

  it("an unknown language with documented commands still binds; with none it still asks", async () => {
    const bound = repo({ "PRD.md": "# build it\n" });
    const ok = await determineVerification({
      root: bound,
      greenfield: true,
      stack: STACK("Zig", { test: "zig build test" }),
    });
    expect(ok.kind).toBe("complete");
    expect(readBindings(bound).bindings.find((b) => b.slot === "test")?.adapter).toBe("greenfield:documented");

    const unbound = repo({ "PRD.md": "# build it\n" });
    const asks = await determineVerification({
      root: unbound,
      greenfield: true,
      stack: STACK("Zig"),
    });
    expect(asks.kind).toBe("interrupt");
    if (asks.kind === "interrupt") expect(asks.interrupt).toBe("AWAIT_SETUP_CONSENT");
  });
});
