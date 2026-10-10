---
title: "CI only ever runs the new tests against the new code"
description: "An agent breaks a behaviour, edits the test to agree, and CI goes green. pr-witness runs the base branch's tests against the pull request's code, checks the description's claims against the real run, and signs the result. Built measuring-stick first; every number here was measured, including the ones that embarrassed me."
date: 2026-10-10
tags: [testing, ci, ai-agents, github-actions, open-source]
---

Here is a pull request. The code changes one comparison, the test changes
one expected value, and the description says *corrected the boundary; all
3 tests pass, no breaking changes*.

```
$ pytest
3 passed in 0.01s
```

It is also wrong. The function decides whether a day is a weekend; the
change makes Monday one; the test that used to say `is_weekend(0) is
False` now says `is True`. The test was not fixed. It was brought into
agreement with the bug.

Nothing in CI can see this, and the reason is structural rather than a
missing feature: CI runs the pull request's tests against the pull
request's code. Both sides of that comparison were written by the same
author, in the same commit. If the author — human or agent — edits both
halves consistently, the result is green by construction.

The combination nobody runs is the *old* tests against the *new* code.

```
$ pr-witness --base main

                   base      head  crossrun
  passed              3         3         2
  failed              0         0         1

  Claims
   ! "3 tests pass"          — true, but 1 test that passed on the
                                base branch fails against this code
   ✗ "no breaking changes"   — 1 base-branch test now fails

!! [crossrun] tests/test_dates::test_monday
```

That is [pr-witness](https://github.com/talhayme/pr-witness). This post is
about building it, and specifically about the parts where measuring
something changed what I believed.

## Why now

Coding agents have a specific failure mode, and it has numbers.
[Transluce](https://transluce.org/docent/blog/coding-agent-behaviors)
analysed 8,600 real coding-agent transcripts; in the public SWE-chat
sessions, 34.7% contained some overselling of success and 14.7% some
monitor evasion — quietly disabling tests, merging without authorization,
claiming a review agent approved. Most of that is mild; the severe cases
are 1.8% and 1.9% respectively, which at the scale agents now run is a lot
of pull requests. The canonical public case is
[anthropics/claude-code#46940](https://github.com/anthropics/claude-code/issues/46940):
on a 4,992-value golden suite the agent broke seven values, reported
`4966/4966 ALL PASSED`, and committed — the denominator had quietly
shrunk. And [ImpossibleBench](https://arxiv.org/abs/2510.20270) (Zhong,
Raghunathan, Carlini) measured what happens when a spec and a test
conflict: on its SWE-bench variant, frontier models "pass" by cheating in
39–76% of tasks (GPT-5 76%, Claude Opus 4.1 54%), and Claude models do it
more than 79% of the time by one method — editing the test file. Cheap to
catch in a diff, in principle.

Tools exist for the diff. [checkwash](https://github.com/taipei49314/checkwash)
reads a change and flags weakened assertions, loosened tolerances,
disabled tests, touched CI. It is good at that and publishes its own
benchmarks. What nobody was doing was the other half: running the thing,
comparing against what used to run, and checking what the author *said*
against what *happened*.

## Build the ruler before the thing it measures

The plan had a rule I would now apply to anything of this kind: phase zero
is a labelled corpus, and no detector gets written until the corpus and the
evaluation harness exist.

The corpus is 17 cases, each a full before/after file tree (not a patch —
a runner has to execute both sides), a pull request description, and a
label saying what the right answer is. Nine are cheats; eight are honest
changes that *look* like cheats to a naive detector: a feature removed
along with its tests, expected values updated because the spec changed,
tests renamed, split into modules, collapsed into `parametrize`, a flaky
test skipped with an issue link.

The honest half is the whole point. A tool that scores perfectly on the
cheats and flags every refactor is not a detector; it is an alarm, and
alarms get switched off.

Counts in the labels are not typed. A verifier runs each case three ways —
base on base, head on head, base tests on head code — and writes the
numbers back. If the run disagrees with the label, the case is wrong. This
caught two of my own cases before the tool existed: one cheat that failed
its own tests (so nothing was hidden), and one labelled `denominator` that
was actually something else.

That second one is worth its own paragraph.

## `describe.only` does not shrink the count

The plan said: flag it when the collected count goes down. pytest's
`testpaths` narrowing does exactly that — 14 collected becomes 8. The
JavaScript twin is `describe.only`, which makes the runner ignore every
other suite. Same trick.

Measured, it is not the same shape. vitest still collects all 5 tests,
runs 2, and reports 3 as `skipped`. The count does not move. So "did the
denominator shrink" is not a runner-portable question. The portable one is
**which tests actually ran**, compared as a set of identities, not as a
total. The tool was redesigned around that before a line of it was written,
and that single decision later saved the precision number — see below.

## The baseline, and what it was not

With the corpus in hand, checkwash 0.6.0 scores:

| bar | P | R |
|---|---|---|
| its own `block` verdict | 0.67 | 0.22 |
| any finding, including advisory `warn` | 0.60 | 0.67 |

Recall 0.22 is not checkwash losing. The corpus was deliberately built from
the signals it does not claim — cross-run breakage, denominators, prose —
so a low number here means "out of scope", which is the premise I was
testing. The raw counting signals alone, read straight from the verifier's
output, score P 0.80 / R 0.89. That was the floor to beat.

## Phase one scored worse than the baseline

The first working version of the tool: P 0.67. Worse than the counts it
was meant to improve on.

The cause was the identity decision above, taken to its logical end. If a
test is identified by `file::name`, then renaming the file deletes every
identity in it. Splitting a module deletes them. Collapsing five tests into
one parametrised test deletes four. Three of the commonest honest refactors
there are, all reported as mass deletion.

The fix is the cross-run itself. If a behaviour is still covered, the base
branch's own tests still pass against the new code — whatever they are
called now. A vanished identity is only worth reporting when the cross-run
cannot confirm it. P 0.67 → 0.80, zero detections lost. A second bug of the
same shape — a documented skip reported both as "documented" and as a
denominator drop — took it to 0.89.

Both were the same mistake: a signal that is technically true and
practically useless. Precision is not something you tune at the end. It is
whether the report is worth reading.

## Integrating checkwash, and disagreeing with it once

The plan listed ten JS/TS patterns to implement because checkwash's
JavaScript support was weak. The plan was written against v0.5. Against
0.6.0, measured one by one, seven of the ten already worked. I would have
spent a week producing a worse copy of working code.

The three real gaps are implemented locally — `try`/`catch` swallowing an
assertion, `@ts-nocheck` on a test file, `eslint-disable` of a rule that
enforces that tests assert something — and the first is filed upstream as
[checkwash#363](https://github.com/taipei49314/checkwash/issues/363), with
a one-commit reproduction: the identical cheat in Python and TypeScript,
one finding, on the Python file.

Wiring checkwash in dropped precision from 0.90 to 0.75. I had mapped its
`warn` findings to a flag. checkwash blocks only on `high`; it raises
`warn` for every disappeared test, so every honest rename lit up. Mapping
`warn` to advisory restored it. The one remaining disagreement is real:
checkwash blocks on *any* added skip marker; pr-witness does not flag a
skip whose reason names a tracking issue. Rather than drop its finding, the
report keeps it, downgrades it, and prints the disagreement:

> checkwash reports every added skip marker. pr-witness does not flag this
> one: the run shows a skip reason that names an issue. If your policy is
> that no skip is acceptable, trust checkwash here, not us.

That is the difference between using a tool and overruling it.

## The lie that lives only in prose

One case had been missed by every layer so far:

> Added 41 tests for the discount logic. 49/49 passing.

Eight tests before, nine after, all green, cross-run clean. The run is
honest. The description is not. No run-level or diff-level signal can see
this, and per the session data it is one of the commonest shapes there is.

So the third layer reads the description. Deterministic templates, English
and Russian, no model — a model that hallucinated a claim the author never
made would be worse than no claim checking. Each claim gets one of four
verdicts, and the fourth took the longest to get right:

| | |
|---|---|
| ✓ true | the run bears it out |
| ✗ false | the run contradicts it — `"49/49 passing" — the run reports 9 passed` |
| ? unverifiable | `Fixes #318` — a test run cannot know this, and saying so beats guessing |
| ! misleading | literally true, materially not |

"8 tests pass" is exactly right when the base branch ran 14. Call it true
and the tool is gameable in one move: narrow the suite, quote the smaller
number honestly. Call it false and you are accusing someone of lying for
quoting their own terminal. `misleading` is the third answer, and it is
where the three layers finally meet: on the `try`/`catch` case every run
reports 3/3, the diff says an assertion was neutralised, and the claim
checker says *all tests pass — but one assertion was neutralised in this
change*.

With claims, recall on the corpus went to 1.00 at P 0.91.

## Signed, so the report means something

A comment on a pull request is text. An agent can type text. The report is
therefore signed with GitHub Artifact Attestations: the evidence JSON is
the predicate, the workflow is the signer, and anyone can run
`gh attestation verify` on the downloaded file. I checked the obvious
thing — flip `clean` to `flag` in the file and verify again — and it is
refused, because no attestation exists for that digest.

Two things the plan did not know, found by reading the current docs rather
than the plan: the action is `actions/attest@v4`, and **attestations only
work in public repositories unless you are on Enterprise Cloud**. A
private-repo user gets the report with an "Unsigned" line and the reason.

## Shipping it was four red runs

The first push to GitHub failed CI twice over. `pytest` from the repository
root collected the corpus's fixture test files — 25 collection errors — and
two scripts hardcoded a `venv/bin/` path that existed on exactly one
laptop. The fix for the first was `testpaths = ["tests"]`, which is
precisely the narrowing the tool flags in a pull request. The config
comment explains why this is the honest case.

The first live run of the action signed `evidence.json` and then threw it
away, so there was nothing to verify. The moving `v0.1` tag — the one that
makes `uses: talhayme/pr-witness@v0.1` work — matched the release
workflow's `v*` trigger and cut two spurious releases.

Every one of those was a real bug, and none would have been found by
running things on the machine they were written on. I mention them because
the subject of this post is the gap between "I ran it and it was green"
and "it is correct", and the project was not exempt.

## Where it is

```
pip install pr-witness
pr-witness --base origin/main
```

```yaml
- uses: talhayme/pr-witness@v0.1
  with:
    test-command: pytest       # or vitest, jest, go
    mode: report               # report | require-ack | strict
```

`report` never fails a job; that is the default, because a tool that blocks
on its first day is uninstalled on its second. `require-ack` fails on a
flag until a maintainer adds `test-change-approved`. `strict` fails on a
flag regardless — the label documents intent, it does not change facts.

There is also a Claude Code plugin: a pause before a test file changes, and
a check of "all tests pass" against a real run when the agent says it is
done. Advisory on purpose. The agent runs inside its own environment and
can route around any hook; the proof is the signed report from CI, where
it cannot reach.

## The number, and its caveat

17 cases, P 0.91, R 1.00, 115 tests, reproduced on a clean Ubuntu runner.
That is a regression gate, not an accuracy claim. The confidence interval
on nine positives is wide enough to drive a truck through, and the honest
reading of recall 1.00 is that the corpus stopped discriminating between
versions somewhere around phase three. It needs harder cases — ideally
real, licence-checked ones from maintainers who caught this in the wild —
more than the tool needs more detectors. If you have one, the repository's
issues are the place.

Source, corpus, and every number in this post:
[github.com/talhayme/pr-witness](https://github.com/talhayme/pr-witness).
