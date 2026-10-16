---
title: "Three models, nine apps, and a verifier: what an agent finds when it has to prove it"
description: "I turned Antagonist's findings into a benchmark: nine open-source web apps in Docker, 46 known defect causes, and a scorer that replays every proof with no model in it. Three runs each for Claude Sonnet 5.5, Claude Haiku 5.5 and GPT-5.4 mini. The verifier kept precision near perfect; recall stayed below one in five."
date: 2026-10-16
tags: [evals, ai-agents, testing, benchmarks, inspect]
---

[Antagonist](https://github.com/talhayme/antagonist) is an agent skill that
attacks a running web app and reports a defect only when a script with no model
in it agrees. On nine open-source apps it confirmed 40 defects. That raised the
obvious next question: how much of that is the method, and how much is the
model running it?

To answer it I needed a fixed setup that any model could be dropped into. So I
built one.

## The setup

[Antagonist Bench](https://github.com/talhayme/antagonist-bench) runs on
[Inspect](https://inspect.aisi.org.uk/). Each sample is one app, started fresh
in Docker at the exact commit from the original trial. The agent gets the
Antagonist method as its instructions and four tools that only reach that app:
look at it in a clean browser, prove a finding, call the app's own HTTP API,
and reset it. It cannot read the source.

When it is done, it submits findings. The scorer replays each proof against a
fresh copy of the app. A finding counts only if the proof replays. A judge model
then has one narrow job: to say which known defect a confirmed finding
describes.

The ground truth started as the 37 defect causes from the original trial. The
models added nine more, which I come to below. Each sample gets about 60 turns.

## Results

Three runs per model, nine apps, 46 known causes:

| model | recall (mean of 3) | range | confirmed, real | confirmed, not a defect |
|---|---|---|---|---|
| Claude Sonnet 5.5 | 0.18 | 0.13–0.21 | 30 | 0 |
| Claude Haiku 5.5 | 0.17 | 0.12–0.20 | 23 | 2 |
| GPT-5.4 mini | 0.00 | 0.00 | 0 | 0 |

Four things stand out.

**The verifier keeps precision high, but not perfect.** Sonnet's 30 confirmed
findings were all real. Haiku's two misses were the same thing twice: in the
budgeting app, an income entry without a category is not counted as income.
That reproduces every time, and it is how the app is designed: income is
decided by category everywhere. A verifier can prove that the hostile journey
behaves differently from the ordinary one. It cannot prove that the difference
is a defect. That last step is still the model's judgement, and the two models
differ there.

**Recall is low.** The best model proves about one known cause in six per run.
All runs of all models together found 23 of the 46. In one app, a collaborative
markdown editor, no model found anything at all. The original trial ran each app in a coding
agent with no turn limit, so the two numbers are not directly comparable, but
the gap is large.

**One run would have told the wrong story.** After the first full run, Haiku
was ahead of Sonnet. Over three runs, each model's results spread over about 0.08,
far more than the 0.01 between the two means. If you compare agents on a task like
this, run each more than once.

**GPT-5.4 mini did not engage.** On every app it stopped after one to three
minutes, usually with a sentence like "I can't confirm a defect responsibly",
and submitted nothing. On the budgeting app it never got past the login
screen, although the task gave it the password.

## The models found defects the trial missed

Twelve confirmed findings matched nothing in the ground truth. I read each one
against the app's source before deciding. Two were the by-design income rule
above and one was a repeat; the other nine were distinct, real defects, though
in two of them the model's explanation of the cause was wrong.

One of them is a habit tracker whose Export leaves out the journal, a feature
added a day after export was written. The other eight are in apps whose
maintainers have not heard about them yet, so they stay out of this post and
out of the public ground truth until they have. All nine are in the scoring,
marked with the model that found them.

The lesson for anyone building a benchmark out of one tool's findings: the
ground truth is a floor, not a ceiling. A model that finds something new is
otherwise scored as if it found nothing, so every confirmed-but-unmatched
finding needs a person to read it.

## Two things the harness had to stop measuring

Both of these produced wrong numbers before they were fixed.

The first version asked the agent to paste its proofs into the final answer.
Haiku proved three real defects in one app and lost all three to one extra
brace in 2,700 characters of retyped JSON. The benchmark was measuring
transcription. Now `prove` keeps each confirmed proof under an id, and the
agent submits ids.

The second was the budget. I capped each sample at a million tokens, which
sounds generous until you count: cached tokens count too, and each turn re-sends
the whole conversation. That is about 30 turns. A run that hits the cap ends
before it submits, so Sonnet's five confirmed findings in one app scored zero.
The budget is now counted in turns, the agent is told when it has about a dozen
left, and a diagnostic counts proofs that were confirmed but never submitted.

## What it costs

With prompt caching, a full run of nine apps costs about $0.40 on Haiku 5.5 and
about $5 on Sonnet 5.5. Everything in this post, including the false starts,
cost about $21.

## Limits

Nine apps and three runs per model are enough to see the shape, not to rank
models finely. One judge model does the matching; I checked its matches by hand
during calibration and read every finding it could not match. Most of the ground truth is not public yet: 28 of the 46
causes wait until the apps' maintainers have heard about them, so the public
files alone give different numbers from the ones above. And the agent runs one fixed method;
a different method would score differently, which is part of the point.

The benchmark, the ground truth, the proofs and the results are at
[talhayme/antagonist-bench](https://github.com/talhayme/antagonist-bench).
