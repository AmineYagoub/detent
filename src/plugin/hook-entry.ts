import { handleHookInput } from "./hook.js";

/**
 * T-113 — the bundle entry point (`hooks/dist/detent-hook.cjs`). Reads the
 * hook payload from stdin, prints the decision, and always exits 0: a crash
 * here must fail open, because the hook is containment's accelerant while the
 * referee re-runs every authoritative check (P2) — and a non-zero exit would
 * surface as hook noise in sessions that have nothing to do with Detent.
 */
async function main(): Promise<void> {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += String(chunk);
  const out = await handleHookInput(raw);
  if (out !== null) process.stdout.write(`${out}\n`);
}

void main().catch(() => {
  /* Fail open by design — see the module doc-block. */
});
