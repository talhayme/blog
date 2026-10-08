---
title: "What it actually takes to run an LLM product on your own"
description: "A document-translation service on GPT-4 and Claude: the architecture, the reliability work nobody demos, and the engineering decisions that decide whether an AI product survives contact with paying customers."
date: 2026-10-08
tags: [llm, production, architecture, reliability]
---

Most writing about AI products stops at the demo. The model answers, the
screenshot looks good, the post ends.

The interesting part starts after that — when real customers send real
documents, one provider has a bad minute, and the inference bill arrives. I
have been running **BookahTranslate** since late 2025: a service that
translates PDF, EPUB and DOCX up to 300+ pages while keeping the layout
intact. It has regular customers, recurring revenue, and it runs on one small
server.

This is what the engineering actually looks like.

## The problem

Upload a 280-page PDF. Twenty minutes later, get back the same document in
another language — figures where they were, tables intact, footnotes attached
to the right sentences, code blocks unmangled.

That sounds modest until you try it with the obvious tools. Google Translate
flattens a PDF into plain text. DeepL has no end-user PDF path. The services
that do handle PDF either cost more than a human translator or return
something that needs an hour of cleanup.

The customers who care about this are specific: academics translating
monographs, lawyers working through foreign contracts, engineers with
technical manuals. They are not price-shopping a free tool — they need the
output to be usable without rework. That is the whole business.

## Architecture

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
inside a web request means gunicorn timeouts and a user watching a spinner
that eventually dies. The queue decouples "accept the job" from "do the job";
the browser polls for progress.

**Why separate databases.** The Telegram bot and the web app have independent
PostgreSQL databases. A migration that breaks one cannot take down the other.
Same pattern for Redis. This felt like over-engineering when I built it and
has since earned its keep twice.

**Why two front doors.** Web and Telegram reach different people. Academics
arrive through the web; the bot serves customers who already live in Telegram
and want to forward a file without opening a browser. Same pipeline behind
both.

**The stack:** Python, Flask, SQLAlchemy, Celery, PostgreSQL, Redis, nginx,
Linux. ~18,600 lines across 62 modules. No Kubernetes, no managed services
beyond the model APIs.

**Total infrastructure: one VPS, 956 MB of RAM, 2 cores.** It runs eight
services and sits at roughly a third of memory free. I mention this because
the default assumption in AI-infrastructure writing is a budget that most
products never need.

## The three things that decide whether it survives

Prompt quality is table stakes. These are what separate a service people pay
for from a demo.

### Provider fallback

Model APIs fail: timeouts, rate limits, outages, and — worst — responses that
arrive with HTTP 200 and are truncated or empty. A job that dies because one
vendor had a bad minute is a refund and a lost customer.

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

Two distinctions carry most of the value. A timeout deserves another attempt;
a 400 does not. And a truncated response with a 200 status is still a failure
— validating the *shape* of what comes back catches the errors that monitoring
never flags.

When the chain is exhausted the job fails honestly and the page is refunded. A
partially translated document delivered as complete costs far more trust than
an error does.

### Cost routing

Defaulting every request to the best available model is the fastest route to a
bill that eats the margin. Much of the traffic is prose that a cheaper model
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
average per-page inference cost by roughly 40% against always calling the top
model. Quality complaints did not move. On a service with recurring orders
that difference is the margin.

### A release gate for prompts

This is the piece almost nobody builds, and the one I would build first if I
started again.

A prompt change is a code change with no compiler. The only way to know
whether it helped is to measure it against a fixed set of cases — and the only
way to make that measurement binding is to let it block the deploy.

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

The per-case half is the important one. A change that lifts mean accuracy
while quietly breaking three specific document types reads as an improvement
on a dashboard and as a complaint from a customer.

Eighty-plus tests run behind this gate, covering auth, billing, translation
and user isolation, plus Playwright end-to-end over the full
register-to-translate-to-pay path.

I later extracted these patterns as standalone repositories, so the approach
is readable without the product around it:
[llm-eval-harness](https://github.com/talhayme/llm-eval-harness),
[rag-grounded](https://github.com/talhayme/rag-grounded),
[mcp-toolserver](https://github.com/talhayme/mcp-toolserver).

## Billing is where correctness gets expensive

An LLM product that charges per page has a concurrency problem most tutorials
skip: two jobs submitted at once must not both spend the last page in the
balance.

```python
def use_pages_atomic(subscription_id: int, pages_count: int) -> tuple[bool, int]:
    """Deduct pages under a row-level lock to prevent concurrent over-spend."""
    sub = (
        db.session.query(UserSubscription)
        .with_for_update()                 # SELECT ... FOR UPDATE
        .filter(UserSubscription.id == subscription_id)
        .first()
    )
    if not sub or sub.status not in ("active", "grace_period"):
        return False, 0
    if sub.pages_remaining < pages_count:
        db.session.rollback()
        return False, sub.pages_remaining

    sub.pages_remaining -= pages_count
    db.session.add(PageTransaction(
        subscription_id=sub.id,
        pages_delta=-pages_count,
        balance_after=sub.pages_remaining,
    ))
    db.session.commit()                    # releases the lock
    return True, sub.pages_remaining
```

Every deduction writes a ledger row. When a customer asks why their balance
moved, the answer is a query rather than an apology. Subscription activation
is enforced by a partial unique index — "one active subscription per user" is
a database constraint, not a hope.

## What I would tell myself at the start

**Build the evaluation gate before the second prompt change.** Not after the
tenth. Retrofitting a baseline onto prompts you have already drifted is
archaeology.

**Price has to be visible before the work starts.** Asking someone to upload a
400-page document and only then showing the cost converts badly, and
deservedly so. Quote first.

**Segment every funnel metric by the dimension that drives price.** An overall
conversion number averages away the signal. Broken out by document size, the
shape of the problem is obvious in one table.

**Design the degraded path on day one.** Every pipeline has inputs it cannot
handle — a scan too poor for OCR, a layout too exotic to reassemble. With a
defined fallback, those become "this one takes longer." Without it, they
become refunds.

**Instrument the funnel before the model.** Model quality is the part that
feels important. Where customers actually stop is the part that pays.

## Where it stands

BookahTranslate runs on
[bookahtranslate.tech](https://bookahtranslate.tech) and through a Telegram
bot, with recurring customers and steady monthly revenue. Current work is a
B2B pilot with a university — institutional volume is a different shape of
problem from individual orders, and most of what is above was built to make
that transition possible rather than terrifying.

It is a small business, run by one engineer, and it has been the best
education I could have bought. Everything I know about LLM systems in
production — fallback chains, cost routing, evaluation gates, the difference
between a model that works in a notebook and one that survives a paying
customer — came from this service meeting reality in specific, memorable ways.

If you are building something similar: charge from day one, and instrument the
funnel before you instrument the model.
