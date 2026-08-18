/**
 * Gate slots (PRD §6).
 *
 * These live in `schemas/` rather than in the adapter for the same reason the
 * execution states do: a slot name is persisted vocabulary. Every A-6 binding
 * record carries one, so the schema and the adapter must not each keep their
 * own copy of the list.
 */
export const GATE_SLOTS = ["test", "test_single", "lint", "typecheck", "build", "e2e"] as const;

export type GateSlot = (typeof GATE_SLOTS)[number];
