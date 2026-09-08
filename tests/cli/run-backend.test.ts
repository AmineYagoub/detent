import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { main as runMain } from "../../src/cli/run.js";
import { stateDir } from "../../src/fs/layout.js";
import { addTicket, implementGreen, makeRunRepo, reviewApprove } from "../kernel/run-fixture.js";
import { removeTree } from "../helpers.js";
import { MockBackend } from "../../src/sessions/mock.js";

/**
 * C-14″ (PRDR-129) — the porcelain runs LIVE.
 *
 * `detent run` defaulted to the fixture backend while `referee` defaulted to
 * the live one and `init` refused the fixture outright. The README's golden
 * path is two commands, test-locked to exactly `detent init` and `detent run`
 * with no flag, so the documented public workflow executed a fake — and a
 * fake whose result shape is indistinguishable from a real session: fabricated
 * telemetry into the real ledger, real journal events, real counters consumed.
 *
 * These assert on the CLI entry point rather than on the option table, because
 * a default is only true if the thing it feeds actually receives it.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});

/** The per-run config audit event — what governed every session of the run. */
function configEvent(root: string): Record<string, unknown> {
  const file = path.join(stateDir(root), "runs", "run", "journal.jsonl");
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const config = rows.find((r) => r["event"] === "config");
  if (config === undefined) throw new Error("no config event in the run journal");
  return config;
}

describe("C-14″ the porcelain runs live, and the journal says which backend ran", () => {
  /**
   * PRDR-174: the seam, not the empty pool.
   *
   * This relied on `makeRunRepo()` seeding zero tickets — so the live default
   * was safe only because nothing was there to run. Adding one ticket to that
   * shared fixture made the identical call reach `ClaudeCodeBackend.run` three
   * times, and no `DETENT_NO_LIVE` enforcement exists anywhere in the suite.
   * The ticket below is deliberate: it proves the default reaches the pool AND
   * that what it reaches is the injected builder, so this test can never spend
   * however the fixture evolves.
   */
  it("`detent run` with no --backend uses the LIVE backend", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    addTicket(root, { id: "t-1" });
    let built = 0;
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await runMain([root], {
        buildBackend: () => {
          built += 1;
          return new MockBackend({ implement: implementGreen, review: reviewApprove });
        },
      });
      /**
       * The C-14″ property, asserted directly: with no flag, `main` reaches the
       * LIVE builder. Previously this was inferred from the journal's
       * `"claude-code"` string, which only held because nothing was injected —
       * and only stayed safe because the fixture had no tickets to run.
       */
      expect(built, "with no --backend, main builds the live backend").toBe(1);
      /* And the journal names whichever backend actually ran — here, the injected one. */
      expect(configEvent(root)["backend"]).toBe("mock");
      /**
       * PRDR-179: the banner follows what RAN. This asserted the opposite —
       * that an injected fixture ran silently, because the banner was keyed on
       * the flag rather than the backend — codifying exactly the divergence
       * C-14″ exists to forbid.
       */
      expect(err.mock.calls.join(""), "an injected fixture is still a fixture and must announce itself").toContain(
        "FIXTURE backend",
      );
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("a fixture run announces itself on stderr before anything is spent", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await runMain([root, "--backend", "mock"]);
      const text = err.mock.calls.join("");
      expect(text).toContain("FIXTURE backend");
      expect(text).toContain("--backend claude");
    } finally {
      err.mockRestore();
    }
  });

  /**
   * `SessionBackend.name` existed with zero readers, so a journal could not
   * answer "was this real?" even after the fact: a fixture run and a live run
   * left identical records. This is the reader.
   */
  it("the run journal records the fixture backend by name", async () => {
    const { root } = await makeRunRepo();
    roots.push(root);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await runMain([root, "--backend", "mock"]);
      expect(configEvent(root)["backend"]).toBe("mock");
    } finally {
      err.mockRestore();
    }
  });
});
