import { afterEach, describe, expect, it } from "vitest";
import { readDecisionLog } from "../../src/init/decide-log.js";
import { checkerIssues, citeIssues, holdsRequirement, logIssues, resolveLists } from "../../src/init/write-checks.js";
import { SCHEMA_VERSION } from "../../src/schemas/common.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import type { WriteArtifact } from "../../src/schemas/write.js";
import { removeTree, tmpTree } from "../helpers.js";

/**
 * PRDR-283 — the checks code makes of WRITE's session (C-2¹³), each on its
 * own: the lists in its artifact, the rows of the decision log, the cites in
 * the pack, and which checker findings refuse it.
 */

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeTree(r);
});
const tree = (files: Readonly<Record<string, string>>): string => {
  const root = tmpTree(files);
  roots.push(root);
  return root;
};

const artifact = (archive: string[], context: string[]): WriteArtifact => ({ schema_version: SCHEMA_VERSION, archive, context });

describe("PRDR-283: the artifact accounts for every original (C-2¹³)", () => {
  const given = ["NOTES.md", "PRD.md", "README.md", "docs/adr/ADR-001-money.md", "docs/design/architecture.md", "docs/prd/requirements.md", "docs/roadmap.md"];
  const rewrote = (rel: string): boolean => rel === "docs/design/architecture.md";

  it("names each way a list is wrong, in words a relaunch can act on", () => {
    const { issues } = resolveLists(
      artifact(["PRD.md", "docs/design/architecture.md", "SPEC.md"], ["README.md", "PRD.md", DECISION_LOG_PATH, "docs/adr/ADR-001-money.md", "docs/prd/requirements.md"]),
      given,
      rewrote,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        "PRD.md is listed twice",
        "SPEC.md is not one of the documents you were given",
        `${DECISION_LOG_PATH} is the decision log, which stays where it is: list it in neither archive nor context`,
        "docs/adr/ADR-001-money.md is at one of the pack's paths, so it is part of the pack and not context: rewrite it in place or leave it as it is",
        "docs/prd/requirements.md is at a path the pack's layout does not hold, so it cannot stay: rewrite what it says into the pack and list it in archive",
        "docs/design/architecture.md is listed in archive, and you rewrote it in place: list a document at the pack's paths in archive only to drop it from the pack",
        "NOTES.md is listed in neither archive nor context",
        "docs/roadmap.md is listed in neither archive nor context",
      ]),
    );
    expect(issues.some((i) => i.startsWith("README.md")), "a README kept as context is right").toBe(false);
  });

  it("decides where the artifact did not: a planning name or a path the layout does not hold is archived, anything else stays", () => {
    const { plan } = resolveLists(artifact(["docs/adr/ADR-001-money.md"], ["NOTES.md", "README.md", "docs/prd/requirements.md"]), [...given, "SPEC.md"], rewrote);
    expect(plan.archive).toEqual(["PRD.md", "docs/adr/ADR-001-money.md", "docs/prd/requirements.md", "SPEC.md"]);
    expect(plan.context).toEqual(["NOTES.md", "README.md", "docs/roadmap.md"]);
    expect(plan.rewritten).toEqual(["docs/design/architecture.md"]);
    expect(plan.notes).toEqual([
      "WRITE archived PRD.md, which its session did not list: a planning document is never context",
      "WRITE archived docs/prd/requirements.md, which its session kept as context: the pack's layout does not hold its path",
      "WRITE left docs/roadmap.md where it is, as context: its session did not say whether it rewrote it",
      "WRITE archived SPEC.md, which its session did not list: a planning document is never context",
    ]);
  });

  it("keeps a document at the pack's paths that nobody touched or listed, and archives one listed to drop it", () => {
    const { issues, plan } = resolveLists(artifact(["docs/adr/ADR-001-money.md"], []), ["docs/adr/ADR-001-money.md", "docs/design/architecture.md"], () => false);
    expect(issues).toEqual([]);
    expect(plan.archive).toEqual(["docs/adr/ADR-001-money.md"]);
    expect(plan.rewritten).toEqual([]);
    expect(plan.context).toEqual([]);
  });
});

const LOG = [
  "# Founder decisions",
  "",
  "## Decisions",
  "",
  "| Id | Question | Answer | Reason |",
  "|---|---|---|---|",
  "| D-1 | Which currency? | **DZD** | The market is Algeria. |",
  "",
  "## Defaults",
  "",
  "| Id | Default | Reason |",
  "|---|---|---|",
  "| X-1 | A late return blocks new loans. | The queue rule. |",
  "| X-2 | A refund keeps the fee. | The provider's documentation. |",
  "",
  "## Stack",
  "",
  "| Field | Value |",
  "|---|---|",
  "| decision | X-2 |",
  "| language | TypeScript |",
  "| toolchain | Node.js 24 with pnpm 10 |",
  "",
].join("\n");

const state = (text: string) => {
  const root = tree({ [DECISION_LOG_PATH]: text });
  return { view: readDecisionLog(root), text };
};

describe("PRDR-283: WRITE only adds defaults to the decision log (C-2¹²)", () => {
  it("lets a default be added, and nothing else change", () => {
    const added = LOG.replace("| X-2 | A refund keeps the fee. | The provider's documentation. |\n", "$&| X-3 | A loan lasts a week. | The documents imply it. |\n");
    expect(logIssues(state(LOG), state(added))).toEqual([]);
  });

  it("names a row gone, a row changed, a decision added and the stack changed", () => {
    const edited = LOG.replace("| X-1 | A late return blocks new loans. | The queue rule. |\n", "")
      .replace("A refund keeps the fee.", "A refund returns the fee.")
      .replace("| D-1 |", "| D-2 | Which rail? | **Stripe** | Cheaper. |\n| D-1 |")
      .replace("| language | TypeScript |", "| language | Go |");
    expect(logIssues(state(LOG), state(edited))).toEqual([
      "the decision log's X-1 is gone",
      "the decision log's X-2 is changed",
      "the decision log gains D-2, but a decision is the founder's answer: settle what it settles as a default (X-n)",
      "the decision log's stack is not as DECIDE left it, and the stack is DECIDE's (D-10′)",
    ]);
  });

  it("names a line it held that no row carries, changed", () => {
    expect(logIssues(state(LOG), state(LOG.replace("# Founder decisions", "# Decisions")))).toEqual([
      "the decision log lost or changed a line it held: rows are only ever added to it",
    ]);
  });
});

describe("PRDR-283: the pack cites what it relies on (C-2⁶)", () => {
  const pack = (text: string): string => tree({ "docs/prd/01-lending.md": text, [DECISION_LOG_PATH]: "| X-1 | cited here only |\n", "README.md": "X-1\n" });
  const docs = ["README.md", DECISION_LOG_PATH, "docs/prd/01-lending.md"];

  it("counts a cite in the pack's own documents, never in the log or a context document", () => {
    expect(citeIssues(pack("(X-1)\n"), docs, [{ id: "X-1", why: "which settles G1" }])).toEqual([]);
    expect(citeIssues(pack("nothing\n"), docs, [{ id: "X-1", why: "which settles G1" }])).toEqual(["the pack does not cite X-1, which settles G1"]);
  });

  it("reads an id whole, and as written, whatever characters a founder's log gave it", () => {
    expect(citeIssues(pack("(X-10)\n"), docs, [{ id: "X-1", why: "which settles G1" }])).toEqual(["the pack does not cite X-1, which settles G1"]);
    expect(citeIssues(pack("(TX-1)\n"), docs, [{ id: "X-1", why: "which settles G1" }])).toEqual(["the pack does not cite X-1, which settles G1"]);
    expect(citeIssues(pack("(Q-1)\n"), docs, [{ id: "Q.1", why: "which settles G1" }])).toEqual(["the pack does not cite Q.1, which settles G1"]);
  });
});

describe("PRDR-283: what refuses a pack", () => {
  it("holds a requirement the schema refused: the checker names it, and there is a pack to fix", () => {
    const root = tree({ "docs/prd/01-lending.md": "# Lending\n\n- **LND-F-001** [M1] Loans start.\n" });
    expect(holdsRequirement(root, ["docs/prd/01-lending.md"], true)).toBe(true);
    expect(holdsRequirement(tree({ "docs/prd/index.md": "# Index\n" }), ["docs/prd/index.md"], true)).toBe(false);
  });

  it("is a blocking finding, never the heuristic's report, and a long list is cut", () => {
    const finding = (blocks: boolean, n: number) => ({ rule: blocks ? "coverage" : "present-indicative", file: "docs/prd/01-lending.md", line: n, text: "", message: `m${String(n)}`, blocks });
    expect(checkerIssues({ green: true, findings: [finding(false, 1)] })).toEqual([]);
    const many = checkerIssues({ green: false, findings: Array.from({ length: 23 }, (_, n) => finding(true, n + 1)) });
    expect(many).toHaveLength(21);
    expect(many[0]).toBe("the pack checker: docs/prd/01-lending.md:1 [coverage] m1");
    expect(many.at(-1)).toBe("and 3 more blocking findings");
  });
});
