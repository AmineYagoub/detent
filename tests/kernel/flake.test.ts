import { afterEach, describe, expect, it } from "vitest";
import {
  RerunLedger,
  filterFlake,
  ledgerFor,
  quarantineTicket,
  type FlakeDecision,
  type FlakeInput,
} from "../../src/kernel/flake.js";
import { runGate, type GateResult } from "../../src/adapter/run.js";
import { errorSignature } from "../../src/kernel/classify.js";
import { createTicket } from "../../src/kernel/tickets/mutations.js";
import { readTicket, allTickets } from "../../src/kernel/tickets/readers.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * T-022 — flake filter (X-5, D-7, D-14).
 *
 * Three oracle ports live here: `test_run_and_flake_filter`,
 * `test_persistent_failure_survives_filter` (test_gates.py) and
 * `test_flake_charges_nothing_and_quarantines` (test_kernel_e2e.py). The third
 * drove the whole reference kernel; the run loop does not exist until T-041, so
 * it is ported at the level the plan's AC names — quarantine linked
 * `discovered_from`, zero fix budget consumed — against a real ticket store.
 */

const trees: string[] = [];
const tree = (files: Record<string, string> = {}): string => {
  const root = tmpTree(files);
  trees.push(root);
  return root;
};
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
});

const BUDGETS = { flake_reruns: 1 } as const;
const ledger = () => ledgerFor(BUDGETS);

/** A synthetic red result, for the cases that do not need a real process. */
function red(output: string, exitCode = 1): GateResult {
  return {
    slot: "test",
    command: "run tests",
    cwd: "/nowhere",
    outcome: "exited",
    green: false,
    exitCode,
    signal: null,
    normalizedExit: exitCode,
    output,
    outputBytes: output.length,
    truncated: false,
    durationMs: 1,
  };
}

function green(): GateResult {
  return { ...red("ok", 0), green: true, exitCode: 0, normalizedExit: 0, output: "ok" };
}

describe("T-022 oracle ports", () => {
  it("test_run_and_flake_filter: an intermittent failure reruns green and is quarantined", async () => {
    const root = tree({
      "g.sh": "#!/bin/sh\nif [ -f once ]; then rm once; echo 'connect ECONNREFUSED'; exit 1; fi\necho ok\nexit 0\n",
      once: "",
    });
    const run = () => runGate({ command: "sh g.sh", cwd: root, slot: "test" });
    const first = await run();
    expect(first.green).toBe(false);

    const decision = await filterFlake({ first, rerunInIsolation: run, ledger: ledger() });
    expect(decision.kind).toBe("quarantine");
    expect(decision.result.green).toBe(true);
  });

  it("test_persistent_failure_survives_filter: a failure that repeats enters the ladder", async () => {
    const root = tree({ "g.sh": "#!/bin/sh\necho 'connect ECONNREFUSED'; exit 1\n" });
    const run = () => runGate({ command: "sh g.sh", cwd: root, slot: "test" });
    const first = await run();

    const decision = await filterFlake({ first, rerunInIsolation: run, ledger: ledger() });
    expect(decision.kind).toBe("ladder");
    expect(decision.result.green).toBe(false);
  });

  it("test_flake_charges_nothing_and_quarantines: the quarantine is linked and nothing is charged", () => {
    const root = tree();
    const parent = createTicket(root, {
      id: "t1",
      type: "feature",
      title: "ship the feature",
      acceptance_criteria: ["it works"],
    });
    const before = parent.generations.at(-1)!.counters;

    const decision = {
      kind: "quarantine",
      result: green(),
      signature: "sig-1",
      firstOutput: "connect ECONNREFUSED",
    } as const;
    const child = quarantineTicket(root, "t1", decision, { id: "t1-flake-1" });

    expect(child.links).toContainEqual({ rel: "discovered_from", ref: "t1" });
    expect(readTicket(root, "t1").links).toContainEqual({ rel: "quarantines", ref: "t1-flake-1" });
    expect(allTickets(root).filter((t) => t.id.startsWith("t1-flake"))).toHaveLength(1);

    // Zero fix budget consumed: the filter is given no counters to charge.
    expect(readTicket(root, "t1").generations.at(-1)!.counters).toEqual(before);
  });
});

describe("T-022 D-14: a pattern never absolves a real regression", () => {
  it("adversarial — a real regression whose output matches a flake pattern enters the ladder", async () => {
    // A genuine assertion failure that happens to mention a reset connection.
    const output = "FAILED tests/test_totals.py::test_totals\nAssertionError: totals mismatch\nconnection reset by peer\n";
    let reruns = 0;
    const decision = await filterFlake({
      first: red(output),
      rerunInIsolation: async () => {
        reruns += 1;
        return red(output);
      },
      ledger: ledger(),
    });

    expect(reruns).toBe(1);
    expect(decision.kind).toBe("ladder");
    if (decision.kind !== "ladder") throw new Error("unreachable");
    expect(decision.reason).toBe("rerun-red");
    expect(decision.rerun).toBe(true);
  });

  it("an unsuspected failure spends no rerun and goes straight to the ladder", async () => {
    let reruns = 0;
    const decision = await filterFlake({
      first: red("AssertionError: totals mismatch\n"),
      rerunInIsolation: async () => {
        reruns += 1;
        return green();
      },
      ledger: ledger(),
    });

    expect(reruns).toBe(0);
    expect(decision.kind).toBe("ladder");
    if (decision.kind !== "ladder") throw new Error("unreachable");
    expect(decision.reason).toBe("not-suspected");
  });

  it("a green rerun is the only route to quarantine", async () => {
    const flaky = "connect ECONNREFUSED 127.0.0.1:5432\n";
    const quarantined = await filterFlake({
      first: red(flaky),
      rerunInIsolation: async () => green(),
      ledger: ledger(),
    });
    const laddered = await filterFlake({
      first: red(flaky),
      rerunInIsolation: async () => red(flaky),
      ledger: ledger(),
    });
    expect(quarantined.kind).toBe("quarantine");
    expect(laddered.kind).toBe("ladder");

    // And it is not merely a convention: the writer takes a QuarantineDecision,
    // so a ladder decision cannot be handed to it. `npm run typecheck` fails if
    // this stops being true.
    const root = tree();
    createTicket(root, { id: "t1", type: "feature", title: "t", acceptance_criteria: ["x"] });
    // @ts-expect-error a ladder decision is not evidence of a flake
    expect(() => quarantineTicket(root, "t1", laddered, { id: "t1-flake-1" })).toBeTypeOf("function");
  });
});

describe("T-022 flake_reruns ceiling (X-1)", () => {
  it("a second rerun of the same signature is unreachable, however many reds arrive", async () => {
    const output = "Error: listen EADDRINUSE :3000\n";
    const shared = new RerunLedger(BUDGETS.flake_reruns);
    let reruns = 0;
    const decisions: FlakeDecision[] = [];

    for (let i = 0; i < 50; i += 1) {
      decisions.push(
        await filterFlake({
          first: red(output),
          rerunInIsolation: async () => {
            reruns += 1;
            return red(output);
          },
          ledger: shared,
        }),
      );
    }

    expect(reruns).toBe(1);
    expect(shared.usedFor(errorSignature(output))).toBe(1);
    expect(decisions.every((d) => d.kind === "ladder")).toBe(true);
    expect(decisions.slice(1).every((d) => d.kind === "ladder" && d.reason === "rerun-budget-exhausted")).toBe(true);
  });

  it("each distinct signature carries its own allowance", async () => {
    const shared = new RerunLedger(1);
    let reruns = 0;
    const rerunInIsolation = async () => {
      reruns += 1;
      return red("still broken");
    };
    await filterFlake({ first: red("connect ECONNREFUSED a\n"), rerunInIsolation, ledger: shared });
    await filterFlake({ first: red("Error: listen EADDRINUSE :3000\n"), rerunInIsolation, ledger: shared });
    expect(reruns).toBe(2);
  });

  it("a ceiling of zero disables the rerun entirely rather than looping", async () => {
    let reruns = 0;
    const decision = await filterFlake({
      first: red("connect ECONNREFUSED\n"),
      rerunInIsolation: async () => {
        reruns += 1;
        return green();
      },
      ledger: ledgerFor({ flake_reruns: 0 }),
    });
    expect(reruns).toBe(0);
    expect(decision.kind).toBe("ladder");
  });

  it("the ledger is not optional — X-1's ceiling cannot be forgotten (P6)", () => {
    // A ledger a caller may omit hands every red gate a fresh allowance, which
    // is an X-1 ceiling silently disabled. The type is the enforcement, so this
    // is a compile-time assertion: `npm run typecheck` fails if it goes optional.
    // @ts-expect-error `ledger` is required
    const withoutLedger: FlakeInput = { first: red("x"), rerunInIsolation: async () => red("x") };
    expect(withoutLedger.ledger).toBeUndefined();
    expect(ledgerFor({ flake_reruns: 1 }).ceiling).toBe(1);
  });

  it("a green first result is passed through untouched", async () => {
    const decision = await filterFlake({
      first: green(),
      rerunInIsolation: async () => {
        throw new Error("must not rerun a green gate");
      },
      ledger: ledger(),
    });
    expect(decision.kind).toBe("green");
  });
});
