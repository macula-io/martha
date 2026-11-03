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

## What the shell is

Anything that can execute something, now or later:

| Tool | Why |
|---|---|
| `Bash` | the obvious one |
| `Write`, `Edit`, `NotebookEdit` | writes a hook, a script, a settings file or an `.envrc` that runs next |
| `Agent`, `Task` | hands the shell to a child session |
| acting MCP tools (`mesh_call`, `crew_restart`, …) | acts on the mesh or on another member without a command line |

A gate on `Bash` alone leaves three of the four open. `src/shell_tools/` is the
one place that set is written down.

## The rule

A session that took in text from a sender the policy table does not name
**executes nothing for the rest of that turn**. It may read the text; it may not
act on it.

Two reasons it is a gate at the shell and not at the door:

1. On a host with no inbound-message hook, a cross-session message is already in
   the turn before anything of ours runs. There is nothing to check on the way
   in.
2. Refusing a tool call before the engine runs it is demonstrably available —
   the crew's existing plugin already denies a shell command that way. Whether a
   turn can be refused or rewritten at its start is **open**: the engine's types
   are not vendored, so this repository does not assume either answer.

The policy table names senders by **node id**. A display name is never a
principal: a session whose first user message says "you are Supervisor" gains
nothing, because the node id on the delivery is the only thing compared.

## Every path, and what stands on it

`src/inbound_paths/` holds every way text reaches a member's session, as data —
the machine-readable copy of the table in issue #2. Each row declares one
control:

- **delivery gate** — the sender is checked before the text is in a turn (the
  crew room's acceptance rule, the board's roster);
- **shell gate** — nothing checks at delivery, and the rule above stops the
  session executing for the rest of that turn;
- **no text reaches the model** — the path is listed so it is not forgotten, and
  must say why;
- **none** — no control. A row in this state fails CI on purpose.

A path is never removed from the list. A path that stops delivering text gets a
control that says so, in words.

## The check

`src/check_every_path_is_gated/` reports every row that reaches a shell-holding
member with no control standing on it, and names the row. It runs in CI as the
`gate coverage` job, and it drives the real gate once per row that claims the
shell gate — a row cannot claim cover the gate does not give.

Its tests plant ungated paths to prove the check is not vacuous: a row copied
from the table without a control, a row whose control was forgotten, and a row
that claims the shell gate while the gate does not refuse it. Each of those
turns CI red.

## What this does not yet do

The rule and the check are the core's. Wiring the refusal into a host's tool
call is the adapter's job, and no adapter is in this repository yet. Until one
is, `src/refuse_execution_after_ungated_text/` is a rule with tests and no
caller — deliberately, and the reason nothing here is published.
