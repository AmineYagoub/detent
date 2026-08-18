import { readFileSync } from "node:fs";
import path from "node:path";
import type { GateSlot } from "../run.js";
import { findTable, parseTables, type TomlTable } from "./toml.js";
import { candidate, type Candidate, type Engine, type StackFacts } from "./types.js";

/**
 * pyproject.toml (V-1). A tool's configuration table is the project saying it
 * uses that tool; that is the native signal Detent binds to, and the table is
 * the region V-3 watches.
 */

interface ToolRule {
  readonly table: string;
  readonly slot: GateSlot;
  readonly ref: string;
  readonly resolved: string;
  readonly rank: number;
}

const TOOL_RULES: readonly ToolRule[] = [
  { table: "tool.pytest.ini_options", slot: "test", ref: "pytest", resolved: "pytest", rank: 0 },
  { table: "tool.ruff", slot: "lint", ref: "ruff", resolved: "ruff check .", rank: 0 },
  { table: "tool.ruff.lint", slot: "lint", ref: "ruff", resolved: "ruff check .", rank: 1 },
  { table: "tool.flake8", slot: "lint", ref: "flake8", resolved: "flake8", rank: 0 },
  { table: "tool.mypy", slot: "typecheck", ref: "mypy", resolved: "mypy .", rank: 0 },
  { table: "tool.pyright", slot: "typecheck", ref: "pyright", resolved: "pyright", rank: 0 },
  { table: "build-system", slot: "build", ref: "build", resolved: "python -m build", rank: 0 },
];

export const pythonEngine: Engine = {
  name: "pyproject",
  discover(facts: StackFacts): Candidate[] {
    if (!facts.markers.includes("pyproject.toml")) return [];

    let tables: TomlTable[];
    try {
      tables = parseTables(readFileSync(path.join(facts.root, "pyproject.toml"), "utf8"));
    } catch {
      return [];
    }

    const out: Candidate[] = [];
    for (const rule of TOOL_RULES) {
      const table = findTable(tables, rule.table);
      if (table === undefined) continue;
      out.push(
        candidate({
          slot: rule.slot,
          adapter: "pyproject",
          ref: rule.ref,
          resolved: rule.resolved,
          pm: null,
          config_file: "pyproject.toml",
          config_region: table.block,
          rank: rule.rank,
        }),
      );
    }

    // A pyproject with no pytest table still very likely tests with pytest —
    // proposed at rank 1 so a declared configuration always wins.
    if (!out.some((c) => c.slot === "test")) {
      out.push(
        candidate({
          slot: "test",
          adapter: "pyproject",
          ref: "pytest",
          resolved: "pytest",
          pm: null,
          config_file: "pyproject.toml",
          config_region: "exists:pyproject.toml",
          rank: 1,
        }),
      );
    }
    return out;
  },
};
