---
title: "One error code, six files: a small fix in the Go MCP SDK"
description: "The official Go MCP SDK answered a request sent before initialize with JSON-RPC error code 0. Changing it to -32600 takes five lines. The merged pull request touches six files, because the SDK treats any change a caller can observe as something users must be able to switch off. What that rule looks like from the contributor's side."
date: 2026-10-12
tags: [mcp, go, open-source, compatibility, sdk]
---

Send a Go MCP server `tools/list` before `initialize` and, until this week,
it answered:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":0,
 "message":"method \"tools/list\" is invalid during session initialization"}}
```

The message is right. The code is `0`, which is what an integer field holds
when nobody set it.
[Someone reported it](https://github.com/modelcontextprotocol/go-sdk/issues/1367)
on 10 October. Their project wraps the transport to rewrite `0` into `-32600`
before the answer reaches a client, and they wanted to delete that wrapper.

I did not find this bug. I traced it, proposed a patch, and was told the
patch was incomplete. This post is about what was missing, because it is the
part of contributing to an SDK that the diff does not show.

## Where the zero comes from

The server refuses the request with a plain Go error:

```go
return nil, fmt.Errorf("method %q is invalid during session initialization", req.Method)
```

One layer down, the JSON-RPC code turns errors into wire errors. It copies a
code only when the error is, or wraps, a wire error. A plain error gets its
message and nothing else, so the code stays at Go's zero value.

Nobody chose `0`. It is what falls out when an error is returned without a
code. Two tests had recorded it as the expected answer all the same.

## Is it even a bug?

The maintainer's first reply was a fair question: where does the
specification ask for `-32600`?

It does not. MCP tells the client not to send requests before the handshake
completes and says nothing about how the server refuses one. JSON-RPC 2.0
requires the code to be an integer and reserves a range; `0` is outside the
reserved range and therefore allowed. Strictly, `-32600` means "the JSON sent
is not a valid Request object", and a well-formed `tools/list` is one.

So the argument is not conformance. It is that `0` tells a client nothing and
cannot be told apart from a code that was never set. I wrote that in the
issue, said where the zero comes from, and offered a patch that returns
`-32600` at that one place.

## The reply

> this change would have to be gated with an MCPGODEBUG variable as it
> represent a behavioral change.

The Go SDK has a
[compatibility page](https://github.com/modelcontextprotocol/go-sdk/blob/main/docs/mcpgodebug.md)
for this. When a fix changes what a caller can observe, it ships with a named
switch that restores the old behavior, read from the `MCPGODEBUG` environment
variable:

```sh
MCPGODEBUG=nopreinitinvalidrequest=1 ./my-server
```

The switch is temporary. This one is listed under 1.9.0 and is scheduled for
removal in 1.11.0. A user whose code depends on the old answer gets two minor
releases to notice and adapt, without pinning the SDK.

The page lists 19 switches added since 1.4.0. Most are like this one: a
default that was wrong, a fix, and a way back.

## What the pull request became

The change in behavior is five lines:

```go
err := fmt.Errorf("method %q is invalid during session initialization", req.Method)
if nopreinitinvalidrequest == "1" {
	return nil, err
}
return nil, &jsonrpc.Error{Code: jsonrpc.CodeInvalidRequest, Message: err.Error()}
```

[The pull request](https://github.com/modelcontextprotocol/go-sdk/pull/1393)
is 49 added lines in six files:

| file | why |
|---|---|
| `mcp/server.go` | the five lines, and the switch variable with its comment |
| `mcp/server_test.go` | one test, run with the switch off and on |
| `mcp/streamable_test.go` | an expected answer that had `0` in it |
| `lifecycle.txtar` | a recorded exchange that had `0` in it |
| `internal/docs/mcpgodebug.src.md` | the entry for the switch |
| `docs/mcpgodebug.md` | the same entry, generated from the source file |

It was approved and merged 77 minutes after I opened it.

Most of that speed is not mine. The maintainer had said what would be
accepted before I wrote the final version, so the review had nothing left to
decide.

## Caveats

The fix covers one place. Every other plain error a handler returns still
reaches the wire as code `0`, because the conversion underneath is unchanged.
I left it alone on purpose: changing the default would alter many answers at
once and needs a decision from the maintainers, not a patch from me. I have
not counted how many such places there are.

Only legacy sessions are affected. A server on the 2026-07-28 revision has no
handshake to be early for, and the maintainer noted that its error codes are
explicit.

The official clients do not send requests before `initialize`, so most users
never saw this. It matters to proxies, test tools and hand-written clients.

`-32600` is a convention here, not a requirement. A code from the
implementation-defined range would have been defensible too.

## What I take from it

In a library, the fix is the small part. The larger part is the answer to
"what happens to the people who already built on the wrong behavior", and a
project that has been burned before has that answer written down as a
procedure. The Go SDK's version is cheap for the contributor, about forty
lines here, and it turned a change the maintainer was questioning into one he
merged the same day.

The quickest way to learn that procedure is to read the project's last few
merged fixes of the same kind.
