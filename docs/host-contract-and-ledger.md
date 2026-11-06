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
| `stores` | `rows`: streams that are only ever appended to; `documents`: files read as text |
| `processes` | running a command and getting its exit status and output |
| `delivery` | handing a turn to the model, and the turns that arrive, with where each came from as far as the tool can say |
| `tools` | registering a tool the model can call |

Nothing in it decides anything, and settings are not in it: they come from the
crew's declaration. An append can name the length it expects the stream to
have, so two writers that read the same stream cannot both act on what they
read.

The core imports nothing but its own slices and Node's standard library. A
test reads every file under `src/` and names any other import, so a coding
tool's API cannot creep in past the contract.

Every slice is tested against
[`host_for_tests.ts`](../src/host_contract/host_for_tests.ts), a host that
lives in memory and keeps the same promises.

## The ledger

[`src/log_ledger/log_ledger.ts`](../src/log_ledger/log_ledger.ts) keeps one
append-only stream per work package:

- **Milestones**: a checkpoint reached, a review round closed, a release
  shipped, a fix shipped after a release.
- **Outward acts**: `sendOutwardAct` writes the act's row first. If the store
  does not keep it, the act does not run. After the act, its outcome is a second
  row, success or failure.
- **What is unresolved**: `actsAwaitingOutcome` returns every act with no
  outcome. A successor checks each one (is the push on the remote? did the
  handoff arrive?) and records what it found with `concludeAct`. An outcome for
  an act never announced, or a second outcome for the same act, is refused.

A row the ledger cannot read is refused rather than skipped, because skipping
it could hide an act that was sent.

A handover as a ledger row, naming the last row it covers, comes with the
`hand_over_at_limit` slice.
