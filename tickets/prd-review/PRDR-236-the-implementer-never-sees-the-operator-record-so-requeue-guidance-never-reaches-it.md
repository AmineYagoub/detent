---
id: PRDR-236
title: "The reviewer receives the operator record and the implementer receives nothing, so requeue guidance — the documented C-12 remedy, whose whole purpose is to steer the next attempt — reaches every role except the one it is written for"
state: DONE
severity: major
category: defect
labels: ["prd-review", "C-12", "PRDR-080", "X-8", "session-inputs", "gate-313", "live-run"]
surface: ["src/kernel/referee-session.ts", "src/kernel/stages/review.ts", "prompts/implement.md", "prompts/blind_fix.md", "prompts/informed_fix.md", "prompts/review_fix.md", "prompts/manifest.json", "tests/kernel/session-inputs.test.ts", "detent-prd-v3.md"]
prd_refs: ["C-12", "X-8", "A-1", "S-2′", "D-17", "V-6", "N-6", "PRDR-080", "PRDR-227"]
acceptance_criteria: ["Every attempt role — implement, blind_fix, informed_fix, review_fix — receives the ticket's recent operator/kernel note trail, the same `operator_record` the reviewer already gets. Observed FIRST (V-6): `attemptInputs` at `src/kernel/referee-session.ts:38-50` returns `{ ticket: publicTicket(...) }` for IN_PROGRESS and `fixInputs` for the rest, and `publicTicket` at `src/kernel/referee-context.ts:447-458` returns id, type, title, description, acceptance_criteria, non_goals, contract inputs and surface — no notes, by any name. `grep -rn lastNote src/` returns two readers, `referee.ts:445` (the operator exit summary) and `referee-sweeps.ts` (drift sweeps); neither is a session input.", "A requeue's `--guidance` text reaches the session that the requeue re-opened the generation for. Observed FIRST: `requeueTicket` at `src/kernel/plumbing.ts:166` records the guidance with `appendNote` and at `:173` as the new generation's `reason`, and nothing carries either into a session's inputs. Proven live on gate-313: t-s01-012 was requeued at 19:35:25Z with the reviewer's finding relayed verbatim, generation 1's implement session ran to completion, and the next review opened with `The requeue guidance's finding is still unaddressed` — the reviewer can read the guidance, the implementer could not.", "The prompt for each attempt role describes `operator_record` and states that a recorded grant or guidance is authoritative, as `prompts/review.md:7` already does for the reviewer.", "Proved by a test that fails on today's tree: an attempt session's inputs carry the ticket's operator notes.", "Second correction, in the same prompt pass and recorded here rather than smuggled in: `prompts/review_fix.md` ends with `a second round of review findings escalates to a human`, which X-1‴ (PRDR-108) made false — review findings buy `review_fix_attempts` rounds, read from the budgets, and gate-313 now runs five. A fixer told it has one round left when it has four spends the attempt defensively, and the line is in a file this ticket already edits."]
non_goals: ["Does not change what the reviewer receives — `REVIEWER_INPUT_KEYS` and its closed-set test at `tests/kernel/stages.test.ts:198` are correct and stay as they are.", "Does not put the whole note history in: the reviewer's window of the last 8 notes is the precedent and is kept, so a long-lived ticket does not push its own criteria out of context.", "Does not change `publicTicket` — the ticket's public shape is not the place for operator history, and four roles inheriting one key at the `attemptInputs` seam is the point.", "Does not add a new note type, CLI flag, or state."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-080", "PRDR-234", "PRDR-235"]
depends_on: []
---

# PRDR-236 — guidance that reaches everyone except its reader

**Severity:** major · **Category:** defect · **Found by:** the first max-effort implement session on
gate-313 reproducing, exactly, the bug its requeue guidance described

## Problem

C-12 gives the operator one lever over a stopped ticket: requeue it, with guidance. The CLI takes
`--guidance`, `requeueTicket` writes it as a ticket note and as the new generation's `reason`, and
the confirmation says *"generation 1 opened with the guidance recorded (X-8)."*

Recorded, and never delivered. `attemptInputs` is the whole of what an attempt session receives:

```ts
// src/kernel/referee-session.ts:38-50
case "IN_PROGRESS":
  return { ticket: publicTicket(ticket, this.ctx.root) };
```

and `publicTicket` is id, type, title, description, acceptance_criteria, non_goals, contract
inputs, surface. No notes. `lastNote` exists, and its only two readers are the operator-facing exit
summary and the drift sweeps — neither is a session input.

The reviewer, meanwhile, gets the note trail in full:

```ts
// src/kernel/stages/review.ts:56
operator_record: ticket.notes.slice(-OPERATOR_RECORD_NOTES).map((n) => ({ author: n.author, text: n.text })),
```

PRDR-080 added that, and its comment names the missing half out loud:

> operator acts — surface grants, **requeue guidance**, claim breaks — are recorded as ticket notes,
> and a reviewer that cannot see them reads SANCTIONED cross-surface work as scope creep forever

PRDR-080 was diagnosing a reviewer that flagged an operator-granted change as scope creep, so it
fixed the reviewer's input and stopped. But of the three operator acts it lists, *requeue guidance*
has no audience except the attempting session. A grant and a claim break are facts a judge needs.
Guidance is an instruction, and it is delivered only to the party who is not meant to act on it.

## Measured, on the live run

t-s01-012 halted at NEEDS_HUMAN carrying a precise reviewer finding: `finalizeTicket` treats
`surface[]` entries as literal paths where A-1 defines them as globs, so a ticket whose surface is
all new files can never be finalized, and a mixed surface silently drops the new files from the
commit. It was requeued at 19:35:25Z with that finding relayed verbatim — mechanism, both failure
directions, the suggested repair and the missing test — into a fresh generation.

Generation 1's implement session ran 630 seconds and completed green. The review that followed
opened:

> The requeue guidance's finding is still unaddressed

and re-derived the same defect from scratch. The implementer had rewritten the ticket from its
acceptance criteria alone, because that is all it was given. The reviewer could quote the guidance
because the reviewer is the one role that receives it.

This also cost the run a second thing: that session was the first ever launched under
`effort_routing.implement: "max"`, and the experiment it was meant to be the first data point for
is void. A session cannot be measured on whether more reasoning helps it act on information it was
never handed.

## Scope

One key, added at the `attemptInputs` seam so all four attempt roles inherit it rather than each
remembering it — the same argument PRDR-169 made for scrubbing at the seam rather than at four call
sites. Same shape and same 8-note window as the reviewer's, so there is one definition of "the
operator record" and not two. Then the four attempt prompts, which must describe the key for it to
be read as binding rather than as background.

## What implementation changed

**`src/kernel/stages/review.ts`** — `OPERATOR_RECORD_NOTES` is exported and joined by
`operatorRecord(ticket)`, the single definition of the record. The reviewer now calls it instead of
inlining the slice, so the two readers cannot drift apart in window size or shape.

**`src/kernel/referee-session.ts`** — `attemptInputs` wraps the existing switch (now `attemptBody`)
and adds `operator_record` to whatever it returns. One site, so all four attempt states inherit it
and a fifth would too — the argument PRDR-169 made for scrubbing at the seam rather than at four
call sites.

**`prompts/{implement,blind_fix,informed_fix,review_fix}.md`** — each describes the key and says
that requeue guidance in it is an instruction addressed to that session and binding alongside the
acceptance criteria, that a recorded grant puts the granted file in scope, and that where the record
is silent the criteria govern. Without this the key would arrive as unexplained background.

**`prompts/review_fix.md`, second correction** (recorded in the criteria above, not smuggled in) —
*"a second round of review findings escalates to a human"* became false when X-1‴ made the rounds a
budget; it now names `review_fix_attempts` and says the escalation comes when that budget is spent.

`npm run prompts` and `npm run plugin` regenerated the manifest, `agents/*.md` and the hook bundle.

**`tests/kernel/operator-record.test.ts`** — five tests, observed failing first (V-6): each of the
four attempt states carries the notes, and the window matches the reviewer's rather than being
re-chosen.

**Scope held:** `REVIEWER_INPUT_KEYS` and its closed-set test are untouched, and `publicTicket` is
unchanged — the ticket's public shape is not where operator history belongs.
