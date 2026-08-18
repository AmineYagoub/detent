import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_IDS, type RoleId } from "../schemas/roles.js";
import type { PromptSet } from "./backend.js";

export type { PromptSet } from "./backend.js";
export { stablePrefix } from "./backend.js";

/**
 * T-047 — the vendored prompt set (S-7, D-9, SEC-2).
 *
 * Prompts ship in the package and are hash-pinned by `prompts/manifest.json`.
 * Loading verifies every role's content against its pin and fails closed:
 * a missing role, an edited prompt, or an assignment referencing an unknown
 * hash is an error at load, never a silent substitution. No network fetch of
 * agents, ever.
 */

export class PromptIntegrityError extends Error {
  constructor(detail: string) {
    super(`vendored prompt set failed integrity check (S-7): ${detail}`);
    this.name = "PromptIntegrityError";
  }
}

const DEFAULT_DIR = fileURLToPath(new URL("../../prompts", import.meta.url));

export function loadPromptSet(dir: string = DEFAULT_DIR): PromptSet {
  let manifest: { schema_version?: unknown; roles?: Record<string, unknown> };
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as typeof manifest;
  } catch (err) {
    throw new PromptIntegrityError(`manifest unreadable: ${(err as Error).message}`);
  }
  const pinned = manifest.roles ?? {};

  const prompts = {} as Record<RoleId, string>;
  const hashes = {} as Record<RoleId, string>;
  for (const role of ROLE_IDS) {
    const pin = pinned[role];
    if (typeof pin !== "string") throw new PromptIntegrityError(`role ${role} has no pinned hash`);
    let body: string;
    try {
      body = readFileSync(path.join(dir, `${role}.md`), "utf8");
    } catch {
      throw new PromptIntegrityError(`role ${role} is pinned but its prompt file is missing`);
    }
    const actual = createHash("sha256").update(body).digest("hex");
    if (actual !== pin) {
      throw new PromptIntegrityError(`role ${role}: content hash ${actual} does not match pin ${pin}`);
    }
    prompts[role] = body;
    hashes[role] = actual;
  }
  return { prompts, hashes };
}

/**
 * Resolve an `agents/assignments.json` reference. Fail closed: an unknown role
 * or a hash that does not match the vendored set is an error (S-7 AC).
 */
export function resolveAssignment(ref: string, set: PromptSet): { readonly role: RoleId; readonly hash: string } {
  const match = /^([a-z_]+)@([0-9a-f]{64})$/.exec(ref);
  if (match === null) throw new PromptIntegrityError(`malformed assignment reference: ${ref}`);
  const role = match[1] as string;
  const hash = match[2] as string;
  if (!(ROLE_IDS as readonly string[]).includes(role)) {
    throw new PromptIntegrityError(`assignment names unknown role: ${role}`);
  }
  if (set.hashes[role as RoleId] !== hash) {
    throw new PromptIntegrityError(`assignment pins ${role}@${hash}, vendored set has ${set.hashes[role as RoleId]}`);
  }
  return { role: role as RoleId, hash };
}

