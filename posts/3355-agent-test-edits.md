---
title: "3,355 times a coding agent edited a test"
description: "SWE-chat publishes real Claude Code sessions with the commits they produced. I pulled every commit where the agent changed a test and the code together, ranked them, ran seven end to end against pr-witness, and found the one thing the cross-run could not see."
date: 2026-10-11
tags: [testing, ci, ai-agents, datasets, open-source]
---

The [first post](/blog/ci-only-runs-new-tests/) about pr-witness ended with
a confession: the evaluation corpus was seventeen cases I wrote myself, and
a detector scored on its author's cases is a regression gate, not evidence.
This is what happened when real pull requests arrived.

## Where real test edits come from

The obvious source was SWE-bench. The `SWE-bench/experiments` bucket holds
the final patch of every submission, 500 instances each, so I pulled three
frontier submissions — Claude, GPT, Gemini, same scaffold — and counted
how many patches touched a test file. **Seven of 1,500.** Frontier agents
on SWE-bench almost never edit tests: the prompt tells them not to and the
harness overwrites any test edit before grading, so there is nothing to
gain. Those seven were useful — honest expectation changes, labelled
against the maintainers' own test patches, and they produced the `review`
verdict — but as a source of what agents *do* to tests they are thin.

Then [SWE-chat](https://huggingface.co/datasets/SALT-NLP/SWE-chat) appeared:
real Claude Code sessions on real repositories, with the commits they
produced, the full diff of each commit, and a per-file record of whether
the agent or the human wrote the change. 62,333 commit rows, 707
repositories, ODC-BY.

Of 32,143 unique commits, **10,933 change a test file and a non-test file
in the same commit**. In 2,781 of them a test file was written by the agent
alone; in 1,181 more, by the agent and the human together. Keep the
open-source licences and that is **3,355 agent-written test edits** with
code to run them against. SWE-bench gave me seven.

## What the edits do

I fetched the test-side diff of every one of the 3,355 through the GitHub
API and sorted them by what the diff does to tests that *already existed* —
new test files are scaffolding, not hidden tests, and a deleted file is the
strongest signal there is.

| what the commit did to existing tests | commits |
|---|---|
| removed more assertions than it added | 235 |
| added a real skip marker (`pytest.skip(`, `it.skip(`, `.only(` …) | 58 |
| deleted a test file outright | 66 |
| any of the above | 911 |

The skip number was 558 the first time. The regex matched the bare words
`skip` and `todo`, which are *data* in half the test suites in the world
(`status_category: 'todo'`); the top of the first skip shortlist was
entirely that. Framework markers only, and it is 58. A ranking is a reading
order for a human, and a human has to read it.

A second kind of noise: a Kotlin repository that moved from JUnit
assertions to Kotest came out as "89 assertions removed, 0 added", because
`shouldBe` is not on my list. Static counting of assertions is a heuristic
with a vocabulary, and the vocabulary is never complete. The point of
pr-witness is that the run does not need one.

## Seven, end to end

I picked seven across the classes — assertions removed, skips added,
expected values changed, tests deleted — read each diff, wrote a label,
and ran them in a sandbox: clone the repository, check out the commit,
install it, and run `pr-witness` on the commit against its parent with the
network off. Labels say two things: what the tool *should* say (`flag`,
`review`, `clean`), and separately whether I think the edit was honest,
which is the thing the tool is not asked to judge.

**Five of seven match** — a number to distrust, for the reason in the
update at the end of this post. Here are the two that mattered most.

### "fix: resolve test suite failures"

A commit whose message says what it is. The project's security tests check
that pre-commit hooks are configured and installed. The agent loosened the
configuration assertions to accept either the old stage names or the new
ones:

```diff
-        assert "stages: [commit]" in content, "No commit stage hooks configured"
+        assert "stages: [pre-commit]" in content or "stages: [commit]" in content, (
```

and replaced the assertions that hooks *are installed* with
`pytest.skip("pre-commit hooks not installed")`, six times.

Honest? Probably. pre-commit renamed its stages; whether hooks are
installed is a fact about the machine, not the code. But it is also,
exactly, a failing suite made green by editing the tests. And pr-witness's
first run on it said **`clean`**.

Twice, for two different reasons, and both are now in the tool.

The first run collected 87 tests on the base branch and passed 0 — the
project imports `pandas` and `datasets` and declares neither, so every test
errored at setup, on base, on head and in the cross-run alike. Same failure
on both sides, nothing to compare, verdict `clean`. That is now
`base_broken`: a base where every test fails is *no evidence*, which is not
the same thing as no findings. With the imports supplied by hand: base
58/87, head 80/87. Twenty-two tests red on the base branch and green now.

And the cross-run saw nothing — because the cross-run only ever looked one
way. It asks: did a test that *passed* on the base branch *fail* against
the new code? A test that was already red on base is not in that set. A
failing suite made green by editing the tests was invisible to the one
check built to catch test edits.

The fix is one more question the same three runs can answer. A test that
was red on base and is green now: does its **old version** still fail
against the **new code**? If so, the code change did not fix it — the test
edit did. That is `greened_by_test_edit`, it is a `review`, and on this
commit it names all twenty-two.

### The contract change

The second commit makes a library's `run()` raise on failure instead of
returning a failed status, and rewrites fourteen test files to match:

```diff
-        assert result.status == RunStatus.FAILED
+        with pytest.raises(FailError):
```

Base: 391 of 442 pass. Head: 460 of 460. Fifty-one tests red on the base
branch, green after — written ahead of the implementation, by the look of
it — and `greened_by_test_edit` names all fifty-one. Honest, deliberate,
and exactly what a reviewer should be shown with the old and new assertion
side by side. The tool said `flag` anyway, because checkwash rated a new
`except Exception:` in one test file as high, and pr-witness passes a
static high through when the run cannot speak to it. That is the one miss
I would argue about rather than fix.

### What cleanup looks like, and what replacement looks like

Two of the seven deleted tests together with the function they tested — a
`describe('entityColor')` block in one, `classifyAttachmentType` in the
other. The run sees this cleanly: the old test file no longer loads against
the new code, or the old tests fail with *is not a function*. The thing
they tested is gone. `clean`, both times, matching the label.

The seventh looked the same to the run and was not. A commit titled
"reconcile extractor with notebook TOA method" deleted three tests that
built a synthetic HDF5 file and ran the extractor end to end, and added two:
one checks the timing arithmetic, the other asserts that extraction *fails*
when an unavailable package is absent — "full extraction is exercised in the
CANFAR image, not here". The deleted tests imported a helper the commit also
removed, so the old file no longer loads: from the run's point of view,
identical to cleanup. What the run cannot see is that the extractor itself
is still there and nothing tests it any more.

I call this *replacement*: delete the real test, add a different one. It is
the one class of test edit the cross-run does not catch, because every run
the tool can do — old tests on old code, new on new, old on new — comes out
consistent with "the subject was removed". A static check does see it — the
shortlist already asks whether the symbols the deleted tests called still
exist in the code — and that is the next finding to build. But I want it
said plainly here first: the cross-run has a structural limit, this is
where it is, and it took a real commit to find it.

## The score, and what it means

Synthetic corpus, three verdicts: 17/17. SWE-bench real cases: 6/6.
SWE-chat: 5/7, both misses understood. Every finding the tool gained this
week — `review`, `greened_by_test_edit`, `tests_removed_still_passing`,
`base_broken`, the bun runner's file paths, "a whole-suite claim is
unverifiable against a restricted run, not false" — came from a specific
real commit and is listed next to it in the
[corpus README](https://github.com/talhayme/pr-witness/tree/main/corpus/real/swechat).
The seventeen synthetic cases stopped changing the tool by phase three.
Seven real ones changed it nine times.

That is the actual lesson, and it is not about agents. A detector built on
its author's examples converges on its author's imagination. The first
afternoon with other people's commits found the question the tool had
never asked — *did the test edit make it pass?* — and the question it
cannot answer. I would rather know both.

## Two notes on method

**The data is read-only.** Nothing was written to any repository; the
corpus references `owner/repo` and a commit SHA, fetches the code under its
own licence at run time, and names no one — SWE-chat's sessions carry
usernames, and none appear. The labels are mine and say so; where
SWE-bench had the maintainers' own test patch to label against, SWE-chat
has a human reading a diff, and the README does not pretend otherwise.

**The 5 GB file took my laptop down twice.** `commits.parquet` is 5 GB
because the attribution column carries the full text of every file version.
pyarrow kept whole row groups resident; DuckDB's `memory_limit` does not
cover its parquet read buffers and peaked at 8 GB under a 3 GB limit. Limits
set inside a program are promises. The run that worked was a container with
a kernel-enforced 2 GB cap, one row group per child process, a killed child
recorded as a skipped group — 60 to 430 MB for the whole pass. The wrapper
is `eval/sandbox/safe-run.sh` in the repository, with the rules it came
from, and the same sandbox is what ran the seven commits.

## Update, the next day: the same tool on commits it had not seen

Everything above has a flaw I named in the first post and then repeated:
the seven commits were picked by eye, and the tool was changed after almost
every one. A score on cases you fitted the tool to is not a score.

So I did it properly once. A script selected seventeen more commits by a
written rule. I labelled each from its diff and committed the labels. Then
I ran them with the source frozen — nothing in the tool changed until all
seventeen were done.

Twelve produced evidence; four ran vacuously, their suites needing services
the sandbox does not have; one would not install.

**Seven of twelve.** Not five of seven, not six of seven — seven of twelve,
and every miss was the tool's, not the label's and not the environment's.

It is worse than the fraction. The tool said `flag` four times, and all
four commits were honest. Two were flagged for a two-line edit to
`CLAUDE.md`, which a rule inherited from checkwash treats as an agent
tampering with its own constraints — in a repository developed with an
agent, that file changes all the time. One was flagged for *adding* three
integration tests guarded by `skipif(..., reason="OPENAI_API_KEY required")`:
my skip check compared skipped sets and never asked whether the test had
existed before. One was flagged because a default voice changed from
`rachel` to `matilda` and thirty-two expectations followed it. The fifth
miss went the other way: pytest abandons a session when one file fails to
import, so a refactor that broke two old test files hid the rewritten
assertions in eight others.

`review` — "a human should read this, here are the old assertion and the
new one" — was right four times out of four.

And no commit in the batch was dishonest, so on real data I still cannot
say whether the tool catches a cheat.

Where the misses came from matters as much as how many there were. None of
the four false flags came from the cross-run. Three were ratings inherited
from checkwash and passed through unchanged; one was my skip check. In two
of the four, the cross-run's own finding — correct, at `review` — was
already in the report, underneath the flag. And in the eleven cases where
the cross-run ran to completion, what it reported agreed with the label
every time. The idea this tool exists for held up on commits it had never
seen. What failed was the layer around it that decides how loudly to speak.

Those four causes are fixed in 0.3.1, and the twelve now agree with their
labels, which means nothing: they are the cases the tool was just changed
to agree with. The replacement finding I promised above is in the same
release (`coverage_replaced`), and it turns the seventh case of this post
into a match — also a fitted one. The only numbers here worth quoting are
the frozen ones: 7 of 12, `review` 4 of 4, `flag` 0 of 4.

What I would tell someone installing it today: run it in report mode and
read what it marks for review — that part has earned it. Hold off failing
builds on `flag` until that layer has passed a frozen batch of its own.

The protocol, the selection record, the labels as committed before the runs
and the write-up of every miss are in
[BATCH1.md](https://github.com/talhayme/pr-witness/blob/main/corpus/real/swechat/BATCH1.md).

---

pr-witness 0.3.1 is on [PyPI](https://pypi.org/project/pr-witness/) and the
[GitHub Marketplace](https://github.com/marketplace/actions/pr-witness);
the corpus and every number above are in the
[repository](https://github.com/talhayme/pr-witness). SWE-chat is by
SALT-NLP, ODC-BY; thank you for publishing the commits and not just the
conversations.
