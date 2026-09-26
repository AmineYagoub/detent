import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { discoverDocs } from "../../src/init/discover-docs.js";
import { readDecisionLog } from "../../src/init/decide-log.js";
import { classifyPack, conformanceRecord, readConformanceRecord, writeConformanceRecord } from "../../src/init/pack.js";
import { checkPack } from "../../src/init/pack-check.js";
import { readProgressMark, readRecordedSpend } from "../../src/kernel/ledger.js";
import { parseArtifact } from "../../src/schemas/common.js";
import { DECISION_LOG_PATH, PACK_PATHS } from "../../src/schemas/pack.js";
import { writeArtifactSchema } from "../../src/schemas/write.js";
import { guardToolUse, stopGate } from "../../src/sessions/guard.js";
import { MockBackend, okResult, type StageFn } from "../../src/sessions/mock.js";
import { loadPromptSet } from "../../src/sessions/prompts.js";
import { repo } from "./plan-fixture.js";
import { PRD, ROADMAP, type Json } from "./decide-fixture.js";
import { INDEX, LENDING, PACK, RAW, README, WROTE, initThroughWrite, read, write, writeOutputs, writesPack } from "./write-fixture.js";

/**
 * PRDR-283 — WRITE: the audited and decided documents are rewritten into the
 * pack (C-2⁶, C-2⁷), the originals it rewrote are moved to `archive/`, and the
 * pack, not the originals, is what the phases after it read.
 */

const TODAY = { now: () => new Date("2026-09-26T12:00:00Z") };
const PACK_DOCS = ["README.md", "docs/founder-decisions.md", "docs/prd/01-lending.md", "docs/prd/index.md", "docs/research/verified-facts.md"];
const issueOf = (inputs: Json | undefined): string => String((inputs?.["previous_attempt"] as Json | undefined)?.["issue"] ?? "");
const at = (root: string, rel: string): boolean => existsSync(path.join(root, ...rel.split("/")));

describe("PRDR-283: WRITE rewrites a raw document set into the pack (C-2⁶)", () => {
  it("runs after DECIDE and gives one spec_write session the documents, AUDIT's findings with the entries that settled them, and the log", async () => {
    const root = repo(RAW);
    const stub = writesPack();
    const result = await initThroughWrite(root, stub);
    expect(result.executed).toEqual(["INIT_FS", "DISCOVER", "AUDIT", "DECIDE", "WRITE"]);
    expect(stub.inputs).toHaveLength(1);
    const given = stub.inputs[0] ?? {};
    expect(given["task"]).toBe("write");
    expect(given["documents"]).toEqual(["PRD.md", "README.md", "docs/roadmap.md"]);
    expect((given["findings"] as Json[]).map((f) => [f["id"], f["settled_by"]])).toEqual([
      ["C1", "X-4"],
      ["G1", "X-1"],
      ["K1", "X-2"],
    ]);
    const claim = (given["claims"] as Json[])[0] ?? {};
    expect([claim["verdict"], claim["correction"]]).toEqual(["wrong", "Stripe keeps the processing fee when a payment is refunded."]);
    expect((given["decision_log_entries"] as Json[]).map((e) => e["id"])).toEqual(["X-1", "X-2", "X-3", "X-4"]);
    expect(given["next_default"]).toBe("X-5");
    expect([given["greenfield"], given["stack_markers"], given["pack_paths"]]).toEqual([true, [], [...PACK_PATHS]]);
    expect(parseArtifact(writeArtifactSchema, given["expected_output"]).ok, "the skeleton is the schema's").toBe(true);
  });

  it("moves every original it rewrote to archive/, byte for byte, and leaves a context document where it is", async () => {
    const root = repo(RAW);
    const notes: string[] = [];
    await initThroughWrite(root, writesPack(), { notes });
    expect(notes.join("\n")).toContain("WRITE wrote the pack: it archived PRD.md, docs/roadmap.md, kept README.md as context, and rewrote none in place");
    expect(read(root, "archive/PRD.md")).toBe(PRD);
    expect(read(root, "archive/docs/roadmap.md")).toBe(ROADMAP);
    expect(at(root, "PRD.md")).toBe(false);
    expect(at(root, "docs/roadmap.md")).toBe(false);
    expect(read(root, "README.md")).toBe(README);
    expect(writeOutputs(root)["archived"]).toEqual([
      { from: "PRD.md", to: "archive/PRD.md" },
      { from: "docs/roadmap.md", to: "archive/docs/roadmap.md" },
    ]);
    expect(writeOutputs(root)["context"]).toEqual(["README.md"]);
  });

  it("leaves a pack the next DISCOVER finds with nothing but its context documents, and hands that pack to planning", async () => {
    const root = repo(RAW);
    await initThroughWrite(root, writesPack(), { more: TODAY });
    expect(discoverDocs(root).docs).toEqual(PACK_DOCS);
    expect(writeOutputs(root)["docs"]).toEqual(PACK_DOCS);
    expect(classifyPack(root, { greenfield: true })).toEqual({ kind: "written", date: "2026-09-26", blocking: 0 });
  });

  it("writes the conformance record as not validated, with the checker's result on the pack", async () => {
    const root = repo(RAW);
    await initThroughWrite(root, writesPack(), { more: TODAY });
    const record = readConformanceRecord(root);
    expect(record?.validated).toBe(false);
    expect(record?.checker.green).toBe(true);
    expect(record?.rounds).toEqual([]);
    expect(record?.date).toBe("2026-09-26");
    expect(Object.keys(record?.documents ?? {}).sort()).toEqual(PACK_DOCS);
  });

  it("marks progress when it completes, after its own session was spent (X-1⁵)", async () => {
    const root = repo(RAW);
    await initThroughWrite(root, writesPack());
    expect(readRecordedSpend(root)).toBeGreaterThan(0);
    expect(readProgressMark(root).spent).toBe(readRecordedSpend(root));
  });

  it("keeps the original of a pack document it rewrote in archive/, since nothing is deleted", async () => {
    const old = "# Architecture\n\nThe first sketch.\n";
    const root = repo({ ...RAW, "docs/design/architecture.md": old });
    const stub = write(() => ({ files: { ...PACK, "docs/design/architecture.md": "# Architecture\n\nLending owns loans (X-1).\n" }, artifact: WROTE() }));
    await initThroughWrite(root, stub);
    expect(stub.inputs[0]?.["documents"]).toContain("docs/design/architecture.md");
    expect(read(root, "archive/docs/design/architecture.md")).toBe(old);
    expect(read(root, "docs/design/architecture.md")).toContain("(X-1)");
    expect(writeOutputs(root)["rewritten"]).toEqual([{ path: "docs/design/architecture.md", original: "archive/docs/design/architecture.md" }]);
  });

  it("never overwrites what archive/ already holds: a second original of one name is kept beside the first", async () => {
    const root = repo({ ...RAW, "archive/PRD.md": "an older original\n" });
    await initThroughWrite(root, writesPack());
    expect(read(root, "archive/PRD.md")).toBe("an older original\n");
    expect(read(root, "archive/PRD.2.md")).toBe(PRD);
    expect(writeOutputs(root)["archived"]).toContainEqual({ from: "PRD.md", to: "archive/PRD.2.md" });
  });
});

describe("PRDR-283: code checks what WRITE wrote (C-2¹³)", () => {
  it("judges the pack as it will stand, without the originals it archives", async () => {
    const root = repo({ ...RAW, "SPEC.md": "# Spec\n\nSee LND-F-099 for the fee.\n" });
    const stub = write(() => ({ files: PACK, artifact: WROTE({ archive: ["PRD.md", "SPEC.md", "docs/roadmap.md"] }) }));
    await initThroughWrite(root, stub);
    expect(stub.inputs, "an id only an archived original names refuses nothing").toHaveLength(1);
    expect(read(root, "archive/SPEC.md")).toContain("LND-F-099");
  });

  it("refuses an original listed nowhere or twice, and a planning document kept as context, and relaunches once with the list", async () => {
    const root = repo(RAW);
    const first = WROTE({ archive: ["docs/roadmap.md", "docs/roadmap.md"], context: ["PRD.md"] });
    const stub = write((n) => ({ files: PACK, artifact: n === 0 ? first : WROTE() }));
    await initThroughWrite(root, stub);
    expect(stub.inputs).toHaveLength(2);
    const issue = issueOf(stub.inputs[1]);
    expect(issue).toContain("README.md is listed in neither archive nor context");
    expect(issue).toContain("docs/roadmap.md is listed twice");
    expect(issue).toContain("PRD.md is a planning document by its name");
    expect(read(root, "archive/PRD.md")).toBe(PRD);
  });

  it("relaunches for a blocking checker finding, and records a red checker when the second attempt leaves one", async () => {
    const root = repo(RAW);
    const uncovered = LENDING.split("\n").filter((l) => !l.includes("LND-AC-02")).join("\n");
    const stub = write(() => ({ files: { ...PACK, "docs/prd/01-lending.md": uncovered }, artifact: WROTE() }));
    const notes: string[] = [];
    await initThroughWrite(root, stub, { notes });
    expect(stub.inputs).toHaveLength(2);
    expect(issueOf(stub.inputs[1])).toContain("LND-F-002");
    const record = readConformanceRecord(root);
    expect(record?.validated).toBe(false);
    expect(record?.checker.green).toBe(false);
    expect(notes.join("\n")).toMatch(/WRITE: the pack checker is red, with 1 blocking finding/u);
    expect(read(root, "archive/PRD.md"), "a red checker is VALIDATE's to fix, and the pack still replaces the originals").toBe(PRD);
  });

  it("refuses a pack that cites neither an entry DECIDE settled a finding with nor a default it added itself", async () => {
    const root = repo(RAW);
    const withX5 = (r: string): string => read(r, DECISION_LOG_PATH).replace(/(\| X-4 \|[^\n]*\n)/u, "$1| X-5 | A loan lasts seven days. | The documents imply a week. |\n");
    const bare = LENDING.replace("(X-2; facts §1.1)", "(facts §1.1)");
    const stub = write((n) => ({ files: { ...PACK, "docs/prd/01-lending.md": n === 0 ? bare : LENDING }, artifact: WROTE() }));
    const adds = write((n, _, r) => ({
      files: { ...PACK, "docs/prd/01-lending.md": n === 0 ? bare : LENDING.replace("(X-1)", "(X-1, X-5)"), ...(n === 0 ? { [DECISION_LOG_PATH]: withX5(r) } : {}) },
      artifact: WROTE(),
    }));
    await initThroughWrite(root, stub);
    expect(issueOf(stub.inputs[1])).toContain("the pack does not cite X-2, which settles K1");

    const other = repo(RAW);
    await initThroughWrite(other, adds);
    expect(issueOf(adds.inputs[1])).toContain("the pack does not cite X-5, a default you added to the log");
    expect(readDecisionLog(other).defaults.map((d) => d.id)).toContain("X-5");
  });

  it("hands planning a pack that still owes a cite after the second attempt, and says which", async () => {
    const root = repo(RAW);
    const bare = LENDING.replace("(X-2; facts §1.1)", "(facts §1.1)");
    const notes: string[] = [];
    await initThroughWrite(root, write(() => ({ files: { ...PACK, "docs/prd/01-lending.md": bare }, artifact: WROTE() })), { notes });
    expect(notes.join("\n")).toContain("WRITE: the pack does not cite X-2, which settles K1; the pack goes to planning without it (C-2⁶)");
    expect(read(root, "archive/PRD.md")).toBe(PRD);
  });

  it("fails, and leaves the tree as it was, when no attempt writes a usable artifact", async () => {
    const root = repo(RAW);
    const stub = write((n) => ({ files: PACK, artifact: n === 0 ? null : { ...WROTE(), moved: [] } }));
    await expect(initThroughWrite(root, stub)).rejects.toThrow(/WRITE produced no usable artifact/u);
    expect(issueOf(stub.inputs[1])).toContain("the session wrote no artifact");
    expect(at(root, "docs/prd")).toBe(false);
    expect(read(root, "PRD.md")).toBe(PRD);
  });

  it("reads each attempt's own artifact: the refused one is gone before the relaunch, so a relaunch that writes none fails", async () => {
    const root = repo(RAW);
    const stub = write((n) => ({ files: PACK, artifact: n === 0 ? WROTE({ context: [] }) : null }));
    await expect(initThroughWrite(root, stub)).rejects.toThrow(/WRITE produced no usable artifact: the session wrote no artifact/u);
    expect(issueOf(stub.inputs[1])).toContain("README.md is listed in neither archive nor context");
    expect(read(root, "PRD.md")).toBe(PRD);
  });

  it("restores the decision log when a rewrite dropped or changed a row it already held, and archives nothing for it", async () => {
    const root = repo(RAW);
    let before = "";
    const stub = write((n, _, r) => {
      if (n === 0) before = read(r, DECISION_LOG_PATH);
      return { files: { ...PACK, [DECISION_LOG_PATH]: before.split("\n").filter((l) => !l.startsWith("| X-1 |")).join("\n") }, artifact: WROTE() };
    });
    const notes: string[] = [];
    await initThroughWrite(root, stub, { notes });
    expect(issueOf(stub.inputs[1])).toContain("the decision log's X-1 is gone");
    expect(read(root, DECISION_LOG_PATH)).toBe(before);
    expect(at(root, "archive/docs/founder-decisions.md")).toBe(false);
    expect(notes.join("\n")).toContain("WRITE: the decision log is restored as DECIDE left it");
    expect(readConformanceRecord(root)?.checker.green, "restored, X-1 resolves again").toBe(true);
  });

  it("on the second attempt archives a planning document kept as context, and leaves an unlisted document where it is", async () => {
    const root = repo(RAW);
    const stub = write(() => ({ files: PACK, artifact: WROTE({ archive: [], context: ["PRD.md", "README.md"] }) }));
    const notes: string[] = [];
    await initThroughWrite(root, stub, { notes });
    expect(read(root, "archive/PRD.md")).toBe(PRD);
    expect(read(root, "docs/roadmap.md")).toBe(ROADMAP);
    const said = notes.join("\n");
    expect(said).toContain("WRITE archived PRD.md, which its session kept as context: a planning document is never context");
    expect(said).toContain("WRITE left docs/roadmap.md where it is, as context: its session did not say whether it rewrote it");
  });

  it("fails, and leaves the tree as it was, when no attempt writes a requirement", async () => {
    const root = repo(RAW);
    const stub = write(() => ({ files: { "docs/prd/index.md": INDEX }, artifact: WROTE() }));
    await expect(initThroughWrite(root, stub)).rejects.toThrow(/WRITE wrote no requirement/u);
    expect(issueOf(stub.inputs[1]), "the relaunch is told").toContain("the pack holds no requirement: write the module PRDs under docs/prd/");
    expect(read(root, "PRD.md")).toBe(PRD);
    expect(at(root, "docs/prd/index.md")).toBe(false);
    expect(at(root, "archive")).toBe(false);
    expect(at(root, "docs/conformance.json")).toBe(false);
    expect(at(root, DECISION_LOG_PATH), "DECIDE's log is DECIDE's, and stays").toBe(true);
  });

  it("runs again on the next init after it failed, from the same originals, and never archives DECIDE's log", async () => {
    const root = repo(RAW);
    await expect(initThroughWrite(root, write(() => ({ files: { "docs/prd/index.md": INDEX }, artifact: WROTE() })))).rejects.toThrow(/WRITE wrote no requirement/u);
    const stub = writesPack();
    const again = await initThroughWrite(root, stub);
    expect(again.executed, "nothing before it re-runs: the failure left the tree as DECIDE did").toEqual(["WRITE"]);
    expect(stub.inputs[0]?.["documents"]).toEqual(["PRD.md", "README.md", "docs/roadmap.md"]);
    expect(read(root, "archive/PRD.md")).toBe(PRD);
    expect(at(root, "archive/docs/founder-decisions.md")).toBe(false);
  });

  it("leaves the tree as it was when its session fails, restoring a pack document it had changed", async () => {
    const old = "# Architecture\n\nThe first sketch.\n";
    const root = repo({ ...RAW, "docs/design/architecture.md": old });
    const dies: StageFn = (spec) => {
      for (const [rel, text] of Object.entries({ ...PACK, "docs/design/architecture.md": "# half written\n" })) {
        mkdirSync(path.dirname(path.join(spec.cwd, rel)), { recursive: true });
        writeFileSync(path.join(spec.cwd, rel), text);
      }
      return okResult({ ok: false, rawTail: "the session died" });
    };
    const stub = { stage: dies, inputs: [], specs: [] };
    await expect(initThroughWrite(root, stub)).rejects.toThrow(/spec_write session failed/u);
    expect(read(root, "docs/design/architecture.md")).toBe(old);
    expect(at(root, "docs/prd")).toBe(false);
    expect(read(root, "PRD.md")).toBe(PRD);
  });
});

describe("PRDR-283: when WRITE writes nothing (C-2⁶, C-2¹³)", () => {
  function packRepo(): string {
    const fixture = path.join(import.meta.dirname, "..", "fixtures", "pack");
    const files: Record<string, string> = {};
    for (const entry of readdirSync(fixture, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const abs = path.join(entry.parentPath, entry.name);
      files[path.relative(fixture, abs).split(path.sep).join("/")] = readFileSync(abs, "utf8");
    }
    const root = repo(files);
    const checker = checkPack(root, discoverDocs(root).docs, { greenfield: true });
    writeConformanceRecord(root, conformanceRecord(root, { checker, rounds: [], date: "2026-09-26", validated: true }));
    return root;
  }

  it("writes nothing on a conforming pack, and hands the pack to planning", async () => {
    const root = packRepo();
    const stub = writesPack();
    const notes: string[] = [];
    await initThroughWrite(root, stub, { notes });
    expect(stub.inputs).toEqual([]);
    expect(writeOutputs(root)["ran"]).toBe(false);
    expect(writeOutputs(root)["reason"]).toBe("conforming");
    expect(writeOutputs(root)["docs"]).toEqual(discoverDocs(root).docs);
    expect(notes.join("\n")).toContain("WRITE: the documents are a conforming pack, which is never rewritten (C-2⁶)");
    expect(readProgressMark(root).spent).not.toBeNull();
  });

  it("writes nothing on a changed pack, whose change is VALIDATE's", async () => {
    const root = packRepo();
    writeFileSync(path.join(root, "docs", "prd", "01-lending.md"), `${read(root, "docs/prd/01-lending.md")}\n`);
    const stub = writesPack();
    const notes: string[] = [];
    await initThroughWrite(root, stub, { notes });
    expect(stub.inputs).toEqual([]);
    expect(writeOutputs(root)["reason"]).toBe("changed");
    expect(notes.join("\n")).toContain("WRITE: the documents are a changed pack, which is never rewritten");
  });

  it("writes nothing on the pack it wrote, edited since, and says planning reads it as it stands", async () => {
    const root = repo(RAW);
    await initThroughWrite(root, writesPack());
    writeFileSync(path.join(root, "docs", "prd", "01-lending.md"), `${read(root, "docs/prd/01-lending.md")}\n`);
    const stub = writesPack();
    const notes: string[] = [];
    await initThroughWrite(root, stub, { notes });
    expect(stub.inputs).toEqual([]);
    expect(writeOutputs(root)["reason"]).toBe("written");
    expect(notes.join("\n")).toContain(
      "WRITE: the documents are the pack WRITE wrote, which is never rewritten: nothing has validated it, and planning reads it as it stands (C-2¹³)",
    );
  });

  it("writes the pack when plan_docs is empty, which narrows nothing (PRDR-086)", async () => {
    const root = repo(RAW);
    const stub = writesPack();
    await initThroughWrite(root, stub, { more: { planDocs: [] } });
    expect(stub.inputs).toHaveLength(1);
  });

  it("writes the pack once plan_docs is dropped, though the set it narrowed to was the whole one", async () => {
    const root = repo(RAW);
    const stub = writesPack();
    await initThroughWrite(root, stub, { more: { planDocs: ["**/*.md"] } });
    expect(writeOutputs(root)["reason"]).toBe("plan_docs");
    await initThroughWrite(root, stub);
    expect(stub.inputs).toHaveLength(1);
    expect(read(root, "archive/PRD.md")).toBe(PRD);
  });

  it("writes nothing when plan_docs narrows discovery, since a pack is written from the whole set, and planning reads the narrowed documents", async () => {
    const root = repo(RAW);
    const stub = writesPack();
    const notes: string[] = [];
    await initThroughWrite(root, stub, { notes, more: { planDocs: ["PRD*.md"] } });
    expect(stub.inputs).toEqual([]);
    expect(writeOutputs(root)["reason"]).toBe("plan_docs");
    expect(writeOutputs(root)["docs"]).toEqual(["PRD.md", DECISION_LOG_PATH]);
    expect(read(root, "PRD.md")).toBe(PRD);
    expect(notes.join("\n")).toContain("WRITE: plan_docs narrows discovery to part of the document set");
  });
});

describe("PRDR-283: the WRITE session's write surface (S-1‴)", () => {
  it("declares the pack's paths as its surface, as an implement session's is declared, with Edit and Write and no Bash", async () => {
    const root = repo(RAW);
    const stub = writesPack();
    await initThroughWrite(root, stub);
    const spec = stub.specs[0];
    expect(spec?.role).toBe("spec_write");
    expect(spec?.allowedTools).toEqual(expect.arrayContaining(["Read", "Grep", "Glob", "Edit", "Write"]));
    expect(spec?.allowedTools.some((t) => t.startsWith("Bash"))).toBe(false);
    expect(spec?.policy?.surface).toEqual([
      ".detent/state/write-artifact.json",
      "docs/founder-decisions.md",
      "docs/research/verified-facts.md",
      "docs/design/*.md",
      "docs/adr/*.md",
      "docs/prd/*.md",
    ]);
    expect(parseArtifact(writeArtifactSchema, JSON.parse(readFileSync(spec?.artifactOut ?? "", "utf8"))).ok).toBe(true);
  });

  it("is let write the pack's paths by the hook, and nothing else: not the code, the record, archive/ or a context document", async () => {
    const root = repo(RAW);
    const stub = writesPack();
    await initThroughWrite(root, stub);
    const policy = stub.specs[0]?.policy;
    if (policy === undefined) throw new Error("the WRITE session published no containment policy");
    const verdict = (rel: string) => guardToolUse("Write", { file_path: path.join(root, rel) }, policy, (p) => p).decision;
    expect(verdict("docs/prd/02-members.md")).toBe("allow");
    expect(verdict(DECISION_LOG_PATH)).toBe("allow");
    expect(verdict("docs/design/architecture.md")).toBe("allow");
    for (const denied of ["src/index.ts", "docs/conformance.json", "archive/PRD.md", "README.md", "docs/prd/sub/notes.md", "docs/research/other.md"]) {
      expect(verdict(denied), denied).toBe("deny");
    }
  });

  it("leaves DECIDE's session its artifact alone: the same role, told another task, declares no surface", async () => {
    const root = repo(RAW);
    let backend: MockBackend | null = null;
    await initThroughWrite(root, writesPack(), { backend: (script) => (backend = new MockBackend(script)) });
    const decideSpec = (backend as MockBackend | null)?.calls.find((c) => c.role === "spec_write")?.spec;
    expect(decideSpec?.allowedTools).not.toContain("Write");
    expect(decideSpec?.allowedTools).not.toContain("Edit");
    expect(decideSpec?.policy?.surface).toEqual([".detent/state/decide-artifact.json"]);
  });

  it("is told its task, its paths, and that code moves the originals, in the role's own prompt", () => {
    const prompt = (loadPromptSet().prompts as Readonly<Record<string, string>>)["spec_write"] ?? "";
    expect(prompt).toContain("`task: write`");
    expect(prompt).toContain("you never move or delete a document, since code moves the ones you rewrote to `archive/`");
    expect(prompt).toContain("never add a decision (`D-n`)");
  });

  it("is never stopped by the product's gate, since it writes documents and not code", async () => {
    let ran = false;
    const decision = await stopGate({ stage: "spec_write", gateCmd: "npm test", stopHookActive: false }, async () => {
      ran = true;
      return { green: false, outputTail: "1 failing" };
    });
    expect(decision.decision).toBe("allow");
    expect(ran, "the gate was not run for it").toBe(false);
  });
});
