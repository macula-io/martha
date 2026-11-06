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
  gate is a function this repository implements and the check drives (see *The
  room's acceptance rule* below);
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
| a session starts, by any host event | `startSession(store, events, { event, session_id, predecessor_id })` — the host's declared events say whether the id stays, a new id inherits the predecessor's record, or a new id starts fresh; an undeclared event has **lost its record** |
| a session starts new, outside the declared events | `beginSession(store, session_id)` — writes the empty record before anything arrives; an id that already holds a record has **lost its record** and nothing is overwritten |
| a session starts again (restart, resume, mod reload) | `resumeSession(store, session_id)` — no readable record means the session is **tainted**, never fresh |
| a member hands over | the host writes the file, then `stampHandover(stamps, { member, session }, { file, content })` — never the model's `Write` |
| a session reads a file the stamp store knows | `readHandover(store, stamps, { member, session }, { file, content })` — on **every** file read, the model's own `Read` included: the host looks the path up in the stamp store, because a plain `Read` of a handover file would otherwise take the text in without the record |
| before running any tool | `answerToolCall({ tool, session, policy, input })` — return the `{ deny }` as the hook's answer |
| a member reads a room | `readRoomThroughItsGate({ session, room, envelopes, rosters, self_node_id })` — the raw mesh reads are refused |
| a turn arrives, from any source | `takeInTurn(session, arrival, binder)`: `bindNothing` on a host that cannot attest who sent a cross-session message |
| the launcher starts or stops a member | `recordMemberLaunch(store, processes, launched)`, `recordMemberStopped(store, member_name)` |
| after a turn | `rememberSession(store, session)` |

`takeInTurn` records the arrival on the inbound path that names it, so the host
and the registry cannot drift apart: the test derives the expected set from the
registry, and a source with no registry row is named by the check.

The rules the seam keeps, and a host must not work around:

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
- **A session id is never started twice.** Only a start under a new id with an
  event declared `fresh` begins with no record. `compact` and `resume` keep the
  id and the record. A fresh start on an id that already holds a record has
  lost its record and overwrites nothing. A lost record is remembered as lost,
  so a second restart does not turn it fresh.
- **A compaction and a handover are inheritances, not arrivals.** They carry the
  predecessor's record forward through the store; `takeInTurn` has no source for
  them.
- **A refresh is not a clear.** On the Claude Code host a crew refresh is a
  handover, then `/clear`, which starts a **new session id**. Keyed by id alone,
  the successor would start clean and read what its tainted predecessor wrote.
  So the host declares every event that starts a session
  (`CLAUDE_CODE_SESSION_EVENTS`): the `/clear` the crew's mod ran itself is
  `crew_refresh`, an inheritance from the predecessor's id, which the mod knows
  and the model never supplies. A forked resume arrives as `resume` under a new
  id with no record, and has lost it. Only `startup` and an owner's own
  `/clear` are fresh, and only until the session reads a handover. The events
  the host emits are listed separately (`CLAUDE_CODE_EMITTED_SESSION_EVENTS`),
  and `gapsInSessionEvents` fails CI on one the declaration does not cover.
- **A handover is stamped by the host.** A tainted session cannot run `Write`,
  so the host writes the handover for the member and stamps it with the member,
  the predecessor's session id, a digest of the content, and the length and a
  digest of the predecessor's record as it was at stamping. Reading it inherits
  the predecessor's record **from the session store**, never from the file, and
  only if that record still begins with what was stamped. No stamp, a digest
  that does not match, a predecessor whose record is gone, or one reset since
  the stamp: the reader has lost its record. Another member's handover is a checkout file
  (B4), unattributed, and taints.
- **There is no release.** A member tainted once stays tainted through every
  refresh until a fresh start that reads no handover. An owner release would be
  the owner's own signed act, never a model's; it is not built (martha#2, the
  open question under item 6).
- **A room is read through its gate, never raw (B1).** The raw mesh reads
  (`RAW_MESH_READS`, plus `mesh_say` when it waits for a reply) are refused in
  every session, tainted or not, under every server namespace: the match is on
  the tool's own name after the last `__`. The one read that remains returns
  only what the room's own delivery gate admits, with the roster the registry
  binds to that room, and says how many envelopes it withheld, never their
  text, sender or kind. Each admitted envelope is an ingestion with its
  sender's node id, so the shell is kept only when the policy names every
  sender. The pointer a long room delivery carries must name this read, never
  a raw tool. A host that registers the read under its own tool name must also
  allow that name while tainted, or a tainted member cannot read its room.

Every refusal a host returns says what clears the taint in the words of one
constant, `WHAT_CLEARS_IT` in `src/refuse_execution_after_ungated_text/`, so
the text cannot drift from the rule.

### Who sent a cross-session message

`src/attribute_a_cross_session_sender/` is the binder on the A6 row. It exists so
that a crew member's message keeps the receiving session's shell because the
host, not the text or a socket, says which node id sent it.

The chain has three links:

1. **the host** attests the process that sent the delivery, out of band (on a Unix
   socket the kernel knows the connecting pid). This is `arrival.sender`, never
   anything parsed from the turn's text;
2. **the launcher's record**, written by `recordMemberLaunch` when it starts a
   member, pairs that pid, and the time the kernel says that process started,
   with the member it launched;
3. that record names **the member's node id**, which is what the shell gate reads.

The rules it keeps, from the threat model on martha#14:

- **Bind nothing until a host attests the sender.** A host that cannot say which
  process sent a delivery passes `bindNothing`, and every cross-session message
  stays unattributed and taints. On the Claude Code host today that is every
  delivery: the plugin is handed the turn's text and nothing else. A text-only
  turn binds only where the host also reports `origin: 'harness_delivery'`; a
  whole envelope the owner pasted stays unattributed even with a sender beside it.
- **Never from text.** On this path `takeInTurn` ignores any `from_identity` the
  host offers; the binder's answer is the only identity. An envelope's `from`,
  its `from-name`, a socket path and a name in the body buy nothing.
- **A record is valid for one process.** A record whose process is gone, or whose
  pid now belongs to a process that started at another time, is dead: a reused
  pid or a socket bound at a dead member's path inherits nothing. A relaunch
  replaces the member's record.
- **A record is valid for one boot.** A pid and its start ticks repeat after a
  reboot, so the start time also names the boot (the kernel's `boot_id`). A
  record from another boot, or a boot that cannot be read, is dead.
- **Never silently widen.** No record, two records for one pid, or a records
  directory holding anything the launcher would not write: nobody.

`memberLaunchesDirectory(directory)` keeps one file per member, so two launches
at once never write over each other's record. Each file is written whole and
renamed into place. Read back, the directory vouches for nothing unless it is a
real directory owned by this user that nobody else may write into, holds only
records, and every record is opened without following a link and checked on the
opened file itself (a regular file, owned by this user, mode `0600`, one row that
names the member its file is named for) before that same file is read.
`linuxProcessTable` reads a process's start time and the boot from `/proc`;
where there is no `/proc`, every process reads as absent and nobody binds.

**The residual, accepted for now:** every member runs as the same OS user, so a
member that already holds a shell can rewrite the records or read another
member's mesh key. The modes and owners checked are speed bumps, not a boundary. The signed
roster (#2 item 7) closes it; running untrusted checkout code under a member is
[#24](https://github.com/macula-io/martha/issues/24).

### What this repository does not contain

The registration itself. On the Claude Code host that is `on('tool.call', …)` in
the plugin package, and building a plugin needs that package's types and its mod
loader, neither of which is in this repository. What is here is the contract
between them: one question per tool call, one record per arrival, one call per
replacement. Writing the adapter's line of registration against the vendored
package is the remaining step, not a guess this repository should make.

An adapter must also call `unknownSupervisorOnlyTools` with its own list of
supervisor-only tools and fail on a difference (see *Who may act*).

## The room's acceptance rule

`src/admit_a_room_message/` is the rule behind both delivery gates the registry
names. Six questions, all of which must answer yes:

1. is the sender a node id at all? — an empty or malformed one is nobody;
2. did something attest the sender?
3. is the sender on this room's roster?
4. is the sender someone other than this session?
5. is the message addressed to this session, by node id?
6. is it a kind of message people talk with?

**The two names are two rosters, not two rules.** `crew-room-acceptance` checks
the crew's roster and `shared-room-acceptance` the board's, and each name is bound
to its roster in the registry rather than left to the caller. What the shared room
gives nobody is authority — nothing said there authorises anything — which is why
the roster question comes before anything the body says.

The rule does not cap or fence the body — that is the room's — and it trusts the
roster's contents, which is the anchor weakness named separately.

## The check

`src/check_every_path_is_gated/` reports every row that reaches a shell-holding
member with no control standing on it, and names the row. It runs in CI as the
`gate coverage` job, and it drives the real gate once per row that claims the
shell gate — a row cannot claim cover the gate does not give.

A delivery gate is driven once per question it has to answer: it must refuse an
unattested message, a session talking to itself, a message addressed elsewhere, a
kind that is not talk, a sender the roster does not name and a sender that is not
a node id — and it must admit a rostered member. A name with no implementation, a
gate that admits everyone, a gate that refuses everyone and a gate that answers
only the roster question are all caught.

Its tests plant each of those mistakes to prove the check is not vacuous: a row
copied from the table without a control, a row whose control was forgotten, a row
claiming the shell gate while the gate does not refuse it, a row naming a gate
nobody has built, a delivery gate that admits a stranger, one that refuses a
member, and a row excused without a reason. Each of those turns CI red.

## What this does not yet do

- **No host adapter is wired.** The rule and the check are the core's; calling
  the refusal from a host's tool call is the adapter's job, and no adapter is in
  this repository yet. `src/refuse_execution_after_ungated_text/` is a rule with
  tests and no caller — deliberately, and the reason nothing here is published.
- **No host attests a cross-session sender yet.** The binder is built and
  tested; no adapter in this repository hands it a sender, so every
  cross-session message still taints. A host gains it by attesting the sending
  process out of band and passing `binderOverLaunches(store, processes)`.
- **The delivery gate has no caller yet.** `src/admit_a_room_message/` is the
  rule; the room code that delivers messages is the crew's existing implementation,
  so nothing in this repository calls it. A host must call it before it turns a
  message into a turn, and refuse the message when it says no.
- **The who-may-act rule has no callers yet either.** `src/who_may_act/` is the
  rule the seven tools must call; the tools themselves are not in this repository,
  so nothing calls it today. Until a host or a tool calls it, the crew's
  display-name gates are still the ones in force.
  - The list is closed against the names that reach it: an action it does not
    know is refused. It cannot see an *eighth* supervisor-only tool a host adds
    without calling the rule at all. An adapter must therefore call
    `unknownSupervisorOnlyTools` with its own list of supervisor-only tools and
    fail unless that list equals `SUPERVISOR_ONLY_ACTIONS`.
