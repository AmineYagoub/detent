import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { initLayout, writeArtifact } from "../../src/fs/layout.js";
import { determineVerification } from "../../src/init/bind.js";
import { okResult, type StageFn } from "../../src/sessions/mock.js";
import { git, gitInit, removeTree, tmpTree, writeTree } from "../helpers.js";
import { addTicket } from "../kernel/run-fixture.js";

/**
 * V-5′ (PRDR-295) — a repository with two packages, for the tests of gates
 * bound per package: the root, whose gates are its Makefile's, and `web`, a
 * Node package whose gate is its own Makefile's. Every gate appends who ran
 * it, for which slot and in which directory to a log outside the repository,
 * so a test can say which gates a ticket ran and where.
 */

export const NOW = (): string => "2026-09-27T10:00:00.000Z";

/** Every directory a test made; `dropScratch` removes them. */
export const scratch: string[] = [];

export function dropScratch(): void {
  for (const dir of scratch.splice(0)) removeTree(dir);
}

/** A gate that logs who ran it, for what, and where, and fails while `.fail` sits beside it. */
export const GATE = (name: string, log: string): string =>
  `#!/bin/sh\necho "${name} $1 $(pwd -P)" >> '${log}'\nif [ -f .fail ]; then cat .fail; exit 1; fi\nexit 0\n`;

export interface Repo {
  readonly root: string;
  readonly log: string;
}

/** Two packages: the root, whose gates are its Makefile's, and `web`, a Node package whose gate is its own Makefile's. */
export function twoPackages(extra: Readonly<Record<string, string>> = {}): Repo {
  const logDir = tmpTree();
  scratch.push(logDir);
  const log = path.join(logDir, "gates.log");
  const root = tmpTree({
    Makefile: ".PHONY: test lint\n\ntest:\n\tsh scripts/gate.sh test\n\nlint:\n\tsh scripts/gate.sh lint\n",
    "scripts/gate.sh": GATE("root", log),
    "src/app.py": "def app():\n    return 1\n",
    "web/package.json": '{"name":"web","private":true}\n',
    "web/Makefile": ".PHONY: test\n\ntest:\n\tsh gate.sh test\n",
    "web/gate.sh": GATE("web", log),
    "web/src/index.ts": "export const x = 1;\n",
    "AGENTS.md": "# Rules\n- only what the ticket says\n",
    ".gitignore": ".fail\n",
    ...extra,
  });
  scratch.push(root);
  gitInit(root);
  initLayout(root);
  writeArtifact(root, "config.json", {
    budgets: { run_spend_usd: 999 },
    protected: ["tickets/**", "AGENTS.md"],
    risk: [],
    model_routing: {},
    pinned: { agent_sdk: "0.3.280", claude_code: "2.1.191" },
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return { root, log };
}

export const lines = (file: string): string[] => {
  try {
    return readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
  } catch {
    return [];
  }
};

/** Bound as `init` binds an existing project, committed, with the tickets planned and approved and the log emptied. */
export async function planned(repo: Repo, tickets: readonly { readonly id: string; readonly surface: readonly string[] }[]): Promise<void> {
  const outcome = await determineVerification({ root: repo.root, greenfield: false, acknowledgedBy: "fixture", now: NOW });
  if (outcome.kind !== "complete") throw new Error(`binding interrupted: ${outcome.kind === "interrupt" ? outcome.message : ""}`);
  git(repo.root, "add", "-A");
  git(repo.root, "commit", "-q", "-m", "bind");
  for (const t of tickets) addTicket(repo.root, t);
  writeFileSync(repo.log, "");
}

/** Writes one file into each directory named for the ticket, and commits. */
export const implementIn =
  (dirs: Readonly<Record<string, readonly string[]>>): StageFn =>
  (spec) => {
    for (const dir of dirs[spec.ticketId] ?? []) writeTree(spec.cwd, { [`${dir}/feature-${spec.ticketId}.txt`]: "done\n" });
    git(spec.cwd, "add", "-A");
    git(spec.cwd, "commit", "-q", "-m", `${spec.ticketId}: implement`);
    return okResult();
  };

/** Who ran, and for what: `web test`, `root lint`. */
export const ran = (log: string): Set<string> => new Set(lines(log).map((l) => l.split(" ").slice(0, 2).join(" ")));
