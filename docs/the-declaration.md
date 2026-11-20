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
| `mode` | yes | Who may do what: a mode's name, as `"team"`, or the table below. A name alone has the roles its members hold, and every act is the owner's. | refused |
| `house_rules` | no | Switches, places and windows (below). | every switch off |
| `conventions` | no | A file under `.martha/` that every member reads. | `.martha/conventions.md` when it exists, else none |
| `channel_read_seconds` | no | How often a session reads the crew's channel, in whole seconds, at least 1. | the value `martha init` writes |
| `handover_ceiling_minutes` | no | How long a handover waits behind a running turn before that turn is ended, in whole minutes. | 10 |
| `backlog` | no | Where to look for work nobody holds (below). | no backlog view, no idle nudge |
| `volatile_paths` | no | The absolute roots a reboot deletes. | the machine's own roots |
| `host` | no | The host a member runs on when the member names none. | `claude-code` |
| `engine_endpoint` | no | Where an engine member's model is reached (below). | none; an engine member is refused at its start |
| `thresholds` | no | When a row reads offline, when a member hands over, when a report is stale (below). | the values below |
| `id` | no | The crew's name: the name of its tmux session when `terminal` is `tmux` (martha#932). | none |
| `terminal` | no | The terminal `martha up` opens members in: `kitty`, or `tmux`, where each member gets a window in one session named by `id` on Martha's own tmux server, shown with `martha attach [<member>]` (martha#932). `tmux` needs `id`. | `kitty` |
| `workspace` | no | Where the crew's clones sit (below). | no places from it |
| `mesh` | no | The crew's mesh realm, key folder and services (below). Read by no part of Martha today. | none |
| `harnesses` | no | The harnesses a profile may name (below). | none |
| `providers` | no | The providers a profile may name (below). | none |
| `profiles` | no | Named model, harness and provider sets a member may name (below). | none |
| `clock_zone` | no | The time zone every clock time Martha prints for the crew reads in, by its IANA name (`Europe/Brussels`): the nudge lines, the CI wait and budget answers, the backlog and the crew-tools flag. A name this machine's time zone data does not know is refused. | `UTC` |
| `github` | no | How the crew spends its GitHub allowance (below). | the values below |
| `transcripts` | no | How many launches' transcripts are kept, and how large (below). | the values below |
| `owner_notices` | no | Which of the host's notices reach the owner (below). | the notices shown as a dialog before |
| `friction_repos` | no | The repositories a member may file a tool-friction note in, each `owner/name` (martha#318). A repository not named here is refused by name, and a crew that names none files no note. | none |
| `public_emails` | no | The email domains a friction note may name besides the ones every note may (martha#318), each a domain such as `acme.example`. | none |

## `members[]`

| Field | Required | What it holds |
|---|---|---|
| `name` | yes | The member's name, unique on the crew. |
| `role` | yes | One of `mode.roles`. |
| `model` | no | The model this member runs; left out, the host's own. |
| `host` | no | The host this member runs on; left out, the crew's `host`. |
| `parked` | no | `true` keeps the member down: `martha up` does not start it, and `martha ls` shows it parked. |
| `profile` | no | A profile under `profiles`: the member runs on its harness's host and its model. Never beside `model` or `host`. |
| `mesh_key` | no | The file the member's mesh key is in; left out, `<mesh.keys>/agent-<lowercased name>.key`. Read by no part of Martha today. |

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
| `gate_enforce` | `gate_enforces`, as the draft of martha#931 spells it; never beside it. |

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
| `key_file` | no | The absolute path of the file the key is in; never beside `key_from`. |

Left out, and an engine member's profile names a provider with an `endpoint`, the endpoint is that provider's. Both at
once is refused.

## `thresholds`

Each field is optional. A field left out reads the value Martha used before it was a field.

| Field | What it holds | When left out |
|---|---|---|
| `offline_after_seconds` | How quiet, in whole seconds (at least 6: more than one 5-second beat), a member's row must be before it reads offline. An offline member is not nudged and is never free. | 30 |
| `handover_percent` | The share of its context, a whole percent from 1 to 100, at which a member hands over. A member at or past it takes no new package. | 70 |
| `progress_stale_minutes` | How old, in whole minutes (at least 1), a member's last report may be in the middle of a package before its row is flagged. | 30 |

```json
{
  "thresholds": { "offline_after_seconds": 30, "progress_stale_minutes": 30, "handover_percent": 70 }
}
```

## `workspace`

| Field | Required | What it holds |
|---|---|---|
| `root` | no | The folder the crew's clones sit in, relative to the project root. With `house_rules.workspace_layout` on, the clones are there and the worktrees in `worktrees` beside it; `house_rules.clones` and `worktrees` are then left out. |
| `root_allowed` | no | Folder names allowed beside the clones. Read by no part of Martha today. |
| `own_orgs` | no | The crew's own GitHub organisations. Read by no part of Martha today. |

## `mesh`

| Field | Required | What it holds |
|---|---|---|
| `realm` | no | The realm, 64 hex characters. |
| `keys` | no | The folder members' mesh keys sit in. |
| `mail` | no | `{ "service": <name>, "on": true or false }`. |
| `memory` | no | The same shape. |
| `graph` | no | The same shape. |
| `kanban` | no | The same shape. |

## `harnesses`

One entry per harness, by its name: `claude` (Claude Code; `claude-code` also) or `martha-engine`.

| Field | Required | What it holds |
|---|---|---|
| `config` | no | Where the harness keeps its own configuration. Read by no part of Martha today. |

## `providers`

One entry per provider, by a name the crew picks.

| Field | Required | What it holds |
|---|---|---|
| `endpoint` | no | Where its model is reached: a URL, or a bare host reached on `https:`. |
| `key_from` | no | The name of the environment variable that holds the key. |
| `key_file` | no | The file the key is in: absolute, or under `~/`. Never beside `key_from`, and never the key. |
| `account` | no | The account it bills. |
| `billing` | no | How a Claude Code member on a profile of this provider is billed: `subscription` (the owner's sign-in) or `api_key` (the key the launcher carries). Only that credential reaches the member. Left out, the launch asks the host whether you are signed in: the key only when you are not and the launcher carries one; otherwise the subscription, also when the host cannot say. |

## `profiles`

One entry per profile, by a name the crew picks.

| Field | Required | What it holds |
|---|---|---|
| `model` | yes | The model. |
| `harness` | yes | A harness under `harnesses`. |
| `provider` | yes | A provider under `providers`. Every `martha-engine` profile the members name names the same one. |
| `context_limit` | no | The model's context, in tokens. |

## `github`

| Field | What it holds | When left out |
|---|---|---|
| `budget_floor` | The calls GitHub says are left at or below which the crew makes no more until the window resets: a whole number, 0 or more. | 500 |

## `transcripts`

Martha keeps each ended launch's transcripts, redacted, so the owner can read what a member's session did.

| Field | What it holds | When left out |
|---|---|---|
| `launches_kept` | How many launches' transcripts are kept, newest first; older launches are removed. A whole number, at least 1. | 64 |
| `megabytes_kept` | The most one transcript, and one launch's transcripts together, may hold, in whole megabytes (at least 1). A file past it is kept as one line naming the bound. | 16 |

## `owner_notices`

| Field | Required | What it holds |
|---|---|---|
| `show` | no | The notices that reach the owner, by the host's own names (`agent_needs_input`, `worker_permission_prompt`, ...). A name the host does not send is refused; an empty list tells the owner of nothing. Left out, the owner is told of every notice Martha showed as a dialog before. |

## Friction notes

A note filed with `file_a_friction_note` is refused when it carries a home path, a private address, an email outside the domains `public_emails` names, a hex id, a token or a lab hostname; the refusal names the class and never the value. Every class the private-text scan runs is one the note refuses, so a note cannot turn the daily posted-text report red (the Supervisor's ruling on martha#318, which the owner can overrule). There is no `lab_hosts` field: the machine-name family the scan knows is not one a crew declares.
