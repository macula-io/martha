# The Goose trial: what nine lines saw on a pinned build

This exists so macula-io/martha#541's shape is proven on a real Goose before any Goose adapter is written.

A throwaway driver ran the nine checks the issue names, each as its own launch, and this is what it
saw. The driver is beside this file; the result of each line, with its strace, came out of the run
described under **How it was run** and is quoted here, because the record is the evidence and the
raw files live outside the repository.

## What was run

| | |
|---|---|
| Engine | the fork `macula-apps/goose`, worktree on `pallas/541-trial`, commit `3da5adff4`, no change made to it |
| Build | `cargo build -p goose-cli --bin goose --no-default-features --features portable-default` |
| Binary | reports `1.59.0` |
| Model | `ministral-3:3b` in the local Ollama, digest `f04aa1c738f6`, 3.0 GB, Q4_K_M, tools capable |
| Anthropic | nothing in the launch reaches it: the provider is Ollama and `OLLAMA_HOST` points at the trial's own proxy |

`portable-default` and not the default features: the default set builds llama.cpp, whose bindgen
needs libclang, which this box has not. `portable-default` is the fork's own feature set without
local inference (`rustls-tls`, `tree-sitter`, `live-voice`, `aws-providers`, `telemetry`, `otel`,
`bundled-mcp`, `scheduler`, `platform-apps`, `chat-recall`, `acp-http`), so Scheduler and Apps are
compiled in even though the launch never turns them on.

## How it was run

Each line is one launch of `goose acp` over stdio, ACP frames one per line, with Martha's side
played by the driver:

- **The owner's home is never written.** A stand-in owner home holds the markers line 1 plants, and
  the driver is started from it. Goose gets a `HOME` and a `GOOSE_PATH_ROOT` of its own per launch,
  both written by the launcher.
- **A recording proxy** sits between Goose and Ollama: every request body is kept, so a line can say
  what the model was given rather than infer it from an answer.
- **`strace -f -e trace=file`** covers the whole process tree, so a line can say that a path was
  never opened, not only that a marker never appeared.
- **The mode is pinned to `approve`** in the config root, and a launch whose session reports any
  other mode is a failure before any line is read.
- **The limits** are the owner's: two launches a check, ten minutes and twenty ACP requests each,
  ninety minutes in all. **The driver enforces none of them and counts none of them**: its only cap
  is a 240-second timeout on a turn, and it neither counts launches nor counts requests. What the run
  itself shows is the evidence for the ten minutes: each launch, timed from the launcher's own config
  being written to that line's `result.json` being written, ran 40 s, 39 s, 1 m 40 s, 1 m 45 s, 22 s,
  22 s, 29 s, 1 m 59 s and 20 s, for 8 m 22 s over the nine — every launch well inside ten minutes,
  though nothing stopped one from running longer. The two-launch cap did not hold, and that is said
  rather than hidden: line 1 was launched three times (the PATH and the launch root) and lines 3 and
  9 four times each (line 3 for a positive half the model would not enact, line 9 for the extension
  switches). The whole session, including those runs, stayed inside ninety minutes.

## The nine lines

Verdicts are from one `--line all` run on the final driver, on 2026-11-17. Every one of the nine
launches recorded 0 opens under the stand-in owner home and 0 under the real home; line 1's trace
holds 1,312 opens in all, all of them under the launch's own places or the binary's directory.

| # | Line | Verdict | What was seen |
|---|---|---|---|
| 1 | Nothing of the owner's home reaches the session | **pass** | 10 markers planted (three skill directories, two recipe directories, two agent directories, and `~/.config/goose`'s config, settings and a plugin). No marker in any request body or in the answer, and no open under the home. |
| 2 | Nothing of an unapproved checkout reaches the session | **pass** (2026-11-19, martha#614) | Skills are on now, so a launch of this checkout would hand its skills to the model: the line is the launch gate's refusal, with no launch. The checkout holds the 13 markers; the real gate (engine host, nothing approved) refused it, naming `.agents/skills`, `.goose/skills`, `.claude/skills`, `.agents/plugins`, `.config/goose/settings.json` and `.config/goose/settings.local.json`. On 2026-11-17, before the gate had Goose's rows, the line launched and saw no marker reach the session. |
| 3 | Every tool call is asked about, and a once-rejection stops it | **pass** | Three calls arrived as `session/request_permission`: shell `allow_once`, shell `reject_once`, write `reject_once`. The allowed call made its file; neither rejected call made anything; the model received both refusals. |
| 4 | A subagent's tool call reaches the same client | **pass** | Launched with `--with-builtin developer,summon`. The model called `delegate`, and the subagent's own shell call (`echo subagent-ran`) arrived at the client as a permission request. |
| 5 | Once-answers only; the permission store stays empty | **pass** | One `allow_once` given; `permissions/tool_permissions.json` under the launch's config root was absent at the end. |
| 6 | One full turn on a model with no Anthropic link | **pass** | A turn on `ministral-3:3b` ended `end_turn`, 167 characters, two model requests. |
| 7 | Killing the process group ends Goose and everything it started | **pass** | With a shell tool call run first, `SIGTERM` to the launch's process group left no process behind (`pgrep -g` empty). |
| 8 | Relayed `!` and `/` text arrives as plain text | **pass** | `[owner message]` then `!touch …` made no file and reached the model as text; `/clear` did not clear the history (the earlier turn was still in the next request body). |
| 9 | The tool list is Developer's and the skill loader, and a typed `/<skill>` reaches the model as text | **not-observed** (2026-11-19, martha#614), twice | The member typed `/martha-trial-approved` with slash commands off. The turn's request offered exactly `edit`, `load_skill`, `read_image`, `shell`, `tree`, `write`, listed `martha-trial-approved` outside the user's words, and carried the typed text: each of these holds. In both launches the cap allows, `ministral-3:3b` did not call `load_skill` for the skill, so the loading half is not seen. On 2026-11-17, before skills were on, this line failed: `load_skill` was offered when nothing was meant to be. |

### The 2026-11-19 run of lines 2 and 9 (martha#614)

Lines 2 and 9 were run again after approved skills were turned on (DECIDED 2026-11-18 "Approved skills on (Recommended)"
and "Switch built-ins off (Recommended)"). The engine was the fork `macula-apps/martha-engine` at `12574353e`, the
commit Martha's recording names, built with `cargo build -p goose-cli --bin martha-engine --no-default-features
--features portable-default`; the binary reports `martha-engine 1.60.0`. The model was the same `ministral-3:3b`. Line
2 was run once; line 9 was launched twice, the cap. Its loading half waits on a model that calls the loader.

## What failed, by name

### 1. `load_skill` cannot be switched off (Goose) — this line goes back to the gate

The state machine registers `SkillOperation` for every session
(`crates/goose/src/agents/state_machine_builder.rs:134`), and its `inference_tools` returns the
`load_skill` tool unconditionally (`crates/goose/src/agents/state_machine/ops_skills.rs:322-324`). It is
not an entry in the platform extension map, so neither `--with-builtin` nor the config's extension
switches touch it. With every other platform extension switched off, the offered list was
Developer's five tools plus `load_skill`.

What this does and does not mean:

- Martha's **gate** holds: `load_skill` is a tool call like any other, so it arrives as
  `session/request_permission` and the client can refuse it (line 3).
- Martha's **allow-list** does not hold: the member's model is offered a tool Martha did not name,
  and `load_skill` reads skills from the checkout and from the home — the two places lines 1 and 2
  show Martha must control.

Upstream, this is the same class as aaif-goose/goose#11728 (a host that embeds Goose starts with only
its own tool servers, and no built-in); the skills work is being reworked (aaif-goose/goose#13430,
aaif-goose/goose#13481). Whether that becomes an upstream ask is the owner's decision, not this
package's.

### 2. The launch's `PATH` (a launcher decision, not a Goose defect)

The first line-1 run failed on the trace, not on a marker: the shell tool searched the owner's
inherited `PATH` for `bash` and opened twelve shells under the real home (`~/.asdf/...`,
`~/.cargo/bin/bash`, `~/.local/bin/bash`, `~/.nix-profile/bin/bash`, the crew's own member shell and
more). A launcher must give a member a narrow `PATH` of its own; this one gives `/usr/bin:/bin`.

### 3. The launch root (a launcher decision, not a Goose defect)

That run also had its checkout under the owner's home, and the search for a repository walks up from
the checkout to the filesystem root, opening every ancestor on the way — so the home directory itself
and the `.git` that would sit in it were opened although neither is a repository. A launch root
inside the owner's home is a trespass on the home whatever the tree holds; the trial now launches
under `/var/tmp/martha-goose-trial`.

### 4. The extension switches in the config root (a launcher decision)

With `goose acp` and no `--with-builtin`, the builtin selection is Developer alone
(`crates/goose/src/acp/server.rs:260-273`), but the session then also loads every extension the config
has enabled (`crates/goose/src/acp/server.rs:612-645`), and Goose reads its platform extensions in at
their own defaults (`crates/goose/src/config/migrations.rs:45-80`) — Analyze, Apps and Extension
Manager default to on. The first line-9 run offered seventeen tools, twelve of them beyond the
allow-list (`analyze`, `apps__*`, `delegate`, `load`, `load_skill`, `extensionmanager__*`).

The switch is the `extensions` mapping in the config root: `enabled: false` per extension. The
launcher writes that mapping for every platform extension the pinned fork declares, read from the
fork's own source so the list cannot drift from the build, keeping Developer. After that the offered
list fell to Developer's five plus `load_skill`. One detail worth passing on: the extension manager's
key is `extensionmanager`, not its display name `Extension Manager`, and Skills is a platform
extension named `skills`.

## What this means for the design

- **Shapes 1, 2, 3, 4 and 6 hold** on this build: a child process, Martha as the only way in, the
  client deciding every tool call, once-answers only, and results and turn ends read off the
  protocol.
- **Shape 5 holds with three launcher obligations now named**: a narrow `PATH`, a launch root outside
  the owner's home, and an `extensions` mapping derived from the pinned fork. "Martha owns everything
  Goose reads" is true only when all three are written.
- **Shape 5's "Skills built-in off" does not hold.** Skills are not a switchable extension on this
  build; `load_skill` is always offered. Either the gate accepts it as a tool call that is always
  asked about and whose reads the launch gate refuses, or the shape needs the upstream change.
- **Nothing here stands in for a gate**: line 2's gate half and Goose's own rows are packages 7-8.

## How to reproduce

On a box with Ollama serving `ministral-3:3b`, with the fork built as above:

```sh
GOOSE_BIN=/path/to/goose-541-trial/target/debug/goose
GOOSE_SRC=/path/to/goose-541-trial          # the fork's checkout, same commit
TRIAL=/some/dir/outside/the/home            # evidence, and a launch root beside it

mkdir -p "$TRIAL/owner-home"
HOME="$TRIAL/owner-home" node trial_the_goose_host/drive_the_trial.ts \
  --goose "$GOOSE_BIN" --goose-source "$GOOSE_SRC" \
  --model ministral-3:3b --evidence "$TRIAL" --line all
```

`--line` takes `1`..`9` or a list (`--line 3,5`) or `all`; `--launch` moves the launch places
(default `/var/tmp/martha-goose-trial`); `--ollama` names the model endpoint. Each line writes
`<evidence>/line-N/result.json`, `<evidence>/line-N/trace.log`, `<evidence>/line-N/acp.jsonl` (every
message across the pipe with the engine, timestamped and by direction, appended as it crosses) and
`<evidence>/line-N/engine-logs/` (the launch's own `goose-root/state/logs`, copied in before the launch
ends). A line whose verdict is `not-observed` fails by name if no exchange was kept beside it
(`./the_evidence_it_keeps/the_evidence_says_why.ts`, martha#694).
