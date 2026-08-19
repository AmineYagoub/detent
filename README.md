# Detent

Detent turns planning documents into merged, reviewed, test-gated code using
fresh, single-purpose Claude Code sessions whose every consequential move is
admitted by a deterministic referee.

## Why Detent

The methodology layer is crowded and good — spec-kit, Superpowers, BMAD and
their peers produce excellent planning documents. Those documents are
Detent's *input*. Detent is the referee underneath that layer: the part that
makes an autonomous run auditable, budgeted, and contained, whichever way the
plan was written.

- **An auditable state machine.** Every ticket moves through a deterministic
  ~20-state machine, and every admitted transition is journaled to
  `transitions.jsonl` — the run's ground truth, not a chat log.
- **Hard budgets that route to a human.** Per-ticket attempt and spend
  ceilings, a run-level spend cap you set yourself, and a metered single
  billable path — a ceiling never auto-retries; it presents a decision.
- **Verification bound to your project, with drift halts.** Detent binds to
  the repo's own test/lint/build commands by executing them, and halts for
  re-baselining if they change mid-run.
- **Per-ticket write containment.** A deny-enforced hook holds every session
  inside its ticket's declared surface — allow-rules cannot shadow it.

Detent maintains itself under the same rules: the N-7 self-build gate —
Detent building its own walking skeleton from its own PRD — is a permanent
release requirement, not a demo.

## Install

As a Claude Code plugin (interactive driver, hooks, and the bundled referee):

```bash
claude plugin marketplace add AmineYagoub/detent
```

```bash
claude plugin install detent@detent
```

For development, load the checkout directly with
`claude --plugin-dir /path/to/detent`. The headless driver below is the same
referee under a deterministic loop — for CI and unattended runs.

## The golden path

Two commands. That is the whole public workflow.

```bash
detent init
```

```bash
detent run
```

`init` prepares a project — it discovers your planning documents and
verification entrypoints, generates an implementation plan as tickets, and
obtains your approval. `run` executes the approved plan through a budgeted
implement → test → review loop with a research-gated escalation ladder and
explicit human gates.

Both commands resume from checkpoints when re-run. If something interrupts —
a missing document, an ambiguous binding, a question the plan cannot answer
without you — Detent stops, tells you exactly what it needs, and picks up
where it left off when you run the same command again.

## What Detent will never do

- **Write to your base branch.** Work happens on a `detent/run-<id>` branch.
- **Own your tooling.** Detent binds to your project's own test, lint and
  build commands; `.detent/` never contains your project's configuration.
- **Transition on a claim.** Only artifacts and exit codes move a ticket
  forward — never a model's assertion that something worked.
- **Redefine a gate mid-run.** If a verification command changes while a run
  is in flight, Detent halts and asks you to re-baseline.

## Exit codes

`run` exit codes are public API:

| Code | Meaning |
|---|---|
| `0` | plan complete |
| `10` | human-gated items remain |
| `2` | not ready (no or unapproved plan, binding drift) |
| `1` | error |

## Plumbing

Documented, scriptable, and never required on the golden path:
`detent status`, `detent report`, `detent doctor`, `detent approve <id>`,
`detent requeue <id>`, `detent verify sync`.

## Status

Under construction. The execution kernel, verification adapter and session
layer are built; the `init` pipeline is in progress. See
`docs/implementation-plan.md` for the ticket-by-ticket state.

## License

Not yet chosen — see OQ-2 in `detent-prd-v2.md`. Detent is not yet published.
