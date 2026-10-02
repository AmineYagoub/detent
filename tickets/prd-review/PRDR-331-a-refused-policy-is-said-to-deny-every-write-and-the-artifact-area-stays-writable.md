---
id: PRDR-331
title: "SEC-3″ says a policy holding a glob picomatch cannot match safely denies every write, and the guard's deny message says no write is allowed under it. A write to the session's own artifact area is still allowed: the guard decides that area first (B-2″), before it reads the policy, since nothing there is matched against a glob, and PRDR-330's built note says so. Its acceptance criterion 5, the PRD's paragraph and the message say more than the code does. The words will say what the guard decides, and tests will hold it"
state: DONE
severity: minor
category: consistency
labels: ["prd-review", "doc-claim-drift", "SEC-3″", "P5", "B-2″"]
surface: ["detent-prd-v3.md", "src/sessions/guard.ts", "hooks/dist/detent-hook.cjs", "tests/sec/glob-hazards.test.ts"]
prd_refs: ["SEC-3″", "P5", "B-2″", "SEC-3"]
acceptance_criteria: ["SEC-3″'s paragraph in the PRD says what the guard decides under a policy that holds a glob picomatch cannot match safely or as written: every write into the worktree is denied, on both skins, and a write to the session's own artifact area stays allowed, since the guard decides that area before it reads the policy and matches no glob there (B-2″).", "The guard's deny message says that no write into the worktree is allowed under such a policy until the plan or config that supplied it is fixed. It no longer says that no write is allowed.", "A test on both skins, the decision the SDK backend registers and the bundled hook, holds that under such a policy a write into the worktree is denied, with the message's words. A test holds that a write to the session's own artifact area is allowed, in-process: the bundled hook's policy names no artifact area, so that skin has none (amended while building, vetoable call 3).", "Falsifying test, against HEAD: the message case fails, since HEAD's message says that no write is allowed. The artifact-area case passes against HEAD, and holds the decision this ticket keeps."]
non_goals: ["Does NOT change what the guard decides. The artifact area stays writable: nothing there is matched against a glob, and a session under such a policy can still write its verdict and its signals, `falsified.json` among them.", "Does NOT edit PRDR-330. A DONE ticket's record stands, and this ticket records the correction to its acceptance criterion 5."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-330", "PRDR-180"]
depends_on: ["PRDR-330"]
---

# PRDR-331 — what the guard denies under a policy it cannot honour, said as the code does it

## Where this came from

On 2026-10-02 the user asked for a review of the work other sessions had landed on
`feat/specification-phase`. The review of PRDR-330 (`534593b`) found one place where the words
say more than the code.

## Problem

- **What the words say.**
  - The PRD's SEC-3″ paragraph: "a policy file holding one denies every write on both skins (P5)".
  - PRDR-330's acceptance criterion 5: "The guard refuses every write under a policy that holds
    such a glob, on both skins".
  - The guard's deny message (`src/sessions/guard.ts`): "No write is allowed under a policy the
    guard cannot match safely and as written".
- **What the guard does.** `guardToolUse` decides the session's own artifact area first (B-2″,
  PRDR-180). A mutating call there is allowed before `policyHazard` is read. Probed in-process on
  2026-10-02, with `+(*)` among the policy's protected globs:

```
write into the worktree: deny — DENY: this session's policy cannot be honoured: `+(*)` makes picomatch repeat …
write to the artifact area: allow — review.json is this session's own artifact area (B-2″)
```

- **PRDR-330's own built note is right:** "The session's own artifact area is decided before any
  glob and stays writable." The PRD's paragraph, the acceptance criterion and the message did not
  follow it.
- **Why it matters.** It is the defect class Detent exists to catch: a sentence in the present
  indicative that the code implements only in part. An operator who reads the PRD, and then finds
  a session's artifact written under a refused policy, has two records that disagree.

## Design

- **Keep the decision, correct the words.** The hazard is a match that does not end, or a glob read
  as its own spelling. Neither reaches the artifact area, which is matched against no glob. A
  session under such a policy can still write its verdict and its signals there (`falsified.json`,
  `surface_request.json`), and that is how it tells the operator anything.
- **The PRD's paragraph** says that every write into the worktree is denied on both skins, and that
  the session's own artifact area, decided before the policy and matched against no glob, stays
  writable.
- **The message** says that no write into the worktree is allowed until the plan or config that
  supplied the glob is fixed.
- **Tests** hold both decisions: the denial on both skins, and the artifact area in-process, the
  one skin whose policy names one (vetoable call 3).

## Building it

- `detent-prd-v3.md`: SEC-3″'s sentence.
- `src/sessions/guard.ts`: the deny message.
- `hooks/dist/detent-hook.cjs`: rendered again by `npm run plugin`, since the message is bundled.
- `tests/sec/glob-hazards.test.ts`: under a refused policy, a write into the worktree, in-process
  and through the bundle, and a write to the artifact area, in-process.

### Vetoable calls

1. **The artifact area stays writable.** The other way to make the words true is to deny it too.
   Then a session under a refused policy could not write its verdict or say what stopped it, and
   nothing would be safer, since nothing there is matched against a glob.
2. **PRDR-330 is not edited.** Its record stands, and this ticket is the correction.

Added while building:

3. **The artifact-area case runs in-process only.** The bundled hook builds its policy from
   `.detent/active_surface.json`, which names a surface and protected globs, with the hook's
   working directory as the work root (`src/plugin/hook.ts`). It names no artifact area, so on that
   skin there is no such write to allow, and a refused policy denies every write into the worktree,
   which is what the message says. The SDK backend's policy names one: `request.artifactOut` for
   `init`, the session's runs directory for `run`. Acceptance criterion 3, the design and the title
   said both skins for the artifact area, and were amended to say this.
4. **The PRD's sentence says the hook's policy names no artifact area.** Without it, "stays
   writable" would read as a claim about both skins.

## Falsification (verification protocol, item 1)

The message case should fail against HEAD, whose message says that no write is allowed. The
artifact-area case should pass there: it guards the decision this ticket keeps. Run against HEAD
(`30e5645`), whose guard, bundle and PRD were unchanged, the two message cases failed and the
artifact-area case passed:

```
× PRDR-330 the decision the SDK backend registers does not match such a glob > under a refused policy a write into the worktree is denied, and the message says the worktree (PRDR-331)
  → expected 'DENY: this session\'s policy cannot b…' to contain 'No write into the worktree is allowed…'
✓ PRDR-330 the decision the SDK backend registers does not match such a glob > under a refused policy the session's own artifact area stays writable, since it is decided before the policy and matches no glob (PRDR-331)
× PRDR-330 the bundled hook does not match such a glob > under a refused policy a write into the worktree is denied, and the message says the worktree (PRDR-331)
  → expected 'DENY: this session\'s policy cannot b…' to contain 'No write into the worktree is allowed…'
Tests  2 failed | 1 passed | 18 skipped (21)
```

## Mutation battery

Each mutant was applied to a snapshot copy of `src/sessions/guard.ts` or
`hooks/dist/detent-hook.cjs`. Then `tests/sec/glob-hazards.test.ts` and
`tests/plugin/hook.test.ts` were run, and the file was restored from its copy and checked with
`cmp`. All six were killed. Each was killed by a behaviour test, and also by the bundle's
staleness test:

| Mutant | Killed by |
|---|---|
| guard: the old message | the in-process message case |
| bundle: the old message | the bundled hook's message case |
| guard: the artifact area under the policy | the artifact-area case |
| guard: an artifact write abstains | the artifact-area case |
| guard: the policy check dropped | five in-process cases, PRDR-330's four among them |
| bundle: the policy check dropped | three of the bundled hook's cases, PRDR-330's two among them |

## Gates

- `npm run lint`, `typecheck`, `parity:check`, `prompts:check`, `rules:check`, `tickets:check`: pass.
- `npm test`: 217 files, 2,433 passed and 2 skipped (2,435), on PRDR-331's filing (`30e5645`).
- `npm run plugin`: after the render above, it wrote nothing that changed, and the bundle's
  staleness test passes.

## What changed

- `src/sessions/guard.ts`: the deny message says that no write into the worktree is allowed under
  a policy the guard cannot match safely and as written. The comment above the check says that the
  artifact area was decided above (B-2″), matches no glob, and stays writable.
- `hooks/dist/detent-hook.cjs`: rendered again by `npm run plugin`. The message's line is the only
  line that changed.
- `detent-prd-v3.md`: SEC-3″ says that under a policy holding such a glob the guard denies every
  write into the worktree on both skins, that the session's own artifact area stays writable
  (decided before the policy, matching no glob), and that the plugin hook's policy file names no
  such area.
- `tests/sec/glob-hazards.test.ts`: three tests. Under a refused policy, a write into the worktree
  is denied with the message's words, in-process and through the bundled hook. A write to the
  session's artifact area is allowed, in-process.

## Recorded, not fixed

- **No test reads the PRD's sentence.** As with every PRD paragraph, review is what holds it to
  the code. The message and the decisions it describes are held by the tests above.
