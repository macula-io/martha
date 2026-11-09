# Getting started: a crew of two on your own project

This exists so a person who has installed Martha gets a first task built by one
member and reviewed by another, without writing code or knowing Martha's
internals. You carry the change between them: in this release members do not
message each other (issue [#51](https://github.com/macula-io/martha/issues/51)),
so you type the hand-off to the reviewer yourself.

Everything here is solo mode: no mesh, no account, one machine. Every command
block below was run as printed against the release that ships this page; the
refusals it can print, and what each costs you, are in
[What a refusal means](#what-a-refusal-means).

## What you need

- **Node**, at the version Martha names in its `engines` field. From the Martha
  checkout:

  ```sh
  node -p "require('./package.json').engines.node"
  ```

  If `node --version` is older than that, upgrade Node first; nothing below is
  tested on an older one.

- **Claude Code**, signed in. Martha's Claude Code adapter is recorded against
  one host version, and the recording is where the version comes from:

  ```sh
  node -p "require('./src/claude_code_host/recorded_claude_code_host.json').host_version"
  ```

  `claude --version` is what you have, in a plain shell. If a version manager
  wraps node (asdf does), it puts its own shims first on the PATH, and the
  `claude` your shell finds can be a different binary from the one Martha
  resolves. A member is a Claude Code session, so the same sign-in serves it.

- **git**, and a project that is a git checkout. Martha reads the top of the
  checkout it is run in, and every member works in that same tree.

## 1. Declare the crew

In your project's checkout, at its top:

```sh
martha init
```

```text
Declared a solo crew in <your project>/.crew/crew.json: builder, reviewer.
```

`<your project>` is the checkout's absolute path as Martha prints it.

It writes `.crew/crew.json` and never writes over one: if you already have a
declaration it says so and exits 1. It takes the owner's name from git, so a
checkout with no `user.name` is refused with the command that sets one. Commit
the declaration with the rest of the project if you want your crew to travel
with it:

```sh
git add .crew/crew.json && git commit -m "Declare the crew"
```

## 2. Read the config your members would start from, and approve it

A coding tool starts whatever its project config names, before any model runs.
So a member starts only on config you have read:

```sh
martha approve
```

```text
martha: A member started here would start code from:
martha:   .claude/settings.json  file  sha256 a2b4f5ad…
martha: with the checkout's work tree 09848a08adb288533f1cdb0a3dfef8a7827cda61.
martha: Read those files. Their fingerprint is 66591c79…
Type yes to approve this config for every member of this crew: yes
Approved: fingerprint 66591c79…
```

Read the files it names before you type `yes`. Only `yes` approves. The sha256 and
the fingerprint are shortened in this page; yours are 64 hexadecimal characters.

- A project with no such config needs no approval: `martha approve` says
  `Nothing to approve: this checkout holds no config that starts code by itself.`
  and exits 0.
- It asks only on your own terminal. Run with its input redirected and it
  refuses (`...its input is not one. Run it yourself, in a terminal.`), exits 1.
- **The approval covers the work tree as well as the files.** Any change in the
  checkout, including the one your member is about to make, makes it stale.

## 3. Start the builder

In the same checkout:

```sh
martha start builder
```

```text
martha: Starting builder on the config you approved at 2026-11-06T23:09:13.945Z (fingerprint 66591c79…).
builder started, pid 1434444
```

The first line tells you which approval this member is starting on, and when you
gave it. `martha start` then holds your terminal until the member ends, and ends
with the member's own exit status (128 plus the signal number if a signal killed
it).

If the `claude` in your PATH is not the version Martha's adapter was recorded
against, one more line sits between those two. It is information, not a refusal:

```text
martha: The host at /usr/local/bin/claude is version 2.1.318; Martha's record of the host is of version 2.1.321. It loads Martha's relay, so the member starts.
```

The two numbers are ones you can check: run the path the line names with
`--version`, and it prints the first; if a version manager wraps node, the
`claude` your shell finds may be another binary, so take the path from the line
rather than the name. The second command under [What you need](#what-you-need)
prints the other.

Before it starts the member, Martha asks that same binary whether it loads
Martha's relay, using the host's own loader, and refuses the start when it does
not or cannot say: a member that ran with its relay left out would have nothing
answering its prompts and tool calls.

The member is a Claude Code session, so the first time it runs in a folder,
Claude Code asks its own trust question before the session starts. Answer it
once; it is asked per folder, not per member.

Give it the first task in its own terminal, in your words. For example:

```text
Add a file hello.txt containing the single line: hello. Then, in one shell
command, create a branch named first-task, add the file, and commit it with the
message: the hello note. Do nothing else.
```

The order matters. A member writes files with its own file tools, and a shell
command is the last thing it runs: once a command has run, it can only read
until you start it again.

When you are done with the builder, end its session (`/exit` or Ctrl-D). The
branch and the commit stay in the checkout.

## 4. Approve again, if you approved in step 2

The builder's commit changed the work tree, and the approval you gave covered
the tree as it was. Start the next member anyway and it refuses:

```text
martha: The member is not started: this checkout holds config that starts code by itself (.claude/settings.json), and you have not approved it as it is now. Run martha approve, read what it shows, and answer yes.
```

So run it again, read what it shows, answer `yes`:

```sh
martha approve
```

## 5. Start the reviewer, in a second terminal

```sh
martha start reviewer
```

It starts the same way and prints its own line. Two members are two terminals:
each `martha start` holds the terminal it was run in.

## 6. Relay the hand-off

Members do not message each other in this release, and the builder may send no
executable text to the reviewer. You carry the change across: in the reviewer's
terminal, type the range you want reviewed:

```text
review main..first-task
```

That is a message to the reviewer, not a Martha command: the reviewer reads the
range in your checkout and answers with a verdict and its findings. Name the
base your project actually uses if it is not `main`.

If Claude Code hands the review to its own background agent, Martha refuses that
member's shell commands for the rest of the session once the agent's text
arrives ([issue #170](https://github.com/macula-io/martha/issues/170)). The
member can still read files, but the verdict that comes back never ran `git` and
never saw the diff: do not rely on it. End the reviewer, start it again, and type
the hand-off again; Martha's refusal says only a fresh start that reads no
handover clears it.

## What a refusal means

A refusal goes to stderr, prefixed `martha:`, and names the command that fixes
it:

| What you see | What to do |
|---|---|
| `... is not inside a git checkout. Run martha in the checkout your crew works in.` | `cd` to your project and run it there |
| `.../.crew/crew.json already exists, and martha init never writes over a declaration.` | keep it; `martha init` is done |
| `... is missing. Run martha init to declare a crew here.` | `martha init` |
| `... is not on this crew (its members are builder, reviewer).` | start a name the crew has |
| `... you have not approved it as it is now. Run martha approve ...` | `martha approve`, read, answer `yes` |
| `martha approve asks you on your own terminal, and its input is not one. ...` | run it yourself, in a terminal |
| `martha start runs a member on your own terminal, and its input is not one. ...` | run it yourself, in a terminal |
| `The member is not started: ... does not load Martha's relay (...), so the member's gates would be off: ...` | that `claude` cannot run Martha's gates: use one that loads them, such as an updated Claude Code |
| `... is stopped: its relay did not report the session's start within ... s. If the host was still asking whether to trust ..., start the member again and answer it; if it was not, the host is not running Martha's gates` | answer the trust question, then start the member again; if no question was asked, that `claude` is not running Martha's gates |
| `... -p is not a switch martha start passes. martha start passes only --model, --effort, --verbose ...` | drop it, and pass those three after `--`; they are the only arguments `martha start` passes on |

Exit codes: `0` done, `1` refused, `2` not a way the command is used
(`martha start` with no member prints the usage line and exits 2).

## Where it keeps things

- `.crew/crew.json` in your checkout: the crew's declaration. Commit it or not,
  as you prefer; it holds names and roles, no secrets.
- `$XDG_STATE_HOME/martha`, or `~/.local/state/martha`: one directory per
  project, named by a hash of the project's path, holding what Martha keeps for
  that project — each member's node id (`members.json`), the approvals you gave
  (`approvals.jsonl`), each launch's copy of the config it started on, and the
  record of what a member wrote itself. Those are the files you would look for;
  the directory also holds what Martha keeps for itself (`rows/`, `launches/`,
  `snapshots/`, `mesh-servers/`). Nothing in your checkout holds any of it.
- `$XDG_RUNTIME_DIR/martha-<your uid>`, or `/tmp/martha-<your uid>`: the sockets
  a running member answers over. Made 0700, and refused if it is not yours
  alone.

To start over: end your members, then delete `$XDG_STATE_HOME/martha`, or
`~/.local/state/martha` when that variable is unset, and edit or
delete `.crew/crew.json` as you would any file of your project.
