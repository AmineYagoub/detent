import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { SCRATCH_SERVER, SCRATCH_TIME_LIMIT_MS, scratchRunner, type ScratchGrant } from "./sandbox.js";

/**
 * S-1⁗ (PRDR-285) — the one tool a VALIDATE reviewer runs scripts with, served
 * in-process to the session whose round has a sandbox.
 *
 * In-process, so the script runs where Detent's sandbox is, below the hook:
 * the hook sees this call, its interpreter and its source, and the script then
 * runs confined whatever it does (`sandbox.ts`). Loaded always, never behind a
 * tool search the session has no tool for, and bounded past the run's own
 * limit, which is what stops a run.
 */

const DESCRIPTION =
  "Run a throwaway script in this round's scratch directory, sandboxed: it may write only its own directory, reads nothing " +
  "of the repository, reaches no network, and runs as one process, starting none. `source` is the whole script; " +
  "`interpreter` is one of those your inputs' `simulation` names. Returns how the run ended, and what it printed.";

export function scratchServer(grant: ScratchGrant): McpSdkServerConfigWithInstance {
  const run = scratchRunner(grant);
  const [first, ...rest] = grant.interpreters;
  const interpreter = z.enum([first.name, ...rest.map((i) => i.name)]);
  return createSdkMcpServer({
    name: SCRATCH_SERVER,
    version: "1.0.0",
    alwaysLoad: true,
    timeout: SCRATCH_TIME_LIMIT_MS + 30_000,
    tools: [
      tool("run", DESCRIPTION, { interpreter, source: z.string() }, async (args) => ({
        content: [{ type: "text", text: await run(args) }],
      })),
    ],
  });
}
