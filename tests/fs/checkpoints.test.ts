import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkpointPath,
  inputsHash,
  readCheckpoint,
  resumePlan,
  withCheckpoint,
  writeCheckpoint,
  type Pipeline,
} from "../../src/fs/checkpoints.js";
import { initLayout } from "../../src/fs/layout.js";
import { checkpointSchema } from "../../src/schemas/records.js";
import { removeTree, tmpTree, writeTree } from "../helpers.js";

/** T-024 — content-addressed checkpoints (F-4, P9, C-8 substrate). */

const trees: string[] = [];
const tree = (files: Record<string, string> = {}): string => {
  const root = tmpTree(files);
  trees.push(root);
  initLayout(root);
  return root;
};
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
});

/** The init pipeline of C-4.1, abridged to the phases with file inputs. */
const PIPELINE: Pipeline = [
  { phase: "DISCOVER", inputs: ["package.json", "docs/PRD.md"] },
  { phase: "ANALYZE", inputs: ["docs/PRD.md"] },
  { phase: "DETERMINE_VERIFICATION", inputs: ["package.json"] },
  { phase: "PLAN", inputs: ["docs/plan-notes.md"] },
];

const FILES = {
  "package.json": '{"name":"fixture"}\n',
  "docs/PRD.md": "# PRD\n",
  "docs/plan-notes.md": "notes\n",
};

/** Which phases read a file, directly or through the chain. */
const DEPENDENTS: Record<string, string[]> = {
  "package.json": ["DISCOVER", "ANALYZE", "DETERMINE_VERIFICATION", "PLAN"],
  "docs/PRD.md": ["DISCOVER", "ANALYZE", "DETERMINE_VERIFICATION", "PLAN"],
  "docs/plan-notes.md": ["PLAN"],
};

function checkpointAll(root: string): void {
  for (const spec of PIPELINE) {
    writeCheckpoint(root, spec.phase, inputsHash(root, PIPELINE, spec.phase), { ok: true }, { at: "2026-08-18T00:00:00.000Z" });
  }
}

describe("T-024 F-4 property: mutating an input re-executes exactly its dependents", () => {
  it.each(Object.keys(FILES))("mutating %s replays from its first reader onward", (file) => {
    const root = tree(FILES);
    checkpointAll(root);
    expect(resumePlan(root, PIPELINE).toExecute).toEqual([]);

    writeTree(root, { [file]: "mutated\n" });
    const plan = resumePlan(root, PIPELINE);
    expect(plan.toExecute).toEqual(DEPENDENTS[file]);
    expect(plan.replayFrom).toBe(DEPENDENTS[file]?.[0]);
  });

  it("editing nothing re-executes nothing (C-8)", () => {
    const root = tree(FILES);
    checkpointAll(root);
    expect(resumePlan(root, PIPELINE).replayFrom).toBeNull();
  });

  it("deleting an input is drift, not a silent reuse", () => {
    const root = tree(FILES);
    checkpointAll(root);
    rmSync(path.join(root, "docs/plan-notes.md"));
    expect(resumePlan(root, PIPELINE).toExecute).toEqual(["PLAN"]);
  });

  it("creating a declared-but-absent input is drift", () => {
    const pipeline: Pipeline = [{ phase: "DISCOVER", inputs: ["docs/LATER.md"] }];
    const root = tree(FILES);
    writeCheckpoint(root, "DISCOVER", inputsHash(root, pipeline, "DISCOVER"), {});
    expect(resumePlan(root, pipeline).toExecute).toEqual([]);
    writeTree(root, { "docs/LATER.md": "arrived\n" });
    expect(resumePlan(root, pipeline).toExecute).toEqual(["DISCOVER"]);
  });

  it("a later phase re-executes even when its own files are untouched", () => {
    const root = tree(FILES);
    checkpointAll(root);
    writeTree(root, { "docs/PRD.md": "# PRD v2\n" });
    const plan = resumePlan(root, PIPELINE);
    /**
     * PLAN reads only plan-notes.md, which did not change — but its predecessor
     * did, so its checkpoint cannot be trusted (F-4).
     */
    expect(plan.phases.find((p) => p.phase === "PLAN")).toMatchObject({ disposition: "execute", reason: "downstream" });
  });

  it("the input hash does not depend on declaration order", () => {
    const root = tree(FILES);
    const a: Pipeline = [{ phase: "DISCOVER", inputs: ["package.json", "docs/PRD.md"] }];
    const b: Pipeline = [{ phase: "DISCOVER", inputs: ["docs/PRD.md", "package.json"] }];
    expect(inputsHash(root, a, "DISCOVER")).toBe(inputsHash(root, b, "DISCOVER"));
  });
});

describe("T-024 P9: a stale checkpoint is unconsumable", () => {
  it("a stale read carries no data at all", () => {
    const root = tree(FILES);
    checkpointAll(root);
    writeTree(root, { "docs/PRD.md": "changed\n" });

    const read = readCheckpoint(root, "ANALYZE", inputsHash(root, PIPELINE, "ANALYZE"));
    expect(read.status).toBe("stale");
    expect(read).not.toHaveProperty("checkpoint");
    if (read.status === "stale") {
      expect(read.recorded).not.toBe(read.expected);
    }
  });

  it("an absent checkpoint is distinct from a stale one", () => {
    const root = tree(FILES);
    expect(readCheckpoint(root, "ANALYZE", inputsHash(root, PIPELINE, "ANALYZE")).status).toBe("absent");
  });

  it("a corrupt checkpoint is invalid, never partially accepted", () => {
    const root = tree(FILES);
    writeTree(root, { ".detent/state/ANALYZE.json": "{not json" });
    expect(readCheckpoint(root, "ANALYZE", "x".repeat(64)).status).toBe("invalid");

    writeTree(root, { ".detent/state/ANALYZE.json": JSON.stringify({ schema_version: 1, phase: "ANALYZE" }) });
    const read = readCheckpoint(root, "ANALYZE", "x".repeat(64));
    expect(read.status).toBe("invalid");
    expect(read).not.toHaveProperty("checkpoint");
  });

  it("a newer-schema checkpoint is refused rather than read (F-3)", () => {
    const root = tree(FILES);
    writeTree(root, {
      ".detent/state/ANALYZE.json": JSON.stringify({
        schema_version: 99,
        phase: "ANALYZE",
        inputs_hash: "a".repeat(64),
        outputs: {},
        at: "2026-08-18T00:00:00.000Z",
      }),
    });
    const read = readCheckpoint(root, "ANALYZE", "a".repeat(64));
    expect(read.status).toBe("invalid");
    if (read.status === "invalid") expect(read.issues[0]).toContain("newer");
  });
});

describe("T-024 A-7 records", () => {
  it("what is written validates as a checkpoint record", () => {
    const root = tree(FILES);
    const written = writeCheckpoint(root, "DISCOVER", inputsHash(root, PIPELINE, "DISCOVER"), { docs: ["docs/PRD.md"] });
    expect(checkpointSchema.parse(written)).toEqual(written);
    expect(checkpointPath(root, "DISCOVER")).toBe(path.join(root, ".detent", "state", "DISCOVER.json"));
  });

  it("refuses a phase name that would escape the state directory", () => {
    const root = tree(FILES);
    expect(() => checkpointPath(root, "../../etc/passwd")).toThrow(/unsafe phase name/);
  });

  it("an unknown phase is an error, not a silent empty hash", () => {
    const root = tree(FILES);
    expect(() => inputsHash(root, PIPELINE, "NOPE")).toThrow(/no such phase/);
  });
});

describe("T-024 withCheckpoint", () => {
  it("executes once, then reuses until an input drifts", async () => {
    const root = tree(FILES);
    let runs = 0;
    const execute = async () => {
      runs += 1;
      return { n: runs };
    };

    const first = await withCheckpoint(root, PIPELINE, "ANALYZE", execute);
    expect(first).toMatchObject({ reused: false, outputs: { n: 1 } });

    const second = await withCheckpoint(root, PIPELINE, "ANALYZE", execute);
    expect(second).toMatchObject({ reused: true, outputs: { n: 1 } });
    expect(runs).toBe(1);

    writeTree(root, { "docs/PRD.md": "edited\n" });
    const third = await withCheckpoint(root, PIPELINE, "ANALYZE", execute);
    expect(third).toMatchObject({ reused: false, outputs: { n: 2 } });
  });
});
