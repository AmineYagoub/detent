# The specification phase — implementation plan

**Status:** proposed; filed as PRDR-278 … PRDR-286; no code yet.
**Prerequisite (N-6):** PRDR-278, the PRD amendment, lands before any code. The phase changes
C-3′ ("Planning does not stop for a question") and the `init` pipeline, and N-6's no-deviation
rule forbids changing either in flight.
**Decided by:** the operator, 2026-09-26, in the design discussion that followed the ksarjs
specification (§2).

---

## 1. What this fixes

`init` plans from the documents as they are written. ANALYZE settles what a competent engineer
could settle and records an assumption for the rest (C-3″, PRDR-119). SLICE places every
requirement id, PLAN drafts the tickets, and a fresh planner-role session reviews the plan before
it is written (C-4″). Everything is judged against the documents; nothing judges the documents.
A contradiction between two of them, a wrong external fact, or a rule that is consistent but
wrong passes ANALYZE as an assumption and reaches a ticket. There, one of two things happens:

- the session meets it, is falsified or escalates, and the operator pays in wall-clock and
  dossiers. The operator's trials on other projects kept raising the same complaint: Detent
  keeps hitting contradictions in the PRD;
- or the session implements it literally, its tests are written from the same criteria, the
  gates are green and review approves. The defect ships. This is doc-claim drift one level up:
  the specification states a rule, and the code and the tests both agree with it, so nothing
  fails.

The ksarjs specification (`~/ksar/docs`, 2026-09-24 … 26) is both the evidence and the template.
A raw PRD for a Medusa marketplace layer became a pack of 2,024 requirements and 1,144 acceptance
criteria in four steps: audit, founder decisions, writing and validation. Validation took seven
rounds: five adversarial reviewers, one per area, in the first, then verification passes over
each round's fixes. What was found, and what found it:

| Class | ksarjs example | Found by |
|---|---|---|
| Contradiction inside the PRD | negotiation in the MVP according to the summary, the endpoint list and an acceptance test, and in phase 2 according to the roadmap and the modules table | the audit; the founder decided |
| Missing external fact | since Medusa 2.21.0, store routes return only allow-listed fields, so a product's linked vendor is dropped silently | the audit, from Medusa's release notes |
| Wrong external fact | the facts file said Medusa's core refund route could refund a payment no order holds | a verification round, reading Medusa's source at the pinned tag |
| Enumeration drift | `POST /store/customers/me/addresses` used, and missing from the route inventory | the mechanical checker |
| A criterion that tests something else | AC-49 and AC-112 | a verification round |
| Rounding | a chargeback share that stranded a cent in 956 of 8,000 random sequences | the money reviewer's randomized simulation |
| Race or lock order | a checkout completing while its buyer's personal-data deletion is approved | a verification round |
| Security by omission | an old invitation link letting the next holder of an email address take over a vendor account | a verification round |
| Consistent but wrong rule | a forfeiture that took the whole pending balance, the vendor's fees and charges with it | a verification round, confirmed by a 40,000-sequence simulation |

A build catches the checker's class at once, and a rounding error only when a property test states
the invariant correctly. It catches none of the last three unless a criterion already names the
failure: the code and its tests both follow the rule. Each round's fixes also introduced new,
smaller defects, and nothing ended the loop: the operator asked why the work was still running
after six rounds. The seventh found only minor defects, which is where §2's stop rule would have
ended it.

## 2. The operator's decisions (2026-09-26)

1. **Inside `init`.** The phase is four new `init` phases. A separate `detent spec` command was
   proposed and declined.
2. **Ask, and default the rest.** Only C-3″-class questions (PRDR-119: a decision "counted in
   money or contracts rather than in code") are asked. Every other gap is settled as a
   **vetoable default**.
3. **Stop rule.** VALIDATE stops after a round with no blocker and no major, and that round's
   minor findings are fixed without re-review. A loop still unconverged at its ceiling goes to
   the operator: a ceiling, never a retry.
4. **Fixed schema.** The pack has a fixed Detent schema that a deterministic checker gates, with
   requirement → ticket → test traceability.
5. **One early stop.** DECIDE stops once, after AUDIT, for the founder's questions. PRESENT
   remains the other stop, and it also lists every vetoable default.
6. **A conforming pack skips.** A pack that already conforms goes through the checker gate only,
   and straight on to ANALYZE.
7. **Sandboxed simulation.** VALIDATE's reviewers may write and run throwaway scripts in a
   scratch directory outside the repository.
8. **Amendments during `run`.** A session that proves a specification defect files an amendment.
   The affected tickets pause, the operator approves, the checker runs again, and only the
   affected tickets are re-planned. The option as asked named `init --replan` for the last step,
   but C-8′ makes `--replan` re-derive every slice, so §8 gives the decision a scoped re-plan
   instead.
9. **Headless takes defaults.** With no one to ask, DECIDE takes every recommended answer and
   logs it as vetoable. N-7 keeps the raw PRD and runs the phase headless.

## 3. The pipeline

```
INIT_FS → DISCOVER → [AWAIT_DOCS] → AUDIT → DECIDE → [AWAIT_INFO] → WRITE → VALIDATE → [AWAIT_INFO]
        → ANALYZE → DETERMINE_VERIFICATION → [AWAIT_BINDING_CHOICE | AWAIT_SETUP_CONSENT]
        → SLICE → PLAN → PREPARE_AGENTS → PRESENT → [AWAIT_INFO | AWAIT_APPROVAL] → READY
```

| Phase | Reads | Writes | Stops for the operator |
|---|---|---|---|
| AUDIT | the discovered documents and, in an existing project, the code | its checkpoint: contradictions, gaps and external claims, each claim with its source and a verdict | never |
| DECIDE | AUDIT's checkpoint | `docs/founder-decisions.md`: asked decisions `D-n` and vetoable defaults `X-n` | once, on a TTY, for C-3″ (PRDR-119) questions |
| WRITE | the documents, AUDIT's checkpoint, the decision log | the pack (§4); the originals moved to `archive/` | never |
| VALIDATE | the pack | the conformance record (§4.3), and the pack's document set for ANALYZE | only at the ceiling, and only for a blocker (§7) |

- **No new interrupt.** Both new stops raise AWAIT_INFO, the decision class C-3′ already
  presents: a question the documents cannot answer. The set of five stays closed (C-5), so
  C-14′'s porcelain freeze holds; a sixth interrupt would be a new decision class, which C-14′
  makes a major-version decision. What changes is where AWAIT_INFO may be raised: at DECIDE and
  at VALIDATE, as well as at PRESENT. That is an amendment to C-3′ (PRDR-278).
- **No second DISCOVER.** Checkpoints are keyed by phase name (F-4), so DISCOVER cannot simply
  run twice. WRITE moves the originals out of every discovery glob, and VALIDATE ends by
  discovering the pack with DISCOVER's own recorded patterns (PRDR-166) and handing that set to
  ANALYZE. A later `detent init` finds the conforming pack at DISCOVER and takes decision 6's
  path: AUDIT, DECIDE and WRITE are skipped, and VALIDATE runs only the checker.
- **Precedent.** SLICE was added to the pipeline the same way (C-2‴). The new phase names and
  artifacts are persisted shapes, so F-3's schema discipline and release-checklist item 8 apply.

## 4. The pack

### 4.1 Layout and precedence

| Path | Holds |
|---|---|
| `docs/founder-decisions.md` | asked decisions `D-n` and vetoable defaults `X-n`, each with the question, the answer and the reason |
| `docs/research/verified-facts.md` | external facts, each with an id, its source link and a tag: `source-read`, `doc` or `unverified` |
| `docs/design/*.md` | architecture and cross-cutting design: data model, API conventions, catalogues, security |
| `docs/adr/ADR-nnn-*.md` | architecture decision records |
| `docs/prd/index.md`, `docs/prd/NN-<module>.md` | the code registry, milestones and module requirements |
| `archive/` | the original documents, outside every discovery glob |

Precedence: decisions > facts > design > ADRs > PRDs. A disagreement is a defect in the lower
document, and the fix always lands there.

### 4.2 Requirements and acceptance criteria

- **Ids.** `<CODE>-F-<nnn>` for functional requirements and `<CODE>-N-<nnn>` for non-functional
  ones, each code registered in the index. Each id carries a milestone tag `[M0]`, `[M1]`, …
- **Wording.** MUST and SHOULD. The pack never states unbuilt behaviour in the present
  indicative. That is the defect class PRDR-263 names: a mechanism stated as built while the code
  does something else. Here it is caught where the claims are born.
- **Criteria.** Every requirement is tested by at least one acceptance criterion, and every
  criterion names the requirements it tests. A criterion states Given / When / Then with exact
  values.
- **Milestone order.** An `[Mk]` requirement never depends on an `[Mj]` with `j > k`.
- **Catalogues** are optional, and are checked when present: error codes, events, settings, jobs
  and routes.
- **Traceability.** Tickets already carry `requirement_ids` (A-1). The pack makes every id
  resolvable, which is how an amendment finds its tickets (§8). PRDR-279 makes PLAN carry each
  requirement's criterion ids into the ticket's acceptance criteria, so review can check that
  each one is tested.

### 4.3 The conformance record

The record is committed next to the pack (PRDR-279 fixes the path), and holds:
- the schema version;
- a hash of the pack's documents, excluding the record itself;
- the checker's result;
- every validation round, with its counts by severity and the findings left open;
- the date.

A pack conforms when its hash matches its documents and the checker is green. A pack whose
documents no longer match the hash is re-validated for the change only: the checker, then review
rounds scoped to the changed documents and whatever cites them, under the same stop rule. An edit
never re-runs the whole phase.

## 5. The checker

The checker is deterministic, uses no model, and is a referee gate. It is a TypeScript port of
ksarjs's `check_pack.py` (kept at `~/ksar-spec-tools/`), generalized to the schema:

- every id is defined exactly once, and every reference to a requirement, criterion, decision,
  fact or section resolves;
- every error code, event, setting, job and route a PRD uses is in its catalogue, when the pack
  has one;
- every requirement has a criterion, and no criterion names an unknown requirement;
- milestone order holds;
- present-indicative claims about unbuilt behaviour are reported to VALIDATE's reviewers as
  findings. This rule is a heuristic, so it reports and never blocks.

The first rule earns its place on Detent's own PRD: `detent-prd-v3.md` defines C-3″, C-9′,
S-3′, V-1⁵ and X-1‴ twice each, as different rules. The checker runs at VALIDATE and on every
amendment (§8). A red checker blocks ANALYZE.

## 6. Stops, defaults and headless runs

- **DECIDE on a TTY** asks in screens of at most four questions. Each question lists its
  recommended option first, and each option states its consequence, the format the ksarjs
  decisions used. The answers are written to `docs/founder-decisions.md`, where the next
  `detent init` reads them (PRDR-166), and `init` replays from the first checkpoint whose inputs
  changed (C-8). AUDIT's checkpoint is not keyed by the decision log, so an answer re-runs DECIDE
  forward and never AUDIT. A question the log already answers is never asked.
- **Off a TTY** (decision 9), DECIDE never stops. It takes every recommended answer and logs it
  as a vetoable `X-n`.
- **Defaults** are `X-n` entries, each with its value and its reason. PRESENT lists them all with
  C-3′'s assumptions. A veto changes the decision log, so the next `detent init` replays DECIDE
  forward: WRITE amends what relied on the default, VALIDATE re-validates the change only (§4.3),
  and only the slices whose inputs changed are re-planned (C-8).

## 7. VALIDATE

1. **The checker first.** A red checker is fixed before any review round starts.
2. **Review rounds.** Each round runs one reviewer per area. ksarjs used five: money and orders;
   identity, security and surfaces; catalog, shipping, search and analytics; plugins and
   notifications; facts and design consistency. Every reviewer uses the review brief (seed:
   `~/ksar-spec-tools/review-brief.md`) and reports each finding with its severity (blocker,
   major or minor), `file:line`, a quote and the exact fix.
3. **Fixes.** A writer applies the round's findings. The next round verifies those fixes and
   hunts for the defects they introduced (seed: `verify6-brief.md`).
4. **Stop.** A round with no blocker and no major ends the loop. Its minor findings are fixed
   without re-review (decision 3).
5. **Ceiling.** After `spec_validation_rounds` rounds (configuration; proposed default 8), the
   loop stops with the last round's fixes applied and never verified. ksarjs, a large and
   money-heavy pack, converged in its seventh round. A ceiling of 6 would have stopped on round
   6's three majors, fixed but unverified. At the ceiling:
   - the last round's majors go to PRESENT as recorded risks, listed beside the defaults, and
     planning goes on;
   - a blocker stops `init` at VALIDATE with AWAIT_INFO, because a plan built on an unverified
     fix to a blocker can be wrong everywhere. The operator settles it in the pack or raises the
     ceiling, and `detent init` resumes VALIDATE.
6. **Simulation.** A pack that states invariants, such as a ledger's or a state machine's, gets
   a reviewer that writes and runs a randomized simulation in a scratch directory (decision 7,
   PRDR-285). The simulation reports and never edits. `init` sessions get S-1′'s read-only
   surface today, so this is a containment change.
7. **Progress.** Today the only progress mark in `init` is a slice's checkpoint write
   (`noteUnitComplete` in `src/init/plan-slices.ts`, X-1⁵). Each completed specification phase
   and each completed round becomes one too. Without them, the no-progress breaker would
   announce throughout a healthy specification phase: it counts sessions before the first unit
   completes.

## 8. Amendments during `run`

- **Filing.** A session that proves a specification defect files it through X-4. Its
  `falsified.json` carries an amendment that names:
  - the affected requirement ids;
  - the defect class;
  - the evidence: a failing test, or two passages of the pack that contradict each other,
    quoted;
  - the proposed text.

  The referee admits PREMISE_FALSIFIED as it does today, and the ticket goes to NEEDS_HUMAN. No
  state or event is added: v3 inherits §7's machine unchanged, and an amendment is a
  falsification that names its fix.
- **Holding.** Until the operator decides, the pool draws no READY ticket whose `requirement_ids`
  include an amended requirement, as it draws no ticket whose blockers are open. The rest of the
  run goes on.
- **Deciding.** The operator approves, edits or rejects the amendment through C-10's escalation:
  on a TTY inside `run`, and with exit 10 off one.
- **Applying.** On approval the pack is edited, the checker gates it, and VALIDATE re-validates
  the change (§4.3). Then comes the scoped re-plan, which neither existing path provides. Plain
  `init` on an approved plan prints status and asks for `--replan` (C-8). `--replan` re-derives
  every slice (C-8′). PRDR-286 adds the scoped re-plan:
  - only the slices whose requirement ids changed are re-planned, and every other slice's cache
    is reused (C-8‴);
  - C-8′'s reconciliation applies: a DONE ticket is never redrafted, so a change to built code
    becomes a new ticket;
  - C-8″'s in-flight refusal is scoped to the re-planned slices' tickets. Today it counts every
    ticket that is neither READY nor DONE (`inFlightTickets` in `src/init/machine.ts`), so the
    filing ticket's own NEEDS_HUMAN would refuse the re-plan it asked for;
  - the changed plan is presented for approval again, since its hash changed (C-7′).

  The filing ticket and the held tickets then return to the queue, as PRDR-277 returns the
  tickets an install un-strands, or are superseded by the re-plan.

## 9. N-7

The self-build runs the phase headless on `detent-prd-v3.md` (decision 9). AUDIT will meet the
five duplicated ids of §5 at once, and DECIDE will default its way past them. N-7 therefore runs
longer and costs more, and PRDR-278 adds both figures to release-checklist item 5, beside the
green. The pack N-7 writes lives in the self-build's folder, like everything else N-7 produces.

## 10. Open questions (not yet decided)

- May an operator switch the phase off for a project, or is a conforming pack the only way past
  it?
- The ceiling's default: 8 is proposed (§7).
- AUDIT checks facts on the web and in dependency sources at pinned versions. Does it reuse the
  research role, or get an auditor role of its own?
- Which roles may file an amendment? X-4 gives one to the implement role; review and diagnose
  write read-only artifacts today.
- Which model and effort does each phase use? The review rounds are the expensive part.
- What will it cost? The ksarjs specification ran interactively, and its cost was never
  measured, so there is no projection yet.

## 11. Tickets

| Ticket | Part | Depends on |
|---|---|---|
| PRDR-278 | The PRD amendment: phases, stops, headless defaults and N-7 | — |
| PRDR-279 | The pack schema and the conformance record | PRDR-278 |
| PRDR-280 | The checker as a referee gate | PRDR-279 |
| PRDR-281 | AUDIT | PRDR-278 |
| PRDR-282 | DECIDE: the early stop, vetoable defaults at PRESENT, headless | PRDR-278, PRDR-281 |
| PRDR-283 | WRITE, and handing the pack to ANALYZE | PRDR-279, PRDR-282 |
| PRDR-284 | VALIDATE: rounds, stop rule, ceiling, progress marks | PRDR-280, PRDR-283 |
| PRDR-285 | Sandboxed scratch execution for VALIDATE's reviewers | PRDR-284 |
| PRDR-286 | Amendments during `run`, and the scoped re-plan | PRDR-280, PRDR-284 |
