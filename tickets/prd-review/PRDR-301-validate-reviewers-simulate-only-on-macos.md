---
id: PRDR-301
title: "VALIDATE's reviewers simulate only on macOS. S-1⁗ (PRDR-285) sandboxes a script with Seatbelt and turns simulation off on every other platform, so an operator on Linux, CI and an N-7 self-build on GitHub's Linux runners judge every invariant by reading. Linux gains the same sandbox through bubblewrap, proven by the same hostile fixture on a real Linux machine"
state: OPEN
severity: minor
category: capability
labels: ["prd-review", "specification-phase", "S-1⁗", "containment", "sandbox", "linux"]
surface: ["src/sessions/sandbox.ts", "src/sessions/sandbox-probe.ts", "src/sessions/sandbox-linux.ts", "src/init/validate-scratch.ts", "detent-prd-v3.md", "tests/sessions/sandbox.test.ts", "tests/sessions/sandbox-linux.test.ts"]
prd_refs: ["S-1‴", "S-1⁗", "SEC-4", "N-7"]
acceptance_criteria: ["On Linux the probe finds bubblewrap and offers each interpreter its canary proves, as on macOS: the canary must write its own directory, and must fail to write beside it and to reach a listener Detent opens. An escape turns simulation off, and so does a bubblewrap that cannot build its namespaces; each gives its reason.", "The hostile fixture of `tests/sessions/sandbox.test.ts` passes under bubblewrap, under node and python3. A script writes nothing outside its directory, reads nothing of the repository or the operator's home, signals no process outside the sandbox, reaches no network over TCP or UDP, and sees no variable of Detent's (SEC-4), while it may still do what a simulation needs.", "A run's limits hold as they do on macOS: 120 s of wall clock, 64 KiB of output and 128 KiB of source, and the tool says which limit stopped a run. Nothing a script starts outlives its run, nor a Detent that ends mid-run.", "Where bubblewrap is missing or refused, simulation stays off, and each round names what is missing, as it does today.", "The Linux cases run on a real Linux machine, and are skipped with their reason where bubblewrap cannot run, never silently. The ticket records a run on Ubuntu 24.04, whose AppArmor may restrict the unprivileged user namespaces bubblewrap needs.", "Falsifying test: on a Linux machine with bubblewrap, the probe at HEAD returns off (\"no sandbox is built for linux, only macOS's Seatbelt\") and the Linux hostile fixture cannot run. The ticket records the failure against HEAD."]
non_goals: ["Does NOT add a sandbox for Windows.", "Does NOT change the macOS sandbox, or what a script may do there.", "Does NOT install bubblewrap, or change a machine's user-namespace settings. It says what is missing."]
attempts: { fix: 0, hypothesis: 0, review: 0 }
links: ["PRDR-285"]
depends_on: ["PRDR-285"]
---

# PRDR-301 — a sandbox for Linux

## Where this came from

PRDR-285 built S-1⁗ on macOS alone, and recorded it as not fixed: Linux's bubblewrap is not
wired, since no Linux machine was at hand to test it on, and an untested sandbox is one in name
only. On 2026-09-27 the operator asked whether a Linux sandbox is required. It is not.
Specification decision 7 grants the sandbox where one exists, PRDR-285's criteria turn simulation
off where none does, and the operator's own runs are on macOS. The operator asked for it to be
filed.

## Problem

On every platform but macOS the probe returns off, "no sandbox is built for linux, only macOS's
Seatbelt", so VALIDATE's reviewers judge every invariant by reading. That holds for:
- an operator on Linux, under WSL, or in a devcontainer;
- CI, which runs on GitHub's Linux runners;
- an N-7 self-build, which runs there too.

Nothing regresses. VALIDATE on Linux works as it did at PRDR-284, and each round says why no
reviewer can simulate. But there, the class of defect simulation catches is caught by reading
alone: money that must balance, and a count that must stay whole. In ksarjs, simulation found a
rounding collision and confirmed two money majors.

## Design

To be settled when it is built; each is a call for the operator's veto then:
- **bubblewrap** (`bwrap`), which builds a sandbox from unprivileged Linux namespaces, run by the
  runner `runSandboxed` already is, with its argument list in place of Seatbelt's profile.
- **Mounts.** The system and the interpreter's install read-only, the script's own directory
  writable, a fresh `/proc` and `/dev`, and nothing of the repository or the operator's home.
- **Namespaces.** A new network namespace, so no network, local included. A new PID namespace,
  and `--die-with-parent`. Everything a script starts then ends with its run's first process, and
  the run ends with Detent. That closes on Linux what PRDR-285 records as open on macOS: a
  script that waits outlives a Detent that ends mid-run. Whether fork stays refused there, for
  parity with macOS's one process per run, is a call to make.
- **Environment.** Cleared, then `PATH`, a UTF-8 locale, and `HOME` and `TMPDIR` set to the
  script's own directory (SEC-4).
- **Limits.** The same runner, so the same wall clock, output limit and CPU limit. Linux also
  enforces a memory limit on a process, which macOS does not. Whether to set one is a call to
  make.
- **The probe.** The same canaries, run through bubblewrap. A missing `bwrap`, and a kernel or
  AppArmor policy that refuses its namespaces, each turn simulation off with bubblewrap's own
  words.

## The test bed

A container usually cannot build user namespaces unless it runs privileged, so a test there would
prove a sandbox no operator runs. A Linux virtual machine, such as Multipass's Ubuntu 24.04, meets
what an operator and GitHub's runners meet, AppArmor's policy included. The falsification and the
mutation battery run there. Whether bubblewrap works on GitHub's runners without that policy being
lifted is to be checked. A CI step that lifts it would test a machine operators do not have.
