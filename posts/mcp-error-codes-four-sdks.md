---
title: "Your MCP handler failed. What error code did the client get?"
description: "I wrote the same small MCP server with four official SDKs, made its handlers fail in the same ways, and recorded the JSON-RPC error code each one sent. Two SDKs send code 0, one cannot, one sends the code the specification names. A request with malformed params gets four different answers, and for one input, silence from two SDKs."
date: 2026-10-12
tags: [mcp, testing, interoperability, sdk, open-source]
---

A prompt handler in your MCP server throws. Maybe the database was down. The
client gets a JSON-RPC error, and the error has a `code`. Which one?

The specification answers for prompts and for resources:
[internal errors are `-32603`](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#error-handling).
You did not choose a code, so the SDK chooses for you. I wanted to know what
each SDK chooses.

I wrote the same server four times, with the Python, TypeScript, Rust and Go
SDKs, using the API each one's documentation starts with. Each has tools,
prompts and resources that succeed, fail with an ordinary error, or fail with
an error carrying code `-32050`. A driver starts the server over stdio,
completes the handshake, sends one request and records the answer. There are
21 requests.

This is the fourth set in
[mcp-sdk-diff](https://github.com/talhayme/mcp-sdk-diff); the
[first three](/blog/same-inputs-four-mcp-sdks/) looked at request ids, SSE
framing and fallback to older servers.

| SDK | cases not met, of 21 | answers with code `0` |
|---|---|---|
| TypeScript 2.3.1 | 2 | 0 |
| TypeScript 1.32.1 | 5 | 0 |
| Rust `rmcp` 3.5.1 | 5 | 0 |
| Python 2.3.0 | 6 | 3 |
| Go v1.8.0 | 6 | 4 |
| Python 1.30.0 | 12 | 8 |

## When the handler fails

| handler fails with an ordinary error | Go | TypeScript | Python 2.3.0 | Rust |
|---|---|---|---|---|
| tool | `isError` result | `isError` result | `isError` result | `isError` result |
| prompt | **`0`** | `-32603` | **`0`** | n/a |
| resource | **`0`** | `-32603` | `-32603` | n/a |
| resource template | **`0`** | `-32603` | `-32603` | n/a |

Tools are fine everywhere: every SDK turns the failure into a result marked
`isError`, which the specification allows.

For prompts and resources, Go and Python send `0`. Zero is not a code anyone
picked. It is what an integer field holds when nothing was written to it. A
client cannot tell it from a missing code, and cannot tell an internal error
from anything else.

In Go the cause is one conversion: an error gets a code only if it already
carries one. I reported the one place where the SDK itself hit this, the fix
[was merged](/blog/one-error-code-six-files/), and the rest, twelve places on
both the server and the client side, is now
[go-sdk#1394](https://github.com/modelcontextprotocol/go-sdk/issues/1394).

Python 2.3.0 has fixed resources and not prompts. An unknown prompt name and
a missing required argument get `0` too, where the specification names
`-32602`; that part is
[python-sdk#3669](https://github.com/modelcontextprotocol/python-sdk/issues/3669).
Python 1.30.0 goes further: when my handler raised an error with code
`-32050`, the client received `0`. The code I chose was thrown away.

TypeScript sends `-32603` in every one of these cases, in both release lines.

Rust is `n/a`, and that is the most interesting cell. A prompt or resource
handler in `rmcp` returns an error type that cannot be constructed without a
code. There is no way to write the bug. The other three SDKs fix this class
of mistake one site at a time; Rust's type made the mistake unrepresentable.

## When the SDK has to refuse

The second half of the set sends requests the SDK must reject before any
handler runs.

**A known method with params that do not fit.** `tools/call` with no params,
or with a number where the tool name goes:

| | Go | Python | TypeScript 2.x | TypeScript 1.x | Rust |
|---|---|---|---|---|---|
| answer | `-32602` or `-32600` | `-32602` | `-32602` | `-32603` | **`-32601`** |

Rust answers "Method not found", with `tools/call` as the message. A client
reading that concludes the server has no tools, when the fault is in its own
arguments. The cause has the same shape as the request-id bug from the first
post: the message type is a union tried variant by variant, the typed variant
refuses the params, and the message falls through to "custom request", whose
default answer is Method not found. I filed
[rust-sdk#1347](https://github.com/modelcontextprotocol/rust-sdk/issues/1347).

**Params that are an array.** `"params": []` is legal JSON-RPC and not legal
MCP. The request has a readable `id`, so the sender is owed an error with
that `id`.

| | answer |
|---|---|
| Go | `-32602`, with the id |
| Rust | `-32600`, **with no `id` member at all** |
| Python 2.3.0, 1.30.0 | **nothing** |
| TypeScript 2.3.1, 1.32.1 | **nothing** |

Four of six lines leave the request unanswered. The session stays alive: a
`ping` sent afterwards gets its reply. The sender waits for its own timeout.

## Does any of this reach a product?

I checked one case from an earlier set. The Rust SDK decodes event streams
with `sse-stream` 0.2.6, which rejects seven valid frame shapes, among them
any frame with a field it does not know. goose, an open-source agent built on
`rmcp`, ships the same version. I pointed goose 1.54.0 at the test server:
it connects in twelve of twenty cases and in the other eight reports

```
failed to initialize MCP client: discover and legacy initialize both failed
```

Seven of those eight are the frames the SDK's dependency rejects. The eighth
is a stream that ends without a blank line, where the case accepts either
outcome. `sse-stream` 0.3.0 handles all seven.

I have no report of a real server that sends such a frame to a goose user.
What the run shows is narrower: a difference measured in an SDK is still
there, unchanged, in a product built on it.

On the other set I tried, fallback to a legacy server, goose connected in all
ten cases, including the one where the bare SDK client did not.

## Caveats

Each fixture uses the high-level API of its SDK: `MCPServer` and `FastMCP` in
Python, `McpServer` in TypeScript, the router macros in Rust, `mcp.Server` in
Go. A lower-level API of the same SDK may answer differently. I wrote all
four fixtures, so a mistake in one would look like a difference.

All of it ran on the 2025-11-25 handshake over stdio. I spot-checked Go on
2026-07-28 and over HTTP, and Rust on 2026-07-28, and saw the same codes, but
that is not in the published results.

Five lines of six ignore an invalid pagination cursor. The fixture has three
tools and never paginates, so I read that row as "nothing to validate", not
as five bugs.

Go is measured at v1.8.0, the latest release. Two of its six misses are
already fixed on main.

An unknown tool is answered with an `isError` result by Python and by
TypeScript 1.x, and with `-32602` by the others. I count it as a miss
because the specification lists unknown tools under protocol errors, and I
can see the argument for the other reading.

The driver matches responses to requests by `id`. Its first version reported
Rust's id-less error as silence; it now records "error without id" as its own
outcome.

## What I take from it

Error codes are the part of a protocol nobody tests, because the test for
"it failed" passes whatever number comes back. Go and Python sent a number
nobody chose. Rust could not, because its error type has no way to leave the
code out.

If you maintain an MCP server, the cheap defence is to return an error that
carries a code yourself. For prompts and resources, every SDK here passed the
handler's own code through, except Python 1.x.

The cases are a JSON file, and a fixture for another SDK is about eighty
lines.
