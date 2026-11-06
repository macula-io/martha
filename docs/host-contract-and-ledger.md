# The host contract and the ledger

This exists so that a member refreshed in the middle of a package can see which
of its predecessor's pushes, handoffs, room messages and tags were sent and
never confirmed, and check them instead of sending them twice; and so that the
same code does this on every coding tool Martha runs in.

Both are the first step of [the port map](port-map.md), as designed on
[issue #1](https://github.com/macula-io/martha/issues/1).

## The host contract

[`src/host_contract/host_contract.ts`](../src/host_contract/host_contract.ts)
is everything the crew core may ask of a coding tool. It has five parts, and a
test fails by name if a sixth appears:

| Part | What a host gives |
|---|---|
| `clock` | the time |
| `stores` | `rows`: streams that are only ever appended to; `documents`: files read as text; `launches`: the launcher's records, one row per key, which slices only read; the writable store is the launcher's own seam, outside the contract (#42) |
| `processes` | running a command and getting its exit status and output; `identityOf(pid)`: which process holds a pid, boot included (#42) |
| `delivery` | handing a turn to the model, and the turns that arrive, with where each came from as far as the tool can say |
| `tools` | registering a tool the model can call |

Nothing in it decides anything, and settings are not in it: they come from the
crew's declaration. An append can name the length it expects the stream to
have, so two writers that read the same stream cannot both act on what they
read. A stream name is an opaque key: an adapter encodes it before it touches a
path, a table or a URL.

The contract also holds the words a host uses to say where a turn came from
(`Arrival`, `TurnSource`, `TurnOrigin`). The publish gate's slices read them
from here. The contract file imports nothing, and a test holds it to that.

The core imports nothing but its own slices and Node's standard library. A
test reads every script file under `src/` (TypeScript and JavaScript, every
extension) and names any other import, including a dynamic import whose name is
computed, so a coding tool's API cannot creep in past the contract.

Every slice is tested against
[`host_for_tests.ts`](../src/host_contract/host_for_tests.ts), a host that
lives in memory and keeps the same promises.

### On Claude Code

[`src/claude_code_host/`](../src/claude_code_host/) implements the contract on
Claude Code (#41). It is host glue, declared in package.json `martha.hostGlue`,
and it decides nothing: it composes the engine's clock, prompt submission and
tool registration with two pieces of glue any POSIX host can use,
[`src/row_streams_directory/`](../src/row_streams_directory/) for the rows and
[`src/linux_process_identity/`](../src/linux_process_identity/) for the
launcher's records and which process holds a pid.

- **Rows** live one directory per stream, the name encoded so it is never a
  path, one file per row named by its position. A row is staged, then linked to
  its position, and a link never replaces a file, so two writers cannot both
  land at one position. A read refuses a gap, a link, an entry it never writes,
  a row that is not a JSON object, and a file anyone else may read or write; it
  never skips one.
- **The launcher's records** reach slices only as `readingOnly(store)`.
- **A process** runs directly with no shell, so a signal reads as a null exit
  code.
- **Where a turn came from** is the engine's `origin`, which it stamps where it
  queued the prompt and no hook may set: a peer's message is `cross_session`,
  the owner's own Enter is `owner_paste`, and anything else is text the harness
  delivered, for the envelope rule to read. Text never sets a source.
- **No sender yet.** The host knows which process sent a cross-session message
  and does not pass it to plugins (anthropics/claude-code#107216), so the
  adapter's binder is `bindNothing` and every cross-session message stays
  unattributed. The adapter reads no transcript.
- **A session start** maps the hook input's `source` and `session_id`, and
  nothing else. A source the host does not send, the crew's refresh among them,
  maps to an event no declaration lists and fails closed. The emitted events
  are parsed from the host's SessionStart schema as recorded from its binary
  (`recorded_claude_code_host.json`; `record_claude_code_host.ts` takes it
  again after an upgrade), plus the crew's refresh.
- **A tool name** is refused a second time before the engine sees it.

The launcher's wiring (who writes the records) waits for #16's launch gate.

## The ledger

[`src/log_ledger/log_ledger.ts`](../src/log_ledger/log_ledger.ts) keeps one
append-only stream per work package:

- **Milestones**: a checkpoint reached, a review round closed, a release
  shipped, a fix shipped after a release.
- **Outward acts**: `sendOutwardAct` writes the act's row first. If the store
  does not keep it, the act does not run. After the act, its outcome is a second
  row, success or failure. A caller can tell the failures apart:

  | Failure | What happened | May the caller send it again? |
  |---|---|---|
  | `ACT_NOT_SENT` | the row was not kept, so the act never ran | yes |
  | the act's own error | the act failed, and that is its kept outcome | as for any failed act |
  | `OUTCOME_NOT_KEPT` | the act ran, and its outcome is not in the ledger | never: check it first |

  Every act sent through `sendOutwardAct` has its row first. The slices that
  send pushes, handoffs, room messages and tags route them through it as they
  land.
- **What is unresolved**: `actsAwaitingOutcome` returns every act with no
  outcome. A successor checks each one (is the push on the remote? did the
  handoff arrive?) and records what it found with `concludeAct`. An outcome for
  an act never announced, or a second outcome for the same act, is refused.

A package is an issue, `owner/repo#n`; any other name is refused before it
names a stream. A row the ledger cannot read is refused rather than skipped,
because skipping it could hide an act that was sent, and so is a row filed under
another package's stream.

A handover as a ledger row, naming the last row it covers, comes with the
`hand_over_at_limit` slice.
