---
title: "The row in MCP's compatibility matrix that says \"Fails\""
description: "The 2026-07-28 revision of MCP removed the initialize handshake. A client that still opens with it cannot reach a server that only speaks the new protocol, and the specification says so in one word. Cursor 3.24 is such a client. I wrote a bridge that answers the old handshake and speaks the new protocol upstream, tested it with two SDK clients and with Cursor, and broke it once on the way."
date: 2026-10-12
tags: [mcp, rust, interoperability, open-source, cursor]
---

The 2026-07-28 revision of MCP has a
[compatibility matrix](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning#compatibility-matrix):
seven rows, one for each pairing of old and new clients and servers. Five say
"Works". Two say "Fails". This post is about one of the two:

> **Legacy client, modern server: Fails.** […] Legacy clients have no
> fall-forward mechanism.

A legacy client opens with an `initialize` handshake and expects a session. A
modern server has neither: every request carries its own protocol version and
client capabilities. A client that supports both eras copes, because it tries
the new way first and falls back. A client that knows only the old way sends
`initialize`, is refused, and has nothing else to try.

In [the previous post](/blog/same-inputs-four-mcp-sdks/) I checked the other
direction: the four SDK clients I tested fall back to a legacy server in
every case I tried but one. So the ecosystem's new clients are mostly fine
with its old servers. The row above is the
one nobody can fix from the client side without shipping a new client.

## What it looks like in an editor

I ran a server that speaks only 2026-07-28 and pointed Cursor 3.24.12 at it.
Cursor's own log:

```
Error connecting to streamableHttp server, falling back to SSE:
  Streamable HTTP error: Error POSTing to endpoint:
  {"jsonrpc": "2.0", "id": 0, "error": {"code": -32020,
   "message": "MCP-Protocol-Version header is required"}}
Error connecting to SSE server after fallback:
  SSE error: Non-200 status code (405)
Connection failed: SSE error: Non-200 status code (405)
```

It sends `initialize` without a protocol version header, is refused, tries
the even older SSE transport, gets a 405, and gives up. A
[report on Cursor's forum](https://forum.cursor.com/t/mcp-client-cannot-connect-to-modern-only-2026-07-28-streamable-http-servers-legacy-initialize-rejected/172536)
from September describes the same sequence on 3.21. The error text in the log
above comes from my test server, which I wrote to answer the way that report
describes; what the log shows independently is the order of events.

The same happens with the official SDKs. The Rust SDK ships an example server
that accepts only 2026-07-28. A client on the Python SDK 1.30.0 gets
`Unsupported protocol version` from it and stops.

## Why the usual workaround does not help

The standard answer to "my client cannot reach this server" is a local proxy
that the client starts as a stdio server. I tried two popular ones against a
modern-only server, with a legacy client on the stdio side:

| tool | what happened |
|---|---|
| `mcp-remote` 0.14.3 | never connected; the server saw only repeated `GET` requests |
| `supergateway` 4.1.0 | got a 404 from the server and closed the connection |

That is one version of each, default options, against a server I wrote
myself. I did not go looking for a flag that changes it. But it matches what
you would expect: these tools translate transports, stdio on one side and
HTTP on the other. The problem here is not the transport. It is that the two
sides speak different protocols over it.

## The bridge

[mcp-era-bridge](https://github.com/talhayme/mcp-era-bridge) answers the
legacy handshake itself, connects to the server as a modern client, and
relays each request.

```
legacy client ──2025-11-25 and earlier──▶ mcp-era-bridge ──2026-07-28──▶ server
```

It runs in front of a server, so that clients connect by URL and install
nothing:

```sh
mcp-era-bridge https://internal.example.com/mcp --listen 0.0.0.0:8080 --allowed-host mcp.example.com
```

It is about 700 lines of Rust on top of `rmcp`, the official Rust SDK, which
already implements both eras. Most of the bridge is wiring between the SDK's
legacy server side and its modern client side. Three things needed more than
wiring.

**A server that asks a question mid-call.** The old protocol let a server
send the client a request: ask the user something, ask the model something,
list the workspace roots. The new one has no server-to-client requests. A
server that needs input returns `input_required` instead of a result, and the
client retries with the answer attached. A legacy client has never heard of
that. So when the server returns `input_required`, the bridge turns each
question into the old kind of request, sends it to the client, collects the
answers, and retries upstream itself. The client sees a tool call that
paused to ask something, which is what it always saw.

**Notifications.** A modern server sends nothing unasked. A change to its
tool list is announced only on a `subscriptions/listen` stream, and a legacy
client never opens one. The bridge opens it on the client's behalf and
forwards what arrives. It tells the client to expect list-change
notifications only for the ones the server agreed to send.

**Authorization.** The SDK's server side can only answer with a JSON-RPC
message. An upstream `401` therefore reached the client as an error inside a
`200`, and no client starts an authorization flow on that. Before handing a
session-opening request to the SDK, the bridge now asks the server one cheap
question with the client's credentials, and returns a `401` or `403` exactly
as it came, `WWW-Authenticate` header included.

## Does it work

Two legacy clients, the Python SDK 1.30.0 and the TypeScript SDK 1.32.1, are
driven through the bridge to the conformance suite's reference server on its
2026-07-28 path. Each client runs in both modes, connecting by URL and
starting the bridge over stdio.

| check | Python 1.x | TypeScript 1.x |
|---|---|---|
| handshake, tools, prompts, resources | pass | pass |
| eight tools that ask for input mid-call | 8 of 8 | 8 of 8 |
| list-change notifications reach the client | pass | not run |
| `401` with the challenge for a bad token | pass | not run |

The eight input tools cover one question, three at once, two rounds, and a
server that signs its state and checks it on the retry.

Then Cursor, the client this is for. Three entries, same server:

| Cursor entry | result |
|---|---|
| the server's URL | error, as in the log above |
| the bridge's URL | connected, 3 tools |
| the bridge as a command | connected, 3 tools |

Through the bridge, `echo` returned its text. `greet` asks for a name in the
middle of the call: Cursor showed me the question, I typed `tal`, and the tool
returned `Hello, tal!`. The server's log shows the two requests that takes,
one answered with `input_required`, then the retry carrying the name.

## What I got wrong on the way

**I built the wrong shape first.** I set out to build something that stands
in front of a server so that nobody has to install anything. The first
version was a program each user installs and starts over stdio, because one
client per process means no sessions to manage, and that was easier. It
worked, and it was not what I had said I would build. The server-side mode
came second and is now the main one; the stdio mode stays for servers you do
not operate.

**My own improvement hung the handshake.** Relaying notifications means
opening a subscription upstream while the client waits for its `initialize`
answer. Against the Rust SDK's example server that worked. Against the
reference server, which advertises list changes but never acknowledged my
subscription, the bridge waited forever, and so did the client. I found it
because the full test run, which had passed an hour earlier, sat for ten
minutes. The subscription now gets three seconds; a server that does not
acknowledge it is served without notifications and a warning is logged. I
had tested the new feature only against the server I wrote it for.

**The authorization probe ran before the Host check.** The bridge refuses
requests whose `Host` it does not expect, which protects a local bridge from
DNS rebinding. My probe went upstream before that check, so a request that
was about to be refused still caused a request to the server. It is now
skipped for such requests, and a test counts the requests reaching the server
to prove it.

## Caveats

Almost nobody is hit by this today. In a sample of twenty servers from the
official registry, eleven answered without credentials, and all eleven
accepted the legacy handshake. Modern-only servers are rare. The problem
grows as servers migrate, and the reason to migrate, dropping session state,
is exactly what a server gives up again if it keeps serving legacy clients
itself.

The bridge keeps each legacy session in the memory of one process. Run two
behind a load balancer and you need sticky sessions for the bridge. The
server behind it needs none, which is the point, but the state has moved, not
vanished.

OAuth is passed through, not performed. The challenge, the metadata relay and
a presented token are tested. A complete flow against a real authorization
server is not.

Resource subscriptions, progress notifications and cancellation are not
relayed.

One editor, one version of it, on one machine.

## Where it is

```sh
cargo install --git https://github.com/talhayme/mcp-era-bridge
```

The repository has a small modern-only server in `examples/`, so the three
Cursor entries above take two commands to reproduce. If you run a client that
still opens with `initialize`, I would like to know what it does.
