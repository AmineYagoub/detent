import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stateDir } from "../../src/fs/layout.js";
import type { AskedQuestion, DecideAnswer } from "../../src/init/decide.js";
import { decisionLogFile, readDecisionLog } from "../../src/init/decide-log.js";
import { parsePack } from "../../src/init/pack-parse.js";
import { checkPack } from "../../src/init/pack-check.js";
import { conformanceRecord, writeConformanceRecord } from "../../src/init/pack.js";
import { discoverDocs } from "../../src/init/discover-docs.js";
import { readProgressMark, readRecordedSpend } from "../../src/kernel/ledger.js";
import { DECISION_LOG_PATH } from "../../src/schemas/pack.js";
import { writeTree } from "../helpers.js";
import { repo } from "./plan-fixture.js";
import {
  DOCS,
  EXISTING,
  LATE,
  PRICE,
  REFUND,
  SORTED,
  SURVEY,
  artifact,
  auditFinds,
  decide,
  decideOutputs,
  initThrough,
  type Json,
} from "./decide-fixture.js";

/**
 * PRDR-282 — DECIDE (C-2⁶, C-3⁗, C-2¹²).
 *
 * Driven through the real pipeline, stopped after DECIDE, so what reaches the
 * log and the checkpoint is what the phase wrote. EXISTING is a brownfield
 * project, whose stack is discovered; DOCS alone is greenfield, where the stack
 * is an item too (D-10′).
 */

const ids = (inputs: Json | undefined): string[] => ((inputs?.["items"] ?? []) as { id: string }[]).map((i) => i.id);
const logText = (root: string): string => readFileSync(decisionLogFile(root), "utf8");

/** A terminal that answers each screen from a script, and records what it was shown. */
function terminal(script: (screen: readonly AskedQuestion[], n: number) => readonly DecideAnswer[] | "later") {
  const screens: (readonly AskedQuestion[])[] = [];
  const ask = async (screen: readonly AskedQuestion[]) => {
    screens.push(screen);
    return script(screen, screens.length - 1);
  };
  return { ask, screens };
}

describe("PRDR-282: DECIDE sorts every item AUDIT left open (C-3⁗)", () => {
  it("runs after AUDIT and gives one spec_write session every open item by id, and no confirmed claim", async () => {
    const root = repo(EXISTING);
    const stub = decide((_, i) => SORTED(i));
    const result = await initThrough(root, stub);
    expect(result.executed).toEqual(["INIT_FS", "DISCOVER", "AUDIT", "DECIDE"]);
    expect(ids(stub.inputs[0])).toEqual(["C1", "G1", "K1"]);
    expect(stub.inputs[0]?.["task"]).toBe("decide");
    expect(stub.inputs[0]?.["greenfield"]).toBe(false);
    /* X-1⁵: a completed DECIDE is a progress mark, taken after its own session was spent. */
    expect(readRecordedSpend(root)).toBeGreaterThan(0);
    expect(readProgressMark(root).spent).toBe(readRecordedSpend(root));

    const confirmed = repo(EXISTING);
    const again = decide(() => artifact({ questions: [PRICE], defaults: [LATE] }));
    await initThrough(confirmed, again, { audit: auditFinds("confirmed") });
    expect(ids(again.inputs[0]), "a confirmed claim is not open").toEqual(["C1", "G1"]);
  });

  it("off a terminal, writes every default and every recommended answer as a vetoable X-n the pack's grammar reads", async () => {
    const root = repo(EXISTING);
    const notes: string[] = [];
    await initThrough(root, decide((_, i) => SORTED(i)), { notes });
    const log = readDecisionLog(root);
    expect(log.decisions).toEqual([]);
    expect(log.defaults.map((d) => [d.id, d.value])).toEqual([
      ["X-1", LATE.value],
      ["X-2", REFUND.value],
      ["X-3", "Free in the MVP"],
    ]);
    expect(log.defaults[0]?.reason).toBe(LATE.reason);
    expect(log.defaults[2]?.reason).toContain("taken without asking, since off a terminal nobody can be asked (specification decision 9)");
    expect(log.defaults[2]?.reason).toContain("No revenue until pricing lands.");
    expect(parsePack(root, [DECISION_LOG_PATH], { greenfield: false }).problems.filter((p) => p.file === DECISION_LOG_PATH)).toEqual([]);
    /* Decision 9: `init`'s output says so, question by question. */
    const said = notes.join("\n");
    expect(said).toContain("DECIDE took the recommended answer to 1 question without asking");
    expect(said).toContain(`X-3: ${PRICE.question} → Free in the MVP`);
    expect(said).toContain("A default is vetoable");
  });

  it("relaunches once with what it refused, and the second attempt keeps what stands", async () => {
    const root = repo(EXISTING);
    const notes: string[] = [];
    const stub = decide((n) =>
      n === 0
        ? artifact({ questions: [PRICE], defaults: [{ ...LATE, settles: ["G1", "Z9"] }] })
        : artifact({ questions: [PRICE], defaults: [LATE] }),
    );
    await initThrough(root, stub, { notes });
    expect(stub.inputs).toHaveLength(2);
    const refused = String((stub.inputs[1]?.["previous_attempt"] as { issue?: string } | undefined)?.issue);
    expect(refused).toContain("default 1 names Z9, which is not an item in your inputs");
    expect(refused).toContain("1 item(s) settled by nothing: K1");
    /* The second attempt still leaves K1 unsorted: kept as it is, and said. */
    expect(readDecisionLog(root).defaults.map((d) => d.value)).toEqual([LATE.value, "Free in the MVP"]);
    expect(notes.join("\n")).toContain("DECIDE left 1 item unsorted after its relaunch");
    expect(decideOutputs(root)["unsorted"]).toEqual([expect.objectContaining({ id: "K1", kind: "claim" })]);
  });

  it("fails the phase when the relaunch writes nothing usable either", async () => {
    const root = repo(EXISTING);
    const result = initThrough(root, decide(() => null));
    await expect(result).rejects.toThrow("DECIDE produced no usable artifact: the session wrote no artifact");
  });
});

describe("PRDR-282: on a terminal, the questions are asked in screens of four (C-3⁗)", () => {
  const asking = (question: string, settles: string[]) => ({ ...PRICE, question, settles });

  it("shows the recommended option first with its consequence, and writes each answer as a D-n", async () => {
    const root = repo(EXISTING);
    const questions = [asking("Is borrowing free at launch?", ["C1"]), asking("Who pays the sales tax on a rental?", ["G1"]), asking("Does a refund keep the card fee?", ["K1"])];
    const tty = terminal((screen) => screen.map((q) => (q.number === 2 ? { own: "Tax is on the member." } : { option: q.number === 1 ? 1 : 0 })));
    await initThrough(root, decide(() => artifact({ questions })), { ask: tty.ask });
    expect(tty.screens.map((s) => s.map((q) => q.number))).toEqual([[1, 2, 3]]);
    expect(tty.screens[0]?.[0]?.options).toEqual(PRICE.options.map((o) => ({ answer: o.answer, consequence: o.consequence })));
    expect(tty.screens[0]?.[0]?.why_asked).toBe(PRICE.why_asked);
    const log = readDecisionLog(root);
    expect(log.defaults).toEqual([]);
    expect(log.decisions).toEqual([
      { id: "D-1", question: "Is borrowing free at launch?", answer: "**Two dollars a day**", reason: "The payment rail ships with the MVP." },
      { id: "D-2", question: "Who pays the sales tax on a rental?", answer: "**Tax is on the member.**", reason: "The founder's own answer, given at DECIDE." },
      { id: "D-3", question: "Does a refund keep the card fee?", answer: "**Free in the MVP**", reason: "No revenue until pricing lands." },
    ]);
  });

  it("splits more than four questions into screens of at most four, numbered across them", async () => {
    const root = repo(EXISTING);
    const gaps = ["late returns", "lost tools", "damaged tools", "member bans"].map((topic) => ({ topic, detail: `nothing on ${topic}`, passages: [] }));
    const topics = ["the price", "late fees", "lost-tool charges", "damage charges", "ban appeals"];
    const questions = ["C1", "G1", "G2", "G3", "G4"].map((id, n) => asking(`What does the founder want for ${topics[n] ?? ""}?`, [id]));
    const tty = terminal((screen) => screen.map(() => ({ option: 0 })));
    await initThrough(root, decide(() => artifact({ questions, defaults: [REFUND] })), { ask: tty.ask, audit: auditFinds("wrong", { ...SURVEY, gaps }) });
    expect(tty.screens.map((s) => s.map((q) => q.number))).toEqual([[1, 2, 3, 4], [5]]);
    expect(readDecisionLog(root).decisions.map((d) => d.id)).toEqual(["D-1", "D-2", "D-3", "D-4", "D-5"]);
    expect(readDecisionLog(root).defaults.map((d) => d.id)).toEqual(["X-1"]);
  });
});

describe("PRDR-282: answering later stops at DECIDE with AWAIT_INFO (C-3⁗, C-5)", () => {
  it("lists every question with its options, writes nothing, and asks again next time without a session", async () => {
    const root = repo(EXISTING);
    const stub = decide((_, i) => SORTED(i));
    const later = await initThrough(root, stub, { ask: async () => "later" });
    expect(later.reachedPhase).toBe("DECIDE");
    expect(later.interrupt?.interrupt).toBe("AWAIT_INFO");
    expect(later.interrupt?.message).toContain(PRICE.question);
    expect(later.interrupt?.message).toContain("1) Free in the MVP (recommended) — No revenue until pricing lands.");
    expect(later.interrupt?.message).toContain("Nothing was written to the decision log.");
    expect(later.interrupt?.items).toEqual([PRICE.question]);
    expect(existsSync(decisionLogFile(root))).toBe(false);
    expect(existsSync(path.join(stateDir(root), "state", "DECIDE.json"))).toBe(false);

    const tty = terminal((screen) => screen.map(() => ({ option: 1 })));
    const answered = await initThrough(root, stub, { ask: tty.ask });
    expect(answered.exitCode).toBe(0);
    expect(stub.inputs, "the draft the first session wrote is asked again").toHaveLength(1);
    expect(readDecisionLog(root).decisions.map((d) => d.answer)).toEqual(["**Two dollars a day**"]);
    expect(decideOutputs(root)["session"]).toBe(false);
  });

  it("drafts again when the log changed while the questions waited", async () => {
    const root = repo(EXISTING);
    const stub = decide((_, i) => SORTED(i));
    await initThrough(root, stub, { ask: async () => "later" });
    writeTree(root, { [DECISION_LOG_PATH]: "# Founder decisions\n\n## Defaults\n\n| Id | Default | Reason |\n|---|---|---|\n| X-1 | Late returns are free. | Goodwill. |\n" });
    await initThrough(root, stub, { ask: async (screen) => screen.map(() => ({ option: 0 })) });
    expect(stub.inputs).toHaveLength(2);
    expect(stub.inputs[1]?.["decision_log_entries"]).toEqual([{ id: "X-1", value: "Late returns are free." }]);
  });
});

describe("PRDR-282: a question the log answers is not asked again, in any words (C-3‴)", () => {
  const LOG = [
    "# Founder decisions",
    "",
    "## Decisions",
    "",
    "| Id | Question | Answer | Reason |",
    "|---|---|---|---|",
    "| D-1 | Is borrowing free at launch or is it two dollars a day? | **Free** | The MVP earns nothing. |",
    "",
  ].join("\n");

  it("refuses the question, relaunches, and cites the log's entry for what the question would have settled", async () => {
    const root = repo({ ...EXISTING, [DECISION_LOG_PATH]: LOG });
    const tty = terminal((screen) => screen.map(() => ({ option: 0 })));
    const reworded = { ...PRICE, question: "At launch, is borrowing free, or does it cost two dollars a day?" };
    const stub = decide(() => artifact({ questions: [reworded], defaults: [LATE, REFUND] }));
    await initThrough(root, stub, { ask: tty.ask });
    expect(stub.inputs[0]?.["decision_log_entries"]).toEqual([{ id: "D-1", question: "Is borrowing free at launch or is it two dollars a day?", answer: "**Free**" }]);
    expect(String((stub.inputs[1]?.["previous_attempt"] as { issue: string }).issue)).toContain("one the decision log already answers, as D-1");
    expect(tty.screens, "never asked").toEqual([]);
    expect(readDecisionLog(root).decisions.map((d) => d.id), "and never logged twice").toEqual(["D-1"]);
    expect(decideOutputs(root)["cited"]).toEqual(["D-1"]);
  });
});

describe("PRDR-282: an answer re-runs DECIDE forward, never AUDIT (C-8, C-2¹²)", () => {
  it("is reused on the next init though it wrote the log, and a veto re-runs it without a session", async () => {
    const root = repo(EXISTING);
    const stub = decide((_, i) => SORTED(i));
    await initThrough(root, stub);
    const again = await initThrough(root, stub);
    expect(again.reused).toEqual(["INIT_FS", "DISCOVER", "AUDIT", "DECIDE"]);

    /* A veto edits X-1's row; the row stands, so every item is still settled. */
    writeFileSync(decisionLogFile(root), logText(root).replace(LATE.value, "A late return costs a day's fee."));
    const vetoed = await initThrough(root, stub);
    expect(vetoed.executed).toEqual(["DECIDE"]);
    expect(vetoed.reused).toEqual(["INIT_FS", "DISCOVER", "AUDIT"]);
    expect(stub.inputs, "the item X-1 settled is still settled by X-1").toHaveLength(1);
    expect(decideOutputs(root)["defaults"]).toEqual(expect.arrayContaining([expect.objectContaining({ id: "X-1", value: "A late return costs a day's fee." })]));
  });

  it("asks again about an item whose entry was deleted, and about nothing else", async () => {
    const root = repo(EXISTING);
    const stub = decide((n, i) => (n === 0 ? SORTED(i) : artifact({ defaults: [{ ...LATE, value: "Late returns are refused." }] })));
    await initThrough(root, stub);
    writeFileSync(decisionLogFile(root), logText(root).split("\n").filter((l) => !l.startsWith("| X-1 ")).join("\n"));
    await initThrough(root, stub);
    expect(ids(stub.inputs[1])).toEqual(["G1"]);
    expect(readDecisionLog(root).defaults.map((d) => [d.id, d.value])).toEqual([
      ["X-2", REFUND.value],
      ["X-3", "Free in the MVP"],
      ["X-4", "Late returns are refused."],
    ]);
  });

  it("asks nothing, and runs no session, when AUDIT left nothing open", async () => {
    const root = repo(EXISTING);
    const notes: string[] = [];
    const empty = { ...SURVEY, contradictions: [], gaps: [], claims: [] };
    const stub = decide(() => artifact());
    await initThrough(root, stub, { audit: auditFinds("wrong", empty), notes });
    expect(stub.inputs).toEqual([]);
    expect(notes.join("\n")).toContain("AUDIT left nothing open, so there is nothing to decide");
    expect(existsSync(decisionLogFile(root))).toBe(false);
  });
});

describe("PRDR-282: in greenfield DECIDE records the stack (D-10′)", () => {
  it("opens the stack as an item, and writes the entry the pack's grammar reads", async () => {
    const root = repo(DOCS);
    const stub = decide((_, i) => SORTED(i));
    await initThrough(root, stub);
    expect(ids(stub.inputs[0])).toEqual(["C1", "G1", "K1", "stack"]);
    const log = readDecisionLog(root);
    expect(log.stack).toEqual({ decision: "X-3", language: "TypeScript", toolchain: "Node.js 24 with pnpm 10", scaffold_files: ["package.json"], gates: { test: "pnpm test" } });
    expect(decideOutputs(root)["stack"]).toEqual(log.stack);
  });

  it("asks it where it is counted in money, takes no own answer for it, and records the chosen option's stack", async () => {
    const root = repo(DOCS);
    const hosted = {
      question: "Which hosting contract does the product run on?",
      why_asked: "Each is a contract with its own monthly cost.",
      options: [
        { answer: "A managed Node host", consequence: "A monthly fee.", stack: { language: "TypeScript", toolchain: "Node.js 24" } },
        { answer: "The founder's Go server", consequence: "No new contract.", stack: { language: "Go", toolchain: "Go 1.24", gates: { test: "go test ./..." } } },
      ],
      settles: ["stack"],
    };
    const tty = terminal((screen) => screen.map((q) => ({ option: q.question === hosted.question ? 1 : 0 })));
    await initThrough(root, decide(() => artifact({ questions: [PRICE, hosted], defaults: [LATE, REFUND] })), { ask: tty.ask });
    expect(tty.screens[0]?.map((q) => q.ownAllowed)).toEqual([true, false]);
    expect(readDecisionLog(root).stack).toEqual({ decision: "D-2", language: "Go", toolchain: "Go 1.24", scaffold_files: [], gates: { test: "go test ./..." } });
  });

  it("does not open the stack when the log already records one", async () => {
    const withStack = "# Founder decisions\n\n## Stack\n\n| Field | Value |\n|---|---|\n| decision | X-9 |\n| language | Go |\n| toolchain | Go 1.24 |\n";
    const root = repo({ ...DOCS, [DECISION_LOG_PATH]: withStack });
    const stub = decide((_, i) => SORTED(i));
    await initThrough(root, stub);
    expect(ids(stub.inputs[0])).toEqual(["C1", "G1", "K1"]);
    expect(readDecisionLog(root).stack?.language).toBe("Go");
  });
});

describe("PRDR-282: a pack's decision log is the founder's record already (C-2⁶)", () => {
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
    writeConformanceRecord(root, conformanceRecord(root, { checker, rounds: [], date: "2026-09-26" }));
    return root;
  }

  it("decides nothing on a conforming pack, and hands its log, its defaults and its stack to planning", async () => {
    const root = packRepo();
    const stub = decide(() => artifact());
    const notes: string[] = [];
    await initThrough(root, stub, { notes });
    expect(stub.inputs).toEqual([]);
    const out = decideOutputs(root);
    expect(out["ran"]).toBe(false);
    expect(out["reason"]).toBe("conforming");
    expect(out["log"]).toBe(DECISION_LOG_PATH);
    expect(out["stack"]).toEqual(expect.objectContaining({ decision: "X-2" }));
    expect((out["defaults"] as unknown[]).length).toBeGreaterThan(0);
    expect(notes.join("\n")).toContain("DECIDE: the documents are a conforming pack");
    expect(readProgressMark(root).spent, "a completed phase is a progress mark, sessions or none (C-2⁶)").not.toBeNull();
  });

  it("decides nothing on a changed pack either, and says that WRITE and VALIDATE are not built", async () => {
    const root = packRepo();
    const prd = readdirSync(path.join(root, "docs", "prd")).find((f) => f.endsWith(".md") && f !== "index.md") ?? "";
    writeFileSync(path.join(root, "docs", "prd", prd), `${readFileSync(path.join(root, "docs", "prd", prd), "utf8")}\n`);
    const stub = decide(() => artifact());
    const notes: string[] = [];
    await initThrough(root, stub, { notes });
    expect(stub.inputs).toEqual([]);
    expect(decideOutputs(root)["reason"]).toBe("changed");
    expect(notes.join("\n")).toContain("Applying its change is WRITE's and checking it VALIDATE's, and this build has neither");
  });
});

describe("PRDR-282: DISCOVER does not list the decision log (C-2¹²)", () => {
  it("raises AWAIT_DOCS for a directory whose only document is the log, which is no set of documents to plan from", async () => {
    const root = repo({ [DECISION_LOG_PATH]: "# Founder decisions\n\n## Defaults\n\n| Id | Default | Reason |\n|---|---|---|\n| X-1 | v | r |\n" });
    const result = await initThrough(root, decide(() => artifact()));
    expect(result.reachedPhase).toBe("DISCOVER");
    expect(result.interrupt?.interrupt).toBe("AWAIT_DOCS");
  });
});
