# claw-code: what it is, where it comes from, what Martha can learn

This report exists so that Martha borrows only ideas it is free to use, and
knows which of claw-code's choices to leave alone.

It answers [issue #4](https://github.com/macula-io/martha/issues/4). The
method was read-only. We cloned the repository and read it as untrusted text.
Nothing from it was built, installed or run, and no code from it is in Martha.

**Short answer.** claw-code began as a port of an exposed copy of a vendor's
proprietary source code, and its own history says so. Copying any of its code,
prompt text or tool descriptions into Martha or lazymesh is not safe. The answer
to the provenance question is **ideas only**, and only general ideas that we
re-implement from our own design. Three of those ideas are worth having. They
are ranked at the end.

## What we read

| | |
|---|---|
| Repository | `instructkr/claw-code`, which GitHub now redirects to [`ultraworkers/claw-code`](https://github.com/ultraworkers/claw-code/tree/51cfca114cf506a5d7a53ab1bffa8e1bbd3c780d) |
| Commit read | `51cfca114cf506a5d7a53ab1bffa8e1bbd3c780d` (2 November 2026) |
| Size | 1,861 commits since 31 March 2026, 428 tracked files, 12 Rust crates holding about 225,000 lines |
| Licence | MIT, "Copyright (c) 2026 UltraWorkers and Claw Code contributors" (`LICENSE:1-3`) |

Every `path:line` below refers to that commit.

## 1. What it is and how it works

**A terminal coding agent, written in Rust.** The `claw` binary is the
product (`README.md:101-102`). A Python tree under `src/` is described as a
reference and audit workspace, not the runtime (`README.md:116`). The project
calls itself "closer to a museum exhibit than a product pitch" and sends people
who want to do real work to two other harnesses (`README.md:59-65`).

**Runtime.** The `runtime` crate (about 92,000 lines) holds the conversation
loop, sessions, context compaction, the system prompt, config loading,
permissions, the sandbox, hooks, an MCP client and an LSP client. `api` talks
to Anthropic, OpenAI-compatible and local model providers. `tools` defines the
built-in tools, and `rusty-claude-cli` is the command-line front end (about
48,000 lines in one `main.rs`).

**Tools.** The tools are the usual set: shell, file read, write and edit, grep, web
fetch and search, todo lists, skills, sub-agents, tool search, teams and cron
jobs (`PARITY.md:42-52`). The task, team and cron registries are in memory only
(`rust/crates/runtime/src/task_registry.rs:2`,
`rust/crates/runtime/src/team_cron_registry.rs:2-5`). They do not survive a
restart.

**Plugins.** A plugin is a manifest with a name, version, declared
permissions (read, write, execute), hooks, lifecycle commands, tools and
commands (`rust/crates/plugins/src/lib.rs:117-132`). Hooks and lifecycle
commands run as shell commands (`rust/crates/plugins/src/hooks.rs:296-297`,
`rust/crates/plugins/src/lib.rs:2160-2185`).

**Coordination loop.** The coordination loop is mostly outside this
repository. The project's philosophy says the code is a by-product, and that
the thing worth studying is the system that produced it
(`PHILOSOPHY.md:5-7`). That system has three parts: a workflow layer that turns
short directives into plans, a notification router that keeps monitoring out of
the agents' context, and a multi-agent coordinator where an architect, an
executor and a reviewer settle their disagreements (`PHILOSOPHY.md:27-57`). A
Discord channel is the human interface (`PHILOSOPHY.md:17-25`).

Inside this repository, the coordination loop shows up as data shapes:

- **Lane events.** A lane is one unit of agent work. Its life is a fixed
  vocabulary of events: started, ready, prompt misdelivery, blocked, red,
  green, commit, PR opened, merge ready, finished, failed, merged, superseded
  and closed (`rust/crates/runtime/src/lane_events.rs:6-36`).
- **Green contract.** Before a lane can claim it is done, it must reach a
  declared verification level: targeted tests, package, workspace or merge
  ready. It can also be told to block on known flaky tests
  (`rust/crates/runtime/src/green_contract.rs:5-10`, `:31-35`).
- **Task packet.** A task is handed over as an objective, a scope, the repo,
  the worktree, a branch policy and acceptance criteria
  (`rust/crates/runtime/src/task_packet.rs:30-46`).
- **Worker boot.** A state machine detects when a worker is ready for a
  prompt, when it is stuck on a trust prompt, and when a prompt went to the
  wrong place (`rust/crates/runtime/src/worker_boot.rs:8-11`).
- **Recovery recipes.** Six known failures each get one automatic recovery
  attempt before they are escalated (`rust/crates/runtime/src/recovery_recipes.rs:2-7`).

**Parity harness.** A mock model service that behaves like Anthropic's
(`rust/crates/mock-anthropic-service/src/lib.rs:36`) replays 12 scripted
scenarios against the real CLI. The scenarios cover streaming, file
round-trips, a multi-tool turn, bash, permission prompts that are approved or
denied, a plugin tool, compaction and cost reporting (`PARITY.md:11-27`,
`rust/mock_parity_scenarios.json`). No live model and no API key are needed.
"Parity" here means behaving the same as the proprietary tool it was ported
from (section 2).

## 2. Provenance

**The repository's own history settles this.**

- The first commit, `507c246` (31 March 2026), is titled "Make the repository's
  primary source tree genuinely Python". Its message says "the old tracked
  TypeScript snapshot has been removed from the repository history", that "a
  local archive can still exist outside Git", and it tells future work "do not
  reintroduce the exposed snapshot into Git history".
- The README in that same commit (`git show 507c246:README.md`, lines 1-21) is
  titled "Claude Code Python Porting Workspace". It says the project's
  background is "the March 31, 2026 Claude Code source exposure", and that the
  author "originally studied the exposed codebase to understand its harness,
  tool wiring, and agent workflow".
- Tracked files still hold inventories taken from that snapshot.
  - `src/reference_data/archive_surface_snapshot.json:2` names the archive root
    `archive/claude_code_ts_snapshot/src`.
  - Lines 60-62 of the same file count 1,902 source files, 207 commands and
    184 tools.
  - `src/reference_data/tools_snapshot.json:3-5` maps each tool to its path in
    the archived TypeScript tree ("Tool module mirrored from archived
    TypeScript path ...").
  - The Python audit code still looks for that archive on disk
    (`src/parity_audit.py:7`, `src/context.py:24`), and `src/AGENTS.md:62-64`
    explains that it is kept out of Git.
- The Rust code keeps a harness that extracts its command, tool and bootstrap
  lists from an "upstream" TypeScript checkout. It reads `src/commands.ts`,
  `src/tools.ts` and `src/entrypoints/cli.tsx` from a path given in the
  `CLAUDE_CODE_UPSTREAM` environment variable
  (`rust/crates/compat-harness/src/lib.rs:41-53`, `:74`, `:95-106`). The parity
  notes compare the Rust bash tool against "upstream has 18 submodules"
  (`PARITY.md:63-67`).
- Early history holds paired commits with the same timestamp, where one subject
  says "Claude Code" and its twin says "Claw Code" (for example `44e4758` and
  `7eb6330`, both "feat: Rust port of ... CLI"). The renaming was done after the
  fact.
- The default system prompt opens with wording close to that vendor's
  published agent prompt (`rust/crates/runtime/src/prompt.rs:746-756`).
- The client identifies itself to the model API as that vendor's product: app
  name `claude-code` and the `claude-code-20250219` beta flag
  (`rust/crates/telemetry/src/lib.rs:13-15`, `:64-72`).

**What the repository says about this.** It "does not claim ownership of the
original Claude Code source material" and "is not affiliated with, endorsed
by, or maintained by Anthropic" (`README.md:301-304`). It does not say that the
code was written without access to the exposed source. The record above shows
that the code was written with that access.

**Conclusion for Martha and lazymesh.** The MIT licence covers what its
contributors could license. It cannot clear material derived from someone
else's proprietary source. We cannot establish which parts of claw-code are
clean, so we treat all of it as unsafe to copy. That covers code, prompt text,
tool names and descriptions, command lists and the scenario files. **Ideas
only.** We take only ideas that also exist independently of this source, and
we write them from our own design, not by reading claw-code while we write.

## 3. Security read

**What it can reach.** By default a session asks before each shell command.
Once the shell is allowed, it can do whatever the user can do, and a cloned
repository can allow it without asking.

- **The default mode asks before each shell command.** With no flag,
  environment variable or config, the mode is `workspace-write`
  (`rust/crates/rusty-claude-cli/src/main.rs:158-164`). The live permission
  gate is built from each tool's required level (`main.rs:14709-14717`), and
  the bash tool requires `danger-full-access`
  (`rust/crates/tools/src/lib.rs:487`, `:505`). In `workspace-write` that
  request goes to the user for approval, and with no one to ask it is denied
  (`rust/crates/runtime/src/permissions.rs:217-330`, `:319-330`). The parity
  scenarios `bash_permission_prompt_approved` and
  `bash_permission_prompt_denied` test this (`PARITY.md:23`). A second,
  looser bash check in `rust/crates/runtime/src/permission_enforcer.rs:147-175`
  is called only from its own tests.
- **The sandbox does not confine files or network.** When a shell command
  does run, on Linux it is wrapped
  commands in `unshare` with new user, mount, IPC, PID and UTS namespaces
  (`rust/crates/runtime/src/sandbox.rs:315-334`). It mounts nothing and
  remounts nothing, so the host file system stays visible and writable as the
  user. The requested file-system mode is only passed on as an environment
  variable (`sandbox.rs:244-252`). Network isolation is off unless asked for
  (`sandbox.rs:96-99`, `:235-237`). On other systems there is no sandbox
  (`sandbox.rs:221-226`).
- **A cloned repository can raise its own permissions.** Config is read from
  the user's files and also from `.claw.json` and `.claw/settings.json` inside
  the working directory, which come with the repository
  (`rust/crates/runtime/src/config.rs:442-468`). Project hooks are stripped
  because "there is no project-hook trust approval flow yet"
  (`config.rs:684-698`). The permission mode is not stripped:
  `"permissionMode": "danger-full-access"` in a repository's `.claw.json` is
  accepted (`config.rs:2063-2095`, `main.rs:3098-3120`). In that mode every
  tool, the shell included, runs without asking. The health check counts it as
  an explicit choice and gives no warning (`main.rs:4224-4235`). This is the
  main risk: opening a session in a repository you did not write can switch
  off the approval step.
- **Project config can start programs.** The `mcpServers` entries are not
  stripped either. When a session is built, every configured MCP server is
  started so that its tools can be discovered (`main.rs:12446-12459`,
  `main.rs:7516-7526`, `rust/crates/runtime/src/mcp_stdio.rs:1183-1184`).
- **Plugin permissions are labels.** Declared permissions are parsed and
  validated (`rust/crates/plugins/src/lib.rs:1849`). We found no place where
  they limit what a hook or lifecycle command can do, and those commands run as
  unconfined shell commands (`plugins/src/lib.rs:2160-2185`).
- **Trust prompts are answered automatically.** A resolver recognises "do
  you trust the files in this folder" prompts and auto-trusts paths on an
  allowlist (`rust/crates/runtime/src/trust_resolver.rs:5-11`, `:324-375`).

**Credentials.**

- API keys come from environment variables (`README.md:266`).
- OAuth tokens are stored in `credentials.json` under the config home
  (`rust/crates/runtime/src/oauth.rs:265-267`). That file is written with the
  process's default file mode and no explicit owner-only permission
  (`oauth.rs:371-380`). With the common umask, other local users can read it.
- Authorization is local and single-user: the person at the terminal, or the
  config files, decide the mode. Nothing records who approved what.

**What it does well.**

- `unsafe` code is forbidden across the workspace (`rust/Cargo.toml:15`).
- Its own roadmap documents fixes for skill files picked up from parent
  directories (`ROADMAP.md:1582`) and for MCP config secrets shown in status
  output (`ROADMAP.md:1803`).

## 4. What to borrow, what to avoid

### Borrow as ideas, ranked

1. **A declared "green level" on every hand-off.** A builder states which
   verification level the work reached (targeted tests, package, whole
   repository, merge ready), and the hand-off is refused below the level the
   package requires. Martha already records every hand-off and verdict. Adding
   the required level to the package, and the reached level to the hand-off,
   turns "CI is green" into a checked fact. Known flaky tests stay listed
   separately, not silently ignored.
2. **A scripted fake model for testing the crew loop.** Martha's adapters can
   be tested against a deterministic fake that replays scripted turns: a
   builder hands off, a reviewer fails it, and the builder fixes and hands off
   again. CI can then prove the loop with no live model, no API key and no
   cost. This is a standard testing technique. We write our own scenarios from
   Martha's own events.
3. **Readiness and misdelivery as explicit states.** Treat "the session is
   ready for a prompt", "the session is waiting on a question" and "the
   message reached the wrong place" as recorded states of a crew member. Today
   they are inferred from silence. A conductor that knows a member never
   received its brief can resend it, instead of waiting.

### Avoid

- **Copying anything.** That includes code, prompt wording, tool names and
  descriptions, command lists and scenario files (section 2).
- **Claiming to be another product.** Martha's adapters identify as Martha.
- **A chat platform as the approval channel.** In Martha a person's yes on a
  push or a release is recorded by Martha itself, not by a hosted chat
  service.
- **Permissions that a repository can grant itself.** Settings that come
  with a cloned repository must never raise permissions, start programs or
  answer trust questions. Only the user's own settings may do that.
- **A sandbox in name only.** If Martha ever offers isolation, it confines
  files and network, or it is not called a sandbox.
- **Secrets in files readable by other users.** Credential files are created
  owner-only, from the first write.
