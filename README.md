# Detent

Detent turns planning documents into merged, reviewed, test-gated code using
fresh, single-purpose Claude Code sessions driven by a deterministic kernel.

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
