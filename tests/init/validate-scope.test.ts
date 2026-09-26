import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePack } from "../../src/init/pack-parse.js";
import { packDocuments } from "../../src/init/pack.js";
import { FOUNDATIONS, areaOf, areasOf, citing, reviewable, scopeOf } from "../../src/init/validate-scope.js";
import { CONFORMING_PACK, packRepo } from "./pack-fixture.js";

/**
 * PRDR-284 — what a VALIDATE round reads: the pack's areas, from its own
 * index, and the documents a change reaches (C-2⁶, C-2⁷).
 *
 * The pack fixture has two areas, Catalog and Checkout, each one module PRD,
 * and six foundations: the decision log, the facts, two design documents, an
 * ADR and the index. Checkout cites `CAT-F-001`, and the index links both.
 */

const LOG = "docs/founder-decisions.md";
const FACTS = "docs/research/verified-facts.md";
const ARCH = "docs/design/architecture.md";
const CATALOGUES = "docs/design/catalogues.md";
const ADR = "docs/adr/ADR-001-integer-money.md";
const INDEX = "docs/prd/index.md";
const CATALOG = "docs/prd/01-catalog.md";
const CHECKOUT = "docs/prd/02-checkout.md";

function pack(extra: Readonly<Record<string, string>> = {}) {
  const root = packRepo({ ...CONFORMING_PACK, ...extra });
  const docs = packDocuments(root);
  return { root, docs, parsed: parsePack(root, docs, { greenfield: true }).pack };
}

describe("PRDR-284: a round's areas are the pack's own (C-2⁶)", () => {
  it("puts the foundations first, then each area the index names, in its order, each with its module PRDs", () => {
    const { docs, parsed } = pack();
    expect(areasOf(parsed, docs)).toEqual([
      { name: FOUNDATIONS, documents: [ADR, ARCH, CATALOGUES, LOG, INDEX, FACTS] },
      { name: "Catalog", documents: [CATALOG] },
      { name: "Checkout", documents: [CHECKOUT] },
    ]);
  });

  it("gives a module PRD the index does not register an area of its own, named for its file", () => {
    const { docs, parsed } = pack({ "docs/prd/03-returns.md": "# Returns\n\n- **RET-F-001** [M1] A return MUST be refunded (X-1).\n" });
    expect(areasOf(parsed, docs).map((a) => a.name)).toEqual([FOUNDATIONS, "Catalog", "Checkout", "03-returns"]);
    expect(areasOf(parsed, docs).at(-1)?.documents).toEqual(["docs/prd/03-returns.md"]);
  });

  it("holds two codes of one area in that area, and a module PRD two areas name in the first", () => {
    const index = (CONFORMING_PACK[INDEX] ?? "")
      .replace("| CHK | Checkout |", "| CHK | Catalog |")
      .replace("| M1 | Selling |", "| M1 | Selling |\n| M2 | Later |");
    const { docs, parsed } = pack({ [INDEX]: index.replace("## Milestones", "| CHX | Extras | [01-catalog.md](01-catalog.md) | M2 |\n\n## Milestones") });
    const areas = areasOf(parsed, docs);
    expect(areas.map((a) => a.name)).toEqual([FOUNDATIONS, "Catalog"]);
    expect(areas[1]?.documents).toEqual([CATALOG, CHECKOUT]);
  });

  it("reviews no context document and no document at a path the layout does not hold", () => {
    const { docs, parsed } = pack({ "docs/prd/notes.md": "# Notes\n" });
    const all = areasOf(parsed, docs).flatMap((a) => a.documents);
    expect(all).not.toContain("README.md");
    expect(all).not.toContain("docs/prd/notes.md");
    expect(reviewable("README.md")).toBe(false);
    expect(reviewable("docs/prd/notes.md")).toBe(false);
    expect(reviewable(CATALOG)).toBe(true);
  });

  it("finds the area that holds a document, and none for a document it does not hold", () => {
    const { docs, parsed } = pack();
    const areas = areasOf(parsed, docs);
    expect(areaOf(areas, CHECKOUT)).toBe(2);
    expect(areaOf(areas, LOG)).toBe(0);
    expect(areaOf(areas, "README.md")).toBe(-1);
  });
});

describe("PRDR-284: whatever cites a change (C-2⁷)", () => {
  it("reaches a document that names a requirement the changed one defines, and one that links to it", () => {
    const { root, docs, parsed } = pack();
    expect(citing(root, parsed, docs, [CATALOG])).toEqual([CHECKOUT, INDEX]);
  });

  it("reads a range for every id in it, one the changed document defines between its ends included", () => {
    const { root, docs, parsed } = pack({
      "docs/prd/03-returns.md": "# Returns\n\n- **RET-F-002** [M1] A return MUST be refunded (X-1).\n",
      "docs/design/limits.md": "# Limits\n\nThe return rules RET-F-001–RET-F-003 hold for a week.\n",
    });
    expect(citing(root, parsed, docs, ["docs/prd/03-returns.md"])).toEqual(["docs/design/limits.md"]);
  });

  it("reaches a document that names a criterion the changed one defines", () => {
    const { root, docs, parsed } = pack({ "docs/design/tests.md": "# Tests\n\nThe mug case is CAT-AC-01.\n" });
    expect(citing(root, parsed, docs, [CATALOG])).toContain("docs/design/tests.md");
  });

  it("reaches every document that cites any entry of the decision log, since the record keeps no earlier copy of it", () => {
    const { root, docs, parsed } = pack();
    expect(citing(root, parsed, docs, [LOG])).toEqual([ADR, ARCH, CATALOG, CHECKOUT]);
  });

  it("reaches every document that cites a fact, for a change to the facts", () => {
    const { root, docs, parsed } = pack();
    expect(citing(root, parsed, docs, [FACTS])).toEqual([ARCH]);
  });

  it("reaches a document that cites a section of the changed one by its name, or an ADR by its id", () => {
    const { root, docs, parsed } = pack({ "docs/design/money.md": "# Money\n\nSee architecture §1, and ADR-001 §1 for why.\n" });
    expect(citing(root, parsed, docs, [ARCH])).toEqual(["docs/design/money.md"]);
    expect(citing(root, parsed, docs, [ADR])).toEqual(["docs/design/money.md"]);
  });

  it("never reaches a context document, nor the changed documents themselves", () => {
    const { root, docs, parsed } = pack({ "README.md": "# Shop\n\nThe catalog rule CAT-F-001 is the one to read, in [the PRD](docs/prd/01-catalog.md).\n" });
    const reached = citing(root, parsed, docs, [CATALOG, CHECKOUT]);
    expect(reached).not.toContain("README.md");
    expect(reached).not.toContain(CATALOG);
    expect(reached).toEqual([INDEX]);
  });

  it("scopes a round to the changed documents it reviews and whatever cites them, each once and sorted", () => {
    const { root, docs, parsed } = pack();
    expect(scopeOf(root, parsed, docs, [CHECKOUT, "README.md", CATALOG, CATALOG, "docs/gone.md"])).toEqual([CATALOG, CHECKOUT, INDEX]);
  });

  it("reads a document as its bytes are now", () => {
    const { root, docs, parsed } = pack();
    writeFileSync(path.join(root, ...ARCH.split("/")), "# Architecture\n\n## 1. Modules\n\nCheckout depends on CAT-F-001.\n");
    expect(citing(root, parsed, docs, [CATALOG])).toContain(ARCH);
  });
});
