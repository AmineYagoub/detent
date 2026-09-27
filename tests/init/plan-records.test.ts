import { describe, expect, it } from "vitest";
import { packDocuments } from "../../src/init/pack.js";
import { parsePack } from "../../src/init/pack-parse.js";
import { sliceRecords } from "../../src/init/plan-records.js";
import { packRepo } from "./pack-fixture.js";

/**
 * PRDR-292 — the records a PLAN session drafts from (C-4⁵), where no pipeline
 * reaches: a cut that places a withdrawn requirement is refused, and one that
 * places an id the pack does not define is too, so no slice holds either.
 */
describe("PRDR-292: a slice's records", () => {
  it("hold no requirement the pack withdrew or never defined, whatever ids they are asked for", () => {
    const root = packRepo();
    const { pack } = parsePack(root, packDocuments(root), { greenfield: true });
    expect(sliceRecords(root, pack, ["CAT-F-001", "CAT-F-003", "CAT-F-404"]).requirements.map((r) => r.id)).toEqual(["CAT-F-001"]);
  });
});
