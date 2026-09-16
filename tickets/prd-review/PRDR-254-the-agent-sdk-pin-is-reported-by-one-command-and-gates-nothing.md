---
id: PRDR-254
title: "`pinned.agent_sdk` has one production reader and it gates nothing, so half of S-5's sentence refuses on four paths and the other half refuses nowhere — with no statement anywhere that the asymmetry is deliberate"
state: DONE
severity: minor
category: decision
labels: ["prd-review", "found-by-audit", "S-5", "doc-claim-drift", "provenance"]
surface: ["src/cli/doctor.ts", "src/sessions/live.ts", "tests/oracle/pin-parity.test.ts", "tests/cli/doctor.test.ts"]
prd_refs: ["S-5", "S-2", "S-4", "N-3", "N-7", "ARCH-2"]
acceptance_criteria: ["The tree states, where a reader of the pin checks will find it, that `pinned.agent_sdk` is ADVISORY and why — its vetting is upstream in Detent's own release pipeline (N-7 + release-checklist 5/6), not in the project's config.", "The statement is mechanically held, not prose: an oracle in the shape of `PIN_CHECK_SITES` fails if any production module starts gating on `pinned.agent_sdk`, so a future gate has to come back and change the claim rather than silently contradict it.", "`doctor`'s `agent-sdk-pin` mismatch detail is addressed to the reader who will see it — a project operator whose Detent moved — and says what to do about it. Today it says \"upgrades are PRs gated on the fixture suite\", which is instruction for Detent's maintainers and means nothing to a project.", "`doctor` reports the mismatch as what it is: the project was initialised against one SDK and is being run by another. The row's `ok` may stay `false`; what changes is that the text names the cause.", "The rejected alternative — gating `agent_sdk` on the four spending paths the way PRDR-251/253 gate `claude_code` — is recorded with its cost, so the next sweep finds a decision rather than re-files this ticket."]
non_goals: ["Does NOT gate `agent_sdk` on `run`, `init`, `referee` or `doctor --smoke`. That is the rejected alternative below; it would turn every Detent upgrade into a fleet-wide refusal, and if it is ever wanted it is a breaking change and its own ticket.", "Does not change `PINNED_AGENT_SDK` or how `init` writes the pin — the constant is already held against `package.json` by `tests/init/config-defaults.test.ts`, and that half is honest.", "Does not make `ensureConfig` rewrite an existing config's pin. A config Detent silently updates to match itself is not a pin.", "Does not touch the `claude_code` pin, `checkVersion`, or `PIN_CHECK_SITES`' existing rows."]
attempts: { fix: 1, hypothesis: 0, review: 0 }
links: ["PRDR-253", "PRDR-251", "PRDR-181", "PRDR-114"]
depends_on: []
---

# PRDR-254 — the advisory pin that is not written down as advisory

## Problem

S-5 is one sentence with two halves:

> Pinning: SDK version is an **exact** dependency in Detent's lockfile;
> `config.json` additionally pins the expected Claude Code CLI/runtime version
> surfaced by `doctor`; upgrades are PRs gated on the cross-ecosystem fixture
> suite.

As of PRDR-253 the second half refuses on all four paths that can spend —
`kernel/run.ts`, `cli/init.ts`, `cli/referee.ts`, and now `doctor --smoke`. The
first half refuses nowhere. `pinned.agent_sdk` has exactly one production
reader in the tree:

```
src/cli/doctor.ts:118    const pinned = loaded.config.pinned.agent_sdk;
```

It pushes a row and nothing reads the row again — the same shape PRDR-253 just
closed one field over, in the same function, forty lines apart.

## What is NOT wrong, measured rather than assumed

This is not "the SDK pin is fake", and the ticket would be wrong to say so:

- `package.json` carries `"@anthropic-ai/claude-agent-sdk": "0.3.258"` — exact,
  no range. The lockfile half of S-5 is real and npm enforces it.
- `PINNED_AGENT_SDK` in `src/init/config.ts` is a hand-written constant whose
  doc-block claims it "mirrors package.json's exact dependency" — and
  `tests/init/config-defaults.test.ts` reads `package.json` and asserts exactly
  that, so the claim is held. A bump that forgets the constant fails the suite.
- `docs/release-checklist.md` item 6 requires `pinned.agent_sdk` to equal
  package.json's dependency at every release.

Three mechanisms, all working. The gap is not in any of them.

## The gap

`ensureConfig` writes the pin once and never again — `if (existsSync(...)) return
"exists"`. So `pinned.agent_sdk` records **which Detent built this project's
config**, frozen at first init. `doctor`'s `installedSdk()` resolves the SDK from
Detent's own `node_modules`. The two values therefore answer different questions,
and they diverge the moment Detent itself is upgraded:

| | what it says |
| --- | --- |
| `config.pinned.agent_sdk` | the SDK the project was initialised against |
| `installedSdk()` | the SDK this Detent ships today |

After any Detent upgrade, every project initialised before it reports a
mismatch. The sessions then run — and the agent SDK is not an incidental
dependency: it is the process that enforces the S-2 tool-use hook, parses the
S-4 telemetry, and carries the permission modes. Containment rides it.

So a sweep reading this file sees a security-relevant version check that is
reported and not enforced, sitting beside three that are, and files a ticket.
This one. It will happen again, because **nothing in the tree says the
asymmetry is on purpose.**

## Why the asymmetry IS on purpose

The two pins guard different threats, and only one of them is the operator's to
get wrong.

`claude_code` names a binary on the user's `PATH`. The user upgrades it whenever
they like, with nothing vetting the new version against Detent at all. That is
precisely the unvetted-backend case S-5's "upgrades are PRs gated on the
cross-ecosystem fixture suite" exists to refuse, and why PRDR-181/251/253 made
all four paths stop. PRDR-251's recorded `pinned: "unknown"` trap is the cost of
that, knowingly paid.

`agent_sdk` names a dependency in Detent's own lockfile. It cannot move unless
Detent moves, and Detent cannot move without `docs/release-checklist.md` item 5
— "No green, no release — every version bump and every S-5 backend upgrade
re-runs it" — putting the new SDK through the N-7 self-build first. **The
vetting S-5 demands has already happened upstream, in the release that shipped
the SDK.** A project config re-litigating it adds nothing.

## Rejected: gate it like `claude_code`

Symmetry is the obvious fix and it is the wrong one. `ensureConfig` never
rewrites an existing config, so the first Detent upgrade would refuse every
`run`, `init` and `referee` in every project initialised before it, until a
human hand-edited `.detent/config.json` on each one. Every Detent release would
be a fleet-wide outage whose only remedy is editing the pin to whatever Detent
now ships — which is not a pin being honoured, it is a pin being rubber-stamped.

The alternative that makes gating survivable — having Detent update the pin
itself — is worse: a pin the pinned thing rewrites to match itself is
decoration. It is a non-goal above for that reason.

## Falsification (verification protocol, item 1)

Three mechanisms, three separate falsifications — and only the first fails on
the unmodified tree, because the other two are guards against a change nobody
has made yet. A guard that has never been shown to fire is decoration, so each
was fired deliberately.

**1. The message, against HEAD.** `tests/cli/doctor.test.ts -t PRDR-254`:

```
× ... > a mismatch names the cause instead of instructing Detent's maintainers
  → the cause: the config was written by a different Detent:
    expected 'MISMATCH: pinned 0.3.258, installed 0…' to contain
    'different Detent build'
  Received: "MISMATCH: pinned 0.3.258, installed 0.4.0
             (S-5 — upgrades are PRs gated on the fixture suite)"
```

**2. The oracle, against a tree with a new reader.** A `pinned.agent_sdk` read
spliced into `src/kernel/run.ts` beside the CLI pin check:

```
× the map is total over the src modules that mention the pin in code
  → a module that touches the agent-sdk pin declares its role in
    AGENT_SDK_PIN_SITES:
    + "kernel/run",
```

**3. The behavioural guard, against a tree where the pin gates.** The mismatch
wired into PRDR-253's `pinRefusal`:

```
× and a mismatch does not stop the session, which is what advisory means
  → and the smoke ran anyway (PRDR-254): expected [] to have a length of 1
    but got +0
```

The first placement of that third probe proved nothing and is worth recording:
set beside the agent-sdk check, `pinRefusal` is cleared moments later by the
`claude_code` check that resolves, so the test passed and the probe was silently
undone. Moved below both pin checks — where a real gate would sit — it fires.
A guard verified against a probe that could not reach it is exactly the
weak-test shape this branch keeps finding.

## Design

Say it, and hold it.

The statement belongs beside `PIN_CHECK_SITES` in `src/sessions/live.ts`, which
is where a reader arrives when asking which pins are enforced where — the map
answers for `claude_code` and is silent on `agent_sdk`, and silence is what this
ticket is about.

Holding it is the same idiom the map already uses: `tests/oracle/pin-parity.test.ts`
derives its verb list from the tree and fails on an entrypoint with no row. The
companion property is the negative one — no production module gates on
`pinned.agent_sdk` — so a future gate fails the oracle and its author has to
either change the claim or reconsider. A prose paragraph saying "advisory on
purpose" can rot; a test that fails when it stops being true cannot.

The third piece is the message. `doctor` currently renders:

> `MISMATCH: pinned 0.3.258, installed 0.4.0 (S-5 — upgrades are PRs gated on the fixture suite)`

The parenthetical is addressed to whoever maintains Detent. The person reading
it is an operator whose project was initialised against an older Detent, and it
tells them nothing they can act on. It should name the cause — this project was
initialised against a different Detent build — and say that the SDK it runs on
was vetted by that build's own release gate, so the row is informational.

## Cost of not doing it

Low and recurring: the next audit sweep re-files this ticket, and the reviewer
before it spends its budget re-deriving the argument above from the PRD. That is
the same cost PRDR-252 and PRDR-253 each paid, and the reason both have a
"Recorded, not fixed" section. This ticket is that section, promoted.

## What changed

`src/sessions/live.ts`: `AGENT_SDK_PIN_SITES`, three rows with roles rather than
checkers — `cli/doctor` reporter, `init/config` writer, `kernel/worstcase`
schema — under the doc-block carrying the argument above and the rejected
alternative with its cost. It sits directly beneath `PIN_CHECK_SITES` because
that is where a reader arrives asking which pins are enforced where, and silence
there is what produced this ticket.

`src/cli/doctor.ts`: the `agent-sdk-pin` mismatch detail rewritten for the
operator who reads it — naming the cause (the config was written by a different
Detent build and `init` never rewrites it), saying plainly that it is advisory
and nothing refuses on it, and ending with an action the reader can actually
take. The row stays `ok: false`: worth seeing, not worth refusing over. A
doc-block on the check points at the map.

`tests/oracle/pin-parity.test.ts`: totality over every `src/**` module mentioning
the pin in code, with comments and string literals stripped by the rules gate's
own `codeOnly`, plus the role counts. `tests/cli/doctor.test.ts`: the message,
and the guard that a mismatch still does not stop the smoke.

Two mechanisms, and each is honest about its half. The oracle cannot see whether
a reporter refuses — a role string is not behaviour — and the test that can see
it cannot see a reader added elsewhere in the tree. Neither is claimed to do the
other's job.
