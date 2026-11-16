# The agent control loop

*The loop a member runs inside one work package: the task, its context, the tools it may use, what happens when a step fails, how the work is verified, and what survives a session.*

This exists so that “what a member does between taking a package and handing it over” has one reference. It is Martha’s map of the control-loop reference the crew reviewed on 2026-11-16, translated into the slices in this tree. The reference image is not vendored; this page is Martha’s own map, and it changes when the slices do.

## The loop

```text
build context → reason / plan → next action?
                     │ tool               │ verify              │ ask
                     ▼                    ▼                     ▼
              tools & workspace    verify candidate      Supervisor / owner
                     │ result             │
                     ▼                    ▼
               record result     evidence sufficient?
             ok │        │ error            │ yes       │ no
                ▼        ▼                  ▼           ▼
   check progress   failure & recovery      complete    build context
                │        │ bounded retry or replan → build context
                ▼        │ pause → Supervisor / owner
          budget left?
          │ yes       │ no
          ▼           ▼
    build context     save / resume (hand over or park)
```

Martha runs this **per member, per package**, inside the crew. The Supervisor owns the package and the owner’s yes; the reviewer owns the verdict; the relay owns the gate. The reference’s single-agent loop is the member’s inner loop, not a replacement for the crew.

## The six systems

| System | What it asks | Where it lives in Martha | What is still open |
|---|---|---|---|
| **Task & constraints** | goal, acceptance criteria, allowed actions, budget, definition of done | [the declaration](../src/declare_crew/declare_crew.ts), the Supervisor’s brief, the role and mode texts, owner yes, [standing items](../src/keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts) | A package contract: **#513**, extending the mandate in **#3** |
| **Context & memory** | retrieve, relevant files, current state, prior attempts, progress notes; compact to what this turn needs | [the crew text](../src/hand_a_member_its_crew_text/hand_a_member_its_crew_text.ts), [the handover](../src/write_my_handover/write_my_handover.ts), [refresh](../src/refresh_a_member/refresh_a_member.ts); the mesh server’s `mesh_recall` when configured, whose text stays on the shell gate | A structured context package; **#506** re-reads handover facts on resume |
| **Tools & workspace** | validate the call, authorize it, pause for approval, execute, capture id, exit status, output and pending work | [the tool-call gate](../src/answer_a_tool_call/answer_a_tool_call.ts), [tool results](../src/take_in_a_tool_result/take_in_a_tool_result.ts), [the shell refusal](../src/refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts), [what a session took in](../src/session_records_in_rows/session_records_in_rows.ts), [every path gated](../src/check_every_path_is_gated/check_every_path_is_gated.ts), [owner-signed commands](../src/run_an_owner_signed_command/run_a_signed_shape.ts), [worktrees](../src/open_and_finish_a_worktree/open_and_finish_a_worktree.ts), [batch landing](../src/land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts) | Package-level allowed actions in **#513**; a structured tool-result envelope |
| **Failure & recovery** | classify, inspect the actual state, decide whether a retry is safe, bounded retry, replan or pause; a timeout reconciles the operation | [the ledger’s failure words](../src/log_ledger/log_ledger.ts) (`ACT_NOT_SENT` / `OUTCOME_NOT_KEPT`), [one bounded recovery](../src/recover_a_failed_act/recover_a_failed_act.ts) (the named classes, the inspection, the one attempt and the pause), [failed reviews](../src/name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts), [merge clashes](../src/find_where_a_merge_clashes/find_where_a_merge_clashes.ts), [generated files after a merge](../src/redo_the_generated_files_of_a_merge/main.ts), [ending a turn](../src/end_a_running_turn/end_a_running_turn.ts), [restart](../src/stop_and_restart_a_member/stop_and_restart_a_member.ts), [waits](../src/watch_waits/watch_waits.ts) | For an announced outward act, the taxonomy, the inspection, the one attempt and the pause are here (**#512** slice 1); every tool call is slice 2 |
| **Verification** | stable candidate, run checks, test behaviour and scope, tie evidence to this revision; new edits invalidate the affected verification | [range verification](../src/check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts), [the verdict that passed](../src/find_the_work_a_verdict_passed/find_the_work_a_verdict_passed.ts), [no disappeared test](../src/check_no_test_the_base_passed_goes_missing/check_no_test_the_base_passed_goes_missing.ts), [CI](../src/wait_for_ci/wait_for_ci.ts) (its reads paid from [the GitHub budget](../src/spend_the_github_budget/spend_the_github_budget.ts)), [batch landing](../src/land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts) | Per-criterion acceptance evidence in **#513**; exact-tip CI stays |
| **State & continuity** | durable log, tool ids and results, workspace checkpoints, pending work and approval state, save / resume / reconcile | [the ledger](../src/log_ledger/log_ledger.ts), [row streams](../src/row_streams_directory/row_streams_directory.ts), [session records](../src/session_records_in_rows/session_records_in_rows.ts), [taint across a refresh](../src/carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts), [the handover](../src/write_my_handover/write_my_handover.ts), [the crew store](../src/keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts), [standing items](../src/keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts), [the ask queue](../src/queue_the_owners_asks/queue_the_owners_asks.ts), [the owner’s list](../src/keep_the_owners_todo_list/keep_the_owners_todo_list.ts) | Workspace checkpoints; a loop-event projection over the existing rows |

## What Martha already does better

- **Verification is tied to the exact revision.** `verify_range` reads a clone’s range and the CI runs on its tip; a PASS names the head; `check_no_test_the_base_passed_goes_missing` fails CI when a test the base passed is missing at the tip, unless a commit in the range says it dropped it. The reference’s “affected verification” is looser. Keep the exact-tip rule.
- **Every tool call is gated, and text taken in is tainted.** `answer_a_tool_call`, `take_in_a_tool_result` and `refuse_execution_after_ungated_text` are the reference’s “authorized?” box, with a stricter model: the owner chooses, per member, whether text taken in costs the shell, enforced, audited or off (`read_the_gate_mode`; absent means off, **#259**, **#321**). The launch recheck, reach widening and raw mesh reads are refused in every mode.
- **An outward act is written before it runs.** `sendOutwardAct` writes the row first, so a successor can tell an act that never ran from one that ran with no kept outcome. The loop’s “record result” should use that distinction, not a second log.

## What the loop does not change

- The crew stays the unit: Supervisor, builder, reviewer, owner. The loop is per member and per package.
- The host and the model plan. Martha’s job is constraints, gates, evidence and state; this is not a new planner.
- A package contract narrows what a package may do. It never widens a role or the mode table.
- **#309** owns the dashboard’s budget gauges; **#3** owns the mandate and revalidation; this page does not duplicate them.

## Where to start

1. **#513**, the package contract: the brief grows the fields, the relay enforces the allowed actions, and verification checks the acceptance evidence.
2. **#512**, failure and recovery: the named classes, inspect before retry, one bounded attempt, and timeout reconciliation.
3. Then a workspace checkpoint and a structured context package, if the first two show the need.

The reference’s last box, “save / resume / reconcile”, is already close to `write_my_handover` + `refresh_a_member` + `log_ledger`. The missing piece is the working tree, not the context.
