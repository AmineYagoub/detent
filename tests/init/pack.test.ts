import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverDocs } from "../../src/init/discover-docs.js";
import { parsePack } from "../../src/init/pack-parse.js";
import {
  ConformanceRecordError,
  classifyPack,
  conformanceRecord,
  packDocuments,
  readConformanceRecord,
  writeConformanceRecord,
} from "../../src/init/pack.js";
import { CONFORMANCE_RECORD_PATH, conformanceRecordSchema, packKindOf, packSchema, packStatusSchema } from "../../src/schemas/pack.js";
import { definitionText } from "../docs/prd-marks.js";
import { CATALOG_PRD, CONFORMING_PACK, DECISION_LOG, ORACLE_ROUNDS, commitRecord, oracleRecord, packRepo } from "./pack-fixture.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";

/**
 * PRDR-279 — the conformance record (C-2⁷): what it holds, where it lives, and
 * how it decides whether a pack conforms.
 */

const ROUNDS = structuredClone(ORACLE_ROUNDS) as never;

describe("PRDR-279: the conformance record", () => {
  it("holds the version, the hash of the pack's documents, the checker's result, every round and the date", () => {
    const root = packRepo();
    const record = conformanceRecord(root, { checker: { green: true, findings: [] }, rounds: ROUNDS, date: "2026-09-26" });
    expect(record).toEqual(oracleRecord(root));
  });

  it("lives at docs/conformance.json and excludes itself from the hash", () => {
    const root = packRepo();
    const record = conformanceRecord(root, { checker: { green: true, findings: [] }, rounds: ROUNDS, date: "2026-09-26" });
    writeConformanceRecord(root, record);

    expect(CONFORMANCE_RECORD_PATH).toBe("docs/conformance.json");
    expect(JSON.parse(readFileSync(path.join(root, "docs", "conformance.json"), "utf8"))).toEqual(record);
    expect(packDocuments(root)).not.toContain(CONFORMANCE_RECORD_PATH);
    expect(conformanceRecord(root, { checker: { green: true, findings: [] }, rounds: ROUNDS, date: "2026-09-26" })).toEqual(record);
    expect(readConformanceRecord(root)).toEqual(record);
  });

  it("is never one of the pack's documents, whatever planning is narrowed to", () => {
    const root = packRepo();
    commitRecord(root);
    expect(discoverDocs(root).docs).not.toContain(CONFORMANCE_RECORD_PATH);
    expect(packDocuments(root)).toEqual(discoverDocs(root).docs);
  });

  it("is refused when its hash disagrees with its own documents", () => {
    const root = packRepo();
    commitRecord(root, { ...oracleRecord(root), hash: "0".repeat(64) });
    expect(() => readConformanceRecord(root)).toThrow(ConformanceRecordError);
    expect(() => readConformanceRecord(root)).toThrow(/hash/u);
  });

  it("is refused, with both versions named, when a newer build wrote it (F-3)", () => {
    const root = packRepo();
    commitRecord(root, { ...oracleRecord(root), schema_version: SCHEMA_VERSION + 1 });
    expect(() => readConformanceRecord(root)).toThrow(new RegExp(`schema_version ${String(SCHEMA_VERSION + 1)}.*supports ${String(SCHEMA_VERSION)}`, "u"));
  });

  it("names its file when it is not JSON", () => {
    const root = packRepo();
    writeFileSync(path.join(root, "docs", "conformance.json"), "<<<<<<< HEAD\n");
    expect(() => readConformanceRecord(root)).toThrow(/docs\/conformance\.json/u);
  });
});

describe("PRDR-279: conformance", () => {
  it("calls a document set with no record raw", () => {
    expect(classifyPack(packRepo(), { greenfield: true })).toEqual({ kind: "raw" });
  });

  it("calls a pack conforming when its hash matches and its checker was green", () => {
    const root = packRepo();
    const record = oracleRecord(root);
    commitRecord(root, record);
    expect(classifyPack(root, { greenfield: true })).toEqual({ kind: "conforming", date: "2026-09-26", hash: record["hash"] });
  });

  it("does not call a pack conforming whose documents now break the schema, whatever its record says", () => {
    const root = packRepo({ ...CONFORMING_PACK, "docs/prd/01-catalog.md": `${CATALOG_PRD}- **CAT-F-004** [M1] Tags exist.\n` });
    commitRecord(root);
    const status = classifyPack(root, { greenfield: true });
    expect(status).toMatchObject({ kind: "changed", added: [], removed: [], modified: [] });
    expect(JSON.stringify(status)).toMatch(/CAT-F-004/u);
  });

  it("does not call a greenfield pack conforming without its stack entry, and a brownfield one does not need it", () => {
    const log = DECISION_LOG.replace(/## Stack[\s\S]*?(?=## Packages)/u, "");
    const root = packRepo({ ...CONFORMING_PACK, "docs/founder-decisions.md": log });
    commitRecord(root);
    const greenfield = classifyPack(root, { greenfield: true });
    expect(greenfield.kind).toBe("changed");
    expect(JSON.stringify(greenfield)).toMatch(/stack entry/u);
    expect(classifyPack(root, { greenfield: false }).kind).toBe("conforming");
  });
});

describe("PRDR-280: conformance runs the checker, not only the schema", () => {
  it("does not call a pack conforming while its checker is red now, whatever its record says", () => {
    const text = CONFORMING_PACK["docs/prd/02-checkout.md"]?.replace("`cart_empty` (CHK-F-001).", "`cart_empty` (CHK-F-009).") ?? "";
    const root = packRepo({ ...CONFORMING_PACK, "docs/prd/02-checkout.md": text });
    commitRecord(root);
    const status = classifyPack(root, { greenfield: true });
    expect(status).toMatchObject({ kind: "changed", added: [], removed: [], modified: [] });
    expect(JSON.stringify(status)).toMatch(/\[reference\].*CHK-F-009/u);
  });

  it("still calls a pack conforming when the heuristic only reports", () => {
    const extra = "- **CAT-F-004** [M1] Tags MUST exist. The catalog indexes them nightly.\n- **CAT-AC-03** [M1] Given a tag, when read, then it exists (CAT-F-004).\n";
    const catalog = `${CONFORMING_PACK["docs/prd/01-catalog.md"] ?? ""}${extra}`;
    const root = packRepo({ ...CONFORMING_PACK, "docs/prd/01-catalog.md": catalog });
    commitRecord(root);
    expect(classifyPack(root, { greenfield: true }).kind).toBe("conforming");
  });
});

describe("PRDR-279: the record and the pack are versioned shapes (F-3)", () => {
  it("stamps the record, the pack's parse and DISCOVER's classification with the build's schema_version", () => {
    const root = packRepo();
    commitRecord(root);
    expect(conformanceRecordSchema.safeParse({ ...oracleRecord(root), schema_version: SCHEMA_VERSION }).success).toBe(true);
    expect(packSchema.parse(parsePack(root, discoverDocs(root).docs, { greenfield: true }).pack).schema_version).toBe(SCHEMA_VERSION);
    for (const status of [{ kind: "raw" }, classifyPack(root, { greenfield: true })]) {
      expect(packStatusSchema.parse(status)).toEqual(status);
    }
  });

  it("is where the PRD's C-2⁹ says it is, beside the layout it states", () => {
    const prd = readFileSync(path.join(import.meta.dirname, "..", "..", "detent-prd-v3.md"), "utf8");
    const rule = definitionText(prd, "C-2⁹").join("\n").replace(/\s+/gu, " ");
    expect(rule).toContain(`\`${CONFORMANCE_RECORD_PATH}\``);
    for (const typed of ["docs/founder-decisions.md", "docs/research/verified-facts.md", "docs/prd/index.md"]) {
      expect(rule).toContain(`\`${typed}\``);
      expect(packKindOf(typed)).not.toBe("context");
    }
    expect(rule).toContain("`## Decisions`, `## Defaults`, `## Stack` and `## Packages`");
  });

  it("is named by release-checklist item 8", () => {
    const checklist = readFileSync(path.join(import.meta.dirname, "..", "..", "docs", "release-checklist.md"), "utf8");
    const item8 = checklist.slice(checklist.indexOf("8. **Schema discipline"));
    for (const shape of ["docs/conformance.json", "src/schemas/pack.ts", "DISCOVER", "`pack`"]) expect(item8).toContain(shape);
  });
});
