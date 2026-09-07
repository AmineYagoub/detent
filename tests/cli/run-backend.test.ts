import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { main as runMain } from "../../src/cli/run.js";
import { stateDir } from "../../src/fs/layout.js";
import { makeRunRepo } from "../kernel/run-fixture.js";
import { removeTree } from "../helpers.js";

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
  it("`detent run` with no --backend uses the LIVE backend", async () => {
    /* An empty pool finishes without launching a session, so this needs no credentials. */
    const { root } = await makeRunRepo();
    roots.push(root);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await runMain([root]);
      expect(configEvent(root)["backend"]).toBe("claude-code");
      /* A live run says nothing about backends — the banner is for the fixture. */
      expect(err.mock.calls.join("")).not.toContain("FIXTURE backend");
    } finally {
      err.mockRestore();
    }
  });

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
