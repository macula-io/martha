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
martha: The host at /usr/local/bin/claude is version 2.1.318; Martha's record of the host is of version 2.1.322. It loads Martha's relay, so the member starts.
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

Claude Code may hand the review to its own agent. Martha follows that agent:
its start, its stop and every call it makes are recorded, so the answer it
hands back is placed by that record. By default the reviewer keeps its shell
while the agent runs; the answer is recorded and nothing is refused.

## If you want the strict shell gate

Martha can be told that text it cannot trace stops every later shell command in
the session — a file the member read outside your checkout, a tool result it
could not place, a page, or a background agent's answer while it runs. Reading
stays allowed under it; only running is stopped, until the session is replaced.
It is off unless you ask for it: a member is a trusted helper by default, and
the check on it is your review plus your yes on every push and release.

With it on, a background agent closes the shell while it runs — its text has no
call to be placed on yet — though the member can still read files, and once the
agent stops and Martha saw every call it made answered, the shell comes back.

To turn it on, add the rule to the crew's declaration, `.crew/crew.json`, as a
top-level key beside `owner` and `mode`:

```json
"house_rules": { "strict_gate": true }
```

If the declaration already has a `house_rules` object, add `"strict_gate": true`
inside it instead of writing a second one. Then start the member again: the
declaration is read once, at `martha start`.

With it on, what that costs is what the strict rule always cost: a review that
reads outside the approved tree closes the reviewer's shell on that read, as
any other text from a stranger does, and a `gh` call or a web page does the
same. The verdict that comes back never saw the diff: end the reviewer, start it
again, and type the hand-off again; Martha's refusal says only a fresh start
that reads no handover clears it.

## Upgrading Martha

Use Martha's own command, not the bootstrap line:

```sh
martha install [<version>] [--downgrade] [--digest sha256:<hex>]
```

It runs the installer the release you are running pins — `installer.json`, its
name, its version and the npm integrity of the bytes npm serves for it — and
nothing else, so taking over the npm account cannot put a new installer in front
of you. It fetches that one version into a temporary directory, with the npm
beside your node, empty npm config, this registry named explicitly and no install
scripts; refuses bytes that do not match the pin; runs the installer with your
words unchanged; and removes the directory afterwards. No terminal is needed: a
member's shell could already type the bootstrap line, so the pin and the
signature are what bound an install, not who typed it.

The [README's upgrade section](../README.md#upgrading-an-installed-martha) says
what each refusal means. Changing `installer/` in the repository needs an npm
publish before the next Martha release: the release pins the installer version
this tree carries, and refuses to build when `installer/` is not what that
version's `installer-v` tag published.

## What a refusal means

A refusal goes to stderr, prefixed `martha:`, and names the command that fixes
it:

| What you see | What to do |
|---|---|
| `... is not inside a git checkout. Run martha in the checkout your crew works in.` | `cd` to your project and run it there |
| `.../.crew/crew.json already exists, and martha init never writes over a declaration.` | keep it; `martha init` is done |
| `... carries no readable installer pin ...` | this release predates the pin; upgrade once with the bootstrap line |
| `... npm does not serve <name>@<version>, which this release pins ...` | that installer version is not on npm; nothing was installed |
| `... npm served bytes for <name>@<version> that are not the ones this release pins ...` | npm serves other bytes than the release vouched for; nothing was installed |
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
