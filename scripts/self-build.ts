import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { main as initMain } from "../src/cli/init.js";
import { stateDir } from "../src/fs/layout.js";
import { run } from "../src/kernel/run.js";
import { buildLiveBackend } from "../src/sessions/live.js";
import { loadPromptSet } from "../src/sessions/prompts.js";
import { git, gitInit } from "../tests/helpers.js";

/**
 * T-140 — the N-7 self-build harness (D-16): `detent init && detent run` on a
 * folder containing ONLY `detent-prd-v3.md`, to DONE on the walking skeleton.
 *
 * The harness is the human's stand-in for exactly the acts N-7's folder needs
 * a human for: `git init` (the consent the CLI routes to the user today), the
 * spend cap (X-1's explicitly-chosen ceiling), and the approval relay
 * (`--approve --by n7-self-build` — MP3's T-131 channel, which is what makes
 * a scripted non-TTY self-build possible at all). Every OTHER decision that
 * fires is an honest red: the gate reports the interrupt and stops.
 *
 * `--dry-run` exercises the entire harness up to the R-10 key gate with the
 * key deliberately withheld, so CI's regular suite can prove the wiring
 * without spending a cent. The live path runs only from `self-build.yml`
 * (workflow_dispatch — the click is the consent) or a terminal with the key
 * and a cap.
 */

export interface SelfBuildResult {
  readonly ok: boolean;
  readonly phase: "dry-run" | "init" | "approve" | "run";
  readonly detail: string;
  readonly dir: string;
}

const REPO = path.resolve(import.meta.dirname, "..");

export async function selfBuild(opts: {
  readonly capUsd: number;
  readonly dir?: string;
  readonly dryRun?: boolean;
}): Promise<SelfBuildResult> {
  const dir = opts.dir ?? mkdtempSync(path.join(tmpdir(), "detent-n7-"));
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(REPO, "detent-prd-v3.md"), path.join(dir, "detent-prd-v3.md"));
  gitInit(dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "n7: the PRD, and nothing else");

  if (opts.dryRun === true) {
    /* Withhold the key even if the environment has one: dry-run NEVER spends. */
    const saved = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      const code = await initMain([dir, "--spend-cap-usd", String(opts.capUsd)]);
      const refused = code === 2 && !existsSync(path.join(stateDir(dir), "config.json"));
      return {
        ok: refused,
        phase: "dry-run",
        detail: refused
          ? "harness wired end-to-end up to the R-10 key gate; nothing written, nothing spent"
          : `expected the keyless refusal before any write; got exit ${code}`,
        dir,
      };
    } finally {
      if (saved !== undefined) process.env["ANTHROPIC_API_KEY"] = saved;
    }
  }

  if (process.env["ANTHROPIC_API_KEY"] === undefined) {
    return { ok: false, phase: "init", detail: "R-10: ANTHROPIC_API_KEY is required for the live self-build", dir };
  }

  /* 2 = an interrupt (AWAIT_APPROVAL expected; any other prints itself and reds out below). */
  const initCode = await initMain([dir, "--spend-cap-usd", String(opts.capUsd)]);
  if (initCode !== 2 && initCode !== 0) {
    return { ok: false, phase: "init", detail: `init exited ${initCode} before PRESENT`, dir };
  }

  const approveCode = await initMain([dir, "--approve", "--by", "n7-self-build"]);
  if (approveCode !== 0) {
    return { ok: false, phase: "approve", detail: `approval replay exited ${approveCode}`, dir };
  }

  const outcome = await run({
    root: dir,
    backend: buildLiveBackend(dir),
    prompts: loadPromptSet(),
    worker: "n7",
    announce: (message) => process.stdout.write(`${message}\n`),
  });
  const journal = path.join(stateDir(dir), "transitions.jsonl");
  const rows = existsSync(journal) ? readFileSync(journal, "utf8").trim().split("\n").length : 0;
  return {
    ok: outcome.exitCode === 0,
    phase: "run",
    detail: `run exited ${outcome.exitCode}; ${rows} journaled transitions; summary: ${JSON.stringify(outcome.summary)}`,
    dir,
  };
}

const invoked = process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invoked) {
  const { values } = parseArgs({
    options: {
      cap: { type: "string" },
      dir: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const capUsd = Number(values.cap);
  if (!Number.isFinite(capUsd) || capUsd <= 0) {
    process.stderr.write("usage: tsx scripts/self-build.ts --cap <usd> [--dir <path>] [--dry-run]\n");
    process.exit(1);
  }
  selfBuild({ capUsd, ...(values.dir === undefined ? {} : { dir: values.dir }), dryRun: values["dry-run"] })
    .then((result) => {
      process.stdout.write(`[n7:${result.phase}] ${result.detail}\n${result.dir}\n`);
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err: unknown) => {
      process.stderr.write(`n7 harness failed: ${(err as Error).message}\n`);
      process.exit(1);
    });
}
