import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stateDir } from "../fs/layout.js";
import { runGate } from "../adapter/run.js";
import { checkCommand, offListMessage, type AllowlistDecision } from "./allowlist.js";

/**
 * T-065 — the setup-consent engine (C-6, C-6a, D-15, SEC-1).
 *
 * Two rules, both absolute:
 *
 * 1. **Nothing runs without per-command confirmation**, showing the exact
 *    command verbatim before it executes, and every consent is logged as a
 *    user action (SEC-1: no unlogged consents).
 * 2. **Off-list commands are structurally unexecutable** — not "refused unless
 *    the user insists". `runConsented` cannot reach a child process for a
 *    command the allowlist rejected, which is what D-15 means by structural.
 *
 * Configuration mutation follows C-6's three-way rule, implemented in
 * `proposeConfigWrite`: existing files are never modified (the proposal is
 * printed), missing files may be created after being shown in full, and
 * dependency manifests change only through the allowlisted package-manager
 * commands above — never by a direct write.
 */

export function consentLogPath(root: string): string {
  return path.join(stateDir(root), "logs", "consent.jsonl");
}

export interface ConsentRecord {
  readonly at: string;
  readonly actor: string;
  readonly kind: "command" | "config-create" | "config-refused" | "off-list";
  readonly command?: string;
  readonly file?: string;
  readonly granted: boolean;
  readonly rationale: string;
}

/** SEC-1: every consent decision is history, granted or not. */
export function logConsent(root: string, record: ConsentRecord): void {
  const file = consentLogPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

export type ConsentPrompt = (presentation: string) => Promise<boolean>;

export interface ConsentDeps {
  readonly root: string;
  /** Shows the exact command and returns the human's answer. */
  readonly confirm: ConsentPrompt;
  readonly actor: string;
  readonly now?: () => number;
  readonly print?: (text: string) => void;
}

export type ConsentOutcome =
  | { readonly kind: "executed"; readonly exitCode: number; readonly output: string }
  | { readonly kind: "declined" }
  | { readonly kind: "off-list"; readonly message: string; readonly decision: AllowlistDecision };

/**
 * Propose one setup command. The allowlist check happens BEFORE the human is
 * asked: consent for a command Detent may not run is not a decision worth
 * putting to someone, and asking would imply the answer could matter.
 */
export async function runConsented(command: string, rationale: string, deps: ConsentDeps): Promise<ConsentOutcome> {
  const now = deps.now ?? (() => Date.now());
  const at = new Date(now()).toISOString();
  const decision = checkCommand(command);

  if (!decision.allowed) {
    const message = offListMessage(command, decision, rationale);
    deps.print?.(message);
    logConsent(deps.root, { at, actor: deps.actor, kind: "off-list", command, granted: false, rationale });
    return { kind: "off-list", message, decision };
  }

  const presentation = [
    "Detent proposes to run a setup command:",
    `  ${command}`,
    `  why: ${rationale}`,
    `  allowlist template: ${decision.template?.id ?? "?"} (${decision.template?.description ?? ""})`,
  ].join("\n");

  const granted = await deps.confirm(presentation);
  logConsent(deps.root, { at, actor: deps.actor, kind: "command", command, granted, rationale });
  if (!granted) return { kind: "declined" };

  const result = await runGate({ command, cwd: deps.root, timeoutMs: 600_000 });
  return { kind: "executed", exitCode: result.normalizedExit, output: result.output };
}

// ---------------------------------------------------------------------------
// C-6's three-way configuration rule

export type ConfigWriteOutcome =
  | { readonly kind: "created"; readonly file: string }
  | { readonly kind: "declined" }
  | { readonly kind: "refused-existing"; readonly message: string };

/**
 * C-6 rules (1) and (2): an **existing** configuration file is never modified
 * — the proposed content is printed and nothing is written. A **missing** one
 * may be created, shown in full first. Rule (3) — dependency manifests — has
 * no path here at all: manifests change only through `runConsented`'s
 * package-manager templates, so a direct write cannot express it.
 */
export async function proposeConfigWrite(
  relPath: string,
  content: string,
  rationale: string,
  deps: ConsentDeps,
): Promise<ConfigWriteOutcome> {
  const now = deps.now ?? (() => Date.now());
  const at = new Date(now()).toISOString();
  const target = path.join(deps.root, ...relPath.split("/"));

  if (existsSync(target)) {
    const message = [
      `Detent will not modify an existing configuration file (C-6).`,
      `  file: ${relPath}`,
      `  why:  ${rationale}`,
      "",
      "Proposed content — apply it yourself if you agree, then re-run `detent init`:",
      content,
    ].join("\n");
    deps.print?.(message);
    logConsent(deps.root, { at, actor: deps.actor, kind: "config-refused", file: relPath, granted: false, rationale });
    return { kind: "refused-existing", message };
  }

  const presentation = [
    `Detent proposes to CREATE a configuration file (C-6a):`,
    `  file: ${relPath}`,
    `  why:  ${rationale}`,
    "",
    content,
  ].join("\n");

  const granted = await deps.confirm(presentation);
  logConsent(deps.root, { at, actor: deps.actor, kind: "config-create", file: relPath, granted, rationale });
  if (!granted) return { kind: "declined" };

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  return { kind: "created", file: relPath };
}
