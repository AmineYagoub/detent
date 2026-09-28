import { SCHEMA_VERSION } from "../../src/schemas/common.js";

/**
 * PRDR-306 — how a stub answers AUDIT's check sessions (C-2¹⁸). A triage
 * session sorts the claims it was given, and a `verify_claims` session writes
 * a brief for the claim it was given (D-34′). Shared by every test that drives
 * AUDIT.
 */

export type Json = Record<string, unknown>;

/** The claims a triage or `verify_claims` session was given. */
export const claimsGiven = (inputs: Json): Json[] => (Array.isArray(inputs["claims"]) ? (inputs["claims"] as Json[]) : []);

export interface Judged {
  readonly load_bearing?: boolean;
  readonly checkable?: boolean;
}

/** A triage: every claim load-bearing and checkable, unless `judge` says otherwise. */
export function triageOf(inputs: Json, judge: (claim: Json) => Judged = () => ({})): Json {
  return {
    schema_version: SCHEMA_VERSION,
    claims: claimsGiven(inputs).map((c) => ({
      claim_hash: c["claim_hash"],
      load_bearing: true,
      checkable: true,
      why: "a decision in the documents rests on it, and a primary source could settle it",
      ...judge(c),
    })),
  };
}

/** A `verify_claims` artifact: `brief` for each claim given, where a null leaves that claim without one. */
export function briefsOf(inputs: Json, brief: (claim: Json) => Json | null): Json {
  return { schema_version: SCHEMA_VERSION, briefs: claimsGiven(inputs).map(brief).filter((b): b is Json => b !== null) };
}
