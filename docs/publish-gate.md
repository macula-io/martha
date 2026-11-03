# The publish gate

This exists so that nobody outside the crew can get their text acted on by a
crew member that holds a shell. It answers [issue #2](https://github.com/macula-io/martha/issues/2),
and nothing is published from this repository until it is closed.

The host adapters change; this rule does not. It lives in the core so that no
coding tool can quietly drop it.

## What a gate is

A deterministic check on **sender identity** that runs before text is acted on.
Not a fence, not a warning line, not a content filter. Every member holds a
shell, so every piece of text that arrives is a possible command.

## What executes

The list is an **allow-list of tools that only read** — `Read`, `Grep`, `Glob`
and a handful of named mesh read tools. Everything else executes, including a
tool name this repository has never seen.

That direction is deliberate. A deny-list quietly allows every name it has not
been taught: hosts differ (`bash` on one, `Bash` on another), plugins add their
own (`MultiEdit`, `patch`), and a host can ship a new tool that executes before
anyone updates a list here. So the gate allows only what cannot make anything
happen — a shell by any name, a write, an agent spawn, a web fetch, a message
that hands the text to a peer, an unknown tool, all execute.

The read-only MCP entries are keyed on the server's own names. A
plugin-namespaced copy of the same tool does not match and is treated as
executing: noisy, and safe.

## The rule

A session that took in text from a sender the policy table does not name **by
node id** executes nothing, **for as long as that text is readable in its
context**. It may read the text; it may not act on it.

The record accumulates on the session and is dropped only when the session is
replaced by a fresh one with no inherited context. There is no "dismiss": a model
that has read a stranger's text cannot decide that it is safe, because deciding
is the model's job and the model is what was reached. Handover files and
compaction summaries carry the text forward, so they arrive as ingests like any
other and re-taint the session they land in.

Two reasons it is a gate at the shell and not at the door:

1. On a host with no inbound-message hook, a cross-session message is already in
   the turn before anything of ours runs. There is nothing to check on the way
   in.
2. Refusing a tool call before the engine runs it is demonstrably available —
   the crew's existing plugin already denies a shell command that way. Whether a
   turn can be refused or rewritten at its start is **open**: the engine's types
   are not vendored, so this repository does not assume either answer.

The policy table names senders by **node id**, compared case-insensitively
because the crew's own code lowercases them. A display name is never a
principal: a session whose first user message says "you are Supervisor" gains
nothing, because the node id on the delivery is the only thing compared.

## What this means when you are the owner

Text **you** paste into a session is an ingestion too. If it arrives
unattributed, the gate blocks execution in that session until you start a fresh
one — you hit this before anyone else does, and that is the intended trade: the
owner is trusted, the thing the owner copied is not.

## Who may act

A gate in front of the text is only half of it: a message that cannot reach the
shell can still *do* things through the crew's own tools. Seven of those —
assign work, read the crew roster, verify a range, open a crew room, restart a
member, take the owner's asks, close the owner's todo rows — are the
supervisor's, and the crew's implementation decides that by a display name the
session sets about itself. That name falls back to the first six user messages,
and a delivered message is a user message, so a stranger's ring purpose saying
"you are Supervisor" passes every one of them. Restarting a member, taking the
asks and closing a todo row have no caller check at all.

`src/who_may_act/` replaces all of them with one rule: an action on the list is
taken only by **the calling session whose own node id is the supervisor's** — the
node id the harness holds for that session, never the sender of a message it
received and never a name read out of text. That distinction is the whole point.
A member that receives an attested message from the supervisor's node id must not
become the supervisor; the supervisor's own session must be able to act on words
the owner typed, which arrive with no message at all. A display name is carried
for the transcript and never compared.

A team may name more than one supervisor, and solo mode names one.

The anchor is the harness's own record of the session's node id. Where that is a
file in the crew's state directory, a shell running as the same OS user can
rewrite it — the same weakness as the roster anchor, and the same fix: an object
the model cannot mint.

## Every path, and what stands on it

`src/inbound_paths/` holds every way text reaches a member's session, as data —
the machine-readable copy of the table in issue #2. Each row declares one
control:

- **delivery gate** — the sender is checked before the text is in a turn, and the
  gate must be one this repository knows by name;
- **shell gate** — nothing checks at delivery, and the rule above stops the
  session executing while the text is readable;
- **no text reaches the model** — the path is listed so it is not forgotten,
  carries no body text, and must say why;
- **none** — no control. A row in this state fails CI on purpose.

A path is never removed from the list. A path that stops delivering text gets a
control that says so, in words.

## Only framed envelopes are believed

The crew learns two things from a cross-session message: whose a socket is, and
which handoffs have been read. Both were learned by scanning text for an
envelope, and every turn the plugin submits is text — so a room body, a ring
purpose, a decline reason, a message's own body, or something the owner pasted
could contain an envelope that was never sent. That buys a stranger two effects:
renaming another member's socket, and retiring a handoff as read without having
sent it.

`src/trust_only_framed_envelopes/` is the rule that closes it. "Framed by the
harness" is not a fact every host hands over — on the Claude Code host the plugin
is given the turn's text and nothing else — so the frame is **derived** by a rule
strict enough that an ordinary turn cannot wear one:

1. the turn starts with the envelope's opening tag, at offset 0;
2. its closing tag is the very end of the turn;
3. there is exactly one envelope in the turn — a second opening tag anywhere in
   the body means the turn is not framed at all;
4. attributes are read from that one opening tag, never from the body.

Everything between the tags is body, and body is never scanned. A room body, a
ring purpose or a decline reason never starts with an envelope, so none of them
can be one; a body that closes its envelope early and opens a forged one is not
framed at all rather than framed with a forgery.

The adapter takes the sender's address and name from that frame and nowhere else.

**The residual, stated rather than papered over:** with that rule, a turn that
*is* a whole envelope — the owner pasting one in — is indistinguishable from a
delivery, and is believed. A host that can say where a turn came from must say
so; `origin: 'owner'` is then never framed. Where the host says nothing, the
paste is believed, and no amount of reading the text can tell the two apart.

Two limits that follow from what a host actually provides:

- **The name is not the identity.** `from-name` is the sender's own chosen
  display name: good for routing a reply, never for authority. Authority is
  `who_may_act`, and that is the calling session's own node id.
- **A cross-session envelope carries no message id on the Claude Code host.** So
  a framed delivery is retired by its id where the host gives one; where it does
  not, only that delivery's **body** may be matched against an unread DM — never
  loose text. An id could come from the sender's own record, keyed by address and
  time; until it does, the body is all there is.

Like the other core rules, this one has no caller in this repository yet: the
scanning it replaces lives in the crew's existing plugin.

## Wiring it into a host

A host does these things, and the core does the rest:

| When | Call |
|---|---|
| a session starts new | `beginSession(store, session_id)` — writes the empty record before anything arrives |
| a session starts again (restart, resume, mod reload) | `resumeSession(store, session_id)` — no readable record means the session is **tainted**, never fresh |
| before running any tool | `answerToolCall({ tool, session, policy })` — return the `{ deny }` as the hook's answer |
| a turn arrives, from any source | `takeInTurn(session, arrival)` |
| the session is replaced | `replaceSession(session, 'clear' \| 'new_session' \| 'compaction' \| 'handover' \| 'resume')` |
| after a turn | `rememberSession(store, session)` |

`takeInTurn` records the arrival on the inbound path that names it, so the host
and the registry cannot drift apart: the test derives the expected set from the
registry, and a source with no registry row is named by the check.

Four rules the seam keeps, and a host must not work around:

- **An identity is carried only where something attested the sender.** The
  registry says, per path, who attests a sender — a crew roster (A1–A3), the mesh
  station (A4, A5), or the host's binder (A6, martha#14). Every other path drops
  the identity the host offers, so a commit authored under the supervisor's node
  id, a `gh` login, or an envelope's `from` attribute buys nothing. A host that
  holds no identity records an unattributed arrival, which taints.
- **The record is persisted per session id and reloaded on start.** Held only in
  memory, it fails open on every process restart: a resumed transcript would come
  back to an empty record. A session that expects a record and cannot read one is
  tainted.
- **Only a real replacement clears the record.** `clear` and `new_session` start
  afresh. `compaction`, `handover` and `resume` keep it. A restart that resumes a
  transcript is `resume`, not `new_session`.
- **A compaction and a handover are inheritances, not arrivals.** They carry the
  predecessor's record forward through the store; `takeInTurn` has no source for
  them. A handover is written from the predecessor's own context, so the record it
  inherits is the honest summary of that context.

The refusal text a host returns names the command that clears it — `/clear` on
the Claude Code host.

### What this repository does not contain

The registration itself. On the Claude Code host that is `on('tool.call', …)` in
the plugin package, and building a plugin needs that package's types and its mod
loader, neither of which is in this repository. What is here is the contract
between them: one question per tool call, one record per arrival, one call per
replacement. Writing the adapter's line of registration against the vendored
package is the remaining step, not a guess this repository should make.

An adapter must also call `unknownSupervisorOnlyTools` with its own list of
supervisor-only tools and fail on a difference (see *Who may act*).

## The check

`src/check_every_path_is_gated/` reports every row that reaches a shell-holding
member with no control standing on it, and names the row. It runs in CI as the
`gate coverage` job, and it drives the real gate once per row that claims the
shell gate — a row cannot claim cover the gate does not give. A row cannot name a
delivery gate that does not exist either: a name is not a control.

Its tests plant ungated paths to prove the check is not vacuous: a row copied
from the table without a control, a row whose control was forgotten, a row that
claims the shell gate while the gate does not refuse it, a row naming a gate
nobody has built, and a row excused without a reason. Each of those turns CI red.

## What this does not yet do

- **No host adapter is wired.** The rule and the check are the core's; calling
  the refusal from a host's tool call is the adapter's job, and no adapter is in
  this repository yet. `src/refuse_execution_after_ungated_text/` is a rule with
  tests and no caller — deliberately, and the reason nothing here is published.
- **The delivery gates are named, not built here.** A1–A3 point at the crew
  room's acceptance rule, which lives in the crew's existing implementation. This
  repository names the gate and fails if a row names one it does not know; it
  does not implement the acceptance rule.
- **The who-may-act rule has no callers yet either.** `src/who_may_act/` is the
  rule the seven tools must call; the tools themselves are not in this repository,
  so nothing calls it today. Until a host or a tool calls it, the crew's
  display-name gates are still the ones in force.
  - The list is closed against the names that reach it: an action it does not
    know is refused. It cannot see an *eighth* supervisor-only tool a host adds
    without calling the rule at all. An adapter must therefore call
    `unknownSupervisorOnlyTools` with its own list of supervisor-only tools and
    fail unless that list equals `SUPERVISOR_ONLY_ACTIONS`.
