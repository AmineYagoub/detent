# Interface contracts and symbol intelligence — implementation plan

**Status:** proposed, not yet filed as tickets
**Prerequisite (N-6):** two PRD-review tickets land before any code —
`PRDR-120` (interface contracts) and `PRDR-121` (symbol-intelligence adapter).

---

## 1. What this fixes

The first full-product `init` on ksar-cloud produced 41 tickets for its walking-skeleton
slice. Its review found eight defects that survived a revision round. Read them together and
they are one defect wearing five costumes — **two tickets disagreeing about a named thing that
neither of them owns**:

| Observed finding | The unowned name |
|---|---|
| `t-s01-016` contradicts the terminal-state contract `t-s01-002` fixes | symbol `v1.TerminalStates()` |
| `t-s01-011`'s criterion needs terminate semantics its description only half-defines | symbol `ErrTerminate` |
| `t-s01-023` derives an image name `t-s01-022`'s validator would reject | symbol `BuildSpec.Validate` |
| `t-s01-027` wires a pipeline from the `Deps` composition `t-s01-017` builds | symbol `Deps` |
| `t-s01-024` adds a module requirement to a file three other tickets also edit | file `controlplane/go.mod` |

Detent already models coupling two ways: `depends_on` (ticket ids the planner guessed) and
`surface` (file globs). Neither expresses *"`t-002` defines `TerminalStates()` and `t-016`
depends on what it means"*. So nothing mechanical can check it, and the job falls to a
reviewer noticing — which is why the same class reappears in every slice, and why at execution
time a session cheerfully rewrites what an earlier ticket established.

The same gap is what a human hits in ordinary use: *"this ticket is blocked by another"* and
*"this ticket destroyed what the last one built"* are the run-time face of a plan that never
wrote the interface down.

---

## 2. Design A — contracts as declared ownership

### 2.1 The idea

Every ticket declares what it **provides** (names it brings into existence, with their
meaning) and what it **consumes** (names it depends on). Detent then computes the provider
index and checks it **mechanically, with no model session**.

This is deliberately not a new artifact to keep in sync. The contract *is* the union of the
tickets' own declarations, so it cannot drift from them.

### 2.2 Vocabulary — a closed kind set

Following the house pattern for `INTERRUPTS` and `PLAN_FINDING_TAGS`, the kinds are closed and
adding one is a spec change:

```ts
export const CONTRACT_KINDS = ["symbol", "config", "file", "route", "table", "event"] as const;
```

- `symbol` — `controlplane/internal/v1.TerminalStates`, an exported function, type or constant
- `config` — `KSAR_BUILD_TIMEOUT`, an environment or config key
- `file` — `controlplane/go.mod`, a shared file whose contents several tickets contend for
- `route` — `GET /v1/traefik/config`, an HTTP surface
- `table` — `placements`, a database table or migration
- `event` — `cp.status`, a queue subject or topic

Six kinds cover every observed finding. The set stays small on purpose: a vocabulary the
planner cannot hold in mind is a vocabulary it fills in badly.

### 2.3 Schema

On the drafted ticket and on the written ticket:

```ts
const contractRef = z.strictObject({
  kind: z.enum(CONTRACT_KINDS),
  id: nonEmptyString,
  /** Provides only: what the name MEANS. The consumer session receives this verbatim. */
  note: z.string().default(""),
});

provides: z.array(contractRef).default([]),
consumes: z.array(contractRef.omit({ note: true })).default([]),
```

`MappedDraftKeys` in `plan.ts` gains both, so the compile-time totality guard (PRDR-101's
lesson) refuses to build until the writer copies them through.

### 2.4 The four mechanical checks

Run in `planStage` after the whole-plan review, before `writePlan`:

1. **Unowned consumption.** A consumed name no ticket provides → `dependency` finding naming
   the consumer. *Catches: five tickets each assuming someone else assigns the port.*
2. **Duplicate ownership.** Two tickets providing the same name → `coherence` finding naming
   both. *Catches: `t-004` and `t-005` both defining `run()`.*
3. **Ordering.** The provider is not the consumer itself nor reachable from it through the
   blocker graph → **the edge is added automatically**, and noted. *Catches: `t-018` needing a
   config key `t-027` adds downstream.*
4. **Shared-file contention.** More than one ticket providing the same `file:` name, or
   consuming a file no ticket provides → `coherence` finding. *Catches: four tickets editing
   `go.mod`.*

Check 3 is the one that changes the product. It **derives real dependency edges from real
coupling**, instead of trusting the planner's guess. That is the direct fix for a ticket being
claimed before the work it needs exists.

### 2.5 What this does not catch, stated plainly

`t-s01-023` derives an image name that `t-s01-022`'s validator rejects. Contracts make the
*coupling* explicit — 023 consumes 022's validator, so the edge exists and the reviewer is
pointed at the pair — but the regex mismatch is semantic and stays a reviewer's judgement.

Contracts convert **structural** coherence defects into mechanical failures. Semantic ones
remain the review's job, now with the right two tickets in front of it. On the ksar evidence
that is four of five.

### 2.6 The execution-time half

`referee-context.ts` already hands the implement session `acceptance_criteria` and
`non_goals`. It gains:

- the ticket's own `provides`, as the interface it must create;
- for each `consumes`, the **provider's `note`** — the meaning of the name, written by the
  ticket that owns it.

A session building `t-016` therefore receives *"`TerminalStates()` = `[failed, stopped]`,
fixed by `t-002`"* rather than having to infer it. This is the context enhancement, sourced
from the plan rather than from a memory store.

The reviewer receives the same, and gains one question it can answer definitively: *did this
diff provide what the ticket declared?*

---

## 3. Design B — Serena as an optional symbol-intelligence adapter

[Serena](https://github.com/oraios/serena) (MIT, LSP-backed, 40+ languages, MCP) supplies
`find_symbol`, `find_referencing_symbols`, `find_implementations` and `symbol_overview`.

### 3.1 Three constraints, discovered before writing any code

**Its editing tools bypass Detent's containment.** Serena also ships `replace_symbol_body`,
`insert_after_symbol`, `safe_delete` and `rename`. Those write files *from inside the MCP
server process*, so they never pass through the `Write`/`Edit` tool calls the D-21 hook
inspects. Granting them would silently void per-ticket write containment (S-2′, SEC-3).
**Only the read tools are ever allowlisted.** This is a hard rule, enforced by an explicit
allowlist and a test that fails if an editing tool name appears in it.

**Its memory system must stay off.** Serena persists knowledge across sessions. Detent's
sessions are deliberately memoryless — artifacts are the interface (P2), prompt prefixes are
byte-identical (S-6), and replay is content-addressed (C-8). A hidden per-project memory would
make two identical runs diverge. Serena documents that it can be disabled; the adapter
disables it and asserts so.

**It is the project's tooling, not Detent's.** D-4/F-2 say Detent binds to what a project has
rather than owning it. So Serena is *discovered and optional*, exactly like a verification
slot: absent, every stage still works and says so once.

### 3.2 Where it earns its place

1. **Contract verification gate.** After an implement session, assert each declared
   `symbol:` provide actually exists via `find_symbol`. A ticket claiming to provide
   `v1.TerminalStates` that did not create it fails **mechanically**, not by review opinion.
   This closes the loop between §2's declarations and the code.
2. **Blast radius before a change.** `find_referencing_symbols` tells a session who depends on
   what it is about to alter — the missing check behind *"it destroyed what another ticket
   built"*.
3. **Review evidence.** The reviewer gets the reference list for changed symbols, so scope
   judgements rest on facts.
4. **Brownfield planning.** On an existing repo, seed `provides` from the real symbol table
   instead of inventing it. (Worth nothing on greenfield — ksar-cloud has no code yet.)

### 3.3 Installation and discovery — Detent never installs it

**Detent installs nothing, and this changes that for nothing.** `AWAIT_SETUP_CONSENT` today
only ever prints a message and exits; there is no install path anywhere in the codebase, and
Serena does not earn one:

- It is a **global** tool (`uv tool install`), not a project dependency. Installing it would be
  Detent modifying the user's machine rather than binding to the project (D-4, F-2).
- It is a third-party MCP server that gets **read access to a private codebase**. That is a
  decision its owner makes deliberately, not a side effect of `detent init`.
- Nothing depends on it. Phase 1 works without it; Phase 2's gate is skipped with a note.

So: **discovered, never installed**, and probed exactly the way a verification command is.

```json
"symbols": { "enabled": true, "command": "serena-agent" }
```

Three states, one behaviour each:

| Config | Command found | Behaviour |
|---|---|---|
| unset (default) | — | Everything runs. The §3.4 reminder may appear, once. |
| `enabled: true` | yes | Read-only tools join the implement and review sessions. |
| `enabled: true` | no | `AWAIT_SETUP_CONSENT`, naming the pinned command to run. A stop is right here: the user asked for it and it is broken. |
| `enabled: false` | — | Never probed, never mentioned again. |

The probe is a health check, not a version sniff: run the command's own status verb, confirm
it speaks MCP, confirm the read tools are present. A command that exists but cannot serve is
treated as absent, with the reason in the note — the same discipline as a rejected binding
(V-1).

The version is **pinned in config** beside `agent_sdk` and `claude_code`, because an MCP
server reading the repo is supply chain (SEC), and an unpinned "latest" is not something
Detent should recommend into a `.detent/config.json` it wrote.

### 3.4 The reminder — earned, not periodic

A tool nobody installs is a tool nobody benefits from, so Detent should say something. But
this codebase just spent a whole ticket (PRDR-119) removing noise that buried the signal, and
a nagging banner is the same mistake in a different costume.

**The rule: Detent mentions it only when it can prove it would have helped, and it says what
it cost.** Every trigger is a real thing that happened in the run just completed:

- a `coherence` or `dependency` finding whose subject was a `symbol:` contract — a coupling a
  reference lookup could have grounded mechanically;
- a `symbol:` provide that could not be verified because the gate was unavailable;
- an X-4′ falsification at run time — a session discovering a dependency the plan missed,
  which is exactly what `find_referencing_symbols` prevents.

No triggers, no message. Ever.

Shown at `PRESENT` beside the findings, and in `detent report`, **at most once per invocation**
— never per ticket, never per session:

```
Symbol intelligence is not configured. 3 findings in this plan were symbol-level
couplings Detent could have checked mechanically instead of leaving to review:
  t-s01-016 → v1.TerminalStates      t-s01-027 → Deps      t-s01-011 → ErrTerminate

  Install:  uv tool install -p 3.13 serena-agent==<pinned>
  Enable:   "symbols": { "enabled": true }   in .detent/config.json
  Silence:  "symbols": { "enabled": false }  — never mentioned again
```

Three properties make this a reminder rather than nagging: it names **what it cost you this
run**, it is **actionable in one line**, and it tells you **how to switch it off permanently**
in the same breath. A user who declines once is never asked twice.

---

## 4. Order, and why

Contracts ship **first and alone**. They need no external dependency, they work on greenfield,
and they are what makes the Serena gate meaningful — verifying declarations requires
declarations. Serena without contracts is a nicer search tool; contracts without Serena still
fix the plan.

The walking skeleton is §2's checks running end to end over ksar-cloud's existing plan.

---

## 5. Tickets

### Phase 1 — contracts (no external dependency)

**T-170 · schema and vocabulary**
`CONTRACT_KINDS`, `contractRef`, `provides`/`consumes` on `planDraftSchema` and `ticketSchema`,
both added to `MappedDraftKeys`.
*AC:* the totality guard fails to compile if the writer drops either field; the skeleton parses
through its own schema; an unknown kind is refused.

**T-171 · the validator**
`src/init/contracts.ts` — build the provider index; emit the four checks of §2.4 as
`PlanReview["findings"]`; return the dependency edges check 3 derives.
*AC:* pure function over drafted tickets, no I/O, no session; unowned, duplicated, late and
contended names each produce their named finding; derived edges never introduce a cycle
(reuses `breakCycles`).

**T-172 · wire into PLAN**
Call after `wholePlanReview`, before `writePlan`; merge findings into the presented set; apply
derived edges to `depends_on`.
*AC:* replaying ksar-cloud's `s01` reproduces the reviewer's structural findings; the
presentation shows derived edges as their own line so a human sees what Detent added.

**T-173 · planner prompt**
Declare `provides`/`consumes`; the note carries meaning, not restatement. REVIEW_PLAN judges
whether declarations match the criteria.
*AC:* re-hashed manifest; a golden-path test asserts the six kinds appear in the prompt.

**T-174 · contracts reach the sessions**
`referee-context.ts` sends the ticket's `provides` and, per `consumes`, the provider's `note`.
*AC:* an implement session's inputs contain the consumed contract and its owner's note; the
review's inputs contain the same; an unresolvable consume degrades to a note, never a crash.

### Phase 2 — Serena (optional adapter)

**T-175 · the adapter**
Discover Serena; config-gated (`config.symbols: { enabled, command, pinned }`); read-only tool
allowlist; memory disabled; absent → one note and full function. Detent never installs it
(§3.3); `enabled: true` with the command missing raises `AWAIT_SETUP_CONSENT` naming the
pinned command.
*AC:* a test fails if any editing tool name is in the allowlist; absent Serena changes no
outcome; the allowlist appears in the session spec, so D-21 still governs every write; no code
path anywhere executes an install; a command that exists but cannot serve MCP is treated as
absent with the reason noted.

**T-178 · the earned reminder**
Count the triggers of §3.4 during a run; render at most one message per invocation, at
`PRESENT` and in `detent report`, naming the specific findings it would have caught.
*AC:* zero triggers renders nothing; `symbols.enabled: false` renders nothing under any
circumstances; the message names real ticket ids from this run, never a generic pitch; a test
asserts it cannot fire twice in one invocation.

**T-176 · contract verification gate**
After a green gate, assert declared `symbol:` provides exist; a missing one is a review
finding on that ticket.
*AC:* a ticket declaring a symbol it did not create is caught without a model judging it;
skipped with a note when Serena is absent.

**T-177 · blast radius in context**
`find_referencing_symbols` for the symbols a ticket consumes, into the implement and review
inputs, bounded in size.
*AC:* bounded output; absent Serena omits the section.

---

## 6. How we know it works

We are not guessing at fixtures. ksar-cloud's `s01` cache holds **41 real tickets and eight
real findings a fresh reviewer produced**, and attempt one's cache holds a different 31 and
fourteen. Both become test fixtures:

> The validator, run over the drafted plan, must independently reproduce the structural
> subset of the findings the review found — the duplicate owner, the late provider, the
> unowned name — with no model in the loop.

If it does, the mechanism has replaced judgement with code for that class, and the evidence is
a real plan rather than a constructed one. If it does not, the vocabulary is wrong and we
learn that for the price of a unit test.

---

## 7. Risks

**The planner fills the fields lazily.** Garbage declarations produce garbage checks.
*Mitigation:* the reviewer judges declarations against criteria (T-173); every check emits a
finding rather than an error, so a bad declaration degrades to noise, never a failed init.

**Vocabulary creep.** Six kinds become sixteen. *Mitigation:* closed set, spec change to
extend, same discipline as the interrupt set.

**Contracts are predictions on greenfield.** Nothing exists yet to verify against, so Phase 1
checks internal consistency only. That is exactly the defect class observed, so it is enough —
and Phase 2's gate makes them facts as the code lands.

**Cost.** Declarations lengthen every drafted ticket; a 41-ticket slice already emits ~130K
output tokens. Expect perhaps 10% more drafting cost, against removing a class of defect that
currently costs a generation each at run time.

---

## 8. Explicitly not doing

- **An agent memory layer** (mem0, Letta, Zep). What Detent needs remembered is the plan and
  the code; both are already durable artifacts. Zep's own benchmark reports >600K tokens per
  conversation. Wrong problem, large bill.
- **A multi-agent orchestrator** (Conductor, Foremerge, Grite). Detent is one, with a stronger
  admission model.
- **Vendoring a code knowledge graph.** Serena's LSP backend already answers the questions we
  have, under a licence we can rely on.
- **Semantic contract checking.** Whether two rules over one value agree stays the reviewer's
  judgement (§2.5).
