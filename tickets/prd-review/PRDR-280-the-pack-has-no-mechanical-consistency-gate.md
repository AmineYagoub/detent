---
id: PRDR-280
title: "Nothing mechanical checks a pack's cross-references. ksarjs's checker caught a route a PRD used and the route inventory lacked, and Detent's own PRD gave nine marks to more than one rule each until PRDR-287 and PRDR-288 renumbered them. A deterministic pack checker becomes a referee gate, and a red result blocks planning"
state: OPEN
severity: major
category: capability
labels: ["prd-review", "specification-phase", "operator-decision", "referee", "determinism"]
surface: ["src/init/pack-check.ts", "src/init/pack-check-rules.ts", "src/init/pipeline.ts", "src/cli/referee.ts", "tests/init/pack-check.test.ts", "tests/fixtures/pack/"]
prd_refs: ["ARCH-2", "D-26", "F-3", "PRDR-263", "PRDR-278", "PRDR-279"]
acceptance_criteria: ["Each rule has a fixture that fails it and one that passes: every id is defined exactly once; every reference to a requirement, criterion, decision, fact or section resolves; every error code, event, setting, job and route a PRD uses is in its catalogue, when the pack has one; every requirement has a criterion, and no criterion names an unknown requirement; milestone order holds.", "The present-indicative rule reports and never blocks. Its findings go to VALIDATE's reviewers, and the checker's own output says the rule is a heuristic.", "Deterministic: no model, no network and no clock. The same pack gives byte-identical output, and each finding names its rule, its `file:line` and the offending text.", "A referee gate: both drivers reach it through the same referee path (ARCH-2). A red result blocks every phase after VALIDATE. It runs at VALIDATE and on every amendment (PRDR-286).", "Parity with its seed: on a fixture cut from the ksarjs pack, it reports what `~/ksar-spec-tools/check_pack.py` reports, zero problems; seeded with that script's catches, it reports the same findings.", "Like `scripts/check-tickets.ts`, it prints what it does not check, so a green result is not read as a review."]
non_goals: ["Does NOT judge meaning. A rule that is consistent and wrong passes the checker; VALIDATE's reviewers and simulations are for that (PRDR-284, PRDR-285).", "Does NOT gate Detent's own repository on `detent-prd-v3.md`. The PRD is not a pack. `tests/docs/prd-requirement-ids.test.ts` (PRDR-287) already keeps its marks unique, and the duplicates PRDR-287 and PRDR-288 renumbered are this ticket's evidence, not its failure.", "Does NOT fix what it finds; VALIDATE's writer does."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-192", "PRDR-279", "PRDR-284", "PRDR-287", "PRDR-288"]
depends_on: ["PRDR-279"]
---

# PRDR-280 — the pack checker, a referee gate

## Where this came from

ksarjs's `check_pack.py`, kept at `~/ksar-spec-tools/`, ran after every fix round. It checks what
reading does not reliably see: ids defined twice, references that resolve to nothing, catalogue
entries a PRD uses and no catalogue holds, requirements with no criterion. It caught
`POST /store/customers/me/addresses`, used by a PRD and missing from the route inventory, and
the specification ended at zero problems.

Its first rule would have failed on Detent's own PRD. Until PRDR-287 and PRDR-288 (2026-09-26),
`detent-prd-v3.md` gave nine marks to more than one rule each: C-3″ named both PRDR-119 and
PRDR-207, and C-9′ three rules. Ten definitions moved, and `tests/docs/prd-requirement-ids.test.ts`
now keeps that one document's marks unique, as this checker will for every pack.

## Design

The plan's §5: a TypeScript port of the script, generalized to PRDR-279's schema, and run by the
referee so neither driver can skip it. The present-indicative rule is the one heuristic, so it
reports to the reviewers instead of blocking. The checker states its blind spots in its own
output, the way `scripts/check-tickets.ts` (PRDR-192) does.
