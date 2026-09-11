---
id: PRDR-212
title: "The implementer is told to run the gate command it cannot run and is never told what its Bash is, so a permission denial reads as an unimplementable premise — and a falsification, once written, cannot be taken back"
state: DONE
severity: major
category: defect
labels: ["prd-review", "prompts", "implement", "X-4", "falsification", "containment"]
surface: ["prompts/implement.md", "prompts/manifest.json", "agents/implement.md", "src/kernel/referee-session.ts", "tests/kernel/falsified-retraction.test.ts", "tests/sessions/prompts.test.ts", "detent-prd-v3.md"]
prd_refs: ["X-4", "S-2‴", "S-3", "P2", "V-6", "N-6", "PRDR-122", "PRDR-211"]
acceptance_criteria: ["The implement prompt states the session's tool surface as it is: files inside the surface, `git add` and `git commit`, and nothing else — the gates are run by the referee when the session ends and their results come back as the next session's inputs. A refused `npm`, `mkdir`, `rm` or `env` is named, in the prompt, as containment working and not as evidence about the ticket. `prompts:check` hash updated.", "A falsification can be retracted by its author: the signal file schema admits `{\"retracted\": true, \"note\": …}`, and a retracted signal is NOT a PREMISE_FALSIFIED event — the referee proceeds as if none were written and records the retraction in the ticket journal. Observed FIRST on gate-313's artifact text (V-6): today the retraction rides inside the note and the event is admitted regardless.", "The prompt says how: overwrite the signal file with the retraction, since the session cannot delete it.", "The stage that reads the signal treats a malformed file exactly as before — a named invalid outcome, never a silent pass."]
non_goals: ["Does not widen the surface by a verb. PRDR-211 gives the referee the install; the session's Bash stays two verbs.", "Does not make falsifying cheaper: a signal that stands is still X-4's — signal, not failure, and the human's to judge.", "Does not let the referee guess intent from prose. `retracted: true` is the only retraction."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-211", "PRDR-122"]
depends_on: []
---

# PRDR-212 — a session that could not know what it was allowed to do

**Severity:** major · **Category:** defect · **Found by:** the bootstrap session's own dossier on
gate-313

## Problem

The dossier, in the session's words:

> RETRACTED. My own Bash tool blocks npm/mkdir/rm/env with a permission wall, and I mistakenly
> concluded the ticket's gates were unimplementable in this session. The Stop hook then ran
> `npm test` itself and got a real ENOENT for a missing package.json rather than a permission
> denial, proving the gate-runner has working, unrestricted npm access outside my sandboxed Bash
> tool. The premise holds; I am completing the ticket normally. Please disregard this file and
> evaluate implement.json / the actual gate results instead.

Three things went wrong in one session, and only the first is the session's.

1. The prompt says *"Run the scoped gate command you were given as you work"*. The session's
   Bash is `git add` and `git commit` (S-3); it cannot. It tried, was refused, tried `mkdir`,
   `rm` and `env`, was refused, and concluded the ticket was unimplementable — which is what the
   prompt told it a refusal-shaped wall means: *"a criterion is unimplementable as specified,
   write the falsified signal file."* Nowhere is the session told what its own surface is.
2. It then understood (the Stop hook's `npm test` reached the shell), finished the scaffold, and
   wanted the signal gone. It cannot delete a file. It wrote the retraction INTO the signal.
3. The referee read a signal file and admitted PREMISE_FALSIFIED, as X-4 says. The retraction
   was prose; the event was structural. NEEDS_HUMAN, exit 10.

X-4 is right that a falsification is signal, not failure. But a signal the author could not
withdraw, prompted by a wall the author was not told about, is not the signal X-4 meant.

## The shape

Tell the session the truth about its tools, in the prompt: what it may write, the two git verbs,
and that gates are the referee's. Then give the signal a way back: `{"retracted": true, "note"}`
overwrites the file, the stage reads it as no signal and records that one was withdrawn, and a
malformed file stays the named invalid outcome it is today. The referee never reads intent from
prose; `retracted` is a field.

PRDR-211 removes the reason this session needed `npm` at all. This ticket is what keeps the next
honest mistake from ending a run.

## What implementation changed

**The prompt tells the truth about the tools.** `prompts/implement.md`'s duties paragraph now
says: your tools are exactly reading and searching, writing and editing inside your surface, and
`git add` / `git commit`; you do not run gates, tests or package managers; `npm`, `mkdir`, `rm`,
`env` and every other shell command are refused by the containment hook, and a refusal is
containment working, never evidence about the ticket; the referee runs the bound gates after you
end, installing what the manifest declares first (V-1⁗), and the Stop hook hands a red scoped
gate back — that is how gate results reach you. The falsification trigger reads *"unimplementable
as specified — as specified, not as blocked by a tool refusal"*. `agents/implement.md` is
regenerated from it (`npm run plugin`), and the manifest hash with it.

**The signal can be taken back.** `{"retracted": true, "note"}` overwrites the file — the
session cannot delete one. `consumeFalsifiedSignal` reads the boolean, removes the file, notes
*falsification withdrawn by the session: <note>* on the ticket, appends a
`falsification_withdrawn` event to its journal, and returns no signal. Anything but the boolean
`true` is a standing signal, exactly as before; a malformed file is still the event.

**V-6, in order.** Observed on the tree as it was: `implement.md must mention "git add"`; the
retracted signal still ended the run at `expected 10 to be +0` — NEEDS_HUMAN. Then the change;
then 33 of 33 across the retraction, prompt, agent and dependency tests.

## Note for the gate

S-7 pins each ticket's assignment to `role@hash`, and gate-313's `assignments.json` names the
implement prompt by its old hash. The runner moves to this commit and `detent init` replays: every
checkpoint holds except PREPARE_AGENTS, whose digest carries the prompt hashes, so it rewrites
the assignments for $0 and PRESENT re-presents an unchanged plan under its standing approval.
Then the bootstrap is requeued and the skeleton runs.
