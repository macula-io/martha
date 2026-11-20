# The crew's declaration

A crew is declared in one file, `.martha/martha.json` under the project root. This page names every field that file
may hold. A field the file leaves out reads the default named here. A field this page does not name is refused when
the crew is declared. `src/declare_crew/the_declaration_page.node-test.ts` fails when the code accepts a field this
page does not name.

## Top level

| Field | Required | What it holds | When left out |
|---|---|---|---|
| `version` | yes | The declaration's format: `1`. | refused |
| `owner` | yes | The owner's name: a person, never a member. | refused |
| `members` | yes | The crew's members, one object each (below). | refused |
| `mode` | yes | Who may do what (below). | refused |
| `house_rules` | no | Switches, places and windows (below). | every switch off |
| `conventions` | no | A file under `.martha/` that every member reads. | none |
| `channel_read_seconds` | no | How often a session reads the crew's channel, in whole seconds, at least 1. | the value `martha init` writes |
| `handover_ceiling_minutes` | no | How long a handover waits behind a running turn before that turn is ended, in whole minutes. | 10 |
| `backlog` | no | Where to look for work nobody holds (below). | no backlog view, no idle nudge |
| `volatile_paths` | no | The absolute roots a reboot deletes. | the machine's own roots |
| `host` | no | The host a member runs on when the member names none. | `claude-code` |
| `engine_endpoint` | no | Where an engine member's model is reached (below). | none; an engine member is refused at its start |
| `thresholds` | no | When a row reads offline, when a member hands over, when a report is stale (below). | the values below |

## `members[]`

| Field | Required | What it holds |
|---|---|---|
| `name` | yes | The member's name, unique on the crew. |
| `role` | yes | One of `mode.roles`. |
| `model` | no | The model this member runs; left out, the host's own. |
| `host` | no | The host this member runs on; left out, the crew's `host`. |

## `mode`

| Field | Required | What it holds |
|---|---|---|
| `name` | yes | The mode's name, for people to read (`solo`, `team`). |
| `roles` | yes | The role names members may hold. |
| `may` | yes | For each act, the roles that may do it, and `owner` for the owner. The acts are `assign_work`, `approve_landing`, `resume_parked_work`, `offer_owner_asks`, `restart_member` and `hold_reviews`. An act the table leaves out is the owner's. |

## `house_rules`

Each switch is off unless the file says `true`.

| Field | What it holds |
|---|---|
| `owner_items` | A switch; accepted, and read by no part of Martha today. |
| `workspace_layout` | Members keep clones and worktrees in the two places below. |
| `member_work` | A switch; accepted, and read by no part of Martha today. |
| `practice` | Every member is handed the crew practice text. |
| `strict_gate` | Read only from a file an earlier release wrote: `true` is `gate_enforces: "all"`. |
| `dashboard` | A session opens the crew's pane and keeps its row. |
| `refresh_between_tasks` | A member hands over after a finished task, not only at the handover share. |
| `owner_bell` | The owner's bell rings when a member's host asks the owner something. |
| `nudges` | The crew tells whoever routes work when work stalls; needs the three windows below. |
| `review_model` | The model reviews run on. |
| `clones` | Where the crew's clones sit; required with `workspace_layout`. |
| `worktrees` | Where the crew's worktrees are made; required with `workspace_layout`. |
| `stalled_minutes` | How long a working member may go without a report before a nudge; 0 turns it off. |
| `review_minutes` | How long a HANDOFF may go unanswered before a nudge; 0 turns it off. |
| `person_minutes` | How long a wait on a person may last before a nudge; 0 turns it off. |
| `gate_enforces` | Who the shell gate enforces for: `all`, `nobody`, or members' names. |
| `gate_audits` | Who the shell gate audits: members' names. |

## `backlog`

| Field | Required | What it holds |
|---|---|---|
| `places` | yes | Organisations, or `owner/repo` repositories, to look for unheld work in. |
| `idle_minutes` | yes | How long a member may sit idle beside unheld work before a nudge; 0 turns the nudge off. |

## `engine_endpoint`

| Field | Required | What it holds |
|---|---|---|
| `host` | yes | The endpoint's URL, `http:` or `https:`. |
| `base_path` | no | The path under the host. |
| `key_from` | no | The name of the environment variable that holds the key. The key itself never goes in the file. |

## `thresholds`

Each field is optional. A field left out reads the value Martha used before it was a field.

| Field | What it holds | When left out |
|---|---|---|
| `offline_after_seconds` | How quiet, in whole seconds (at least 1), a member's row must be before it reads offline. An offline member is not nudged and is never free. | 30 |
| `handover_percent` | The share of its context, a whole percent from 1 to 100, at which a member hands over. A member at or past it takes no new package. | 70 |
| `progress_stale_minutes` | How old, in whole minutes (at least 1), a member's last report may be in the middle of a package before its row is flagged. | 30 |

```json
{
  "thresholds": { "offline_after_seconds": 30, "progress_stale_minutes": 30, "handover_percent": 70 }
}
```
