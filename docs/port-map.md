# The port map, in summary

This exists so that moving the crew conductor into Martha is a list of moves,
and nothing it does today gets lost on the way. It answers item 4 of
[issue #1](https://github.com/macula-io/martha/issues/1): which existing
behaviour moves first.

The full map lives beside the code it maps, in the private repository that code
comes from. A test there fails by name when the code has a tool, command,
timer, hook, module or launcher verb that the map does not place, or when the
map names something the code no longer has. The map moves into this repository
together with that code. Until then, this page is the public summary.

## Three kinds of move

Each behaviour is one of three kinds, and its kind decides where it lands here:

- **protocol** moves into a core slice as it is. It is what makes a crew a crew,
  on any coding tool.
- **house rule** moves as a switch in the crew's declaration. One crew wants it,
  another may not, so it is data and never a branch in code.
- **host glue** moves into a host adapter. It exists only because of one coding
  tool's API.

## Landing order

1. **host_contract** with **log_ledger**. The small contract every host
   implements (a clock, stores, running a process, delivery in and out, and
   registering a tool; settings are not in it), and the ledger of package
   milestones, which keeps a row before every outward act. Both hosts already
   carry the ledger, so one package proves the slice shape and its reuse across
   hosts. Landed: [the host contract and the ledger](host-contract-and-ledger.md).
2. **declare_crew**: the declaration read once into typed settings, before any
   second slice, so every later slice takes its settings as an argument and
   never reads a global. The house rules live here as switches.
3. **deliver_crew_room**: the crew's own channel, its send checks, and the
   messages a session never read, handed to the next one.
4. **show_dashboard_beat**: the one writer of a member's row on the dashboard.
   Most later slices write a beat, so this comes before them.
5. **park_and_wake**, **refresh_member** and **hand_over_at_limit**: parking,
   waking an idle member, refreshing a session from a handover, and the handover
   the conductor starts itself at the context limit.
6. **ask_owner**, then **switch_model**: the owner's ask queue and dialogs, and
   moving a session to another model and back.
7. The Supervisor's small views, one package each: **keep_operator_todo**,
   **keep_standing_items**, **file_friction**, **track_backlog**,
   **nudge_review_waits**. Then **watch_waits**, which is new rather than a
   move: every wait names its target and the artifact it waits for, a cycle
   or an over-long wait is escalated, and a wait on the owner becomes a to-do
   with the exact act (the deadlock requirement in issue #1).
8. **read_shared_room** and **announce_node_events**: the mesh readers, used in
   team mode only.
9. **prove_landing**, **open_and_finish_worktree** and **guard_workspace**: the
   checks that a landing is what was reviewed, and the workspace rules wherever
   git runs.
10. The Claude Code adapter shrinks to a composer: the host contract, the
    dashboard pane and the list of slices.

Three containers are not slices and do not wait on that order: the
**launcher** (starting and stopping members, one terminal per member),
**realm admission** (joining a crew by invite, used in team mode) and
**release** (packing a release from what is committed, with no private text in
it).

## Left behind on purpose

No behaviour is dropped. What stays behind is the code that exists only because
the two hosts do not share their slices today:

- the second host's own copies of the ledger and the room reader, which go when
  the slice that serves both hosts lands;
- settings read from globals and environment fallbacks, which go when the typed
  declaration lands, because a setting read in two places can disagree;
- the one large host module, which ends as the thin adapter in step 10.
