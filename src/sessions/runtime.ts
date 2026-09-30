import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * S-5 (PRDR-096), S-5⁶ (PRDR-319) — the Agent SDK's own manifest: the SDK's
 * version, and the Claude Code it bundles, which is the runtime that serves
 * every session (S-5‴).
 *
 * PRDR-096: `require("@anthropic-ai/claude-agent-sdk/package.json")` threw —
 * the SDK's `exports` map does not expose `./package.json`, so Node refuses
 * the subpath and `doctor`, the command whose whole job is to report on the
 * environment, died reporting on it. Resolve the package's own entry point
 * instead and read the manifest beside it, which needs no exports entry. An
 * unreadable manifest, or a field it lacks, reads "unknown" — the same honest
 * value `init` records for an unreadable CLI, and something a check can report
 * rather than crash on.
 */
export interface SdkManifest {
  /** The SDK's own version, which `package.json` pins exactly. */
  readonly version: string;
  /** `claudeCodeVersion`: the bundled Claude Code, the runtime that serves each session. */
  readonly runtime: string;
}

export function sdkManifest(): SdkManifest {
  const require = createRequire(import.meta.url);
  try {
    let dir = path.dirname(require.resolve("@anthropic-ai/claude-agent-sdk"));
    for (let up = 0; up < 8; up += 1) {
      const candidate = path.join(dir, "package.json");
      if (existsSync(candidate)) {
        const manifest = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string; version?: unknown; claudeCodeVersion?: unknown };
        if (manifest.name === "@anthropic-ai/claude-agent-sdk") {
          return {
            version: typeof manifest.version === "string" ? manifest.version : "unknown",
            runtime: typeof manifest.claudeCodeVersion === "string" ? manifest.claudeCodeVersion : "unknown",
          };
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* fall through to the honest unknown */
  }
  return { version: "unknown", runtime: "unknown" };
}

/** S-5⁶ (PRDR-319): the Claude Code the installed SDK bundles, or "unknown". */
export function bundledRuntime(): string {
  return sdkManifest().runtime;
}
