---
id: PRDR-331
title: "SEC-3″ says a policy holding a glob picomatch cannot match safely denies every write, and the guard's deny message says no write is allowed under it. A write to the session's own artifact area is still allowed: the guard decides that area first (B-2″), before it reads the policy, since nothing there is matched against a glob, and PRDR-330's built note says so. Its acceptance criterion 5, the PRD's paragraph and the message say more than the code does. The words will say what the guard decides, and a test on both skins will hold it"
state: OPEN
severity: minor
category: consistency
labels: ["prd-review", "doc-claim-drift", "SEC-3″", "P5", "B-2″"]
surface: ["detent-prd-v3.md", "src/sessions/guard.ts", "hooks/dist/detent-hook.cjs", "tests/sec/glob-hazards.test.ts"]
prd_refs: ["SEC-3″", "P5", "B-2″", "SEC-3"]
acceptance_criteria: ["SEC-3″'s paragraph in the PRD says what the guard decides under a policy that holds a glob picomatch cannot match safely or as written: every write into the worktree is denied, on both skins, and a write to the session's own artifact area stays allowed, since the guard decides that area before it reads the policy and matches no glob there (B-2″).", "The guard's deny message says that no write into the worktree is allowed under such a policy until the plan or config that supplied it is fixed. It no longer says that no write is allowed.", "A test on both skins, the decision the SDK backend registers and the bundled hook, holds that under such a policy a write to the artifact area is allowed and a write into the worktree is denied, with the message's words.", "Falsifying test, against HEAD: the message case fails, since HEAD's message says that no write is allowed. The artifact-area case passes against HEAD, and holds the decision this ticket keeps."]
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
- **A test on both skins** holds both decisions.

## Building it

- `detent-prd-v3.md`: SEC-3″'s sentence.
- `src/sessions/guard.ts`: the deny message.
- `hooks/dist/detent-hook.cjs`: rendered again by `npm run plugin`, since the message is bundled.
- `tests/sec/glob-hazards.test.ts`: a write to the artifact area and a write into the worktree,
  under a refused policy, in-process and through the bundle.

### Vetoable calls

1. **The artifact area stays writable.** The other way to make the words true is to deny it too.
   Then a session under a refused policy could not write its verdict or say what stopped it, and
   nothing would be safer, since nothing there is matched against a glob.
2. **PRDR-330 is not edited.** Its record stands, and this ticket is the correction.

## Falsification (to run against HEAD when this is built)

- The message case fails against HEAD, whose message says that no write is allowed.
- The artifact-area case passes against HEAD. It guards the decision this ticket keeps.
