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

## Where we are

One row per step of the landing order. **Built** means the slices are on `main`
and run, and every slice named links to its directory. **In flight** means a
work package is open on it. **Planned** means an issue holds it and no slice
has landed. A slice that is renamed or moved breaks its link here, and the
links check fails on it, so the table is changed on the landing that moves it.

| Step | Where it stands | On `main`, or tracked in |
|---|---|---|
| 1. host_contract with log_ledger | built | [`host_contract`](../src/host_contract), [`log_ledger`](../src/log_ledger), [`keep_the_ledger`](../src/keep_the_ledger); see [the host contract and the ledger](host-contract-and-ledger.md) |
| 2. declare_crew | built | [`declare_crew`](../src/declare_crew), [`declare_a_solo_crew`](../src/declare_a_solo_crew), [`who_may_act`](../src/who_may_act) |
| 3. deliver_crew_room | built on one machine; the room across machines is planned | [`keep_the_crew_channel`](../src/keep_the_crew_channel), [`send_a_crew_message`](../src/send_a_crew_message), [`hand_a_crew_message_to_its_member`](../src/hand_a_crew_message_to_its_member), [`show_what_a_message_became`](../src/show_what_a_message_became), [`read_a_crew_line`](../src/read_a_crew_line); across machines: [#310](https://github.com/macula-io/martha/issues/310), [#510](https://github.com/macula-io/martha/issues/510) |
| 4. show_dashboard_beat | built | [`show_dashboard_beat`](../src/show_dashboard_beat), [`report_where_the_work_stands`](../src/report_where_the_work_stands), [`see_the_crew`](../src/see_the_crew) |
| 5. park_and_wake, refresh_member, hand_over_at_limit | built | [`park_and_wake_a_member`](../src/park_and_wake_a_member), [`wake_a_member`](../src/wake_a_member), [`refresh_a_member`](../src/refresh_a_member), [`write_my_handover`](../src/write_my_handover), [`end_a_running_turn`](../src/end_a_running_turn) |
| 6. ask_owner, then switch_model | built | [`queue_the_owners_asks`](../src/queue_the_owners_asks), [`switch_a_members_model`](../src/switch_a_members_model), [`put_the_owners_model_back`](../src/put_the_owners_model_back) |
| 7. keep_operator_todo | built | [`keep_the_owners_todo_list`](../src/keep_the_owners_todo_list) |
| 7. keep_standing_items | built | [`keep_the_supervisors_standing_items`](../src/keep_the_supervisors_standing_items) |
| 7. file_friction | planned | [#318](https://github.com/macula-io/martha/issues/318) |
| 7. track_backlog | built | [`find_the_unheld_work`](../src/find_the_unheld_work), [`see_who_is_free`](../src/see_who_is_free), [`nudge_an_idle_crew`](../src/nudge_an_idle_crew) |
| 7. nudge_review_waits | built | [`nudge_the_supervisor`](../src/nudge_the_supervisor) |
| 7. watch_waits | built | [`watch_waits`](../src/watch_waits) |
| 8. read_shared_room, announce_node_events | built in part: the room's gate and the node id load on every launch; reading the shared room and announcing node events are planned | [`read_a_room_through_its_gate`](../src/read_a_room_through_its_gate), [`admit_a_room_message`](../src/admit_a_room_message); the rest: [#310](https://github.com/macula-io/martha/issues/310) |
| 9. prove_landing | built | [`check_a_range_before_the_owner_says_yes`](../src/check_a_range_before_the_owner_says_yes), [`land_passed_work_as_one_batch`](../src/land_passed_work_as_one_batch), [`hold_a_package_back_from_a_batch`](../src/hold_a_package_back_from_a_batch) |
| 9. open_and_finish_worktree | built | [`open_and_finish_a_worktree`](../src/open_and_finish_a_worktree) |
| 9. guard_workspace | in flight; the crew's declared layout (`workspace_layout`) is built, and the guard wherever git runs is in review | [`declare_crew`](../src/declare_crew); the guard: [#562](https://github.com/macula-io/martha/issues/562), [PR 584](https://github.com/macula-io/martha/pull/584) |
| 10. the Claude Code adapter shrinks to a composer | in flight | [`claude_code_host`](../src/claude_code_host); [#443](https://github.com/macula-io/martha/issues/443) splits it, [#41](https://github.com/macula-io/martha/issues/41) is the adapter's track |

| Container | Where it stands | On `main`, or tracked in |
|---|---|---|
| the launcher | built | [`launch_a_claude_code_member`](../src/launch_a_claude_code_member), [`start_a_member`](../src/start_a_member), [`stop_and_restart_a_member`](../src/stop_and_restart_a_member) |
| realm admission | planned | [#310](https://github.com/macula-io/martha/issues/310) |
| release | built | [how a release is made](how-a-release-is-made.md) |

## Left behind on purpose

No behaviour is dropped. What stays behind is the code that exists only because
the two hosts do not share their slices today:

- the second host's own copies of the ledger and the room reader, which go when
  the slice that serves both hosts lands;
- settings read from globals and environment fallbacks, which go when the typed
  declaration lands, because a setting read in two places can disagree;
- the one large host module, which ends as the thin adapter in step 10.
