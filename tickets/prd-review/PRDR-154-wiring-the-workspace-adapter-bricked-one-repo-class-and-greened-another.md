---
id: PRDR-154
title: "Wiring the workspace adapter bricked every `go.work` repo and gave npm-workspaces a gate that passes having run nothing; and wiring `doctor` made it die on the broken state it exists to diagnose"
state: DONE
severity: major
category: correctness
labels: ["prd-review", "found-by-audit", "self-inflicted"]
surface: ["src/adapter/discover/index.ts", "src/cli/doctor.ts", "src/cli/verify.ts", "src/cli/index.ts"]
prd_refs: ["V-1", "V-1″", "R-10", "C-6a", "PRDR-148"]
acceptance_criteria: ["`preferOrchestrator` is NOT wired, and the two reasons are recorded where the wiring would go rather than left as a silence.", "`doctor` survives a `bindings.json` it cannot read: it degrades to the offline checks and still prints them.", "`doctor`'s live smoke session is behind `--smoke`, so the command stays a free offline diagnostic and never spends unasked.", "`verify sync` refuses off a terminal BEFORE `verifySync` runs the candidate commands, and its prompt says they have already run.", "The consent prompt uses `readline/promises` like its two siblings, and answers `false` on close rather than hanging on Ctrl-D."]
non_goals: ["Does not redesign `workspace.ts`'s command table or its dedup. Both need reconsidering — demote the collider rather than dropping it, and never prefer a sweep that can pass vacuously — and that is a design change with its own evidence."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-141", "PRDR-148"]
depends_on: []
---

# PRDR-154 — the wiring phase's own wiring

**Severity:** major · **Category:** correctness · **Found by:** the audit of phase 4 ·
**Introduced by:** `ccdc501`

PRDR-148's rule was *wiring a dead control exposes every latent defect in it, at once, in
production*. PRDR-141 invoked that rule, applied it to `doctor` — and found a real drift there —
and then wired two more things without finishing the same check on them.

**`preferOrchestrator` bricked one repo class and greened another.** It dedups by command string
and **drops** the collider; `go-work`'s root gates are byte-identical to what `discover/go.ts`
emits, so the `adapter: "go"` candidate vanished from discovery. `currentFor` matches on
slot+adapter+ref, so an existing `bindings.json` reported `vanished` — which halts. Every ticket
on a `go.work` repository stopped at exit 2 against a binding that was valid the day before. And
its npm-workspaces root gate is `npm run test --workspaces --if-present`, which exits 0 having
run **nothing** when the packages carry no `test` script and a root config covers them — the
commonest monorepo layout. `bindSlot` probes it, sees green, and binds a gate that can never
fail: the "greened on nothing" class V-1″ closed once already.

Both are properties of the module, not of the three lines that called it. So the answer to
PRDR-141's *"wired, or the module and the claim go together"* turned out to be a third one: the
audit showed the module is not fit to wire, and that is recorded where the wiring would go.

**`doctor` died on the broken state it exists to diagnose.** `buildLiveBackend` reads
`bindings.json`, which throws on an invalid or newer-schema file — so the one command an operator
reaches for when the state directory is broken printed nothing at all: no config check, no pin
check, no WebFetch check. It degrades now and still prints.

**And it started spending money.** The smoke session runs a real billable session with no
consent, no cap and no ledger row, while `live.ts` asserts R-10's gate is "consent plus a cap". A
free offline diagnostic became a billable command on every logged-in machine. It is behind
`--smoke` now — which also stops `hasLiveBackendAuth()` from spawning the `claude` CLI, with a
ten-second timeout, on every invocation.

**`verify sync` asked for consent it had already spent.** V-1/P4 require the candidates to be
executed before they may be approved — a sync that approved an unexecuted binding approves a
guess — so `verifySync` binds before it asks, correctly. What was wrong is that the off-terminal
refusal lived *inside* the consent callback, by which point every discovered gate command had
run. It refuses before `verifySync` now, where refusing still prevents the running, and the
prompt says the commands have already executed rather than implying a choice that is still open.

Its prompt was also a third divergent transport: a raw `stdin.once("data")` that never settles on
Ctrl-D and leaves the stream flowing with a listener attached. It uses `readline/promises` like
`makeTtyApproval` and `makeTtyEscalation`, and answers `false` on close.
