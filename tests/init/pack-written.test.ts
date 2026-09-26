import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPack, conformanceRecord, packNote, readConformanceRecord } from "../../src/init/pack.js";
import { packStatusSchema } from "../../src/schemas/pack.js";
import { commitRecord, oracleRecord, packRepo } from "./pack-fixture.js";

/**
 * PRDR-283 — a pack WRITE wrote and nothing has validated (C-2¹³).
 *
 * WRITE moves the originals out of discovery and writes the pack in their
 * place, and until VALIDATE writes its verdict, nothing said the new pack was
 * one: with no record, the next `init` found a raw document set in the pack's
 * shape and ran AUDIT, DECIDE and WRITE over WRITE's own output. WRITE writes
 * the record, saying it is not validated, and DISCOVER calls such a pack
 * written.
 */

describe("PRDR-283: the record says whether the pack was validated", () => {
  it("carries validated, as WRITE writes it and as VALIDATE will, and refuses a record that does not say", () => {
    const root = packRepo();
    const record = conformanceRecord(root, { checker: { green: true, findings: [] }, rounds: [], date: "2026-09-26", validated: false });
    expect(record.validated).toBe(false);
    const unsaid: Record<string, unknown> = { ...oracleRecord(root) };
    delete unsaid["validated"];
    commitRecord(root, unsaid);
    expect(() => readConformanceRecord(root)).toThrow(/validated/u);
  });
});

describe("PRDR-283: DISCOVER calls a pack nothing has validated written", () => {
  it("whatever its record's checker said, and counts what the checker blocks on in it now", () => {
    const root = packRepo();
    commitRecord(root, { ...oracleRecord(root), validated: false });
    expect(classifyPack(root, { greenfield: true })).toEqual({ kind: "written", date: "2026-09-26", blocking: 0 });

    const red = packRepo();
    commitRecord(red, { ...oracleRecord(red, { green: false }), validated: false });
    expect(classifyPack(red, { greenfield: true }).kind).toBe("written");
  });

  it("stays written after an edit, which VALIDATE's first run checks with the rest, and counts a break it makes", () => {
    const root = packRepo();
    commitRecord(root, { ...oracleRecord(root), validated: false });
    writeFileSync(path.join(root, "docs", "prd", "01-lending.md"), "# 01 — Lending\n\n- **LND-F-001** [M1] Loans start.\n");
    const status = classifyPack(root, { greenfield: true });
    expect(status.kind).toBe("written");
    expect(status.kind === "written" && status.blocking > 0).toBe(true);
  });

  it("is a kind DISCOVER's checkpoint holds (F-3)", () => {
    expect(packStatusSchema.safeParse({ kind: "written", date: "2026-09-26", blocking: 0 }).success).toBe(true);
    expect(packStatusSchema.safeParse({ kind: "written", date: "2026-09-26" }).success).toBe(false);
  });

  it("says so at DISCOVER: written by WRITE, not validated, and what the checker blocks on", () => {
    expect(packNote({ kind: "written", date: "2026-09-26", blocking: 0 })).toBe(
      "the documents are the pack WRITE wrote on 2026-09-26, which nothing has validated: VALIDATE is not built, so the pack goes to planning as WRITE left it (C-2¹³)",
    );
    expect(packNote({ kind: "written", date: "2026-09-26", blocking: 2 })).toContain("; the pack checker finds 2 blocking findings in it");
  });
});
