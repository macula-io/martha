# Martha's architecture

This page shows, in three pictures, what Martha talks to, what it is made of, and
what its code is made of, drawn from the code that is here rather than from the
design it grew from.

> **Status: the launcher is built, and the crew's own tools with it.** The `martha`
> command (`init`, `approve`, `start`, and the `run`, `install`, `pin-key`, `keep-shapes`
> and `--version` words beside them), the approval and launch gates and the relay are in
> `src/` and run. So do the crew's tools (`a_crews_tools`): the dashboard's rows and the
> pane that draws them (`show_dashboard_beat`), the ledger of what a member did
> (`keep_the_ledger`), and a message from one member to another (`send_a_crew_message`).
> What does not run yet is the room across machines, and the handover that would let a
> member outlive its context; the order the rest arrives in is in
> [the port map](../docs/port-map.md). A box drawn for something not built says so, and is
> dashed in the pictures.

## Context: who uses Martha, and what it reaches

![Martha system context](../assets/c4-context.svg)

| | Solo mode | Team mode |
|---|---|---|
| People | the owner | the owner and teammates, under the roles the team names |
| Coding tools | Claude Code, with Martha as a plugin | the same |
| Also needs | git, and a terminal | the same, plus the Macula mesh and realm |
| Who says yes to a push or a release | the owner | the people the team names |

Solo mode needs no account and no service, and admits no room message. The room
itself is not built, and every launch still loads pieces of its slices: the node
id a member has, the mesh server's tool list, the trust a turn is believed on, and
the refusal of reach-widening mesh tools. The Components table below names each of
them. A mesh server is installed and run only when the project's config names one,
in either mode. The npm registry is where the signed package will come from;
today it is installed from a checkout (#2, #21).

## Containers: what Martha is made of

![Martha containers](../assets/c4-container.svg)

| Container | What it does | Mode |
|---|---|---|
| **the `martha` command** | `init`, `approve`, `start <member>`, `--version`: reads the declaration and the approval, starts one member, and holds its terminal until the member ends. | both |
| **the crew declaration** | `.crew/crew.json` in the project: who is on the crew, and the mode's table of who may do what. Written once, never written over. | both |
| **the approval** | Shows every file that would start code and the checkout's tree, then takes one word: yes. Its fingerprint covers both. | both |
| **the launcher** | Snapshots approved config, writes a launch record before the host starts, and runs the host with the member's arguments. | both |
| **Martha's state** | `$XDG_STATE_HOME/martha`, or `~/.local/state/martha`: one directory per project, holding node ids, approvals, launch records and snapshots. Never in the checkout. | both |
| **the relay** | Loads inside the member's own session and gates its turns: what it may run, and whose text it took in. | both |
| **team mode** | Realm admission and the shared room. | team only, not built |

### The host contract

An adapter gives the core only what a coding tool physically has: a clock,
stores, running a process, delivery in and out (a turn handed to the model, and
where that turn came from as far as the tool itself can say), and registering a
tool. Nothing that decides anything lives in an adapter. A behaviour that one
host needs and another does not is a slice, never a branch in an adapter.
`src/claude_code_host` is the one adapter there is; an OpenCode adapter is
planned.

### One code path for two modes

The mode is data in the declaration: a table of who may assign work, approve a
push or a release, and resume parked work. Solo is a table with one person who
may do everything. Team is a table with roles. In solo mode no room is run, no
room message is admitted and no mesh call is made; what does load on every launch
is the node id, the mesh server's tool list, the envelope trust and the reach
refusal, and the Components table below names each of those slices.

## Components: what the code is made of

![Martha components](../assets/c4-components.svg)

Every box is a directory in `src/`, and its test sits beside it. The names are
the capabilities, not the layers. A test fails when a directory in `src/` is in
none of the boxes and in none of those left out below, so the picture cannot
fall behind the code.

| Component | What it does |
|---|---|
| `run_the_martha_command` | The acts (`init`, `approve`, `start`, `run`, `install`, `pin-key`, `keep-shapes`, `--version`), and the words they are used with: a refusal on stderr names the command that fixes it, and the exit status says which kind it was. |
| `declare_a_solo_crew`, `declare_crew` | Reads `.crew/crew.json` once into typed settings, and writes it only where there is none. `who_may_act` holds the mode's table. |
| `approve_a_checkouts_config` | Names what would start code, asks on the owner's own terminal, and keeps the fingerprint it was given. |
| `start_a_member`, `pass_only_switches_that_load_no_config` | Refuses no terminal, an unknown name and a stale approval; then names the approval it starts on. `pass_only_switches_that_load_no_config` is what the owner's `--` words pass: an allow-list of the switches that load no config, code or permission, and any other word is refused by name. |
| `launch_a_claude_code_member` | The places in Martha's state, the approved snapshot, the launch record, and the host's command and arguments. `run_an_owner_signed_command` runs a shape the owner signed for a member's `martha run`: on a copy of the bytes it verified against the signed base, the member's own writes and the base lock, in a sandbox with nothing else. |
| `refuse_launch_of_unapproved_config` | Fingerprints the config and the tree at start, and allows only what was approved; `refuse_code_a_checkout_runs_itself` closes a checkout's own scripts. |
| `keep_martha_state_outside_the_checkout` | One directory per project, named by a hash of its path; `row_streams_directory` appends rows as files; `dashboard_rows_directory` writes one member's dashboard row as one file, renamed into place whole so a reader never reads half of it; `keep_what_the_owner_signed` keeps the owner's pinned hardware key, the newest epoch of each signed list, and the signed command shapes. |
| `host_contract`, `linux_process_identity` | What the crew core may ask of a coding tool — a clock, stores, running a process, delivery in and out — and this machine's answers to it, without a host. |
| `install_the_recorded_mesh_server` | A tree by bytes, never by version: recorded by `record_mesh_server_tools` (itself a by-hand script, drawn here because the launcher imports what it recorded), proved by `prove_the_mesh_server_bytes`, installed by the launcher. |
| `inbound_paths` | Every way text reaches a session and every way a checkout starts code, each row naming the gate on it; `check_every_path_is_gated` fails CI on a gap. |
| `take_in_a_turn`, `shell_tools`, `answer_a_tool_call` | What a host calls when a session took something in, and what may run after: the gate on every tool call, `take_in_a_tool_result`, which records what a built-in tool's result handed the model, `refuse_execution_after_ungated_text`, which stops everything after unvetted text, and `trust_only_framed_envelopes`, what a turn may be believed on. `keep_the_shell_for_an_owner_signed_command` reads the owner's signed list of command shapes and decides when a run's result keeps the shell. `session_records_in_rows` keeps a session's records in the host's row streams, one row per record, so what a session took in survives the launcher, the host and the machine restarting — and a record nobody can vouch for reads as lost, never as empty. |
| `name_the_source_of_a_prompt` | The origin a host attests, carried with the turn: with `attribute_a_cross_session_sender` and `carry_taint_across_a_refresh`; `trust_only_signed_lists` opens every list a gate trusts, from the owner's signed bytes. |
| `admit_a_room_message`, `read_a_room_through_its_gate` | The node id every member has, and the mesh server's tool list; `refuse_widening_a_member_reach` refuses the mesh tools that widen a member's reach. The room itself, which would admit a crew or shared message, is not built — yet every launch loads these parts of its slices, so the box is not dashed. |
| `claude_code_host`, `claude_code_relay` | The host contract on Claude Code: the plugin and its hooks, and the relay that answers over a socket. `hear_the_hosts_dialogs` holds the host's own field names for the dialogs it raises — a permission, an elicitation, a notification, and the check it runs about a call — and reads each one in the crew's words. |
| `check_nothing_private_gets_in`, `check_every_link_resolves` | This repository's own checks. A private issue link, an internal host name or a private remote fails CI by name. A link is called broken only when it really is: a host that answers 408, 429 or a 5xx, or times out, is asked again before its link fails, while a 404 or a missing file fails at once, by name. `check_posted_text_carries_nothing_private` reads the text members post on GitHub — issue titles and bodies, issue comments, pull-request titles and bodies, review bodies, inline review comments and commit comments — and refuses the same classes there, by name; it writes nothing, and a red run is the signal. `check_the_logos_are_valid_svg` holds every logo to well-formed XML, on this repository's own Node rather than through `xmllint` from the Ubuntu archive. `check_no_test_the_base_passed_goes_missing` names every test title the merge base holds that the branch's tip no longer does, by file and title; a deliberate removal passes only when a commit in the range says which title (or file) it drops, and a claim that excuses nothing fails too. |
| `install_the_pinned_installer` | `martha install`: the installer the running release pins, and no other — the pin read from the release's own tree, the exact version fetched, other bytes refused by name, and the installer run with the words unchanged. `read_the_words_of_martha_install` says which words `martha install` takes; `hold_the_launch_to_the_version_floor` refuses every act but `--version` and `install` of a placed release below the version floor this machine holds, found from the launcher's own real path (martha#21). |
| `run_the_nodes_own_npm_alone` | npm, and nothing of the machine's: the npm beside this node, empty user and global config, one named registry, `--ignore-scripts`, and an environment built from `HOME` and `PATH` alone. The mesh server's install and the pin's install share it, so they cannot drift apart. |
| `show_dashboard_beat`, `keep_the_ledger` | The crew's rows and its ledger. `show_dashboard_beat` holds a member's row and the rule that the newest beat wins; `report_progress` moves a row and `see_the_crew` lays every row out. `tell_the_owner_a_session_waits` keeps the dialogs the host has open on the owner's screen — a permission, an elicitation, a notification, a menu — so a row reads "needs you" when the host itself is asking, keyed by what raised each one; `say_what_the_host_is_asking` decides which of the host's own events opens a dialog and which one closes it, so a row's dialogs are changed by the host and nothing else; `ring_the_owner` rings the owner's own terminal once on the change into that state, with a base64 notification beside it. `a_crews_tools` answers every tool the crew registers in a member's session. `keep_the_ledger` loads `log_ledger`, whose streams sit in the crew's own state. `keep_the_crew_channel` is where a message lives, `send_a_crew_message` writes one, `show_what_a_message_became` reads back what became of it, and `read_a_crew_line` reads the HANDOFF and VERDICT lines a message carries, and `hand_a_member_its_crew_text` composes the crew text every session of a member is handed as it starts: who it is, the crew's practice when the crew switched it on, its role's text, the mode's text, the lines it sends, and the crew's conventions. `nudge_the_supervisor` and `watch_waits` find what has stalled from those rows and lines: a quiet member, a HANDOFF nobody answered, a wait on a person, a cycle of waits, and a PR head that moved off the tip its HANDOFF named. `spend_the_github_budget` is the crew's one GitHub allowance — the floor, the backoff, the shared counter, the head last seen and the green kept per sha — and `wait_for_ci` reads the CI on a sha through it. |
| `check_a_range_before_the_owner_says_yes` | The five tools a member's session can call that act (martha#256): `verify_range` reads a clone's range and the CI runs on its tip, `land_batch` cuts a batch of passed work and `fast_forward_after_the_owners_yes` moves the default branch onto the tip the owner said yes to, `worktree_open` and `worktree_finish` make and remove a worktree — each answered by the slice beside it, through the launcher's own `processes`, so nothing that acts runs in the member's session. `read_the_origin_a_clone_has` says what a clone is of. `forecast_what_a_batch_lands` is `land_batch`'s dry run (`check: 1`, martha#339), and `find_where_a_merge_clashes` reads `git merge-tree` and names what a pull request clashes with. |
| `hold_a_package_back_from_a_batch` | A held package stops a batch (martha#364): `land_batch` asks it before it runs anything, and `fast_forward_after_the_owners_yes` before its push is announced. It reads the open holds through `keep_the_supervisors_standing_items`' own fold, and refuses when one names a package of the batch (`package`, owner/repo#n), naming every hold. A hold whose day has come still holds until it is closed with its evidence, and a stream that cannot be read refuses too. |
| `write_my_handover`, `park_and_wake_a_member`, `wake_a_member`, `refresh_a_member` | A member outliving its context: the host writes the one handover file a member has and stamps it, and `write_my_handover` is the tool a member calls to have it written; a park is a marker in the crew's store that a clear, a restart or a refresh cannot lose, and `park_a_member` and `wake_a_member` are the two tools that set and clear it; `martha wake` clears that park and starts the member from its newest handover. `refresh_a_member` is the flow: the limit past which a member always hands over, the after-a-task trigger the declaration switches on, `refresh_this_session` for a refresh someone asks for, and the `crew_refresh` start the launcher records for it, the send-back and the decline rules, the storm park, and the clear and resume the mod carries out. |
| `stop_and_restart_a_member` | `martha ls` and `martha stop [<member>]` (martha#312): one line per declared member, running only while the kernel still names the recorded process at its pid; a stop is a request in the crew's store that the launcher holding the member reads on its own tick and acts on once, and when no launcher answers by the deadline the owner's verb ends the recorded group itself, through `processes.signalGroup`, which refuses a pid that now names another process. Whoever ends the member keeps `member_stopped` in the crew's lifecycle stream. |
| `keep_the_owners_todo_list` | The owner's to-do list (martha#316): the acts only the person at the keyboard can do, each command shown in full under what it does. `owner_todo_add` and `owner_todo_done` are the tools a member the table lets assign work keeps it with; the list is an append-only stream in the crew's rows, an act's own check (`pr_merged`, `tag_exists`) takes it off by itself on the launcher's sweep, and the owner reads it on the crew pane or with `martha todo`. |
| `keep_the_supervisors_standing_items` | The Supervisor's standing items (martha#317): what it holds back, who owes what, and the rulings it recorded as the owner's words. `standing_add` and `standing_close` are the tools a member the table lets assign work keeps them with, and `standing` reads them for every member; they are an append-only stream in the crew's rows, a hold closes only with a line of evidence, a hold that names its `package` stops a batch that would land it (martha#364), a fresh session of such a member is handed them at its start (inbound path A20), and the pane shows them under the owner's list. A ruling there is a record of the owner's words, never the owner's yes: no landing reads it. |
| `queue_the_owners_asks` | The ask queue (martha#313): `queue_ask` puts a routine ask in an append-only stream instead of a menu, `list_asks` only looks, `take_asks` claims every ask waiting that this crew still declares as one batch for a single menu and names any ask its gate refuses instead of stopping the take, and `settle_asks` takes the batch off once, with the ids the owner ticked — after the claim window an unsettled batch waits again, a late settle still removes what was ticked, and a settle is refused unless a menu closed in that session since the take. |
| `crew_files_directory` | The crew's store on this machine: the host glue that keeps handovers, parks and the rest of the crew's files whole in one directory, so no slice touches a disk. A place per name, a file written under a staging name and kept at 0600, and nothing read that is not this user's alone. |
| `switch_a_members_model`, `put_the_owners_model_back` | A member's model for one package (martha#315). `switch_a_members_model` keeps, in the crew's own store, the model a member was moved to, the package it is for and the way back, and the two tools a member calls for it: `switch_your_model` and `return_to_your_own_model`. The switch itself is the host's own model command, run after the turn from an order the launcher answers. `put_the_owners_model_back` undoes what the host's model command does to the owner's own settings file, which it saves a new default into: one lock per owner config directory, a snapshot of the file, a bounded wait for the save, a restore only when nothing else in the file moved, and a recovery at the next launch by the hash the record kept; `owners_settings_directory` is that file read and written whole, and the lock over it. `run_reviews_on_the_review_model` is the crew's house rule: a review subagent that does not name `house_rules.review_model` is refused, with the name to call it again on. |

### When two passed pull requests clash

A batch never settles a clash by hand (martha#339). `land_batch` with `check: 1`
says before anything is built which pull requests land, which the landing would
redo (a C4 picture, or the ceilings in `package.json`), and which clash by hand,
in which paths and with what: an earlier pull request of the batch, or the
landing on the default branch that brought the clash. In the landing itself, a
pull request that clashes by hand, or whose merged tree fails its ceilings, is
left out and named, and the rest land; a head cut from one left out is left out
with it.

The left-out pull request is fixed by its own builder, on its own branch, after
the batch lands: `git merge origin/main` there, with no rebase and no
force-push, the merge commit carrying only the resolution and anything else in a
commit after it. Its reviewer then reads only that, in one round marked *merge
only*: the `git show --remerge-diff` of the merge plus any commits after it.
That round does not count toward the two-round cap. The new head needs CI green
on its exact tip and a PASS that names it, and it rides the next batch. The
fix is never made in the batch's worktree, by the batch runner or by the
Supervisor.

### Left out of the Component diagram on purpose

The directories in `src/` below are drawn in no box, because nothing that runs
loads them. The same test above fails if any other directory joins them without a
box:

| Left out | Why |
|---|---|
| `record_mesh_answers` | A script run by hand, `npm run record:mesh-answers`, when a version of the mesh server is recorded. The gate reads the answer shapes it wrote; the script itself never runs. |
| `probe_launch_hosts` | A script run by hand, `npm run probe:launch`, to probe a coding tool's launch. The `martha` command never loads it. |
| `declare_a_launch_probe` | What one row of `npm run probe:launch` is: its shape, the place it runs in, and the command builders its rows share. The rows and the runner both import it; the `martha` command never loads it. |
| `probe_a_checkouts_own_config` | The rows of `npm run probe:launch` about a checkout's own config: its `CLAUDE.md` files and agents, and the tool servers, hooks and plugins it declares. The `martha` command never loads them. |
| `probe_the_owners_hooks` | The rows of `npm run probe:launch` about the owner's hooks: user hooks and plugins, the keys that turn every hook off, and the spellings of the `hooks` key. The `martha` command never loads them. |
| `probe_the_owners_own_folders` | The rows of `npm run probe:launch` about the owner's own folders: the skills trash, the synced skills, and a write into each folder the host loads the owner's text from. The `martha` command never loads them. |
| `probe_the_hosts_auto_memory` | The rows of `npm run probe:launch` about Claude Code's auto-memory, in a plain checkout and in a worktree. The `martha` command never loads them. |
| `record_claude_code_host` | A script run by hand, `npm run record:claude-code-host`, when the coding tool is upgraded. The adapter reads the recording it writes; the script itself never runs. |
| `redo_the_generated_files_of_a_merge` | A program `land_batch` runs, `npm run redo:generated`, over a clone whose batch clashes only in a C4 picture or the host ceilings (martha#381). It redraws the picture and merges the ceilings; the core runs it and never loads it. Two more modes answer for its rule without merging (martha#339): `--classify` tells the dry run whether one clashed path is redone, and `--judge` tells `verify_range` whether a landing merge that clashed is what the redo makes and nothing more. |

## Keeping the pictures true

The three SVGs are drawn by [`c4_diagrams.ts`](c4_diagrams.ts), and a test fails
when an SVG in `assets/` is not what that file draws. That test holds the picture to
its own geometry too, and names what is wrong: a text a box prints below its bottom
edge or past its right edge, a legend drawn across a box, a boundary's label drawn on
a box, two boxes drawn on each other, and anything drawn off the canvas. A box is never
drawn smaller than its text needs, and the Component page places its boxes in rows
rather than at a height each one was given by hand; the Container page's boundary takes
its height from the boxes it holds, so the label under them keeps its own ground. The
foot of the Component page is drawn from the left-out list rather than beside it, and a
check holds it there: the count, and each directory's name and the reason its own entry
gives. After changing a box:

```sh
node architecture/c4_diagrams.ts
npm test
```

Then render each one and look at it, and keep the tables on this page in step:

```sh
rsvg-convert -w 1400 assets/c4-components.svg -o /tmp/c4.png
```
