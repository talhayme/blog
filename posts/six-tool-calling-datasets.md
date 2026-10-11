---
title: "What the trainer does to six tool-calling datasets"
description: "The most-downloaded function-calling datasets, rendered through the model's own tokenizer and chat template. At max_seq_len=2048, 44% of the rows in hermes-function-calling-v1's two func_calling configs are cut before the answer. Plus two things met on the way: what a known Ollama bug costs (the model gets a Go struct dump instead of the tool schema), and a pre-fix template in Qwen's official GGUFs."
date: 2026-10-10
tags: [fine-tuning, tool-calling, datasets, ollama, llama.cpp]
---

If you fine-tune a small model on tool calling, you pick one of a handful
of datasets, leave `max_seq_length` at 2,048 because the notebook did,
and trust the loss curve. I wanted to know what the trainer actually does
to each row — not what the JSON looks like, what bytes the model sees.

So I took six datasets — about 1,500 sampled rows from each, and hermes read
whole — rendered them through the Qwen2.5 chat template and tokenizer, and
checked the result.

*Corrected 11 October. Two figures below were wrong when this was first
published: the hermes number (38%, from a flawed sample of one config,
quoted for the whole dataset) and a claim that one conversion creates
duplicates. Both are fixed in place and listed at the end with the other
mistakes.*

| dataset | p50 tokens | rows > 2,048 | **cut before the answer @2,048** | schema vs call | no final assistant turn |
|---|---|---|---|---|---|
| NousResearch/hermes-function-calling-v1, `func_calling` | 2,170 | 52.4% | **45.1%** | clean | **8.6%** |
| …same dataset, `func_calling_singleturn` | 1,135 | 41.9% | **41.9%** | clean | 0.0% |
| …same dataset, `glaive_func_calling` | 632 | 0.2% | 0.1% | 0.2% | 3.6% |
| allenai/Dolci-Instruct-SFT-Tool-Use | 1,194 | 16.9% | **14.9%** | 3.8% unparseable calls | 0.1% |
| glaiveai/glaive-function-calling-v2 | 404 | 0.2% | 0.1% | 0.3% | 1.4% |
| lockon/xlam-function-calling-60k | 496 | 0.0% | 0.0% | 1.5% missing required | 0.0% |
| argilla/apigen-function-calling | 482 | 0.1% | 0.0% | 1.3% missing required | 0.0% |
| hiyouga/glaive-function-calling-v2-sharegpt | 472 | 0.1% | 0.1% | 0.1% | 0.0% |

## The column that matters

"Cut before the answer" is a row whose final assistant turn starts past
the cutoff. The trainer keeps the prompt and drops the answer. Without
loss masking such a row still trains — on the system prompt and the tool
signatures, not on a call. With response-only masking (`assistant_only_loss`
in TRL, `train_on_responses_only` in Unsloth; opt-in in both) it contributes
exactly zero gradient. Either way the model is never shown the answer it
was supposed to learn.

*Correction, 11 October: this paragraph first called response-only masking
"the Unsloth and TRL default". It is opt-in in both. The measurements are
unchanged; the consequence is stated correctly now.*

hermes carries every tool signature in the system prompt as JSON. It has
three tool-calling configs and I read all three in full. In the two
`func_calling` configs, 43.5% of rows (1,646 of 3,786) are cut before the
answer at 2,048: the model is shown the answer in barely more than half of
them, and nothing in the pipeline says so. At 4,096 the problem is gone.
The third config, `glaive_func_calling`, is the largest and is untouched
(0.1%), so over all three the figure is 18.4% — which number is yours
depends on which configs you load. Dolci has the same shape at 15%, plus a single row of **334,792
tokens** — an `environment` turn that is a 1.2 MB API response.

Separately, 8.6% of `func_calling` rows end on a `tool` message with no
assistant reply after it. Same effect: no target.

## The smaller findings

**xLAM and apigen** put parameter defaults on the wrong fields. By xLAM's
own convention a parameter without a `default` is required. In
`calculate_electric_field`, `charge` and `distance` carry
`default: 8.854e-12` — vacuum permittivity — and `permitivity` has none;
the call then omits it. About 1.4% of calls disagree with their own
schema this way, and a model learns whichever side it is shown.

**glaive** (the original text format) writes tool-call arguments as a
*string in single quotes*: `{"name": …, "arguments": '{…}'}`. Neither
JSON nor Python. Every converter has to know, and hiyouga's ShareGPT
conversion does. Both versions repeat about 3% of conversations under
different tool definitions, usually the same tool with a reworded
description — not duplicates, since the template renders the tools.

**Dolci** stores calls as Python expressions. 3.8% of rows have one that
is not: JSON literals inside Python (`stableonly=true`), tool names with
spaces (`Historical Engagement Stats(...)`), hyphens, a bare `null`. Two
notations at once.

## Three numbers I got wrong first, and two I published wrong

The method section in the repository records each of them, because a
survey that only reports its final numbers is asking to be trusted
rather than checked.

- The first hermes run showed 25.7% duplicate rows. All 385 were my
  sampling windows overlapping on a 1,893-row split. Windows are now
  100-aligned and raw rows are de-duplicated before anything else.
- The first hermes token counts were nearly double. hermes writes the
  tool signatures into its own system prompt; my adapter *also* passed
  them to the template, which rendered them again.
- apigen showed 500 rows calling undeclared tools — exactly one sample
  block. That block ships tools in OpenAI shape and my adapter read it as
  xLAM's flat shape.
- **Published wrong: hermes.** This post first said 38% "of
  hermes-function-calling-v1". That was a 1,500-row sample of one config
  whose windows still overlapped — the fix above had not been applied to the
  sample I reported from — leaving 1,115 distinct rows, and I quoted it for
  the whole dataset. Read in full: 45.1% and 41.9% for the two `func_calling`
  configs, 0.1% for the largest config.
- **Published wrong: duplicates.** I wrote that hiyouga's conversion
  "collapses 3.2% of rows into duplicates by dropping the system prompt". My
  linter compared messages and ignored tools. Those rows differ in their tool
  definitions, and the original dataset repeats conversations at the same
  rate. The conversion is not at fault; the linter is fixed.

## Two things found on the way

Rendering the same tool-calling conversation through three runtimes
turned up two mismatches that have nothing to do with the datasets.

**Ollama hands the model a Go struct dump instead of the tool schema.**
The library `qwen2.5` template renders `{{ .Function }}`, and the Go type
behind it has no JSON `String()`, so the model receives
`{get_weather Get the current weather… {object <nil> <nil> [city] {…}}}`
where it was trained on a JSON schema. On the same GGUF blob at
temperature 0, Qwen2.5-0.5B gets exact arguments right 39/40 times with
the correct prompt and 31/40 with Ollama's — every failure the same
invented parameter, `amount from_currency`, read straight off Go's
`[amount from_currency to_currency]` rendering of `required`. The bug
itself is known — [ollama/ollama#14601](https://github.com/ollama/ollama/issues/14601)
has been open since March, with two PRs that fix it; what I added there
is the measurement of what it costs.

**Qwen's official Qwen2.5 GGUFs embed a pre-fix chat template.** The HF
repo fixed a doubled-brace instruction (`{{"name": …}}`) on 2024-09-19;
the GGUF repos were populated the day before and never regenerated.
Ollama's library blobs are those files. Ollama itself never renders the
embedded template, but llama.cpp, vLLM and LM Studio do — and the 0.5B
model copies the braces into every tool call it makes, producing invalid
JSON that works or fails depending on how forgiving the server's parser
is. The 1.5B ignores it. Reported on
[QwenLM/Qwen3#1921](https://github.com/QwenLM/Qwen3/issues/1921).

## Caveats

About 1,500 rows per dataset (hermes read whole), so in the samples rates
near 0.1% are one or two rows. The
truncation figures are for the Qwen2.5 template; Llama-3 or Gemma render
tools differently and will move the hermes numbers, though not to zero.
The adapters from each native format are mine and are in the repository.

## The tool

```
pip install ftgate
ftgate data train.jsonl --model Qwen/Qwen2.5-0.5B-Instruct --max-seq-len 2048 --fail-on error
ftgate template --model Qwen/Qwen2.5-0.5B-Instruct --llama http://localhost:8080 --ollama my-model
ftgate tools --from-dataset train.jsonl --provider ollama:my-model --provider "openai:m@http://localhost:8080/v1"
```

`data` is the linter above, with a pytest plugin, a pre-commit hook and a
GitHub Action. `template` is the three-sided byte comparison — HF
tokenizer as the reference, llama-server through its own endpoints,
Ollama rendered with Ollama's own template package and cross-checked
against the live token count. `tools` runs your tool-calling cases, or
rows held out of your training set, against each backend via promptfoo,
with a judge that separates *wrong tool*, *wrong arguments*, *the
provider's parser lost the call*, and *malformed*.

Source, survey, and the notes from each day:
[github.com/talhayme/ftgate](https://github.com/talhayme/ftgate).
