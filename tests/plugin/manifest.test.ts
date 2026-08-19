import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "../../src/referee/registry.js";
import { REFEREE_VERSION } from "../../src/referee/server.js";

/**
 * T-110/T-111 — the plugin manifest, marketplace listing, and the two
 * commands-as-skills (C-1′, C-14′, SEC-2, D-26).
 *
 * The live counterpart of these assertions is `npm run plugin:validate`
 * (`claude plugin validate --strict` over the marketplace manifest, the plugin
 * manifest, `skills/`, and `agents/`) plus T-114's `--plugin-dir` exit; this
 * file pins everything decidable without the claude CLI installed.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");

interface PluginManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly mcpServers?: Record<string, { command?: unknown; args?: unknown }>;
}
interface Marketplace {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly owner?: { name?: unknown };
  readonly plugins?: readonly { name?: unknown; source?: unknown; description?: unknown }[];
}

const manifest = JSON.parse(read(".claude-plugin", "plugin.json")) as PluginManifest;
const marketplace = JSON.parse(read(".claude-plugin", "marketplace.json")) as Marketplace;

describe("T-110 plugin manifest (SEC-2, layout law)", () => {
  it("names the plugin `detent` — the namespace of the two commands", () => {
    expect(manifest.name).toBe("detent");
  });

  it("pins an explicit version that matches the referee server's (SEC-2 — never git-derived)", () => {
    expect(manifest.version).toBe(REFEREE_VERSION);
    expect(typeof manifest.version).toBe("string");
  });

  it("keeps only manifests inside .claude-plugin/ — component dirs live at plugin root", () => {
    expect(readdirSync(path.join(ROOT, ".claude-plugin")).sort()).toEqual(["marketplace.json", "plugin.json"]);
    for (const dir of ["skills", "agents", "hooks"]) {
      expect(statSync(path.join(ROOT, dir)).isDirectory(), dir).toBe(true);
    }
  });

  it("bundles the referee as the `referee` MCP server via ${CLAUDE_PLUGIN_ROOT} (R-1)", () => {
    const referee = manifest.mcpServers?.["referee"];
    expect(referee).toBeDefined();
    expect(String(referee?.command)).toContain("${CLAUDE_PLUGIN_ROOT}");
    const args = (referee?.args ?? []) as readonly unknown[];
    expect(args.some((a) => String(a).endsWith("src/cli/referee.ts"))).toBe(true);
  });
});

describe("T-110 marketplace listing (D-26 distribution)", () => {
  it("lists exactly one plugin, sourced from this repository root", () => {
    expect(marketplace.name).toBe("detent");
    expect(typeof marketplace.description).toBe("string");
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins?.[0]?.name).toBe(manifest.name);
    expect(marketplace.plugins?.[0]?.source).toBe("./");
  });
});

describe("T-111 the two commands as skills (C-1′, C-14′)", () => {
  const skillDirs = readdirSync(path.join(ROOT, "skills")).sort();

  it("C-14′ porcelain freeze: exactly two user-invocable skills, `init` and `run`", () => {
    expect(skillDirs).toEqual(["init", "run"]);
    for (const dir of skillDirs) {
      expect(existsSync(path.join(ROOT, "skills", dir, "SKILL.md")), dir).toBe(true);
    }
  });

  it("each skill declares a description and receives $ARGUMENTS", () => {
    for (const dir of skillDirs) {
      const body = read("skills", dir, "SKILL.md");
      expect(body.startsWith("---\n"), dir).toBe(true);
      expect(body, dir).toMatch(/\ndescription: \S/);
      expect(body, dir).toContain("$ARGUMENTS");
    }
  });

  it("C-1′/C-5: init presents the closed set of five decisions, by name", () => {
    const body = read("skills", "init", "SKILL.md");
    for (const decision of ["AWAIT_DOCS", "AWAIT_INFO", "AWAIT_BINDING_CHOICE", "AWAIT_SETUP_CONSENT", "AWAIT_APPROVAL"]) {
      expect(body).toContain(decision);
    }
    expect(body).toContain("five");
  });

  it("C-11′/R-1: run names the four outcomes and every referee tool, and forbids ambient bypass", () => {
    const body = read("skills", "run", "SKILL.md");
    for (const outcome of ["`ok`", "`error`", "`not-ready`", "`human-gated`"]) {
      expect(body).toContain(outcome);
    }
    for (const tool of TOOL_NAMES) {
      expect(body).toContain(`\`${tool}\``);
    }
    expect(body).toContain("D-28");
  });
});
