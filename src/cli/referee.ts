import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { stateDir } from "../fs/layout.js";
import { ensureRunBranch, installTrailerHook } from "../kernel/git.js";
import { RunJournal } from "../kernel/journal.js";
import { RefereeCore } from "../kernel/referee.js";
import { loadConfig } from "../kernel/worstcase.js";
import { buildServer } from "../referee/server.js";
import type { SessionBackend } from "../sessions/backend.js";
import { MockBackend } from "../sessions/mock.js";
import { loadPromptSet } from "../sessions/prompts.js";
import { ClaudeCodeBackend } from "../sessions/sdk.js";

/**
 * The referee's composition root: `detent referee --root <path>` serves the
 * R-1 tool set over MCP stdio. The plugin's `.mcp.json` points here (MP1);
 * the T-106 transport-parity fixture spawns it with `--backend mock`.
 *
 * Wiring only — every decision the served tools make lives in the registry
 * and the core, shared verbatim with the in-process driver (ARCH-2).
 */

export async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      root: { type: "string" },
      backend: { type: "string", default: "claude" },
      worker: { type: "string" },
    },
  });
  const root = values.root ?? process.cwd();

  const configPath = path.join(stateDir(root), "config.json");
  if (!existsSync(configPath)) {
    process.stderr.write(`no config at ${configPath} — run \`detent init\` first\n`);
    return 2;
  }
  const loaded = loadConfig(JSON.parse(readFileSync(configPath, "utf8")));

  const backend: SessionBackend =
    values.backend === "mock"
      ? new MockBackend()
      : new ClaudeCodeBackend({
          policy: { surface: ["**"], protectedGlobs: [...loaded.config.protected], workRoot: root },
        });

  const journal = RunJournal.open(root);
  const runBranch = ensureRunBranch(root, `referee-${process.pid}`);
  installTrailerHook(root);
  const core = new RefereeCore(
    {
      root,
      backend,
      prompts: loadPromptSet(),
      ...(values.worker !== undefined ? { worker: values.worker } : {}),
    },
    loaded,
    journal,
    runBranch,
  );

  const server = buildServer(core);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Serve until the client closes stdin; the journal lock rides the process.
  await new Promise<void>((resolve) => {
    transport.onclose = () => {
      journal.close();
      resolve();
    };
  });
  return 0;
}

// Executed as an entry point (the plugin's .mcp.json spawns this file directly).
const invoked = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invoked) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    });
}
