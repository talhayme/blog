---
title: "The same 45 inputs, four MCP SDKs"
description: "Each official MCP SDK parses the same wire formats with its own code. I fed 45 identical inputs to the Python, TypeScript, Rust and Go SDKs and recorded where they disagree: a request that silently becomes a notification in two of them, seven valid SSE frames that end a Rust client's session, and one legacy-server answer only one client cannot recover from."
date: 2026-10-12
tags: [mcp, testing, interoperability, sdk, open-source]
---

The Go SDK got a bug report this week: a JSON-RPC request id of
`9007199254740993` comes back as `9007199254740992`. The id goes through a
float on the way in, and 2^53 + 1 does not survive that.

It is a small bug with a fix already in review. What caught my attention is
the question it leaves open. MCP has official SDKs in ten languages, and every
one of them decodes the same JSON-RPC messages and the same event streams with
its own hand-written code. If Go gets request ids wrong in one way, what do
the others do with the same bytes?

Nothing compares them directly. The official conformance suite tests each SDK
against a reference server, one SDK at a time. So I wrote down inputs, ran
them through four SDKs, and put the answers side by side.

| vector set | cases | Python | TypeScript | Rust | Go |
|---|---|---|---|---|---|
| JSON-RPC request ids | 15 | 5 | 0 | **7** | 5 |
| SSE framing | 20 | 0 | 1 | **7** | 3 |
| fallback to a legacy server | 10 | 0 | 0 | 1 | 0 |

The numbers are cases where the SDK did something the case does not accept.
Python and TypeScript were each measured on two release lines (`mcp` 2.3.0
and 1.30.0; `@modelcontextprotocol/client` 2.3.1 and `sdk` 1.32.1), and both
lines of each gave identical results. Rust is `rmcp` 3.5.1, Go is `go-sdk`
v1.8.0.

The code, the inputs and the full tables are in
[mcp-sdk-diff](https://github.com/talhayme/mcp-sdk-diff).

## A request that becomes a notification

The first set decodes one message with fifteen different ids:

```json
{"jsonrpc":"2.0","id":<id>,"method":"tools/list"}
```

A message with an `id` and a `method` is a request. The SDK may hand it on
with the id it was sent with, or reject it. What it must not do is read it as
a notification, because a notification gets no response and the sender waits
for one until its own timeout.

| `id` | Python | TypeScript | Rust | Go |
|---|---|---|---|---|
| `42`, `"abc"` | request | request | request | request |
| `9007199254740993` | request | rejected | request | **request, id …992** |
| `9223372036854775808` | request | rejected | **notification** | **request, id …807** |
| `1.0` | **notification** | request, id 1 | **notification** | request, id 1 |
| `1.5` | **notification** | rejected | **notification** | **request, id 1** |
| `true` | **notification** | rejected | **notification** | rejected |

Three SDKs, three different wrong answers. Go keeps the message a request and
changes the id: precision is lost above 2^53, anything past int64 is clamped
to the largest int64, and `1.5` becomes `1`. Python and Rust keep nothing: a
request whose id is not an integer or a string falls through to the
notification type and is dropped without an answer.

The cause in Python and Rust is the same shape. The message type is a union
tried variant by variant. The request variant refuses the id, the next variant
that fits is the notification, and a notification does not mind an extra `id`
field. Rust does this with a `#[serde(untagged)]` enum, Python with a pydantic
union.

TypeScript is the only one that meets every expectation in this set. It
accepts `1.0` as the integer it is and rejects the rest.

`1.0` is the case I would worry about. It is an integer written the way some
JSON encoders write every number, and it is enough to make a Python or Rust
server go silent.

The Python behaviour was reported in February for `"id": null`
([python-sdk#2057](https://github.com/modelcontextprotocol/python-sdk/issues/2057)),
with a note that version 2 would probably fix it. It did not, and the table
shows it is wider than `null`; I added that to the issue. For Rust I filed
[rust-sdk#1345](https://github.com/modelcontextprotocol/rust-sdk/issues/1345),
which was triaged as P1, and sent a fix. Go's cases are covered by the pull
request that started all this.

## Seven valid event streams a Rust client rejects

The second set leaves decoding functions alone and drives each SDK's real
Streamable HTTP client against a local server. The server answers
`initialize` with one Server-Sent Events frame, shaped a different way in each
of twenty cases. Every frame is valid under the
[SSE parsing rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)
and carries the same response, so the client should connect every time.

Twelve cases pass everywhere, among them a frame with no space after the
colon, comment lines, CRLF line endings, a byte order mark, a `retry` field,
an event id, an empty priming event and data split over two lines. The other
eight:

| frame | Python | TypeScript | Rust | Go |
|---|---|---|---|---|
| CR-only line endings | ok | **hangs** | ok | **fails** |
| unknown field with no colon (`heartbeat`) | ok | ok | **fails** | **fails** |
| unknown field with a value (`x-trace: abc`) | ok | ok | **fails** | ok |
| bare `data` line before the data | ok | ok | **fails** | **fails** |
| two `event` lines | ok | ok | **fails** | ok |
| two `id` lines | ok | ok | **fails** | ok |
| two `retry` lines | ok | ok | **fails** | ok |
| `retry` that is not a number | ok | ok | **fails** | ok |

Python connects in all twenty.

The Rust failures are not in the SDK. They are in `sse-stream` 0.2.6, the
crate it uses to decode the stream, which treats an unknown field name or a
repeated `event`, `id` or `retry` line as an error. I ran the crate on its own
to check: 0.2.6 fails all seven, and 0.3.0, released on 18 September, passes
all seven. The Rust SDK has had an automated pull request for that upgrade
open since 22 September, with failing checks. When I tried the upgrade
locally the library stopped compiling in one place, where 0.3.0 changed the
error type of the response body.

The TypeScript hang has the same structure one layer down. Fed the CR-only
frame on its own, `eventsource-parser` 3.1.1 emits no event, and emits it as
soon as any further byte arrives: it looks like a trailing CR is held back in
case it is the first half of a CRLF, and nothing releases it when the stream
ends. Version 4.1.1 emits the event.

Go's parser is its own. The two colon-less cases are a known issue with a fix
in review; the CR case is not part of that fix.

So of three failing SDKs, two were inheriting a bug that their dependency had
already fixed. The SDK's own test suite cannot show that, because it tests the
SDK against inputs the SDK's authors thought of.

## One answer a Rust client does not recover from

The 2026-07-28 revision of MCP removed the `initialize` handshake. A client
that supports both eras starts with a modern request, usually
`server/discover`, and falls back to `initialize` when the server turns out to
be a legacy one. The
[specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
says a recognized modern JSON-RPC error identifies a modern server, and
"anything else identifies a legacy server."

The third set is ten ways a legacy server can answer that first request: a 400
with one of three JSON-RPC errors, a 400 with an empty or plain-text body, a
404, a 405, and a 200 carrying `-32601 Method not found` either as JSON or
inside an SSE frame.

All clients connect in all ten cases, with one exception. The Rust client
falls back when the error arrives as `application/json` and reports
`connection closed: discover response` when the same error arrives in an SSE
frame. The Python 2.3.0 and Go clients probe first and fall back every time.
The TypeScript clients sent `initialize` straight away in my runs, so for
them this set proves little.

## What I got wrong on the way

**I blamed my test server, then the SDK, and the truth was in between.** In
the first run of the SSE set the Rust client failed the control case, the
plain frame every client must accept. A client that fails the control is not
telling you anything about the inputs. My server answered the
`server/discover` probe with an error inside an SSE frame, and Rust stopped
there. I decided it was my server and went to check against a real one, a
stateless server on the TypeScript SDK. Rust connected, which looked like
confirmation. It was not: the real server rejects the probe earlier, over the
protocol version header, with a plain JSON 400, so it never sends the reply my
server sent. What I had found was the fallback case above. It is real, and I
have only reproduced it against my own server.

The runner now marks one case in every set as a control and reports an SDK
that misses it as "control failed" for the whole column.

**I nearly posted a wrong sentence about TypeScript.** My draft comment on the
Python issue said the TypeScript SDK rejects all the odd ids. The summary
table said `ok` for every row, and I read `ok` as "rejected". The raw results
said it accepts `1.0` and `1e2` as integers. Two acceptable outcomes behind
one word is how that happens; the comment went out with the correct sentence.

## Caveats

The request-id set calls each SDK's decoding directly. It shows what the SDK
makes of a message, not what a running server sends back over the wire.

Unknown SSE fields, CR-only line endings and ids above 2^53 are rare. I have
no report of anyone hitting most of these in production; the `1.0` id and a
gateway that injects a keep-alive line are the two I can imagine meeting.
This is a list of differences from what the formats require, not a list of
outages.

"Acceptable" is my reading of JSON-RPC 2.0, the SSE parsing rules and the MCP
specification. Where a text leaves room, the case accepts more than one
outcome, and each case records why.

Four SDKs out of ten, one version of each release line, one machine.

Every number above comes from a run whose output is committed in the
repository, and the commands to repeat it are in its README.

## What I take from it

A conformance suite asks whether an SDK does what the specification says. This
asks a cheaper question: do the SDKs do the same thing? Forty-five inputs were
enough to find a request that vanishes in two SDKs, a dependency fix that two
SDKs had not picked up, and a fallback that works in three clients out of
four. None of it needed a model, a GPU or a second machine.

The inputs are plain JSON files. If you maintain an MCP SDK that is not in the
table, an adapter is about a hundred lines.
