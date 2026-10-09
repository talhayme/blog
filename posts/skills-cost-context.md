---
title: "Your Claude Code skills cost 7,155 tokens on every request"
description: "Every installed skill injects its description into the system prompt of every turn, used or not. I measured mine: 64 skills, 7,155 tokens per request, half from one source, and one skill installed twice. Here is how to measure yours."
date: 2026-10-09
tags: [claude-code, llm, context, tooling]
---

I installed a few plugins. Then a few more. Then I measured what they cost.

**7,155 tokens. On every single request. Whether I use them or not.**

That is 64 skills across 21 sources, and I had no idea, because nothing in
the interface tells you. The `/context` command shows what your conversation
is using. It does not itemise what your *tooling* is using before you type a
character.

Here is the mechanic, the measurement, and three things I found that I did
not expect.

## Why a skill you never use still costs you

A skill is a folder with a `SKILL.md`. The body — the actual instructions —
loads only when the skill fires. That part is pay-per-use and fine.

The frontmatter is not. Claude has to decide *which* skill to invoke, and it
decides by reading every skill's `name`, `description` and `when_to_use`. So
those get injected into the system prompt of every request, for every
installed skill, forever.

Ten plugins at eight skills each is eighty descriptions riding along on every
turn. Nobody notices, because each one is small and the total is never shown.

```
  64 skills across 21 sources
  ~7,155 tokens added to every request

  BY SOURCE
  --------------------------------------------------------------
  personal                      3,439 tok   48.1%  ████████████
  plugin-dev@claude-plugins-of    766 tok   10.7%  ███
  pentest@claude-pentest          426 tok    6.0%  ██
  mcp-server-dev@claude-plugin    347 tok    4.9%  █
  project-artifact@claude-plug    231 tok    3.2%  █
  injection-probe@talhayme        211 tok    2.9%  █
```

Half of my cost comes from one source. I would not have guessed that, and
guessing is the only tool most people have here.

## Three things the numbers showed

### 1. I had the same skill installed twice

```
  ⚠ OVERLAPPING SKILLS
    [accuracy, analysis, benchmark] skill-creator (personal),
                                    skill-creator (skill-creator@official)
```

A personal copy and the official plugin's copy, both loaded, both describing
the same work. Not just wasted tokens — when two skills compete for the same
request, Claude picks one semi-arbitrarily. The other is pure overhead, and
which one wins is not something you control.

### 2. Descriptions get silently truncated

Claude Code cuts `name` + `description` + `when_to_use` at **1,536
characters**. Past that, the text is dropped.

This is worse than it sounds. The author wrote instructions describing when
their skill should fire; the tail of those instructions never reaches the
model. The skill still loads. It just gets chosen on incomplete information,
and nothing warns anyone — not the author, not you.

### 3. The heaviest skills are all description, no restraint

```
   252 tok  docs
   241 tok  pptx
   240 tok  google-workspace
   239 tok  xlsx
   237 tok  computer-use
```

Roughly 240 tokens each, on every turn, forever. A description's job is to
help Claude choose — that needs a sentence or two. Everything past that
belongs in the skill body, which loads only when the skill actually fires.

## What about MCP? (this part is out of date everywhere)

If you search for this problem you will find posts about MCP servers burning
55,000 or 67,000 tokens of tool definitions before you type anything. Those
numbers were real.

They are also substantially out of date, and most of the posts repeating them
do not say so. Claude Code shipped **MCP Tool Search** in v2.1.7: when tool
descriptions would exceed roughly 10% of the context window, definitions are
tagged for deferred loading and replaced with a search tool. The model
searches, loads only what matches, then calls. Reported reduction is around
85%.

So the MCP half of this problem has a built-in fix.

**Skills do not get that treatment.** Their descriptions are how Claude
decides what to invoke, so they cannot be deferred behind a search without
breaking selection. The skill tax is still paid in full, every turn, and it
is the part nobody is measuring.

## Measure your own

I wrote a plugin for this. It reads the on-disk layout — personal skills,
every installed plugin, project-local skills — and reports the total,
attributes it per source, and flags the three problems above.

```bash
claude plugin marketplace add talhayme/claude-plugins
claude plugin install context-audit@talhayme
```

Then ask in plain language — *"how much context are my skills costing me?"* —
or run `/context-audit` directly.

Offline, read-only, no dependencies. Token counts are estimated at ~4
characters per token: good enough to rank and budget, not exact.

For CI, there is a budget flag, so a repository's `.claude/skills` cannot
grow unnoticed:

```bash
python3 scripts/audit.py --budget 4000   # exit 1 when over
```

## What I actually did about it

Uninstalled the duplicate `skill-creator`. Went through the personal skills —
the 48% — and removed what I had installed to try once and never used again.

I did not go further, and this is the part worth saying out loud: **7,000
tokens is not an emergency.** On a 200k context window it is around 3.5%. The
reason to measure is not that the number is catastrophic; it is that the
number was *invisible*, and invisible costs only grow. Mine went from 6,630
to 7,155 while I was writing this post, because I installed two more of my
own plugins.

Which is the honest footnote here: **my three plugins cost 525 tokens between
them.** A tool that measures overhead is still overhead. If `context-audit`
is not earning its 132 tokens on your machine, uninstall it after you have
your number — it will tell you the same thing next time you reinstall it.

---

*The plugin is [context-audit](https://github.com/talhayme/claude-plugins),
MIT, part of a small marketplace of tools built on one idea: AI tooling
should be measurable.*
