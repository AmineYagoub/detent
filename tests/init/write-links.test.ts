import { afterEach, describe, expect, it } from "vitest";
import { readConformanceRecord } from "../../src/init/pack.js";
import { repointLinks } from "../../src/init/write-links.js";
import { removeTree, tmpTree } from "../helpers.js";
import { repo } from "./plan-fixture.js";
import { RAW, WROTE, initThroughWrite, packFor, read, write } from "./write-fixture.js";

/**
 * PRDR-312 — WRITE repoints the links its archiving would break (C-2²²).
 *
 * On tabachir's test clone WRITE archived the PRD and fourteen decision
 * records, and 80 links in the README and the contributor guides still named
 * the paths it had moved. The checker blocks on a broken link in any document
 * it reads, and VALIDATE's writer may write only the pack's paths, so no
 * session could clear them.
 */

const README = [
  "# Toolshed",
  "",
  "Read the [product requirements](PRD.md#pricing), the [roadmap](docs/roadmap.md) and the [whole PRD](/PRD.md).",
  "Shown as code, `[the PRD](PRD.md)` stays text, and so does [a page](https://example.com/PRD.md).",
  "",
  "```md",
  "[an example](PRD.md)",
  "```",
  "",
].join("\n");
const RUNBOOK = '# Runbook\n\nSee [the PRD](../PRD.md) and [the roadmap](roadmap.md "the plan").\n';

const linked = () => write((_, inputs) => ({ files: packFor(inputs), artifact: WROTE({ context: ["README.md", "docs/runbook.md"] }) }));

describe("PRDR-312 WRITE repoints the links its archiving would break (C-2²²)", () => {
  it("repoints each link to a moved original to its place in archive/, keeping its anchor and its form, and the record's checker is green", async () => {
    const root = repo({ ...RAW, "README.md": README, "docs/runbook.md": RUNBOOK });
    const notes: string[] = [];
    await initThroughWrite(root, linked(), { notes });

    expect(read(root, "README.md")).toBe(
      README.replace("](PRD.md#pricing)", "](archive/PRD.md#pricing)")
        .replace("](docs/roadmap.md)", "](archive/docs/roadmap.md)")
        .replace("](/PRD.md)", "](/archive/PRD.md)"),
    );
    expect(read(root, "docs/runbook.md")).toBe(RUNBOOK.replace("](../PRD.md)", "](../archive/PRD.md)").replace('](roadmap.md "the plan")', '](../archive/docs/roadmap.md "the plan")'));
    const record = readConformanceRecord(root);
    expect(record?.checker.findings.filter((f) => f.rule === "link")).toEqual([]);
    expect(record?.checker.green).toBe(true);
    expect(notes.join("\n")).toMatch(/WRITE: 5 links in 2 documents named an original it moved, and now name its place in archive\/: README\.md, docs\/runbook\.md/u);
  });
});

describe("PRDR-312 a link is repointed as the checker reads it, and nothing else in the document moves", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) removeTree(r);
  });

  it("keeps CRLF endings and front matter, decodes and re-encodes a target, reads an angle-bracket target, and repoints two links on one line", () => {
    const doc = ["---", "see: [front](PRD.md)", "---", "[a](PRD.md) and [b](<PRD.md>), [c](my%20notes.md#top)", "[kept](docs/other.md)", ""].join("\r\n");
    const root = tmpTree({ "README.md": doc, "docs/other.md": "# Other\n" });
    roots.push(root);
    const moved = new Map([
      ["PRD.md", "archive/PRD.md"],
      ["my notes.md", "archive/my notes.md"],
    ]);
    expect(repointLinks(root, ["README.md", "docs/other.md"], moved)).toEqual([{ file: "README.md", links: 3 }]);
    expect(read(root, "README.md")).toBe(
      ["---", "see: [front](PRD.md)", "---", "[a](archive/PRD.md) and [b](<archive/PRD.md>), [c](archive/my%20notes.md#top)", "[kept](docs/other.md)", ""].join("\r\n"),
    );
  });

  it("leaves a document with no link to a moved original byte for byte, and repoints nothing when nothing moved", () => {
    const root = tmpTree({ "README.md": "[the PRD](PRD.md)\n" });
    roots.push(root);
    expect(repointLinks(root, ["README.md"], new Map())).toEqual([]);
    expect(repointLinks(root, ["README.md"], new Map([["docs/roadmap.md", "archive/docs/roadmap.md"]]))).toEqual([]);
    expect(read(root, "README.md")).toBe("[the PRD](PRD.md)\n");
  });

  it("never repoints a link with a scheme, which the checker does not read as relative, whatever the moves name", () => {
    const root = tmpTree({ "README.md": "[a page](https://example.com/PRD.md)\n" });
    roots.push(root);
    expect(repointLinks(root, ["README.md"], new Map([["https:/example.com/PRD.md", "archive/PRD.md"]]))).toEqual([]);
    expect(read(root, "README.md")).toBe("[a page](https://example.com/PRD.md)\n");
  });
});
