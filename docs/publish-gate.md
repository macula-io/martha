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

`src/inbound_paths/` holds every way text reaches a member's session, and every
way a checkout gets code started on a member's machine, as data — the
machine-readable copy of the tables in issues #2 and #16. Each row declares one
control:

- **delivery gate** — the sender is checked before the text is in a turn, and the
  gate is a function this repository implements and the check drives (see *The
  room's acceptance rule* below);
- **shell gate** — nothing checks at delivery, and the rule above stops the
  session executing while the text is readable;
- **no text reaches the model** — the path is listed so it is not forgotten,
  carries no body text, and must say why;
- **launch gate** — for code the host starts by itself (below), the only
  control such a row may declare;
- **none** — no control. A row in this state fails CI on purpose.

A path is never removed from the list. A path that stops delivering text gets a
control that says so, in words.

## Code the host starts by itself

This section answers [issue #16](https://github.com/macula-io/martha/issues/16),
which has the threat model.

A coding tool reads files from the directory it starts in and starts what they
name: a project's tool servers, its hooks, its plugins. That is not text for the
model. No tool is called and no model runs, so the shell gate has nothing to
refuse, and no sender exists for a delivery gate to check. Whoever last wrote
those files runs code as the owner's OS user. The plainest case is a reviewer
checking out a pull request to run its tests.

These are the `launched` rows: C1 for a checkout's tool-server config, C2 for
its hooks and plugins. What was seen on the two hosts, in a fresh checkout whose
config only touched a marker file (`npm run probe:launch`, the program in
`src/probe_launch_hosts/`, which exits non-zero when a host does anything else):

| Host, and how it was started | What starts with nobody asked |
|---|---|
| Claude Code 2.1.318 by hand, interactive | nothing: a project server waits for approval. The approval is stored as a list of **server names**, so a later change to an approved server's command is not asked about again |
| Claude Code 2.1.318 by hand, headless `claude -p` | the project's tool server, and its `SessionStart` hook |
| OpenCode 2.2.5 by hand | the project's tool server and its plugin, even for `opencode debug config` |
| Claude Code 2.1.318 as Martha starts it, config rewritten after approval | the approved server and hook only; the rewritten ones do not start |
| OpenCode 2.2.5 as Martha starts it, config rewritten and a plugin added after approval | the approved server only; the rewritten server and the added plugin do not start |
| OpenCode 2.2.5 as Martha starts it, the owner's environment setting both project-config switches to `0` | the same: the approved server only |
| Claude Code 2.1.318 as Martha starts it, headless, one tool call, an after-call hook that only reports | the after-call hook, then the approved `Stop` and `SessionEnd` hooks: the host goes on past a hook that returns |
| Claude Code 2.1.318 as Martha starts it, headless, one tool call, an after-call hook that waits for the launcher to SIGKILL the member's process group | the after-call hook only: neither the approved `Stop` nor the `SessionEnd` hook runs |

The host's own approval is name-keyed where it exists at all, so it cannot be the
control. `src/refuse_launch_of_unapproved_config/` is five rules:

1. **The host never reads the checkout's own config.** `prepareLaunch` copies the
   approved files into a snapshot outside the checkout and returns the switches
   that start the host on that copy with project config off: for Claude Code
   `--setting-sources user` and `--strict-mcp-config` with `--mcp-config` and
   `--settings` naming the copy, so only the servers passed start; for OpenCode
   `--standalone` with `OPENCODE_CONFIG` naming the copy and both of its switch
   names, `OPENCODE_CONFIG_PROJECT_DISABLE=1` and
   `OPENCODE_DISABLE_PROJECT_CONFIG=1`: OpenCode reads the first that is set, so
   setting only the second lets an inherited `=0` of the first win. The
   inherited `OPENCODE_CONFIG_CONTENT` and `OPENCODE_CONFIG_DIR` are dropped
   (`launchEnvironment`), since each brings config in from somewhere else. The
   background OpenCode service ignores a client's environment, hence
   `--standalone`. A pull that rewrites the config while the host runs changes a
   file the host is not reading, so a host that reloads its config live reloads
   the snapshot. Each copied file is hashed again as it is copied, and a file
   that changed since the decision is refused rather than carried.
2. **Approval is by content, never by name, and covers what the config runs.**
   The fingerprint holds every listed file's content hash, every file under a
   listed directory, which of the files are absent, and the checkout's work
   tree: the tree git would write if every tracked change and every untracked,
   unignored file were staged now (`checkout_tree.ts`, in a scratch index, with
   inherited `GIT_*` variables dropped and fsmonitor off). A pull that changes
   only the script an approved hook runs changes the fingerprint. It is read
   before every tool call, so a checkout git reports clean reads as HEAD's own
   tree without staging anything.
3. **The directories above count**, up to but not including the stop directory
   the launcher names (the owner's home); a start outside it is read up to the
   root. This is for a host started by hand, which walks up — OpenCode with no
   stop at all, so it also reads `~/.opencode` and `~/opencode.json` as project
   config. A planned launch reads none of them.
4. **What the gate cannot pin down is refused**: a symlink, even an approved one;
   a path that is not a plain file or directory; config in a directory that is
   no git checkout, or in one whose top is the stop directory or above it (a
   home kept in git), where nothing pins what it runs and staging the tree would
   copy a whole home into the object store; a request that does not show
   every listed file as read, so a reader that returned nothing cannot pass for
   an empty checkout; two files that would be passed through one carrier; and a
   host with no file list.
5. **No config needs no approval.** A checkout holding none of the files starts,
   still with project config off.

Only the owner approves a fingerprint, typed in that member's tab and logged
(martha#1, decision 4). The refusal names the files and the fingerprint to
approve.

What the plan leaves out, stated rather than hidden:

- **Not every listed file is carried.** A checkout's
  `.claude/settings.local.json` (a member's own permission answers) and its
  `.opencode` directory (its plugins) are fingerprinted but never loaded;
  `prepareLaunch` returns them as `not_carried` for the launcher to show the
  owner.
- **The tree does not cover** a file git ignores and does not track — the
  checkout's author cannot ship one; it is written on this machine by a command
  the member ran (A13) — nor the inside of a submodule beyond the commit its
  parent records, nor a change the checkout's own index hides from
  `git status` (assume-unchanged, skip-worktree): those flags are the
  member's, and no commit carries them. Of the same class: a member's own git
  config whose `include.path` names a tracked file, which lets the checkout's
  author define a clean filter that reading the tree runs.
- **The fingerprint-to-launch race**: between `prepareLaunch` and the host's
  start, a script the snapshot runs can still be rewritten in the checkout, and
  a `SessionStart` hook runs it before the first tool call is checked.
- **Inside a turn**, the snapshot's hooks run the checkout's scripts as they
  are at that moment. The launch is checked before every call
  (`answerToolCall`) and after it (`recheckLaunch`). The stop after a call is
  not a report: Martha's after-call hook does not return until the launcher has
  sent SIGKILL to the member's whole process group, the host and its tool
  servers. A host waits for its hooks, so nothing fires past that point. A hook
  that only reported would let the host go on, and a fast text reply would fire
  the approved `Stop` hook first; a SIGTERM or a normal exit fires the
  `SessionEnd` hooks on the way out (`npm run probe:launch` shows both). What
  is left is the hooks of the one call that changed the tree, which run in
  parallel with Martha's own (`PreToolUse`/`PostToolUse`); the stop does not
  undo what they ran.
- **Agents a checkout defines** (`.claude/agents`) may name hooks and tool
  servers in their frontmatter. They start only when the model spawns that
  agent, which is a tool call the shell gate refuses while unapproved text is
  readable (A7), and their files are in the tree the approval binds.

**Where Martha does not start the host** — the owner opens the coding tool by
hand and Martha loads inside it — the host has started these before any of
Martha runs. Each launched row says so in its `residual`, and the check fails a
row that does not. The adapter must then refuse that session a place in the
crew: the machine is already reached, the crew is not.

### Code a checkout runs through the member's own commands

[Issue #24](https://github.com/macula-io/martha/issues/24), option 3, as a
partial measure. A member commits, installs or runs a shell in a checkout, and
the checkout's own files start code with the member's full rights: a git hook,
an npm install script, an `.envrc`. No model is asked, so no gate sees it (row
A13). The launcher shuts those doors for every member it starts, in one place
(`src/refuse_code_a_checkout_runs_itself/`), through the environment the host
and everything under it inherit:

| Door | What the launcher sets | Why it wins |
|---|---|---|
| git hooks: `.git/hooks`, a `core.hooksPath` the checkout's config names, hooks named in config (git 2.54+), `core.fsmonitor` | `core.hooksPath` = an empty 0500 directory made for this launch, `hook.<event>.enabled=false` for every event git documents, `core.fsmonitor=false` | appended to `GIT_CONFIG_PARAMETERS`, which git reads after every config file and after `GIT_CONFIG_COUNT`; the owner's own settings there are kept |
| npm install scripts, `pre`/`post` scripts included | `npm_config_ignore_scripts=true` | npm ranks its environment above every `.npmrc`; every inherited spelling of the setting is dropped |
| the program a tracked `.npmrc` names as `git`, which `npm install` runs to fetch a git dependency, scripts off or not | `npm_config_git=git`, the member's own git from its `PATH` | the same |
| `.envrc` and `.env` through direnv | `DIRENV_DISABLE=1`, and `DIRENV_CONFIG` = the same empty directory | direnv 2.38+ stops outright; an older one finds no `direnv.toml`, so no whitelist trusts a directory wholesale |

These apply whoever wrote the checkout: the launcher cannot tell a crew
checkout from another, since a crew checkout pulls other people's commits.

What option 3 does **not** close, stated rather than hidden:

- **Code the member runs on purpose.** `npm test`, `npm run`, `make`, a test
  runner, a build script: running the checkout's code is what those commands
  are for. Only a boundary (option 1 or 2 on #24) holds there.
- **Other tools that load a directory's files**: pnpm, yarn and bun scripts,
  mise, a shell's own directory hooks. Not tested here, so not claimed.
- **An `.envrc` the owner allowed by its exact content**, on a direnv older
  than 2.38.
- **A git hook event newer than the documented list**, when named in config;
  a hook file for it is still off through `core.hooksPath`. A test reads the
  installed git's githooks(5) page and fails on an event the list lacks.
- **The other `.npmrc` settings that name a program.** `script-shell` runs
  scripts and `node-gyp` builds native addons; under `ignore-scripts` an
  install runs neither, and `npm run` or `npm test` is code run on purpose.
  `shell` serves `npm exec` and `npm explore`, `editor` serves `npm edit` and
  `npm config edit`. `npm install` reaches none of them.
- **Anything that has already run as this user**, which can undo every
  setting here, rewrite the roster or read another member's key (A13). The
  owner accepted that for now (martha#1 decision 1).

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
| before starting the coding tool in a checkout | `prepareLaunch({ host, launch_dir, stop_dir, snapshot_root, approved_fingerprints })` — on a refusal do not start it and show the refusal to the owner; otherwise start it with the returned `switches` (their `args`, and the environment `launchEnvironment(process.env, switches)`, which drops inherited variables that would bring config back), show the owner `not_carried`, and remove `snapshot_dir` when the member stops |
| before running any tool | `answerToolCall({ tool, session, policy, input, launch, names: host.tools })`, where `launch` is the place and approvals `prepareLaunch` was given and `names` is the host's own split of a called tool's name — return the `{ deny }` as the hook's answer. It checks the launch again first: the snapshot's hooks and servers run scripts that still live in the checkout, so a call that changes the tree (a `gh pr checkout`, a pull) is followed by a refusal of every call after it. What is left is the hooks of the one call that changed the tree |
| after every tool call | `recheckLaunch(launch)` — on a refusal the hook asks the launcher to stop the member and does not return: the launcher sends SIGKILL to the member's whole process group (the host and its tool servers), which ends the hook with it. A hook that returned would let the host fire its next hooks (`Stop` at the end of the turn), and a SIGTERM or normal exit fires `SessionEnd` |
| a member reads a room | `readRoomThroughItsGate({ session, room, envelopes, rosters, self_node_id })` — the raw mesh reads are refused |
| after any MCP tool result | `takeInTurn(session, { source: 'mcp_result' }, binder)` — a mesh tool that runs (`mesh_call`, `mesh_get`, `mesh_recall`, a ring's answer) hands back text with no sender to admit, so the shell gate judges it (B2) |
| a turn arrives, from any source | `takeInTurn(session, arrival, binder)`: `bindNothing` on a host that cannot attest who sent a cross-session message |
| the launcher starts or stops a member | `recordMemberLaunch(launcherRecords, host.processes, launched)`, `recordMemberStopped(launcherRecords, member_name)`, with the writable store the adapter holds as the launcher's seam; slices get only `host.stores.launches`, which reads (#42) |
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
  and the model never supplies. A `resume` under a new id has no record, and
  has lost it; so does a `fork`, which the host sends as its own SessionStart
  `source` and which carries its parent's context under a new id. Only
  `startup` and an owner's own `/clear` are fresh, and only until the session
  reads a handover. The events the host emits
  (`CLAUDE_CODE_EMITTED_SESSION_EVENTS`) are derived by the Claude Code adapter
  from the host's own SessionStart schema, recorded from its binary
  (`src/claude_code_host/`), and `gapsInSessionEvents` fails CI on one the
  declaration does not cover.
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
- **A room is read through its gate, never raw (B1).** A mesh tool runs only
  when `MESH_TOOLS_THAT_RUN` names it: every other mesh tool, a new one
  included, is refused in every session, tainted or not, under every server
  namespace, and so is `mesh_say` when it waits for a reply or comes with no
  input. The match is on the tool's own name, which the host takes out of the
  name it calls (`host.tools.ownNameOf`): Claude Code names an MCP tool
  `mcp__<server>__<tool>`, OpenCode `<server>_<tool>`, and only the host knows
  its form and its servers. The two lists, `MESH_TOOLS_THAT_RUN` and
  `MESH_TOOLS_REFUSED`, are proved against the tools the mesh server's published
  package registers, one record per version a member may install
  (`recorded_mesh_server_tools.json`; `npm run record:mesh-tools`, the program
  in `src/record_mesh_server_tools/`, adds or replaces one version's record): the
  coverage check fails CI by name on a tool any recorded version registers that
  nobody decided, a decided name no recorded version registers, or a tool
  outside `MESH_TOOL_PREFIX`. The records are tied to what members run
  (martha#49): the launcher reads the version the approved `.mcp.json` pins
  (`<package>@<version>`, nothing looser) and refuses to start a member whose
  version is not recorded, naming both. A version is retired by removing its
  record, after which a member still on it is refused by name. Since the gate
  judges a mesh tool by its name from any server, the check fails closed:
  every server in the approved `.mcp.json`, the mesh server or not, must start
  as `npx -y <package>@<x.y.z>` (stdio, an `env` holding only the
  mesh server's own settings that someone reviewed, `known_settings`, no other key), or
  the member is not started, naming the server. The mesh server may also start
  as `npx -y -p <package>@<x.y.z> <bin>`, the shape members use. Each record
  holds that version's bins and names the one that is the server
  (`server_bin`, chosen by whoever records it and visible in the reviewed
  record); the bin named must be that one, since the package's other bins are
  its own tools (a doctor that spawns the commands every MCP client config
  names, a register that rewrites host configs). The shorter shape is accepted
  only where npx would pick the server bin itself (one bin, or one named after
  the package), which the mesh server's seven bins do not allow. A git or GitHub spec, a URL server, a shell wrapper, a package named
  in a variable or a bare bin is refused; there is no exempt list. The version
  does not prove the bytes by itself (martha#65): npx would take them from
  whatever registry, project `.npmrc`, `node_modules` or global prefix it
  finds, and the server's caret dependencies drift under one version. So each
  recorded version also carries its whole tree
  (`src/prove_the_mesh_server_bytes/recorded_mesh_server_trees.json`): the
  tarball's integrity, npm's lock for that version alone with a sha512 for
  every package, the `MACULA_*` settings its code reads (a version reading one
  nobody reviewed is not recorded), and every installed file with its sha512.
  The launcher installs the lock with `npm ci --ignore-scripts` and no outside
  npm config or environment, compares the tree file by file before every
  launch, refusing a changed, missing or added file by path, and the approved
  copy starts the record's server bin by path with the launcher's own node,
  never through npx (`src/install_the_recorded_mesh_server/`). A host starts
  a server with its own environment under the entry's `env`, so the
  launcher's environment would reach the server: a `NODE_OPTIONS` preload, a
  library for libc to preload, a `<NAME>_PREBUILD` directory a dependency
  loads a native addon from. So the placed entry's `env` names every variable
  the host is given: HOME and PATH keep their values, the entry's reviewed
  settings keep theirs, and every other one is emptied. Claude Code adds two
  sources of its own. It starts every server as `<prefix> "<command>"` when
  its environment holds `CLAUDE_CODE_SHELL_PREFIX`, so the launcher drops that
  variable before the host starts. And it gives every server the `env` of each
  settings file it loads, which under `--setting-sources user` is the owner's
  user settings (`$CLAUDE_CONFIG_DIR/settings.json`, else
  `~/.claude/settings.json`; a `CLAUDE_CONFIG_DIR` that is set but empty,
  not absolute, or with white space around it, which Claude Code trims,
  refuses the launch, since the launcher and the host could resolve it to
  different files) and the approved `--settings` copy: a launch is
  refused, naming the file and the variable, when either sets a name other
  than HOME, PATH or a reviewed setting, except Claude Code's own variables
  that no file of a recorded tree reads (`CLAUDE_CODE_OWN_VARIABLES`, today
  `CLAUDE_CODE_PLUGIN_DIRS`), which the server is given empty
  (`src/claude_code_host/settings_env_reaching_servers.ts`). With those, what
  the launcher and the settings files hand a mesh server is an allow-list.
  Claude Code also sets `CLAUDE_PROJECT_DIR`, `CLAUDE_CODE_SESSION_ID`,
  `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` for a server by itself; the server
  reads only the session id, to scope what it keeps per session, and none of
  them changes what code it loads. Admin-managed settings
  (`/etc/claude-code/managed-settings.json`) are root's and are not read. What
  this does not close: a
  member's shell runs as the same user and can edit the installed tree during
  a session; the next launch refuses it, but the running server is not checked
  again. In the same way, the user settings file is read before the host
  starts and the host reads it again itself, so an edit by that user in
  between reaches the host unchecked. Both are the same class as the contact-policy file
  (macula-io/macula-mcp#79). Each recorded version also lists what every
  package of its tree reads from the environment (`environment_reads`,
  martha#72): each name read by a literal `process.env` key with the files
  that read it, and the files that read by a computed key (node-gyp-build's
  `<NAME>_PREBUILD`, cross-spawn's PATH by `path-key`), which are listed, not
  refused. A package reading a name the server is started with (HOME, PATH or
  a reviewed setting; the server's own reads of its reviewed settings are
  covered by `known_settings`) is not recorded, and a recorded tree holding
  one is not started, until someone reviews that read and adds the name under
  the package in `known_environment_reads`; the refusal names the package,
  the name and the file, and CI checks every recorded version against the
  same rule, so a name added to the kept list or the settings later fails by
  name. Before a placed tree starts, its reads are taken again from the
  installed bytes and must equal the recorded list, so a read struck from the
  record is refused by package, name and file. The scan reads code text:
  `process['env']` and `globalThis['process']` are listed as computed reads,
  but a read that never names the environment (`os.homedir()`, a native
  addon's `getenv`, the process kept under another name) is not seen, and
  every name outside the kept list and the settings is emptied for the
  server anyway. A module the tree lacks, such as an
  optional one, would be looked for in every `node_modules` above the tree and
  under HOME, which that user can write; so the server is started with the
  launcher's own resolve hook (`node --import`; the hook is the launcher's own
  file and exactly as trusted as the launcher), which refuses every `require`
  and `import`, computed ones included, that resolves anywhere but node's own
  modules or the tree (by its real path), as not found (martha#73). The hook
  confines resolution only: whatever the tree's own code chooses to do is that
  code's choice, and that code is compared file by file. For example, a
  `process.dlopen` on an absolute path, or a node child or worker the server
  starts with arguments of its own, does not pass the hook. Only the
  servers an installed plugin brings are not version-checked; their tools are
  still refused at run time unless decided. The one read that remains returns
  only what the room's own delivery gate admits, with the roster the registry
  binds to that room, and says how many envelopes it withheld, never their
  text, sender or kind. Each admitted envelope is an ingestion with its
  sender's node id, so the shell is kept only when the policy names every
  sender. The pointer a long room delivery carries must name this read, never
  a raw tool. A host that registers the read under its own tool name must also
  allow that name while tainted, or a tainted member cannot read its room.
- **The mesh tools that serve or change the contact list are refused
  (martha#48).** `mesh_serve`, `mesh_trust_agent` and `mesh_untrust_agent` are
  refused in every member session, clean or tainted, under every namespace
  (`MESH_TOOLS_THAT_WIDEN_REACH` in `src/refuse_widening_a_member_reach/`, part
  of `MESH_TOOLS_REFUSED`). A served procedure runs on any caller's payload for
  as long as the server runs, outside every session's record; the contact list
  is the owner's and the crew launcher's, and removing an entry from it breaks
  the crew's own rings as surely as adding one lets a stranger in. A member's
  ring trust comes from the declaration and the launcher. A procedure the owner
  signs is a proposal (martha#50), not built. What this does not close: a clean
  member can still write the contact-policy file (`MACULA_MCP_CONTACT_POLICY_FILE`)
  from its shell, or start a mesh process of its own that serves; signing that
  file is macula-io/macula-mcp#79. `mesh_answer_ring` stays allowed, because
  what enters after a ring is answered is still gated: the room's text by the
  roster gate, and the ring's purpose by the shell gate.

Every refusal a host returns says what clears the taint in the words of one
constant, `WHAT_CLEARS_IT` in `src/refuse_execution_after_ungated_text/`, so
the text cannot drift from the rule.

### On Claude Code: the relay and the launcher

[Issue #41](https://github.com/macula-io/martha/issues/41) has the threat
model. A Claude Code hooks module runs with no Node and may import only its own
files, so the core cannot run inside the host. It runs in the member's
**launcher** (`src/launch_a_claude_code_member/`), one per member: the process
that starts the host and that sends SIGKILL to its process group. Inside the
host, a **relay** (`src/claude_code_relay/`, a plugin the launcher loads with
`--plugin-dir`) posts each event over a Unix socket made for that launch alone,
with the engine's own fields unchanged, and acts on the answer. The relay
decides nothing.

A relay the host refuses to load runs no gate at all ([#104](https://github.com/macula-io/martha/issues/104)).
So before a member starts, the launcher resolves the host's command once and
asks that binary's own loader (`plugin validate`) whether it takes the relay,
and starts nothing if it does not. A host of another version than the one the
adapter was recorded from is told to the owner in one line. After the start, a
member whose relay does not report its session's start within
`RELAY_DEADLINE_MS` is stopped. CI runs the loader of the recorded version
over the relay (`prove_the_relay_loads/`).

| Host event (the relay) | The launcher's call |
|---|---|
| settings `SessionStart` (`classic.SessionStart`: the host's `source` and `session_id`) | `startSession(store, CLAUDE_CODE_SESSION_EVENTS, sessionStartOf(input))`; the mod's own `session.start` carries neither field |
| `prompt.submit` (`text`, and the `origin` the engine stamped where it queued the prompt) | `takeInTurn(session, arrivalOfPrompt(CLAUDE_CODE_PROMPT_ORIGINS, origin.kind), bindNothing)`; a prompt Martha itself submits comes back as `plugin`, and is recorded like any other |
| `tool.call`, before `next` | the session's stored record read back, then `answerToolCall({ tool, session, policy, input, launch, names })` |
| `tool.call`, after `next` | `recheckLaunch(launch)`, then for an `mcp__` tool `takeInTurn(session, { source: 'mcp_result' }, bindNothing)` |

The launcher starts the host as `prepareLaunch` says, with the owner's
arguments first (`--mcp-config` takes every argument after it up to the next
flag), and `launchEnvironment` plus the socket's path in `MARTHA_RELAY_SOCKET`.
It records the launch with the writable store it alone holds (#42). When the
member exits, the launcher kills the member's group, drops the launch record,
and removes the socket directory and the snapshot.

**Failing closed, per event.** Anything but the exact shape of a yes counts as
a no: the launcher unreachable, no answer within `RELAY_DEADLINE_MS`, a status
other than 200, an answer with a field missing or one too many, a hook that
throws or overruns its budget (each gating hook has a `.catch`):

- a prompt is dropped and never enters the session;
- a tool call before it runs is denied;
- after a tool ran, the member is stopped. The launcher kills the group and
  never answers. A relay that cannot hear the launcher kills its own group and
  holds the hook, with a host call in flight so no budget runs out;
- a session start the launcher did not take leaves the session with no record
  there, so every prompt and tool call of that session is refused.

Inside the launcher, a session whose record cannot be kept (`ROW_NOT_DURABLE`,
`ROW_STREAM_MOVED`, a rows directory that no longer vouches for its rows, a row
another writer added) is refused for the rest of the process. Its prompts are
dropped and its tools denied, and after a tool ran the member is stopped.

The socket's directory is made new for each launch, mode 0700, in a parent
owned by this user that nobody else may write. A path that already exists, a
link, a parent that is a link or that others may write, or a socket path too
long for an address refuses the launch.

**T13, accepted under A13.** A process of the same OS user can connect to that
socket and claim any origin, a typed turn included. This is the same-user
tampering the owner accepted until the signed roster (martha#1 decision 1,
martha#24): that process could already rewrite the session records, the
launch records and the row store. A secret held only by the relay would not
close it: anything this user runs can read the host's environment and memory.

What the wiring leaves out: A6, until the host passes the attested sender to
plugins (anthropics/claude-code#107216; the binder stays `bindNothing`); the
launcher handing a turn to the model or registering a tool (no slice does
either yet); and reading approvals and the policy from the crew's declaration
(the caller passes them until port-map step 2 lands).

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

The binder reaches the machine only through the host contract (#42): the
records are `host.stores.launches`, one row per member keyed by its name, and the
process's start time and boot are `host.processes.identityOf(pid)`. The slice
decides what a row must say (a launch, keyed by the member it names); the host
keeps the file-level promises. Both seams are synchronous, so nothing runs
between reading a record and asking which process holds its pid.

Slices only read the records. The contract types `stores.launches` as
`KeyedRows`, which has `all` and nothing else, and an adapter hands it as
`readingOnly(store)`, so the object a slice holds has no writing member at run
time either. The writable `KeyedRowStore` is the launcher's own seam: the adapter
that launches members holds it and passes it to `recordMemberLaunch` and
`recordMemberStopped`; it is not part of `HostContract`. As a second line,
`prove_the_core/only_the_launcher_writes_launch_records.ts` names any slice but
the binder's that writes the store or reaches `stores.launches` for anything but
reading, names any slice that imports host glue, and refuses a `martha.hostGlue`
entry that is not exactly `src/<one directory>`. A slice writing the records'
files itself with `node:fs` is left to #26's allow-list of Node modules.

On Linux both seams come from `src/linux_process_identity/`, host glue that is
not a slice and that every host adapter on Linux composes (package.json
`martha.hostGlue`). `launchRecordsDirectory(directory)` keeps one file per key,
so two launches at once never write over each other's record; the key is encoded
before it becomes a file name, so it is never a path. Each file is written whole
and renamed into place. Read back, the directory vouches for nothing unless it is
a real directory owned by this user that nobody else may write into, holds only
records, and every record is opened without following a link and checked on the
opened file itself (a regular file, owned by this user, mode `0600`, a JSON row)
before that same file is read. `linuxProcessIdentities` reads a process's start
time and the boot from `/proc`; where there is no `/proc`, every process reads as
absent and nobody binds.

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

## Every list a gate trusts is signed

Every gate compares against a list: the crew room's roster and the shared
room's, the policy that names whose text a session may act on, the
supervisors who may act, and the members the binder may attribute a sender to. Kept as plain files, one command run as a member's
user adds a node id to any of them, and the gate then admits whoever was added.
So each list is a document the owner signs, opened by `openTrustList`
(`src/trust_only_signed_lists/`) from the signed bytes on every read.

- **Nothing signed, nobody trusted.** A missing, unsigned, edited or malformed
  list opens empty, and the gate built on it admits nobody. `trustedRoomRosters`,
  `trustedPolicy` and `trustedSupervisors` turn an opened list into what each
  gate reads, so a refused list reaches the gate as nobody, never as the file.
- **Only a hardware key, touched.** The owner signs on their own machine with
  `ssh-keygen -Y sign`, a FIDO key (`sk-ssh-ed25519@openssh.com`), and the
  namespace `TRUST_LIST_NAMESPACE`. The signature is OpenSSH's SSHSIG format,
  verified here without any other tool. A pinned key of any other type is
  refused, so a key file a member's user can read is never the anchor, and the
  signature must carry the user-presence flag that a touch sets.
- **Bound, numbered, expiring.** A document names its `crew` and `kind` and has
  an `epoch`, an `issued_at` and an `expires_at`, and no other field: a document
  cannot carry a key of its own. A list for another crew or kind, an expired
  one, one issued in the future, one whose `expires_at` is more than
  `MAXIMUM_LIFETIME_DAYS` after its `issued_at` (counted from the signed issue
  date, so a long-lived list cannot open in its final days), one whose
  `issued_at` or `expires_at` is not an RFC 3339 UTC instant naming a real moment
  (a form without an offset, or a free form, reads by the verifier's timezone),
  one older than the newest
  epoch the verifier has opened, and a different list at that same epoch are
  refused. The verifier's `EpochStore` keeps the epoch and a digest of the list
  it opened, and it must persist across processes where the member's user
  cannot write: a store in memory forgets on restart and lets an old list back.
- **One byte string, one reading.** The signed bytes must be exactly what
  `JSON.stringify` writes for the value they parse to, compact or indented by
  `PRETTY_INDENT`, with or without one final newline. A duplicate key at any
  depth, or a key spelled with escapes, serialises differently and is refused,
  so no parser can read a list the owner did not review.
- **Node ids compare without case.** Every node id is lowercased when a list is
  opened, as the gates lowercase the senders they compare.
- **The verifying key is the host's to pin**, from where it installed it,
  outside the directory the lists live in. The key inside a signature counts
  only when it is pinned.
- **Nothing shipped signs.** The test fixtures sign with keys held in memory,
  and real `ssh-keygen -Y verify` accepts what they write. A test fails if
  shipped code imports them or if a private key is tracked in this repository.

Not signed: the session record store, which the host writes on every turn and
no owner could sign. It keeps the fail-closed rule instead (a missing or
unreadable record taints). The binder's rows (martha#14) are bound by the
signed `members` list: a launch record binds only when its `member_name` and
`node_id` pair is in that list, so a planted record for a stranger, or a signed
node id under another member's name, binds nothing. The pid in a record is
dynamic and no owner can sign it, so pointing a signed member's record at
another process stays martha#24's residual. Code running as the member's own user can still replace a
pinned key the host installed where that user can write, which is the OS
boundary of martha#24.

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

A launched row may only declare the launch gate, and must say what happens where
Martha does not start the host. The launch gate is driven once per question: it
must admit config the owner approved and a checkout with no config, and refuse
unapproved config, an approved file whose content changed under the same name,
a file added after the approval, a config one directory up, a symlink even when
approved, a host it has no file list for, and a request whose config was never
read.

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
- **The launch gate has no caller yet.** `src/refuse_launch_of_unapproved_config/`
  is the rule and the reader; no launcher or turn hook calls it, because no host
  adapter is in this repository. Until one does, a checkout's own config starts
  as each host decides, which the table above describes.
- **No host attests a cross-session sender yet.** The binder is built and
  tested; no adapter in this repository hands it a sender, so every
  cross-session message still taints. A host gains it by attesting the sending
  process out of band and passing
  `binderOverLaunches(host.stores.launches, host.processes, signedMembers)`,
  where `signedMembers` returns `trustedMembers` of the opened `members` list.
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
