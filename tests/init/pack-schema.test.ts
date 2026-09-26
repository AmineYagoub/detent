import { describe, expect, it } from "vitest";
import { discoverDocs } from "../../src/init/discover-docs.js";
import { parsePack, unresolvedIds } from "../../src/init/pack-parse.js";
import { PACK_PRECEDENCE, levelOf, packKindOf, packSchema } from "../../src/schemas/pack.js";
import { CATALOG_PRD, CONFORMING_PACK, DECISION_LOG, packRepo } from "./pack-fixture.js";

/**
 * PRDR-279 — the pack's schema (C-2⁷): its layout and precedence, the id
 * grammar, MUST and SHOULD, Given / When / Then, milestone order, optional
 * catalogues, the greenfield stack entry (D-10′) and declared packages (V-5′).
 */

function parse(files: Readonly<Record<string, string>>, greenfield = true) {
  const root = packRepo(files);
  return parsePack(root, discoverDocs(root).docs, { greenfield });
}

const withFile = (file: string, text: string) => ({ ...CONFORMING_PACK, [file]: text });
const without = (...files: string[]) => Object.fromEntries(Object.entries(CONFORMING_PACK).filter(([f]) => !files.includes(f)));
const catalog = (extra: string) => withFile("docs/prd/01-catalog.md", `${CATALOG_PRD}${extra}\n`);
const messages = (problems: readonly { readonly message: string }[]) => problems.map((p) => p.message).join("\n");

describe("PRDR-279: the pack's layout and precedence", () => {
  it("types every path the layout names, and calls what lies outside docs/ context", () => {
    expect(packKindOf("docs/founder-decisions.md")).toBe("decisions");
    expect(packKindOf("docs/research/verified-facts.md")).toBe("facts");
    expect(packKindOf("docs/design/architecture.md")).toBe("design");
    expect(packKindOf("docs/adr/ADR-001-integer-money.md")).toBe("adr");
    expect(packKindOf("docs/prd/index.md")).toBe("prd");
    expect(packKindOf("docs/prd/01-catalog.md")).toBe("prd");
    expect(packKindOf("README.md")).toBe("context");
    expect(packKindOf("docs/runbook.md")).toBe("context");
  });

  it("refuses a name the layout does not hold inside one of the pack's own directories", () => {
    for (const bad of ["docs/prd/notes.md", "docs/adr/money.md", "docs/research/other.md", "docs/design/sub/x.md"]) {
      expect(packKindOf(bad)).toBeNull();
    }
    const { problems } = parse(withFile("docs/prd/notes.md", "# Notes\n"));
    expect(problems).toEqual([expect.objectContaining({ rule: "layout", file: "docs/prd/notes.md" })]);
  });

  it("ranks decisions over facts over design over ADRs over PRDs", () => {
    expect(PACK_PRECEDENCE).toEqual(["decisions", "facts", "design", "adr", "prd"]);
  });

  it("requires the decision log, the index and a module PRD", () => {
    const none = without("docs/founder-decisions.md", "docs/prd/01-catalog.md", "docs/prd/02-checkout.md");
    const text = messages(parse(none).problems);
    expect(text).toContain("docs/founder-decisions.md");
    expect(text).toMatch(/module PRD/u);
  });
});

describe("PRDR-279: requirements and criteria", () => {
  it("parses the fixture pack with no problems, as a persisted shape", () => {
    const { pack, problems } = parse(CONFORMING_PACK);
    expect(problems).toEqual([]);
    expect(packSchema.parse(pack)).toEqual(pack);
    expect(pack.requirements.map((r) => r.id)).toEqual(["CAT-F-001", "CAT-F-002", "CAT-N-001", "CAT-F-003", "CHK-F-001", "CHK-F-002"]);
    expect(pack.criteria.map((c) => c.id)).toEqual(["CAT-AC-01", "CAT-AC-02", "CHK-AC-01", "CHK-AC-02"]);
    expect(pack.codes.map((c) => [c.code, c.prd, c.milestones])).toEqual([["CAT", "01-catalog.md", [0, 1]], ["CHK", "02-checkout.md", [1]]]);
    expect(pack.decisions.map((d) => d.id)).toEqual(["D-1"]);
    expect(pack.defaults.map((d) => d.id)).toEqual(["X-1", "X-2"]);
    expect(pack.facts.map((f) => [f.id, f.tag])).toEqual([["1.1", "doc"], ["1.2", "unverified"]]);
    expect(pack.adrs).toEqual([{ id: "ADR-001", file: "docs/adr/ADR-001-integer-money.md" }]);
  });

  it("records each requirement's milestone, level, tags and place", () => {
    const { pack } = parse(CONFORMING_PACK);
    const byId = new Map(pack.requirements.map((r) => [r.id, r]));
    expect(byId.get("CAT-F-001")).toMatchObject({ code: "CAT", kind: "F", milestone: 0, level: "MUST", file: "docs/prd/01-catalog.md", line: 5 });
    expect(byId.get("CAT-F-002")).toMatchObject({ milestone: 1, level: "SHOULD" });
    expect(byId.get("CAT-N-001")).toMatchObject({ kind: "N", level: "MUST" });
    expect(byId.get("CAT-F-003")).toMatchObject({ withdrawn: true, milestone: null, level: null });
    expect(byId.get("CHK-F-002")?.tags).toEqual(["E2E"]);
    expect(byId.get("CHK-F-001")?.text).toContain("MUST emit `order.placed` once the order is stored");
  });

  it("ranks MUST over SHOULD, and reads neither in lower case", () => {
    expect(levelOf("It SHOULD log, and it MUST refuse.")).toBe("MUST");
    expect(levelOf("It MUST NOT log.")).toBe("MUST");
    expect(levelOf("It should log.")).toBeNull();
  });

  it("refuses a requirement that states neither MUST nor SHOULD", () => {
    const { problems } = parse(catalog("- **CAT-F-004** [M1] The catalog stores tags."));
    expect(problems).toEqual([expect.objectContaining({ rule: "requirement", line: 16 })]);
    expect(messages(problems)).toMatch(/CAT-F-004.*MUST or SHOULD/u);
  });

  it("refuses a requirement with no milestone tag", () => {
    const { problems } = parse(catalog("- **CAT-F-004** The catalog MUST store tags."));
    expect(messages(problems)).toMatch(/CAT-F-004.*milestone/u);
  });

  it("refuses a bold id that is neither a requirement nor a criterion id", () => {
    const { problems } = parse(catalog("- **CAT-F-04** [M1] The catalog MUST store tags."));
    expect(messages(problems)).toMatch(/CAT-F-04/u);
  });

  it("splits a criterion into Given, When and Then, and refuses one without all three", () => {
    const { pack } = parse(CONFORMING_PACK);
    expect(pack.criteria[0]).toMatchObject({
      given: "a product titled `Mug` priced 1500",
      when: "it is stored and read back",
      then: "the title is `Mug` and the price is 1500",
      requirements: ["CAT-F-001"],
      milestone: 0,
    });
    const { problems } = parse(catalog("- **CAT-AC-03** [M1] Given a product, when it is read, it works (CAT-F-001)."));
    expect(messages(problems)).toMatch(/CAT-AC-03.*Given, When and Then/u);
  });

  it("reads the requirements a criterion names, ranges included, and refuses one that names none", () => {
    const { pack } = parse(CONFORMING_PACK);
    const byId = new Map(pack.criteria.map((c) => [c.id, c.requirements]));
    expect(byId.get("CAT-AC-02")).toEqual(["CAT-F-002", "CAT-N-001"]);
    expect(byId.get("CHK-AC-02")).toEqual(["CHK-F-001", "CHK-F-002"]);
    const { problems } = parse(catalog("- **CAT-AC-03** [M1] Given a product, when it is read, then it is shown."));
    expect(messages(problems)).toMatch(/CAT-AC-03.*names no requirement/u);
  });

  it("orders milestones by number, not by text", () => {
    const index = CONFORMING_PACK["docs/prd/index.md"]?.replace("| M1 | Selling |", "| M10 | Later |\n| M2 | Selling |") ?? "";
    const { pack } = parse(withFile("docs/prd/index.md", index));
    expect(pack.milestones.map((m) => [m.id, m.order])).toEqual([["M0", 0], ["M2", 2], ["M10", 10]]);
  });
});

describe("PRDR-279: the decision log, facts and catalogues", () => {
  it("refuses a row that is not an entry of its section", () => {
    const log = DECISION_LOG.replace("| D-1 |", "| D1 |");
    expect(messages(parse(withFile("docs/founder-decisions.md", log)).problems)).toMatch(/D1/u);
  });

  it("refuses a table in the decision log outside its four sections", () => {
    const log = `${DECISION_LOG}\n## Open questions\n\n| Id | Question |\n|---|---|\n| Q-1 | Who pays returns? |\n`;
    const { problems } = parse(withFile("docs/founder-decisions.md", log));
    expect(problems).toEqual([expect.objectContaining({ rule: "decision", file: "docs/founder-decisions.md", text: "| Q-1 | Who pays returns? |" })]);
  });

  it("refuses a fact whose tag is not source-read, doc or unverified", () => {
    const facts = CONFORMING_PACK["docs/research/verified-facts.md"]?.replace("| doc |", "| verified |") ?? "";
    const { problems } = parse(withFile("docs/research/verified-facts.md", facts));
    expect(problems).toEqual([expect.objectContaining({ rule: "fact", file: "docs/research/verified-facts.md", line: 5 })]);
  });

  it("reads the catalogues when present and needs none", () => {
    const { pack } = parse(CONFORMING_PACK);
    expect(pack.catalogues.error_codes.map((e) => e.id)).toEqual(["cart_empty"]);
    expect(pack.catalogues.events.map((e) => e.id)).toEqual(["order.placed"]);
    expect(pack.catalogues.routes.map((e) => e.id)).toEqual(["POST /store/checkout"]);
    expect(pack.catalogues.settings).toEqual([]);
    const bare = parse(without("docs/design/catalogues.md"));
    expect(bare.problems).toEqual([]);
    expect(bare.pack.catalogues.error_codes).toEqual([]);
  });

  it("records every document's numbered sections, for section references to resolve against", () => {
    const { pack } = parse(CONFORMING_PACK);
    const doc = pack.documents.find((d) => d.path === "docs/design/architecture.md");
    expect(doc).toEqual({ path: "docs/design/architecture.md", kind: "design", sections: ["1", "1.1"] });
  });
});

describe("PRDR-279: traceability", () => {
  it("resolves requirement and criterion ids in the pack, and names the ones that do not", () => {
    const { pack } = parse(CONFORMING_PACK);
    expect(unresolvedIds(pack, ["CAT-F-001", "CAT-AC-01", "CHK-F-002", "CAT-F-999", "CHK-AC-09"])).toEqual(["CAT-F-999", "CHK-AC-09"]);
    expect(unresolvedIds(pack, pack.criteria.flatMap((c) => c.requirements))).toEqual([]);
  });
});

describe("PRDR-279: the greenfield stack entry (D-10′) and declared packages (V-5′)", () => {
  it("parses the stack into language, toolchain, gate commands per slot and scaffold files", () => {
    const { pack } = parse(CONFORMING_PACK);
    expect(pack.stack).toEqual({
      decision: "X-2",
      language: "TypeScript",
      toolchain: "Node.js 22 with pnpm 9",
      scaffold_files: ["package.json", "tsconfig.json"],
      gates: { test: "pnpm test", lint: "pnpm lint" },
    });
  });

  it("refuses a greenfield pack with no stack entry, and names it", () => {
    const log = DECISION_LOG.replace(/## Stack[\s\S]*?(?=## Packages)/u, "");
    const greenfield = parse(withFile("docs/founder-decisions.md", log), true);
    expect(greenfield.problems).toEqual([expect.objectContaining({ rule: "stack", file: "docs/founder-decisions.md" })]);
    expect(messages(greenfield.problems)).toMatch(/stack entry/u);
    expect(parse(withFile("docs/founder-decisions.md", log), false).problems).toEqual([]);
  });

  it("refuses a greenfield stack that declares no gate command for the root package", () => {
    const log = DECISION_LOG.replace("| . | test | `pnpm test` |\n| . | lint | `pnpm lint` |\n", "");
    expect(messages(parse(withFile("docs/founder-decisions.md", log)).problems)).toMatch(/gate command/u);
  });

  it("parses declared packages with each one's gate commands", () => {
    const { pack } = parse(CONFORMING_PACK);
    expect(pack.packages).toEqual([
      { path: ".", gates: { test: "pnpm test", lint: "pnpm lint" } },
      { path: "dashboard", gates: { test: "pnpm --dir dashboard test" } },
    ]);
  });

  it("refuses an unknown slot, a slot declared twice, and a path that leaves the repository", () => {
    for (const row of ["| dashboard | deploy | `pnpm deploy` |", "| . | test | `npm test` |", "| ../other | test | `pnpm test` |"]) {
      const log = DECISION_LOG.replace("| dashboard | test |", `${row}\n| dashboard | test |`);
      expect(parse(withFile("docs/founder-decisions.md", log)).problems).toEqual([expect.objectContaining({ rule: "package" })]);
    }
  });
});

describe("PRDR-279: the markdown the grammar is read from", () => {
  it("reads a requirement or a table inside a fenced code block as an example, not an entry", () => {
    const example = ["```markdown", "- **CAT-F-009** [M1] An example MUST NOT count.", "| D-9 | q | a | r |", "```"].join("\n");
    const { pack, problems } = parse(catalog(example));
    expect(problems).toEqual([]);
    expect(pack.requirements.map((r) => r.id)).not.toContain("CAT-F-009");
  });

  it("keeps counting lines through a fence, frontmatter included", () => {
    const text = `---\nid: catalog\n---\n\n~~~\n\`\`\`\n~~~\n${CATALOG_PRD}`;
    const { pack } = parse(withFile("docs/prd/01-catalog.md", text));
    expect(pack.requirements.find((r) => r.id === "CAT-F-001")?.line).toBe(12);
  });

  it("reads a table whose separator has single dashes and no closing bar", () => {
    const log = DECISION_LOG.replace("| Id | Question | Answer | Reason |\n|---|---|---|---|", "| Id | Question | Answer | Reason |\n|-|-|:-:|-");
    const { pack, problems } = parse(withFile("docs/founder-decisions.md", log));
    expect(problems).toEqual([]);
    expect(pack.decisions.map((d) => d.id)).toEqual(["D-1"]);
  });

  it("reads an indented requirement bullet as its own entry, not as text of the one above", () => {
    const { pack, problems } = parse(catalog("- **CAT-F-004** [M1] Tags MUST exist:\n  - **CAT-F-005** [M1] Each tag MUST have a name."));
    expect(problems).toEqual([]);
    expect(pack.requirements.find((r) => r.id === "CAT-F-004")?.text).toBe("Tags MUST exist:");
    expect(pack.requirements.map((r) => r.id)).toContain("CAT-F-005");
  });

  it("reports a stack entry that lacks a field once, by what it lacks", () => {
    const log = DECISION_LOG.replace("| language | TypeScript |\n", "");
    const { problems } = parse(withFile("docs/founder-decisions.md", log));
    expect(problems).toEqual([expect.objectContaining({ rule: "stack", message: "## Stack: has no language" })]);
  });
});
