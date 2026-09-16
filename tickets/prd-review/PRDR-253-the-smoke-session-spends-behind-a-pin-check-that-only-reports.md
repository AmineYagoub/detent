---
id: PRDR-253
title: "`detent doctor --smoke` records the S-5 pin check and then spends regardless, so the one `doctor` path that costs money enforces the pin on nobody"
state: DONE
severity: major
category: gap
labels: ["prd-review", "found-by-audit", "S-5", "X-1", "R-10"]
surface: ["src/cli/doctor.ts", "tests/cli/doctor.test.ts"]
prd_refs: ["S-5", "X-1", "R-10", "ARCH-2", "C-11"]
acceptance_criteria: ["A backend whose `checkVersion` rejects never reaches `backend.run` on `detent doctor --smoke`: no session, no ledger row, no spend line on stderr.", "The `smoke-session` row says it did not run and names the pin as the reason, rather than pushing a verdict for a session nobody ran.", "A root whose config will not load — where the pin is never checked at all — also does not spend: the smoke is gated on a pin that was VERIFIED, not on one that merely did not fail.", "The matching-pin control is unchanged: one session, one ledger row, `smoke OK`, and the X-1 stderr line PRDR-179 added.", "`doctor` still prints every other check and still exits 1, not 2 — a diagnostic that aborts at the first bad check is the defect PRDR-154 closed.", "Every criterion above fails on the tree before its fix, with the output recorded here."]
non_goals: ["Does not gate the smoke on `agent-sdk-pin`. None of the three refusing entrypoints gate on `pinned.agent_sdk` either, and making `doctor` alone do so would invent a fourth refusal contract inside the ticket family whose whole claim is parity. Recorded below, unfixed.", "Does not change `checkVersion`, nor what counts as a match (`installed.includes(pinned)`).", "Does not change `DoctorReport.exitCode` to `2`, and does not add a `PIN_CHECK_SITES` row — `cli/doctor` has had one since PRDR-251 and this ticket is about what the row's check DOES, not whether it exists.", "Does not fix the `pinned: \"unknown\"` trap PRDR-251 recorded; this fix inherits it on one more path and says so."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-251", "PRDR-252", "PRDR-181", "PRDR-173", "PRDR-179", "PRDR-158", "PRDR-154"]
depends_on: []
---

# PRDR-253 — the check that is reported and not enforced

## Problem

`src/cli/doctor.ts` does the S-5 work and then throws the answer away:

```ts
try {
  await deps.backend.checkVersion(loaded.config.pinned.claude_code);
  checks.push({ name: "claude-code-pin", ok: true,  detail: … });
} catch (err) {
  checks.push({ name: "claude-code-pin", ok: false, detail: (err as Error).message });
}
```

Nothing reads `ok` again. Forty lines later the `--smoke` session runs on the
same backend, spends real tokens, and writes a permanent ledger row through
`recordOutOfBandSpend(root, "doctor-smoke", result, …)` — a row that, as the
doc-block directly above it says, "counts against `run_spend_usd` for every
later run on this root".

So on the one `doctor` path that costs money, the pin is **reported and not
enforced**. Every other entrypoint that can spend refuses:

| entrypoint | on a mismatch | since |
| --- | --- | --- |
| `kernel/run.ts` | `notReady(err.message)` before the run lock | PRDR-181 |
| `cli/init.ts` | `EXIT_NOT_READY` before `buildPipeline` | PRDR-251 |
| `cli/referee.ts` | exit 2 before `acquireRunLock` | PRDR-251 |
| `cli/doctor.ts` | pushes a red row, then spends | — |

Each of the three carries a sentence saying spend comes after the pin —
`init`'s reads "Before the pipeline, so a refusal spends nothing". `doctor`
carries no such sentence, because it does not do it.

## Why PRDR-251 did not catch it

PRDR-251 built `PIN_CHECK_SITES` and an oracle that is total over the verbs
which obtain a live backend. `cli/doctor` is a row in that map, and the oracle's
second property — "each named checker actually calls `checkVersion`, in code and
not in prose" — passes for `doctor`, because `doctor` really does call it.

The map answers *is the pin checked here*. It cannot answer *does anything
happen when it fails*, and PRDR-251 said so in its own non-goals, from the
opposite side:

> Does not add a pin check to `doctor` — it has had one since PRDR-158/162 and
> is the row this map was written from.

The row the map was written from is the row that does the least with its
result. That is the doc-claim-drift shape once more, one level up: the claim was
promoted from prose to a checked map, and the map checks the half that was
already true.

## Two holes, not one

The obvious one is a mismatch. The second is a config that will not load:

```ts
let loaded: LoadedConfig | null = null;
…
if (loaded !== null) { …both pin checks… }
```

With no `.detent/config.json`, or one that fails `loadConfig`, `loaded` stays
`null`, **neither pin check is pushed at all** — and the smoke session below is
guarded only by `deps.backend === undefined`, so it launches. A root too broken
to say which CLI version it pins is a root on which `doctor --smoke` spends
against an entirely unverified one.

That is why the fix tracks a verified pin rather than an absent failure. `ok:
false` was never pushed in this case, so a gate phrased as "unless the pin check
failed" would leave this hole exactly where it is.

## Falsification (verification protocol, item 1)

`tests/cli/doctor.test.ts -t PRDR-253` against this tree, unfixed:

```
stderr | smoke session recorded $0.0010 to .detent/ledger.jsonl — it counts
        against run_spend_usd for every later run on this root (X-1).

× PRDR-253 ... > a mismatched pin stops the smoke session before it spends
  → nothing may spend behind a failed pin (S-5): expected 1 to be +0
× PRDR-253 ... > a config that will not load means an unverified pin, and an
  unverified pin does not spend
  → a root too broken to say what it pins is not a root to spend on:
    expected 1 to be +0
✓ PRDR-253 ... > a matching pin still runs the session, records the row, and
  reports smoke OK
```

Both holes are real and they fail identically: the session ran. The stderr line
above is the second case — the run with **no config at all**, where neither pin
row was ever pushed — announcing its permanent ledger row on the way past. The
control passed before the fix and must keep passing after it; that is what makes
it a control.

## Design

One local, `pinRefusal: string | null`, initialised to the no-config reason and
cleared only when `checkVersion` resolves. The smoke branch gains a third arm
between "no backend" and "run it": a backend was supplied, and the pin does not
permit spending it.

`doctor` refuses differently from the other three on purpose. Its contract is
`exitCode: 0 | 1` and its job is to report every check it can — PRDR-154 exists
because `doctor` once printed nothing at all on a broken state directory. So the
refusal here is a failing row and a session that does not happen, not an early
return: the WebFetch check still runs, the config check still prints, the exit
code is already 1 from the pin row itself.

The row is `ok: false` rather than a passing skip. The passing skip above it —
"skipped: no live backend (R-10)" — is honest because nobody asked for a smoke.
Here the operator typed `--smoke` and got no smoke, and PRDR-141's finding on
this same file was precisely that both live checks "pushed `ok: true`
unconditionally while the CLI advertised one live smoke session".

## Recorded, not fixed: the SDK pin

`agent-sdk-pin` is S-5 as well, and a mismatch there does not gate the smoke
either. It stays ungated because no other entrypoint gates on
`pinned.agent_sdk` — `run`, `init` and `referee` all check `pinned.claude_code`
alone via `checkVersion` — and a `doctor` that refused on a pin the drivers
ignore would be the parity break this family was opened to close. The divergence
is real and this ticket does not widen it; it is written down so the next reader
finds a decision rather than an oversight.

Likewise `pinned: "unknown"`, PRDR-251's recorded trap: a config written where
`claude --version` could not run pins a string no real version matches, so this
fix makes `doctor --smoke` refuse to spend on such a root too. That is the
intended reading of the trap — it now costs a diagnostic rather than a billed
session — but it is inherited, not introduced, and not fixed here.

## What changed

`src/cli/doctor.ts`: one local, `pinRefusal`, initialised to the never-checked
reason and cleared only where `checkVersion` resolves; a third arm in the smoke
branch that pushes a failing `smoke-session` row naming the refusal instead of
launching. The file doc-block now says the smoke is the only part with a
precondition, because it is the only part that spends. `tests/cli/doctor.test.ts`
gains the three cases above; no existing test changed.
