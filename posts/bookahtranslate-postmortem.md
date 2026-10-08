---
title: "I built an AI translation SaaS solo. Here is what the data says."
description: "Eleven months, 937 users, 37 paying customers and one 956 MB server. The architecture, the funnel that leaked 86% of large orders, and the advertising campaign that returned less than half its cost."
date: 2026-10-08
tags: [llm, production, postmortem, saas]
---

Most "I built an AI product" posts stop at the launch screenshot. This one
starts there and keeps going through the part where traffic collapses, the
payment funnel leaks 86% of large orders, and a paid advertising campaign
returns less than half of what it costs.

I run BookahTranslate — a document translation service on GPT-4 and Claude
that keeps the layout of a PDF, EPUB or DOCX intact across 300+ pages. I built
and operate it alone. The code is ~18,600 lines of Python across 62 modules.

I am publishing the metrics because posts with real conversion data were the
ones that helped me, and they are rare.

---

## 1. What the thing actually does

You upload a 280-page PDF. Twenty minutes later you get back the same PDF in
another language — figures where they were, tables intact, footnotes attached
to the right sentences, code blocks unmangled.

That sounds modest until you try it. Google Translate flattens a PDF into
plain text. DeepL has no end-user PDF path. The handful of services that do
handle PDF either cost more than a human translator or return something that
needs an hour of cleanup.

The hard part was never "call the model." It was everything around it.

## 2. Architecture

Three components that share nothing but a Redis queue:

```
                  ┌──────────────┐
   browser  ──────▶  Web app     │  Flask + SQLAlchemy
                  │  (gunicorn)  │  auth, billing, job intake
                  └──────┬───────┘
                         │ Redis queue
                  ┌──────▼───────┐
                  │  Translation │  chunking, context assembly,
                  │  pipeline    │  provider calls, reassembly
                  └──────┬───────┘
                         │
   Telegram  ◀───────────┴───────▶  PostgreSQL
   bot                              (separate DB per context)
```

**Why separate processes.** A 300-page document takes 20+ minutes. Doing that
inside a web request means gunicorn timeouts and a user staring at a spinner
that eventually dies. The queue decouples "accept the job" from "do the job,"
and the browser polls for progress.

**Why separate databases.** The Telegram bot and the web app have independent
PostgreSQL databases. A migration that breaks one does not take down the
other. Same pattern for Redis instances. This felt like overkill at the time
and saved me twice.

**The stack:** Python, Flask, SQLAlchemy, Celery, PostgreSQL, Redis, nginx,
Linux. No Kubernetes. No managed services beyond the model APIs.

**Total infrastructure: one VPS with 956 MB RAM and 2 cores.** It currently
runs eight services and has 339 MB free. I mention this because the dominant
genre of AI-infrastructure writing assumes a budget I did not have.

## 3. The engineering that actually mattered

Three things separate a demo from something people pay for. None of them is
prompt engineering.

### Provider fallback

Model APIs fail. Timeouts, rate limits, outages, and — worst — responses that
arrive with HTTP 200 and are truncated or empty. A translation job that dies
because one vendor had a bad minute is a refund and a lost customer.

```python
RETRYABLE = (ProviderTimeout, RateLimited, ProviderUnavailable)

def translate_chunk(chunk: str, chain: list[ModelChoice]) -> Translation:
    failures: list[str] = []

    for model in chain:
        for attempt in range(MAX_ATTEMPTS):
            try:
                result = call_provider(model, chunk, timeout=timeout_for(model))
                if not result.is_well_formed():
                    # A malformed response is a failure even with HTTP 200.
                    raise MalformedResponse(model)
                if failures:
                    log.warning("recovered after %s", ",".join(failures))
                return result

            except RETRYABLE as exc:
                failures.append(f"{model.name}:{type(exc).__name__}")
                sleep(backoff(attempt))      # exponential, jittered
            except MalformedResponse:
                break                        # retrying won't fix the prompt
            except ProviderRefused:
                break                        # next model, not next attempt

    # Every provider is down: fail loudly and refund the page. Never hand
    # the user a half-translated document as if it succeeded.
    raise AllProvidersFailed(failures)
```

The distinction that matters: a timeout deserves another attempt, a 400 does
not. And when the whole chain is exhausted, the job fails honestly and the
page is refunded. A partially translated document delivered as complete
destroys trust far more cheaply than an error does.

### Cost routing

Defaulting every request to the best available model is the fastest way to a
four-figure monthly bill. Half my traffic was prose that a cheaper model
handles indistinguishably.

```python
def pick_model(doc: Document, tier: UserTier) -> ModelChoice:
    if tier == UserTier.ECONOMY and doc.kind in {DocKind.TXT, DocKind.PLAIN_PDF}:
        return ModelChoice.GOOGLE_TRANSLATE
    if doc.kind == DocKind.SCANNED_PDF:
        return ModelChoice.GPT_4O          # needs vision + OCR in one pass
    if doc.kind == DocKind.LEGAL or doc.has_dense_terminology:
        return ModelChoice.CLAUDE_SONNET   # terminology consistency
    if doc.pages > 200 and tier != UserTier.PREMIUM:
        return ModelChoice.CLAUDE_HAIKU    # ~10x cheaper, bulk prose
    return ModelChoice.GPT_4O
```

Routing by document profile plus response caching for repeated chunks cut
average per-page inference cost by roughly 40% versus always calling the top
model. Quality complaints did not increase.

### A release gate for prompts

This is the piece almost nobody builds, and the one I would build first if I
started over.

A prompt change is a code change with no compiler. The only way to know
whether it helped is to measure it against a fixed set of cases — and the
only way to make that measurement binding is to let it block the deploy.

```python
def gate(report: RunReport, baseline: Baseline) -> GateResult:
    violations = []
    if report.hallucination_rate > MAX_HALLUCINATION_RATE:
        violations.append(f"hallucination {report.hallucination_rate:.1%}")
    if report.mean_accuracy < MIN_ACCURACY:
        violations.append(f"accuracy {report.mean_accuracy:.3f}")
    if report.cost_per_page > baseline.cost_per_page * COST_CEILING:
        violations.append(f"cost/page {report.cost_per_page:.4f}")

    # Averages can all pass while specific documents break.
    # Per-case comparison is what actually catches a regression.
    regressions = [
        case.id for case in report.cases
        if baseline.passed(case.id) and not case.passed
    ]
    return GateResult(passed=not violations and not regressions, ...)
```

The per-case check is the important half. A change that lifts mean accuracy
while silently breaking three specific document types reads as an improvement
on a dashboard and as a bug report from a customer.

I later extracted this as a standalone repository — along with the retrieval
and tool-calling patterns — so the approach is readable without the product
around it:
[llm-eval-harness](https://github.com/talhayme/llm-eval-harness),
[rag-grounded](https://github.com/talhayme/rag-grounded),
[mcp-toolserver](https://github.com/talhayme/mcp-toolserver).

## 4. The numbers

Everything below is from the production database on 8 October 2026. My own
test account is excluded; the difference matters — including it would inflate
revenue by 57%.

| Metric | Value |
|---|---|
| Registered users | 937 |
| Paying customers | 37 |
| Successful payments | 60 |
| Jobs created | 1,213 |
| Jobs completed | 355 |
| Pages translated | 27,042 |
| Lifetime | Nov 2025 – Oct 2026 |

Registration-to-payment conversion: **3.9%**. Jobs that reached completion:
**29%**.

Monthly trajectory, external users only:

| Month | Jobs | Active users |
|---|---|---|
| 2025-12 | 40 | 16 |
| 2026-01 | 321 | 92 |
| 2026-02 | 119 | 82 |
| 2026-03 | 195 | 111 |
| 2026-04 | 158 | 93 |
| 2026-05 | 36 | 27 |
| 2026-06 | 4 | 4 |
| 2026-09 | 60 | 50 |
| 2026-10 | 8 | 6 |

January was the peak. Then traffic fell off a cliff in May and never fully
recovered. September's bump is an advertising campaign I will come back to.

## 5. Where it leaks: the pricing cliff

The single most expensive mistake is visible in one table. Abandonment rate by
document size:

| Document size | Price tier | Jobs | Abandoned |
|---|---|---|---|
| 1–10 pages | minimum charge | 352 | **57%** |
| 11–50 pages | minimum charge | 116 | **62%** |
| 51–100 pages | tier 2 | 50 | **76%** |
| 101–300 pages | tier 3 | 186 | **77%** |
| 300+ pages | tier 4+ | 251 | **86%** |

Two things are wrong here, and both are my fault.

**The minimum charge punished the most common case.** 352 jobs — the single
largest bucket — were documents of 10 pages or fewer. Every one of them hit
the same minimum charge as a 50-page document. Someone arriving with a
three-page contract saw a price built for a book.

**The price appeared after the upload, not before.** A user would wait for a
400-page PDF to upload and parse, and only then discover what it cost. 86% of
them left at that screen. They had already invested effort; the reveal felt
like a bait-and-switch even though nothing was hidden deliberately.

The fix is embarrassingly simple — show the price before the upload, and add
lower tiers so small jobs cost small money — and it took me eleven months to
see it, because I was reading aggregate conversion instead of conversion by
document size.

**Lesson:** segment your funnel by the dimension your pricing uses. An overall
conversion number averages away the exact signal you need.

## 6. Where it leaks: paid advertising

In September I ran a Yandex.Direct campaign. The full result:

| | |
|---|---|
| Clicks | 1,140 |
| Impressions | 14,107 |
| Click-through rate | 8.1% |
| Attributable revenue | **~40% of spend** |

A net loss over twelve days: every rouble spent returned about forty kopecks.
Three failures, in order of cost:

**Wrong intent.** My keywords attracted people searching for a *free* online
translator. They clicked, saw a price, and left. High CTR, zero purchase
intent — the worst combination, because it looks like success in the dashboard.

**Negative keywords missed a transliteration.** I blocked "переводчик"
(translator) but not "пдф" — the Cyrillic phonetic spelling of "PDF." Roughly a third of
the daily budget flowed through that gap before I noticed.

**I broke my own analytics.** The campaign tagged traffic as
`utm_source=direct` while `utm_medium=cpc`. Paid clicks were therefore
indistinguishable from organic direct traffic in reports — I spent a week
unable to answer "did the ads do anything."

**And a near-miss worth recording:** I added "нейросеть" (neural network) and
"ии" (AI) as negative keywords to filter tire-kickers. Both appear in my own
best-performing phrases — "нейросеть перевод книги," "ai перевод книги." I cut
my own targeting and reverted within the hour. Always check negative keywords
against your own keyword list.

## 7. What I got wrong beyond the funnel

**I built the degraded path too late.** Every pipeline has inputs it cannot
handle — a scan too poor for OCR, a layout too exotic to reassemble. Without a
defined path for those, the only outcome is a failure message. Design the
graceful-degradation route on day one: it converts "we failed" into "it took
longer," which is the difference between a refund and a customer.

**I measured the wrong traffic for months.** nginx showed 78–142 "visitors"
per day. Filtering for clients that actually load CSS and JS — a real browser
signal — the number was 7–15. The rest were scanners with Chrome user-agent
strings. I was computing conversion against a denominator that was 90% bots.

**I shipped an operational time bomb.** The TLS certificate for a related
domain expired for 79 days without my noticing. Auto-renewal worked perfectly;
the renewed certificate sat on disk while nginx served the expired one,
because the copy step failed silently on file ownership. Automation that fails
quietly is worse than no automation.

## 8. What I would do differently

1. **Price visible before upload.** Non-negotiable. Sunk-cost reveals convert
   worse than honest pricing.
2. **Segment every funnel metric** by the dimension that drives price or cost.
3. **Build the eval gate before the second prompt change,** not after the
   tenth.
4. **Verify the fix, not the config.** I once fixed a DNS resolution bug by
   editing `/etc/gai.conf`, confirmed the config was correct, and moved on.
   The long-running service had read it at startup in September and kept the
   old behaviour for another day. Checking that a config is correct is not
   checking that the system changed.
5. **Count humans, not requests.**

## 9. Was it worth it

Thirty-seven paying customers over eleven months is not a business. Measured
as income against the hours, it is a rounding error.

As an education it was the best investment I have made. Everything I now know
about running LLM systems in production — fallback chains, cost routing,
evaluation gates, the difference between a model that works in a notebook and
one that survives a paying customer — came from this service breaking in
specific, memorable ways.

The code is ordinary. The judgment about *which* failures matter is not, and
you cannot get it from tutorials. You get it by shipping something small,
charging money for it, and being on the hook when it breaks at 2 a.m.

If you are considering building something similar: do it, charge from day one,
and instrument the funnel before you instrument the model.

---

*I am an AI engineer working on LLM products in production — RAG, MCP servers,
evaluation and reliability. Code at [github.com/talhayme](https://github.com/talhayme),
more at [talhayme.github.io/portfolio-vitalii](https://talhayme.github.io/portfolio-vitalii).*
