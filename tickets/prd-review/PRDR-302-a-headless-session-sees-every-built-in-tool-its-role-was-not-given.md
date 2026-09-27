---
id: PRDR-302
title: "A headless session sees every built-in tool, whatever its role was given. S-1‴ sets tools per role and the plugin's agent files bind them, but the SDK backend passes a base set for the planning roles alone (C-4⁵), and its default mode approves a read-only shell command before the allowlist is consulted, so an `audit` session whose allowlist is Read, Grep, Glob and WebSearch ran `ls` and `git log` on tabachir's first live init"
state: DONE
severity: major
category: defect
labels: ["prd-review", "S-1", "S-1′", "S-1‴", "S-2‴", "ARCH-2", "containment", "doc-claim-drift", "live-run"]
surface: ["src/sessions/sdk.ts", "src/sessions/guard.ts", "src/init/session.ts", "detent-prd-v3.md", "tests/sessions/role-tools.test.ts"]
prd_refs: ["S-1", "S-1′", "S-1‴", "S-2‴", "C-4⁵", "ARCH-2", "D-28″"]
acceptance_criteria: ["Every session the SDK backend launches is given, as its base set of built-in tools, the built-in tools its allowlist names and no others: a rule's specifier names its tool (`Write(//x)` is Write, `Bash(git add:*)` is Bash, `WebFetch(domain:d)` is WebFetch), and an MCP tool is no built-in. A read-only role therefore has no shell, and what the base set leaves out the model never sees, as C-4⁵ made true for the planning roles.", "A spec that names its own base set keeps it (the planning roles' `tools`, C-4⁵).", "An MCP server's tools are untouched: the symbol server's read tools and a VALIDATE reviewer's scratch tool stay reachable where the allowlist names them.", "The two drivers agree: a headless session's base set is the built-in names of `toolsForRole`, which the plugin build writes into each agent file's `tools`, and a read-only session's rule for its own artifact adds `Write`.", "S-2‴'s doc-block, which says an abstention returns the decision to the allowlist, says what else decides it: the permission mode approves a read-only command before any allow rule is read, so the base set is what binds.", "Falsifying test: the options built for an `audit` session, whose allowlist is Read, Grep, Glob, WebSearch and its artifact's write rule, carry a base set of exactly those built-ins. Against HEAD they carry none. The ticket records the failure against HEAD."]
non_goals: ["Does NOT deny a write role's read-only shell commands. An implement session is given Bash for `git add`, `git rm` and `git commit`, and the mode's approval of a read-only command inside the repository stays as it is.", "Does NOT change any role's allowlist, or grant any role a tool it lacks.", "Does NOT change the plugin driver: its agent files already bind each role's tools."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-067", "PRDR-122", "PRDR-292", "PRDR-281"]
depends_on: []
---

# PRDR-302 — a headless session sees every built-in tool its role was not given

## Where this came from

The first live `detent init` on the tabachir test copy (2026-09-27, binary `350155b`). AUDIT's
survey session runs on the `audit` role, whose allowlist is the research role's surface (S-1‴):
`Read`, `Grep`, `Glob`, `WebSearch`, and the one rule that writes its artifact. Its transcript
shows 32 `Read` calls and two `Bash` calls, both of which ran and returned output:

```
22:04:16Z Bash  wc -l docs/prd/PRD.md; wc -c docs/prd/PRD.md
22:18:07Z Bash  ls -la && ls -la docs docs/contributing docs/decisions docs/prd && git log --oneline -n 15
```

## Problem

S-1‴ gives each role "one per tool set, because routing and tools are both set per role", and
S-1′ says a read-only session's "read-only-ness is the allowlist plus the D-21 hook". Neither is
what the headless backend builds:

- **The allowlist does not bind a read-only command.** `buildOptions` (`src/sessions/sdk.ts`) runs
  every session in the SDK's `default` permission mode with the role's `allowedTools`. The
  containment hook abstains on a call that names no path (S-2‴, PRDR-122), and its doc-block says
  abstaining "returns the decision to the allowlist, where it belongs". The SDK's order is hooks,
  deny rules, ask rules, the mode, then allow rules, and the `default` mode approves a read-only
  shell command at the mode's step. So no allowlist entry was needed for `ls` or `git log`.
- **Only the planning roles have a base set.** PRDR-292 found 2,846 read-only Bash calls in planner
  sessions whose allowlist named no Bash, and gave `planner` and `plan_review` a base set of
  `Read`, `Grep`, `Glob` and `Write` (C-4⁵): "what it leaves out the model never sees". Every other
  session, `init`'s `audit`, `spec_write` and `spec_review` and every one of `run`'s roles, is
  given the platform's whole tool set.
- **The drivers disagree (ARCH-2).** The plugin driver's agent files bind each role's tools in
  their frontmatter: `detent-review` has `Read, Grep, Glob`, `detent-research` adds `WebSearch`,
  and `detent-implement` has the write tools and three git verbs. A review under the headless
  driver has a shell; under the plugin driver it has none.

Nothing escaped the repository in this run: both commands were read-only, inside the work root.
What is wrong is that the roles' tool sets are stated, per role, in the PRD and the plugin, and the
headless backend applies them to two roles of twelve.

## Design

The base set is derived where every session's options are built, from the allowlist the role
already has: `buildOptions` passes `tools` as the built-in tools the allowlist names, each rule's
specifier stripped and MCP tools left out, unless the spec names its own. One change covers both
drivers' headless sessions and `init`'s, and the planning roles' `PLANNER_TOOLS` is the same set,
derived.

## Recorded, not fixed

- **A write role keeps the mode's approval of read-only commands.** An implement or fix session is
  given Bash for its git verbs, so its base set holds Bash, and the mode still approves a read-only
  command there. Denying every shell command but the three verbs would be the guard's to do, and is
  a change to what a write session can do, not to what it is given.
- **Reads outside the work root through the shell were not probed.** Whether the mode's approval
  covers a read-only command on a path outside the session's directory is the SDK's rule; a
  read-only role no longer has a shell to ask with.

## Building it

Every session the SDK backend launches now has, as its base set of built-in tools, the built-in
tools its allowlist names and no others. The PRD records it as S-1⁵, placed after S-1⁗, and S-1′,
S-1‴ and S-2‴ point to it.

The acceptance criteria, as built:
1. **The base set is the allowlist's** (`buildOptions`, `src/sessions/sdk.ts`):
   `tools: spec.tools ?? builtinTools(spec.allowedTools)`. `builtinTools` strips each rule's
   specifier (`Write(//x)` is Write, `Bash(git add:*)` is Bash, `WebFetch(domain:d)` is WebFetch)
   and leaves out an MCP server's tools. An `audit` session is given Read, Grep, Glob, WebSearch
   and Write, and no shell; a `spec_write` session with a surface, Read, Grep, Glob, Edit and
   Write; a `run` review, Read, Grep, Glob and Write; an implement session, those with Edit and
   Bash for its git verbs.
2. **A spec's own base set is kept:** the planning roles' `PLANNER_TOOLS` (C-4⁵), which is also
   what their allowlist names, and any other a caller sets.
3. **MCP tools are untouched:** a symbol server's read tools and a VALIDATE reviewer's scratch tool
   stay in `allowedTools` and in `mcpServers`, and the base set does not govern them.
4. **The drivers agree:** the roles' lists move from `src/sessions/guard.ts` to
   `src/schemas/roles.ts`, below every layer, and the guard re-exports them. The kernel gives a
   `run` session `toolsForRole`, the list the plugin build writes into each agent file's `tools`;
   it had kept its own copy, which ARCH-1's import rule forced, called it "the referee's advisory
   copy" of a set it said "the SDK backend composes", and the copy had lost S-3⁵'s `git rm`.
   (A `git rm` still ran headless: the hook answers `allow` for one it clears, which ends the
   evaluation, so the gap was in the lists, not in what a session could do.)
5. **S-2‴'s doc-block** (`GuardDecision`, and the abstention in `guardToolUse`) now says the mode
   decides before the allow rules and approves a read-only command no rule names, so the base set
   is what binds.
6. **The falsifying test** is `tests/sessions/role-tools.test.ts`'s first case, on the spec an init
   launch of `audit` hands its backend. Against HEAD the options carry no base set (below).

### Vetoable calls

1. **The base set is derived from the allowlist,** not from `toolsForRole(spec.role)`. What a
   session is given per session (its artifact's write, a declared surface's Edit and Write, a
   round's scratch tool) is in its allowlist already, and a role list would need each added back.
2. **`PLANNER_TOOLS` stays,** though it now equals what the planners' allowlist names: C-4⁵'s tests
   hold it by name, and a spec may still name a set of its own.
3. **The lists move to `src/schemas/roles.ts`,** not a new module: the role sets they read are
   there, and `schemas/**` is the one layer both drivers may import.
4. **A write role keeps Bash in its base set,** and with it the mode's approval of a read-only
   command: its git verbs are Bash, and a guard that denied every other shell command is a change
   to what a write session can do, which the ticket's non-goals leave alone.
5. **`doctor --smoke` now has no built-in tools,** since its allowlist names none; its prompt already
   says not to use any.

## Falsification (verification protocol, item 1)

The final `tests/sessions/role-tools.test.ts` was copied into a `git archive` of HEAD `350155b` in
the scratchpad and run there, against HEAD's source. Six of its seven cases fail, each on the base
set HEAD does not pass:

```
 × AC 6: an `audit` session is given Read, Grep, Glob, WebSearch and its artifact's Write, and no shell
   → expected [] to deeply equal [ 'Glob', 'Grep', 'Read', …(2) ]
 × each rule's specifier names its tool, and an MCP tool is no built-in
   → expected undefined to deeply equal [ 'Read', 'Write', 'Bash', 'WebFetch' ]
 × a session that declares a surface is given Edit and Write for it, and still no shell (S-1‴)
   → expected [] to deeply equal [ Array(5) ]
 × an MCP server's tools stay reachable where the allowlist names them
   → expected [] to deeply equal [ 'Glob', 'Grep', 'Read', 'Write' ]
 × `run`'s sessions too: a review has no shell, and an implement session has its git verbs' Bash
   → expected [] to deeply equal [ 'Glob', 'Grep', 'Read', 'Write' ]
 × the two drivers agree: each agent file's tools are the headless base set of its role's list
   → review: expected [] to deeply equal [ 'Glob', 'Grep', 'Read' ]
 Test Files  1 failed (1)
      Tests  6 failed | 1 passed (7)
```

The one that passes holds that the planning roles keep their own base set, which HEAD has since
C-4⁵. Its second assertion, a spec whose own set differs from its allowlist, was added after the
archive run, for SD4 below.

## Mutation battery (verification protocol, item 2)

9 mutants, one defect each, run against the new suite and the seven around the lists (the guard,
the plugin's agents, the audit, plan-review and DECIDE roles, the install run, and the SDK's
options), and restored from a snapshot, never by `git checkout`; at the end all three files matched
it. They covered:
- **The base set:** none but the planners'; a rule's specifier kept; an MCP tool made a built-in;
  the spec's own set overridden by the allowlist's.
- **The one list:** the kernel's old copy restored.
- **The lists themselves:** `audit` given no web; `spec_write` given the write tools; `git rm`
  dropped; the read-only roles given the write tools.

All 9 were killed on the first pass.

## Gates

`npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check` and
`test` all pass. The first full run failed two cases, each for a reason of its own: the plugin's
hook bundle, which includes the guard, was stale until `npm run plugin` rebuilt it, and the next
ticket's test, written early, cited that ticket while it was OPEN and was set aside for its own
commit. Run again: 2152 tests passed and 2 skipped, across 185 files; the seven new cases are the new suite's. `npm run plugin` builds, and rewrites
`hooks/dist/detent-hook.cjs`.

## Found along the way

- **`SessionSpec`'s doc-blocks** (`src/sessions/backend.ts`): `allowedTools` was "advisory until
  T-046 wires real enforcement", which T-046 did long ago, and `permissionMode` was "`plan` for the
  read-only roles", which S-1′ changed to an artifact-less session alone. Both say what is built.
- **`tests/plugin/agents.test.ts` is titled "the SDK allowlist and the frontmatter are one truth",**
  and compared the frontmatter with `toolsForRole`, which `run`'s sessions did not use. It is true
  now that the kernel reads the same list.
- **The live run's two shell calls were read-only and inside the work root.** Nothing escaped; the
  defect is that a role's tool set was stated and not applied.
