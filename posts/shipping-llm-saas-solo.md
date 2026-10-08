---
title: "What it actually takes to run an LLM product on your own"
description: "A document-translation service on GPT-4 and Claude: the architecture, the reliability work nobody demos, and the engineering decisions that decide whether an AI product survives contact with paying customers."
date: 2026-10-08
tags: [llm, production, architecture, reliability]
---

The largest document the service has translated was 1,130 pages. It arrived
as a 154 MB PDF, went through the pipeline, and came back with its figures,
tables and footnotes where the author left them.

Getting that to work reliably — not once, but as a thing customers pay for
every month — took far more engineering around the model than inside it. I
have been running **BookahTranslate** since late 2025: PDF, EPUB and DOCX
translation that preserves layout. To date it has processed 27,000+ pages and
54 million characters, for regular customers, on one small server.

This is what that engineering actually looks like.

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

## The problem nobody warns you about: where to cut

A 1,130-page book does not fit in a context window, so it has to be cut into
pieces. This sounds like a solved problem — split every N characters, send,
reassemble — and it is the single largest source of bad output if you do it
that way.

Cut mid-sentence and the model finishes the thought on its own, inventing an
ending that never existed in the source. Cut mid-paragraph and the second
half arrives without the subject of its own argument, so pronouns resolve to
nothing and the model guesses. Neither failure is visible in a diff: the
output reads fluently and says something the author did not write.

The fix is to never cut at an arbitrary offset. Paragraphs are the natural
unit, and they get packed into chunks up to a budget rather than split to
fill one:

```python
def _chunk_paragraphs(paragraphs, max_chars=3500):
    """Group paragraphs into chunks without breaking them."""
    chunks, current_chunk, current_length = [], [], 0

    for para in paragraphs:
        para_len = len(para)

        if para_len > max_chars:
            # A single paragraph over budget — flush what we have, then fall
            # back to sentence boundaries. Never mid-sentence.
            if current_chunk:
                chunks.append("\n\n".join(current_chunk))
                current_chunk, current_length = [], 0

            sentences = re.split(r"(?<=[.!?])\s+", para)
            sent_chunk, sent_length = [], 0
            for sent in sentences:
                if sent_length + len(sent) > max_chars and sent_chunk:
                    chunks.append(" ".join(sent_chunk))
                    sent_chunk, sent_length = [], 0
                sent_chunk.append(sent)
                sent_length += len(sent) + 1
            if sent_chunk:
                chunks.append(" ".join(sent_chunk))

        elif current_length + para_len > max_chars and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            current_chunk, current_length = [para], para_len
        else:
            current_chunk.append(para)
            current_length += para_len + 2

    if current_chunk:
        chunks.append("\n\n".join(current_chunk))
    return chunks
```

The degradation ladder is the point: paragraph boundary first, sentence
boundary only when a single paragraph exceeds the budget, and never a cut
inside a sentence. A legal document with one 6,000-character clause still
gets split — but at a full stop, where the model can tell that a thought
ended rather than guessing that it continued.

The 3,500-character budget is empirical, not principled. Larger chunks mean
fewer calls and better cross-sentence consistency; smaller chunks mean a
retry costs less when a provider fails mid-document. This number is where
those two pressures balanced for this content.

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
bot, with recurring customers and steady monthly revenue. Average document:
76 pages. Largest so far: 1,130.

Current work is a B2B pilot with a university, and institutional volume is a
genuinely different shape of problem. An individual customer sends one
document and waits. A department sends forty and expects them all by Friday —
which turns a pipeline that handles documents into one that has to schedule
them, with some tenant's work necessarily waiting behind another's. Billing
stops being one card charge and becomes an invoice someone in finance has to
reconcile against a list of jobs. And a mistake no longer costs one refund;
it costs the relationship.

Every piece above exists because of that transition. Per-page accounting with
a ledger is overkill for a single customer and the only sane basis for an
invoice. Provider fallback matters more when the deadline is institutional
than when one person can retry tomorrow. An evaluation gate is a convenience
for solo work and a prerequisite for promising consistent quality across
forty documents.

None of that was foresight. It was built because each problem showed up
first at small scale, where getting it wrong was cheap.

It is a small business, run by one engineer, and it has been the best
education I could have bought. Everything I know about LLM systems in
production — fallback chains, cost routing, evaluation gates, the difference
between a model that works in a notebook and one that survives a paying
customer — came from this service meeting reality in specific, memorable ways.

If you are building something similar: charge from day one, and instrument the
funnel before you instrument the model.
