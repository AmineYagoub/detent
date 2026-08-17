/**
 * T-018 — the oracle parity map.
 *
 * Every one of the Python reference's 52 tests appears here exactly once, with
 * the ticket that closes it. `status` is derived from that ticket's milestone,
 * not asserted independently, so the two cannot drift.
 *
 * R-2: M0 translates all 52 against interfaces; those needing a later layer sit
 * as `pending-M1` or `pending-M2` until their ticket lands. Each milestone exit
 * asserts its own threshold rather than one global count.
 */

export interface ParityEntry {
  /** `<file>::<test>` in the Python reference v0.1.3. */
  readonly oracle: string;
  /** The Detent ticket that closes it. */
  readonly ticket: string;
  /** Where it lives once green. Absent while still pending. */
  readonly ts?: string;
  /** Why the property moved rather than translating literally, where it did. */
  readonly note?: string;
}

export const PARITY: readonly ParityEntry[] = [
  // ---- test_state.py (7) ----------------------------------------------------
  { oracle: "test_state.py::test_illegal_transitions_raise", ticket: "T-011", ts: "tests/oracle/state.test.ts" },
  { oracle: "test_state.py::test_happy_paths", ticket: "T-011", ts: "tests/oracle/state.test.ts" },
  {
    oracle: "test_state.py::test_full_ladder_budget",
    ticket: "T-013",
    ts: "tests/oracle/resolver.test.ts",
    note: "counter mapping per PRD §13: fix_sessions{0,1,2} <-> (blind,informed){(0,0),(1,0),(1,1)}",
  },
  { oracle: "test_state.py::test_hypothesis_cap", ticket: "T-011", ts: "tests/oracle/state.test.ts" },
  {
    oracle: "test_state.py::test_review_loop_respects_ladder_budget",
    ticket: "T-011",
    ts: "tests/oracle/state.test.ts",
    note: "D-6 gives review its own unit budget; the oracle reused the fix pool",
  },
  { oracle: "test_state.py::test_budget_caps_hold_on_every_reachable_path", ticket: "T-012", ts: "tests/oracle/budgets.test.ts" },
  { oracle: "test_state.py::test_budget_breach_from_anywhere", ticket: "T-011", ts: "tests/oracle/state.test.ts" },

  // ---- test_tickets.py (5) --------------------------------------------------
  { oracle: "test_tickets.py::test_schema_enforced", ticket: "T-017", ts: "tests/oracle/tickets.test.ts" },
  { oracle: "test_tickets.py::test_ready_respects_dependencies", ticket: "T-017", ts: "tests/oracle/tickets.test.ts" },
  { oracle: "test_tickets.py::test_atomic_claim_exactly_one_winner", ticket: "T-017", ts: "tests/oracle/tickets.test.ts" },
  { oracle: "test_tickets.py::test_discovered_from_link", ticket: "T-017", ts: "tests/oracle/tickets.test.ts" },
  { oracle: "test_tickets.py::test_notes_append_only", ticket: "T-017", ts: "tests/oracle/tickets.test.ts" },

  // ---- test_contract.py (7) -------------------------------------------------
  { oracle: "test_contract.py::test_valid", ticket: "T-014", ts: "tests/oracle/worstcase.test.ts" },
  { oracle: "test_contract.py::test_missing_and_unknown_keys", ticket: "T-014", ts: "tests/oracle/worstcase.test.ts" },
  {
    oracle: "test_contract.py::test_backend_pin_required_for_claude_code",
    ticket: "T-014",
    ts: "tests/oracle/worstcase.test.ts",
    note: "S-5 pins both SDK and CLI; config.pinned carries them",
  },
  { oracle: "test_contract.py::test_unknown_budget_rejected", ticket: "T-014", ts: "tests/oracle/worstcase.test.ts" },
  { oracle: "test_contract.py::test_kernel_contains_no_stack_strings", ticket: "T-003", ts: "tests/arch/deps.test.ts", note: "generalized into ARCH-1's dependency-direction lint" },
  { oracle: "test_contract.py::test_gate_executes_and_flags_unrunnable", ticket: "T-020" },
  { oracle: "test_contract.py::test_gate_accepts_runnable_failing_command", ticket: "T-020" },

  // ---- test_gates.py (7) ----------------------------------------------------
  { oracle: "test_gates.py::test_flake", ticket: "T-016", ts: "tests/oracle/classify.test.ts" },
  { oracle: "test_gates.py::test_toolchain", ticket: "T-016", ts: "tests/oracle/classify.test.ts" },
  { oracle: "test_gates.py::test_assertion_default", ticket: "T-016", ts: "tests/oracle/classify.test.ts" },
  { oracle: "test_gates.py::test_stable_across_volatile_details", ticket: "T-016", ts: "tests/oracle/classify.test.ts" },
  { oracle: "test_gates.py::test_different_failures_differ", ticket: "T-016", ts: "tests/oracle/classify.test.ts" },
  { oracle: "test_gates.py::test_run_and_flake_filter", ticket: "T-022" },
  { oracle: "test_gates.py::test_persistent_failure_survives_filter", ticket: "T-022" },

  // ---- test_hooks.py (7) ----------------------------------------------------
  // PRDR-050: these close at T-046 against a PreToolUse hook, not canUseTool.
  { oracle: "test_hooks.py::test_allows_in_surface", ticket: "T-046" },
  { oracle: "test_hooks.py::test_denies_protected", ticket: "T-046" },
  { oracle: "test_hooks.py::test_denies_out_of_surface_with_escape_hatch_hint", ticket: "T-046" },
  { oracle: "test_hooks.py::test_denies_outside_worktree", ticket: "T-046" },
  { oracle: "test_hooks.py::test_blocks_stop_while_red", ticket: "T-046" },
  { oracle: "test_hooks.py::test_allows_stop_when_green", ticket: "T-046" },
  { oracle: "test_hooks.py::test_read_only_stage_and_loop_guard", ticket: "T-046" },

  // ---- test_extra.py (8) ----------------------------------------------------
  { oracle: "test_extra.py::test_upstream_blocks_with_linked_ticket", ticket: "T-045" },
  { oracle: "test_extra.py::test_unparsable_telemetry_is_budget_breaching", ticket: "T-046" },
  { oracle: "test_extra.py::test_three_change_cycles_escalate", ticket: "T-044" },
  {
    oracle: "test_extra.py::test_validate_report_approve_requeue",
    ticket: "T-055",
    note: "the unmappable test that forced T-055 into existence; requeue asserts X-8 generations, not the oracle's attempts reset",
  },
  { oracle: "test_extra.py::test_mode1_stub_detected", ticket: "T-060", note: "greenfield vs brownfield detection is C-1's job in the init phase machine" },
  { oracle: "test_extra.py::test_smoke_mock_backend", ticket: "T-040" },
  { oracle: "test_extra.py::test_research_session_gets_domain_scoped_web_tools", ticket: "T-046" },
  { oracle: "test_extra.py::test_risk_detection_on_master_based_repo", ticket: "T-049" },

  // ---- test_kernel_e2e.py (11) ---------------------------------------------
  { oracle: "test_kernel_e2e.py::test_feature_to_done_and_merged", ticket: "T-041" },
  { oracle: "test_kernel_e2e.py::test_triage_unverified_blocks", ticket: "T-041" },
  { oracle: "test_kernel_e2e.py::test_ladder_exhausts_to_needs_human_with_dossier", ticket: "T-041" },
  { oracle: "test_kernel_e2e.py::test_research_cache_hit_skips_research_session", ticket: "T-045" },
  { oracle: "test_kernel_e2e.py::test_no_second_blind_fix_after_crash", ticket: "T-041" },
  { oracle: "test_kernel_e2e.py::test_falsified_premise_recycles_to_diagnosis", ticket: "T-043" },
  { oracle: "test_kernel_e2e.py::test_hypothesis_thrash_escalates", ticket: "T-043" },
  { oracle: "test_kernel_e2e.py::test_surface_request_grant_and_deny", ticket: "T-046" },
  { oracle: "test_kernel_e2e.py::test_risk_path_requires_human_approval", ticket: "T-049" },
  { oracle: "test_kernel_e2e.py::test_flake_charges_nothing_and_quarantines", ticket: "T-022" },
  { oracle: "test_kernel_e2e.py::test_changes_then_fix_then_approve", ticket: "T-044" },
];

/** The reference suite's size. A map that does not cover it exactly is a defect. */
export const ORACLE_TEST_COUNT = 52;

/** Which milestone a closing ticket belongs to, from the plan's numbering. */
export function milestoneOf(ticket: string): "P0" | "M0" | "M1" | "M2" | "M3" | "M4" {
  const n = Number(ticket.slice(2));
  if (n < 10) return "P0";
  if (n < 20) return "M0";
  if (n < 40) return "M1";
  if (n < 60) return "M2";
  if (n < 80) return "M3";
  return "M4";
}

export type ParityStatus = "green" | "pending-M1" | "pending-M2" | "pending-later";

export function statusOf(entry: ParityEntry): ParityStatus {
  const m = milestoneOf(entry.ticket);
  if (m === "P0" || m === "M0") return "green";
  if (m === "M1") return "pending-M1";
  if (m === "M2") return "pending-M2";
  return "pending-later";
}
