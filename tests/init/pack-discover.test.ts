import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discover as discoverStack } from "../../src/adapter/discover/index.js";
import { DOC_PATTERNS, discoverDocs } from "../../src/init/discover-docs.js";
import { listingDigest, runInit, type PhaseHandler } from "../../src/init/machine.js";
import { buildPipeline, type PipelineDeps } from "../../src/init/pipeline.js";
import { CEILINGS, type Budgets } from "../../src/schemas/budgets.js";
import { MockBackend } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { commitRecord, oracleRecord, packRepo } from "./pack-fixture.js";

/**
 * PRDR-279 — DISCOVER tells a conforming pack from a changed one and from a
 * raw document set (C-2⁶, C-2⁷), and `archive/` is outside every discovery
 * glob.
 */

const PROMPTS = loadPromptSet();
const BUDGETS = Object.fromEntries(Object.entries(CEILINGS).map(([k, s]) => [k, s.default])) as Budgets;

/** INIT_FS and DISCOVER only: what DISCOVER records is the whole question here. */
function discoverOnly(root: string, notes: string[], extra: Partial<PipelineDeps> = {}): PhaseHandler[] {
  return buildPipeline({
    root,
    backend: new MockBackend(),
    prompts: PROMPTS,
    budgets: BUDGETS,
    note: (text) => notes.push(text),
    ...extra,
  }).filter((h) => h.phase === "INIT_FS" || h.phase === "DISCOVER");
}

async function discover(root: string, extra: Partial<PipelineDeps> = {}) {
  const notes: string[] = [];
  const result = await runInit(root, discoverOnly(root, notes, extra));
  expect(result.exitCode).toBe(0);
  return { result, notes, pack: result.outputs["DISCOVER"]?.["pack"] as Record<string, unknown> | undefined };
}

describe("PRDR-279: DISCOVER classifies the document set (C-2⁷)", () => {
  it("records a pack whose hash matches and whose checker was green as conforming", async () => {
    const root = packRepo();
    const record = oracleRecord(root);
    commitRecord(root, record);

    const { pack, notes } = await discover(root);

    expect(pack).toEqual({ kind: "conforming", date: "2026-09-26", hash: record["hash"] });
    expect(notes.join("\n")).toMatch(/conforming pack/u);
  });

  it("does not call a pack conforming when its record says the checker was red", async () => {
    const root = packRepo();
    commitRecord(root, oracleRecord(root, { green: false }));

    const { pack } = await discover(root);

    expect(pack?.["kind"]).toBe("changed");
    expect(pack?.["modified"]).toEqual([]);
    expect(String(pack?.["reasons"])).toMatch(/checker/u);
  });

  it("re-runs DISCOVER on an edited pack, names the document, and never calls the pack raw", async () => {
    const root = packRepo();
    commitRecord(root);
    const first = await discover(root);
    expect(first.pack?.["kind"]).toBe("conforming");

    const edited = path.join(root, "docs", "prd", "01-catalog.md");
    writeFileSync(edited, "# Catalog\n\n- **CAT-F-001** [M0] The catalog MUST store products.\n");
    const second = await discover(root);

    expect(second.result.executed).toContain("DISCOVER");
    expect(second.pack?.["kind"]).toBe("changed");
    expect(second.pack?.["modified"]).toEqual(["docs/prd/01-catalog.md"]);
    expect(second.pack?.["added"]).toEqual([]);
    expect(second.pack?.["removed"]).toEqual([]);
    expect(second.notes.join("\n")).toContain("docs/prd/01-catalog.md");
  });

  it("names documents added to and removed from a recorded pack", async () => {
    const root = packRepo();
    commitRecord(root);
    writeFileSync(path.join(root, "docs", "design", "security.md"), "# Security\n");
    rmSync(path.join(root, "docs", "adr", "ADR-001-integer-money.md"));

    const { pack, notes } = await discover(root);

    expect(pack?.["kind"]).toBe("changed");
    expect(pack?.["added"]).toEqual(["docs/design/security.md"]);
    expect(pack?.["removed"]).toEqual(["docs/adr/ADR-001-integer-money.md"]);
    expect(notes.join("\n")).toContain("docs/design/security.md");
    expect(notes.join("\n")).toContain("docs/adr/ADR-001-integer-money.md");
  });

  it("keeps C-8's listing digest for a document set with no record, so an edit still reuses DISCOVER", async () => {
    const root = packRepo({ "PRD.md": "# PRD\n\nThe shop MUST sell mugs.\n" });
    const handler = discoverOnly(root, []).find((h) => h.phase === "DISCOVER");
    const markers = discoverStack(root).stack.markers.map((m) => `marker:${m}`);
    expect(handler?.digest({ root, outputs: {}, now: () => 0 })).toBe(
      listingDigest([...discoverDocs(root, DOC_PATTERNS).docs, ...markers]),
    );

    const first = await discover(root);
    expect(first.pack).toEqual({ kind: "raw" });
    writeFileSync(path.join(root, "PRD.md"), "# PRD\n\nThe shop MUST sell cups.\n");
    const second = await discover(root);
    expect(second.result.reused).toContain("DISCOVER");
  });
});

describe("PRDR-279: archive/ is outside every discovery glob (C-2⁷)", () => {
  const files = {
    "archive/PRD.md": "# The original PRD\n",
    "archive/docs/spec.md": "# The original spec\n",
    "archive/README.md": "# The original readme\n",
    "docs/prd/index.md": "# Index\n",
    "docs/archive/notes.md": "# Not the pack's archive\n",
  };

  it("never discovers an archived original under the default patterns", () => {
    const root = packRepo(files);
    expect(discoverDocs(root).docs).toEqual(["docs/archive/notes.md", "docs/prd/index.md"]);
  });

  it("never discovers one under a configured glob that would reach it", () => {
    const root = packRepo(files);
    expect(discoverDocs(root, ["**/*.md"]).docs).toEqual(["docs/archive/notes.md", "docs/prd/index.md"]);
  });

  it("never hands one to planning, through the pipeline", async () => {
    const root = packRepo(files);
    const { result } = await discover(root, { planDocs: ["**/*.md"] });
    expect(result.outputs["DISCOVER"]?.["docs"]).toEqual(["docs/archive/notes.md", "docs/prd/index.md"]);
  });
});
