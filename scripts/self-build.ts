import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { main as initMain } from "../src/cli/init.js";
import { stateDir } from "../src/fs/layout.js";
import { run } from "../src/kernel/run.js";
import { LIVE_AUTH_HINT, buildLiveBackend, hasLiveBackendAuth } from "../src/sessions/live.js";
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
  /*
   * The PRD's CLOSURE, not just the file: v3 inherits §5/§6/§7/§9/§10
   * verbatim from the v2 document it names as its reference, so "a folder
   * containing only this PRD" means both — T-140's tenth firing watched a
   * worker fail t-100 because §10 was literally not in the folder.
   */
  copyFileSync(path.join(REPO, "detent-prd-v3.md"), path.join(dir, "detent-prd-v3.md"));
  copyFileSync(path.join(REPO, "detent-prd-v2.md"), path.join(dir, "detent-prd-v2.md"));
  gitInit(dir);
  git(dir, "add", "-A");
  /* Commit only when the scaffold actually changed: a re-fired harness must not stack empty commits over ticket work (they polluted claim bases at T-140's twelfth firing). */
  if (git(dir, "status", "--porcelain").trim() !== "") {
    git(dir, "commit", "-q", "-m", "n7: the PRD, and nothing else");
  }

  if (opts.dryRun === true) {
    /*
     * DETENT_NO_LIVE forces the auth gate shut even on a logged-in machine
     * (subscription auth lives in the OS keychain, which no env deletion can
     * hide): a dry run NEVER spends, by construction.
     */
    const saved = process.env["DETENT_NO_LIVE"];
    process.env["DETENT_NO_LIVE"] = "1";
    try {
      const code = await initMain([dir, "--spend-cap-usd", String(opts.capUsd)]);
      const refused = code === 2 && !existsSync(path.join(stateDir(dir), "config.json"));
      return {
        ok: refused,
        phase: "dry-run",
        detail: refused
          ? "harness wired end-to-end up to the R-10 auth gate; nothing written, nothing spent"
          : `expected the no-auth refusal before any write; got exit ${code}`,
        dir,
      };
    } finally {
      if (saved === undefined) delete process.env["DETENT_NO_LIVE"];
      else process.env["DETENT_NO_LIVE"] = saved;
    }
  }

  if (!hasLiveBackendAuth()) {
    return { ok: false, phase: "init", detail: `R-10: no live backend auth — ${LIVE_AUTH_HINT}`, dir };
  }

  /*
   * Run-only resume (C-9): once a plan is approved, work resumes through
   * `run` alone — re-invoking init on a tree the build itself keeps changing
   * would re-derive ANALYZE/PLAN every firing (C-8 doing its job, at a price
   * the resume path never pays).
   */
  const approved = existsSync(path.join(stateDir(dir), "plan", "approval.json"));
  if (!approved) {
    /* 2 = an interrupt (AWAIT_APPROVAL expected; any other prints itself and reds out below). */
    const initCode = await initMain([dir, "--spend-cap-usd", String(opts.capUsd)]);
    if (initCode !== 2 && initCode !== 0) {
      return { ok: false, phase: "init", detail: `init exited ${initCode} before PRESENT`, dir };
    }

    const approveCode = await initMain([dir, "--approve", "--by", "n7-self-build"]);
    if (approveCode !== 0) {
      return { ok: false, phase: "approve", detail: `approval replay exited ${approveCode}`, dir };
    }
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
