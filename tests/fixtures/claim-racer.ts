/*
 * Child process for the T-017 claim race. Each child spins on a barrier file so
 * that all N contend at genuinely the same moment — spawning alone does not
 * guarantee overlap, and a sequential race would pass even against a
 * non-atomic claim.
 */
import { existsSync } from "node:fs";
import { claim } from "../../src/kernel/tickets/mutations.js";

const [, , root, id, owner, barrier] = process.argv;
const deadline = Date.now() + 30_000;
while (!existsSync(barrier!) && Date.now() < deadline) {
  /* busy-wait: a sleep would reintroduce the staggering we are trying to avoid */
}
process.stdout.write(claim(root!, id!, owner!) ? "won" : "lost");
