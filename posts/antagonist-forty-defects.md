---
title: "An agent that tries to break your app, and has to prove it"
description: "Coding agents test the happy path and say it works. Asked to look for bugs, they report ones that are not there. Antagonist is an agent skill built around the second problem: a suspicion becomes a finding only when a script with no model in it agrees. On nine open-source apps it had not seen, it confirmed 40 defects, five of which lose data or take the app down."
date: 2026-10-13
tags: [testing, ai-agents, qa, open-source, agent-skills]
---

Ask a coding agent whether the app it just built works, and it will click
through the happy path and say yes. Ask it to look for bugs, and it will hand
you a list, some of which are real.

The second answer is the dangerous one. A list of plausible bugs costs you an
afternoon to check, and after the third false one you stop reading the list.

[Antagonist](https://github.com/talhayme/antagonist) is an agent skill built
around that problem. The agent attacks a running web app with whatever it
likes, but a suspicion becomes a finding only after a small script, with no
model in it, replays it in a clean browser and agrees. On nine open-source
apps it had never seen, it confirmed 40 defects. Five of them lose a user's
data or take the app down for every user.

## The first version found almost nothing

I started with the obvious thing: a script that clicks around at random, types
hostile values into every field, and watches for crashes, errors in the
console and words like `NaN` on screen. Every hit was replayed twice in a fresh
browser and kept only if it came back.

On three small apps it reported 20 findings, all of which reproduced. After I
read them, they came down to five causes, and two of those were real. The
other three were my own script going Back from the first page into an empty
tab, an app that caught bad data correctly and logged it, and a feature that
failed because I had not given it an API key.

That was the useful result. **A finding that reproduces is not therefore a
defect.** Everything that came after is built on that sentence.

## A control for every attack

What separates a defect from an artefact is a control: the same journey with
an ordinary value. If the journey with `Milk` passes and the journey with `B#1`
fails, the difference is the input. If both fail, the environment is broken or
the expectation was wrong, and nothing reaches the report.

So every finding in Antagonist is a JSON file with a control, an attack and an
expectation:

```json
{
  "title": "Creating a note named B#1 empties the existing note B",
  "expect": [{"field": {"css": "textarea:visible", "matches": "beta body"}}],
  "control": [ "...create a note named B-1, then open B..." ],
  "attack":  [ "...create a note named B#1, then open B..." ]
}
```

A verifier replays each side twice from a clean browser. The finding stands
only when the control passes and the attack fails, both times, the same way.
Two other shapes cover what a control cannot: work the app accepts and then
loses after a reload, and an attack that takes the whole server down.

The agent does the creative part: it reads the screen, decides that the amount
field deserves `1e308` and the export deserves a description with a quote in
it, and writes the files. The verifier does the part a model should not be
trusted with.

## What the agent attacks

The catalog the skill follows starts with one question, because the most
valuable finding of the early trials was of this kind: **does the button do
what it says?**

One habit tracker had a Save button for the monthly reflection. Nothing
crashed, nothing logged an error, and the text was gone after a reload. In the
source, the save function was a stub, `saveReflection: (n) => {}`, left behind
by whoever built the app. A random walker cannot find that. An agent that
types something, presses Save, reloads and looks finds it in one journey.

After that come inputs (zero, negative and enormous numbers; quotes, `#`, `=`
and emoji in names; dates at month end, in other time zones, just after
midnight), data on the move (totals, exports, imports, saved data the app
cannot read back), sequences (double clicks, Back in the middle of a save) and
the app's own API.

## Nine apps it had not seen

I picked nine open-source web apps that run locally without external
services, from 41 to 2,836 GitHub stars: note-taking, a budget, a family
planner, two habit trackers, a grocery planner, a collaborative editor and an
e-book reader. Neither I nor the catalog had seen them. Each got one agent, the
skill, the address and nothing else; reading the source was forbidden.

| | |
|---|---|
| confirmed findings | 40 |
| losing data or taking the app down | 5 |
| confirmed by the verifier, then dropped by the agent as not a defect | 1 |
| cost per app | 70k to 150k tokens, 4 to 56 minutes |

Then I checked the agents. I replayed the proof files for six of the apps
again, and every one confirmed. For five of the weightiest findings I went to
the source code, and all five were real, each down to a line.

The first project I have reported to is
[NoteDiscovery](https://github.com/gamosoft/NoteDiscovery), a self-hosted
markdown knowledge base and the largest of the nine:

- **Creating a note named `B#1` empties the existing note `B`.** The page puts
  the note's path into the request URL unencoded, so everything from `#` on
  becomes a fragment and the save lands on `B`. A name that differs only by
  case does the same on macOS and Windows.
  ([#317](https://github.com/gamosoft/NoteDiscovery/issues/317))
- **Renaming a shared note breaks its share link**, because rename is done as
  create-and-delete while only move updates the link.
  ([#318](https://github.com/gamosoft/NoteDiscovery/issues/318))
- **Exporting a note with a Cyrillic or emoji title fails with a 500**,
  because the title goes into an HTTP header as is.
  ([#319](https://github.com/gamosoft/NoteDiscovery/issues/319))

The other projects stay unnamed until their maintainers have heard from me.
Among their findings: a server that one request takes down for every user, a
monthly reminder set for the 31st that drifts to the 28th and never returns,
a budget page that shows $0 after a reload while the server holds the real
amount, and a meal planned for Sunday that is saved as Saturday in every time
zone east of UTC.

## What held

A tester that finds defects everywhere is no more useful than one that finds
none. On the same run, the agents attacked access between users in two apps and
found no way to read or change another user's data. They checked money
arithmetic to the cent in the budget app and a three-way expense split in the
family planner, and both were right. On the one app in the early trials that
was built with tests and written rules for its own agent, the first full run
confirmed nothing; a later, deeper run found a single real defect there.

## What the verifier cannot decide

The verifier proves that the hostile journey behaves differently from the
ordinary one. It does not prove that the difference is a defect.

In one trial it confirmed that a column name typed with no delay between
keystrokes was never saved. That is true, and it is not a bug: no person
types that fast, and with 40 ms between keys the app was fine. The rule that
now catches this is a written list the agent checks every confirmed finding
against: its own speed, its own Back button, errors the app handled, features
that need a service nobody configured, behaviour a label says is intended.

So the report is a list of findings to confirm, not a verdict. It is a much
shorter list than an agent produces on its own, and every item on it comes
with a file you can rerun.

## Where it is

```sh
npx skills add talhayme/antagonist
```

It works with the coding agents that read agent skills, attacks only an app
you run yourself on your own machine, and changes that app's data, so point it
at a throwaway copy. A small app costs about as much as a long coding session.

If you run it on your own app, I would like to know what it finds, and what it
gets wrong.
