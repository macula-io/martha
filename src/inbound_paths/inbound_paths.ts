// Every way text can reach a member's session, and every way a checkout can get
// code started on a member's machine, and what control stands on each.
//
// This is the machine-readable copy of the table in issue #2, read from
// crew-code at macula-sponsors cf5e5a3; the C rows come from issue #16. The issue
// tables are its review; this is what ../check_every_path_is_gated drives and
// what CI fails on.
//
// A row is here for one reason: text arrived, or code is about to start, and
// something must decide whether that may go ahead. A path is never removed from
// this list — a path that stops delivering text gets a control that says so, in
// words.

import { admitsInCrewRoom, admitsInSharedRoom, type DeliveryGate } from '../admit_a_room_message/admit_a_room_message.ts'
import { admitsLaunch, type LaunchGate } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { passesOnlySwitchesThatLoadNoConfig, type ArgumentGate } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'

/**
 * How the path reaches the member.
 *
 * - `delivered` — text put into a turn for the model.
 * - `fetched` — text the model's own tool brought back.
 * - `launched` — code the host starts by itself, from files in a checkout. No
 *   tool is called and no model runs, so neither the shell gate nor a delivery
 *   gate stands in front of it: only a launch gate does.
 */
export type PathClass = 'delivered' | 'fetched' | 'launched'

/**
 * Who, if anyone, attests the sender of text arriving on this path.
 *
 * Only an attested path may carry a sender's identity into the shell gate. Every
 * other path carries none, whatever the text says about itself: a git commit
 * author, a `gh` login, an envelope's `from` attribute and a name in a message are
 * all written by whoever wrote the text, so none of them is an identity.
 *
 * - `roster` — a crew roster checked the sender before delivery.
 * - `station` — the mesh station attested the caller.
 * - `host-binder` — the host attests the sending process and the binder
 *   (../attribute_a_cross_session_sender, martha#14) resolves it to a node id
 *   through the launcher's record. A host that attests no sender binds nothing,
 *   and a delivery on this path then carries no identity.
 * - `host-engine` — the host's engine stamped the turn as typed at the
 *   member's own terminal, where it queued it and where no hook may set it, so
 *   the sender is the owner (Raf's ruling on martha#51). The identity on such a
 *   row is the owner's mark, never a node id: the owner signs the policy, so
 *   the owner is its root and not an entry in it.
 * - `none` — nobody attests the sender.
 */
export type SenderAttestation = 'roster' | 'station' | 'host-binder' | 'host-engine' | 'none'

/**
 * The delivery gates, by the name a row may use. A row may only name one of
 * these, and the function behind the name is what the coverage check drives: a
 * name on its own is not a control, and a function that admits everyone is not
 * one either.
 */
export const DELIVERY_GATES = {
  'crew-room-acceptance': admitsInCrewRoom,
  'shared-room-acceptance': admitsInSharedRoom,
} as const satisfies Record<string, DeliveryGate>

export type KnownDeliveryGate = keyof typeof DELIVERY_GATES

/**
 * The launch gates, by the name a row may use. As with the delivery gates, the
 * coverage check drives the function behind the name, once per question.
 */
export const LAUNCH_GATES = {
  'owner-approved-launch-config': admitsLaunch,
} as const satisfies Record<string, LaunchGate>

export type KnownLaunchGate = keyof typeof LAUNCH_GATES

/**
 * The argument gates, by the name a row may use: what decides which of the
 * owner's words reach the host when Martha starts it. The coverage check drives
 * the function behind the name, once per question.
 */
export const ARGUMENT_GATES = {
  'owner-arguments-load-no-config': passesOnlySwitchesThatLoadNoConfig,
} as const satisfies Record<string, ArgumentGate>

export type KnownArgumentGate = keyof typeof ARGUMENT_GATES

/**
 * The path gates a row may name: a control that checks every path a member's
 * own file tools name (martha#168). The function behind the name is built where
 * the machine is reachable, in the host adapter that holds the guard
 * (../refuse_a_member_writing_owner_memory, admitsAWriteNoLaterGitRunReads), and
 * the coverage check takes it as an argument — a slice may import no adapter, so
 * the name is all that can stand here.
 */
export type KnownPathGate = 'nothing-a-later-git-run-reads'

/**
 * What stops outsider text on this path from being acted on.
 *
 * - `delivery-gate` — a deterministic check on the sender runs before the text
 *   is in a turn (the crew room's acceptance rule, the board's roster).
 * - `shell-gate` — nothing checks at delivery; the text lands, and
 *   ../refuse_execution_after_ungated_text stops the session executing for as
 *   long as the text is readable.
 * - `no-text-reaches-the-model` — the path is listed so it is not forgotten,
 *   and carries no body text. It must say why.
 * - `launch-gate` — the host is not started in a checkout whose launch config
 *   the owner has not approved by content
 *   (../refuse_launch_of_unapproved_config). The only control a `launched` row
 *   may declare. `residual` says, in words, what happens where Martha does not
 *   start the host itself and so cannot run the gate first.
 * - `refused-before-launch` — words handed to the host when Martha starts it,
 *   judged before the host starts: every word the named argument gate does not
 *   pass refuses the start, so none reaches the model or the host's config.
 *   Only a `delivered` row may declare it.
 * - `none` — no control. A row in this state fails CI on purpose.
 * - `check_every_path_is_gated` — a member's own file tools are refused, path by
 *   path, by the gate the row names: the owner's memory and instructions, and
 *   what a later git run of the owner's reads (martha#168). `also` names the
 *   controls that stand on the same path beside it, each judged by its own rule.
 */
export type Control =
  | { readonly kind: 'delivery-gate'; readonly gate: KnownDeliveryGate }
  | { readonly kind: 'shell-gate' }
  | { readonly kind: 'no-text-reaches-the-model'; readonly why: string }
  | { readonly kind: 'launch-gate'; readonly gate: KnownLaunchGate; readonly residual: string }
  | { readonly kind: 'refused-before-launch'; readonly gate: KnownArgumentGate }
  | { readonly kind: 'check_every_path_is_gated'; readonly gate: KnownPathGate; readonly also: readonly Control[] }
  | { readonly kind: 'none' }

export interface InboundPath {
  readonly id: string
  readonly what: string
  readonly klass: PathClass
  readonly control: Control
  readonly attestation: SenderAttestation
}

/**
 * The instruction files a host can load from a checkout, named once (martha#135).
 *
 * - `checkout` — a checkout's own instructions: the top file, any below it a
 *   read reaches, and those of the directories above the checkout. A16 owns it.
 * - `local` — the same folder's local instructions. Git ignores one, so a
 *   member can write it and no owner approved it. B4 owns it.
 * - `agents` — what another engine reads in the same places. A16 owns it, and
 *   no run has seen one load, which A16's `why` says.
 */
export const INSTRUCTION_FILES = {
  checkout: 'CLAUDE.md',
  local: 'CLAUDE.local.md',
  agents: 'AGENTS.md',
} as const

/**
 * The words an owning row must say about a text it owns, in one place
 * (martha#135). The row's text is built from these phrases and
 * `gapsInInstructionTextOwnership` fails CI when the row no longer carries one,
 * so the table cannot claim a fact the row stopped saying.
 */
export const INSTRUCTION_TEXT_WORDING = {
  /** A checkout's fixed text is not only the top one: a file read below the top loads that directory's. */
  nested: 'any below it that the host loads once a file there is read',
  /** A checkout's fixed text is not only its own folder's: the directories above it count too. */
  above: 'the directories above it',
  /** Whether a host loads an AGENTS.md at all is not observed, so that text is not pinned. */
  not_observed: 'Whether the host loads an AGENTS.md is not observed',
} as const

export const INBOUND_PATHS: readonly InboundPath[] = [
  {
    id: 'A1',
    what: 'a private crew room message, turned into a turn by the mod poll',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'crew-room-acceptance' },
    attestation: 'roster',
  },
  {
    id: 'A2',
    what: 'a shared cross-crew room message',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'shared-room-acceptance' },
    attestation: 'roster',
  },
  {
    id: 'A3',
    what: 'a backlog digest folding many accepted messages into one turn',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'crew-room-acceptance' },
    attestation: 'roster',
  },
  {
    id: 'A4',
    what: "a mesh ring this member answers: what answering it returns (mesh_answer_ring), which can carry the caller's own text. The ring's purpose itself is handed only by mesh tools refused by name (B1)",
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'station',
  },
  {
    id: 'A5',
    what: 'a ring answered: the decline reason',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'station',
  },
  {
    id: 'A6',
    what: 'a cross-session message, arriving as the turn text itself',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'host-binder',
  },
  {
    id: 'A7',
    what: "what a checkout's approved config prints into the session at run time: a hook's output or added context, and the hooks of a plugin it enables or loads from a folder its env names. The approval pins the script, never its output, which changes from run to run with the network, the clock or a file git ignores (martha#121). Recorded at every session start whenever the carried settings declare a hook or a plugin (sourcesALaunchHandsTheModel). The owner's user settings and the managed settings, which the host also loads, may declare none: a member does not start, and a running one is stopped, while one of them declares a hook, enables a plugin or names a plugin folder (hooks_and_plugins_the_owner_declares, martha#121)",
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A8',
    what: 'the handover file a resumed session is told to read',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A9',
    what: 'a forged cross-session envelope inside turn text',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A10',
    what: 'text the owner pastes into the session',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A11',
    what: "an MCP server's instruction block, handed to the model when the session starts. Recorded at every session start for every server the recorded mesh server tree does not bind, and for an enabled plugin (sourcesALaunchHandsTheModel). The mesh server's block is code of its recorded tree, which treeUnlike compares with the recorded one file by file, through placeRecordedMeshServers, before every launch (martha#65, ../install_the_recorded_mesh_server), so it records nothing (martha#121). Not closed: a same-user edit of that tree during a session, as for B1",
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A12',
    what: 'a compaction summary replaying earlier turns',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A13',
    what: "code an untrusted checkout runs through the member's own commands, and a member's file-tool write into the checkout's git directory or the owner's own git configuration, which a later git run of the owner's would then run or obey (martha#168)",
    klass: 'delivered',
    control: {
      kind: 'check_every_path_is_gated',
      gate: 'nothing-a-later-git-run-reads',
      also: [{ kind: 'shell-gate' }],
    },
    attestation: 'none',
  },
  {
    id: 'A14',
    what: "a turn the owner typed at the member's own terminal, stamped as typed by the host's engine: no command expanded into it and not written by the engine (martha#51). The owner's mark is admitted here and nowhere else; a pasted text is the owner's act. Not closed: a process of the same OS user can claim this origin on the launcher's socket (T13, accepted under A13 until the signed roster, martha#24)",
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'host-engine',
  },
  {
    id: 'A15',
    what: "the owner's words after martha start <member> --, which the host would act on after the launch gate judged the launch: a prompt there is a turn no host stamped as the owner's, a --settings, --mcp-config or --plugin-dir loads config or code nobody approved, a permission switch lets a tool past the shell gate's hook (martha#98)",
    klass: 'delivered',
    control: { kind: 'refused-before-launch', gate: 'owner-arguments-load-no-config' },
    attestation: 'none',
  },
  {
    id: 'A16',
    what: `a checkout's fixed text: its ${INSTRUCTION_FILES.checkout} or ${INSTRUCTION_FILES.agents} files, the top one, ${INSTRUCTION_TEXT_WORDING.nested}, and those of ${INSTRUCTION_TEXT_WORDING.above}, and the agents it defines (.claude/agents), whose frontmatter may name hooks and tool servers (martha#121, martha#135)`,
    klass: 'delivered',
    control: {
      kind: 'no-text-reaches-the-model',
      why: `Martha starts the host with project config switched off (project_config_off, ../refuse_launch_of_unapproved_config), and with it the host loads no project ${INSTRUCTION_FILES.checkout}, nested or not, and no project agent: npm run probe:launch plants the top and the nested ${INSTRUCTION_FILES.checkout} and one agent, and sees none load, while the same checkout started by hand loads them (Claude Code 2.1.319). The ${INSTRUCTION_FILES.checkout} of the directories above the checkout is not planted in this tree, so that one rests on the design's prototype and is not pinned here (martha#165). ${INSTRUCTION_TEXT_WORDING.not_observed}: no run, not even with project config on, saw one load, so this is not pinned, and it cannot tell an ${INSTRUCTION_FILES.agents} that is switched off from one the host never reads (martha#135). A host the owner starts by hand loads them before any of Martha runs, as with C1 and C2, so the adapter must refuse that session a place in the crew`,
    },
    attestation: 'none',
  },
  {
    id: 'A17',
    what: "auto-memory the host loads at a session's start, and writes by itself from the session (extractMemories, auto-dream, team memory), from a memory folder outside the checkout: text a member wrote there would reach a later session, the owner's or another member's, with nothing recording where it came from (martha#136)",
    klass: 'delivered',
    control: {
      kind: 'no-text-reaches-the-model',
      why: "the launcher sets CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 and drops CLAUDE_CODE_POST_TURN_MEMORY, CLAUDE_MEMORY_STORES, CLAUDE_COWORK_MEMORY_PATH_OVERRIDE and CLAUDE_CODE_REMOTE_MEMORY_DIR, and refuses settings whose env names any of them, so a member's host neither loads memory nor runs a memory pass; probe:launch shows the loader running with memory on and not with Martha's launch. That rests on two code paths of the recorded host (memory_off in recorded_claude_code_host.json): file mode returns early on the off switch, and hosted mode needs the dropped variable. It does not rest on the publish gate, whose hook is not established to fire for the memory pass, which runs as a fork. The gate's file-tool deny and the permissions.deny rules in the host's --settings keep a member's own writes out of every project's memory folder and out of the owner's own instruction file at the config dir's root and its rules/ (OWNER_INSTRUCTIONS, ../refuse_a_member_writing_owner_memory; that file is not a checkout's, which A16 owns). Not closed: a Bash write into a memory folder, which a clean member alone holds; a host the owner starts by hand (C1, C2); OpenCode, unprobed for a memory of its own",
    },
    attestation: 'none',
  },
  {
    id: 'B1',
    what: "the model's own mesh read tools, served by the mesh server the launcher starts from its recorded tree, compared file by file, with an environment built from HOME, PATH and the entry's reviewed settings and every other variable emptied (martha#65), and confined by the launcher's resolve hook to loading node's own modules and files of that tree (martha#73). Not closed: a same-user edit of that tree during a session, which only the next launch refuses; a dependency's environment read that names no literal key, which the scan lists when it reads by a computed key and does not see when it never names the environment at all, and either way does not refuse (martha#72); and whatever the tree's own code chooses to do, since the hook confines resolution only (a process.dlopen on an absolute path, or a node child or worker started with its own arguments, for example), which is that code's choice, compared file by file",
    klass: 'fetched',
    control: {
      kind: 'no-text-reaches-the-model',
      why: "every mesh tool that would hand the model a room's or another agent's text, a ring's purpose among it, is refused by its own name before it runs (isRawMeshRead and MESH_TOOLS_REFUSED, ../read_a_room_through_its_gate); the mesh tools that run are recorded on B2, A4 or A5 (sourceOfAMeshToolResult), and a room is read through its gate (A1, A2)",
    },
    attestation: 'none',
  },
  {
    id: 'B2',
    what: 'any MCP tool result: board cards, procedures, shared memory',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B3',
    what: 'the GitHub CLI: issue and pull-request bodies, comments, reviews',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B4',
    what: "files in a checkout, read, edited or searched through the host's own tools: a file git puts in the tree the owner approved, as the member started on it, or that tree as this member's own recorded writes left it, while the launch checkout still holds either, is not text taken in, because the owner approved that tree to run as the owner and the member itself wrote the rest (decided 2026-11-07, martha#127 and martha#132); in a checkout with no config nothing was approved, so every read counts; an ignored file is text taken in, a CLAUDE.local.md among them, since a member can write one and the owner approved no such text; a fixed-text file that a read attaches belongs to A16, and this row claims none of it; a link that leads out, git's own directory and every other place are",
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B5',
    what: 'git history',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B6',
    what: 'web fetch and web search',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B7',
    what: 'a subagent result, and a review answer relaunched onto another session',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B8',
    what: "the mod's own gh pr list",
    klass: 'fetched',
    control: {
      kind: 'no-text-reaches-the-model',
      why: 'only headRefOid, headRefName and a #n match are read, as a stale-handoff flag; no body text is delivered',
    },
    attestation: 'none',
  },
  {
    id: 'C1',
    what: "a checkout's own tool-server config, which the host starts by itself (each host's files are listed in LAUNCH_FILES_OF_HOST)",
    klass: 'launched',
    control: {
      kind: 'launch-gate',
      gate: 'owner-approved-launch-config',
      residual:
        'Martha starts the host on an approved snapshot of this config, with the checkout\'s own config switched off (prepareLaunch; npm run probe:launch). What is left: a host the owner starts by hand starts these servers before any of Martha runs (observed: interactive Claude Code 2.1.318 holds a project server for approval but records it by server name only, so a later change to its command is not asked again; headless claude -p and OpenCode 2.2.5, even for opencode debug config, start it unasked), so the adapter must refuse that session a place in the crew; a server the host restarts after a call changed the tree runs the script as it is then, until the launcher stops the member (the launch is checked before every tool call, by answerToolCall, and after it, by recheckLaunch, whose hook does not return until the launcher has sent SIGKILL to the member\'s process group); and a file git ignores and does not track is outside the approval.',
    },
    attestation: 'none',
  },
  {
    id: 'C2',
    what: "a checkout's own hooks and plugins, which the host runs by itself (each host's files are listed in LAUNCH_FILES_OF_HOST)",
    klass: 'launched',
    control: {
      kind: 'launch-gate',
      gate: 'owner-approved-launch-config',
      residual:
        "Martha starts the host on an approved snapshot of this config, with the checkout's own config switched off (prepareLaunch; npm run probe:launch); a checkout's .claude/settings.local.json and its .opencode plugins are never carried, and prepareLaunch names them as not_carried for the launcher to show the owner. What is left: a host the owner starts by hand runs these before any of Martha runs (observed: headless claude -p 2.1.318 runs a checkout's SessionStart hook unasked; OpenCode 2.2.5 loads its plugin unasked, even for opencode debug config), so the adapter must refuse that session a place in the crew; the hooks of the one call that changed the tree, which run in parallel with Martha's own (PreToolUse/PostToolUse): the launch is checked before every tool call (answerToolCall) and after it (recheckLaunch), and on a refusal after the call Martha's hook does not return until the launcher has sent SIGKILL to the member's whole process group, so no Stop or SessionEnd hook runs (npm run probe:launch); and a file git ignores and does not track is outside the approval.",
    },
    attestation: 'none',
  },
]

/**
 * One text a host can attach to a member's session, and the single row of
 * INBOUND_PATHS that owns it (martha#135).
 *
 * Two rows used to be able to claim the same text — A16 the fixed text of a
 * checkout, B4 the exemption for a read of an approved file — and a reader of
 * the table could be told two different things about one file. This names the
 * owner of each text, the words that owner must say about it, and
 * `gapsInInstructionTextOwnership` fails CI when the rows disagree with it.
 */
export interface InstructionText {
  /** The text, named as the case that plants it names its marker. */
  readonly text: string
  /** The file it comes from: one of INSTRUCTION_FILES, never a retyped name. */
  readonly file: string
  /** The row that owns it: the only row whose text may name the file. */
  readonly owner: string
  /**
   * The phrases its owner's row must carry, each one of
   * INSTRUCTION_TEXT_WORDING: where the text comes from, and whether any run
   * saw it load. Checked by exact inclusion, so a row that stops saying one
   * fails CI rather than passing quietly.
   */
  readonly words: readonly string[]
}

export const INSTRUCTION_TEXT_OWNERS: readonly InstructionText[] = [
  { text: 'NESTED_CLAUDE_MD', file: INSTRUCTION_FILES.checkout, owner: 'A16', words: [INSTRUCTION_TEXT_WORDING.nested] },
  { text: 'ABOVE_CLAUDE_MD', file: INSTRUCTION_FILES.checkout, owner: 'A16', words: [INSTRUCTION_TEXT_WORDING.above] },
  { text: 'NESTED_LOCAL_MD', file: INSTRUCTION_FILES.local, owner: 'B4', words: [] },
  { text: 'ROOT_LOCAL_MD', file: INSTRUCTION_FILES.local, owner: 'B4', words: [] },
  { text: 'NESTED_AGENTS_MD', file: INSTRUCTION_FILES.agents, owner: 'A16', words: [INSTRUCTION_TEXT_WORDING.not_observed] },
  { text: 'ABOVE_AGENTS_MD', file: INSTRUCTION_FILES.agents, owner: 'A16', words: [INSTRUCTION_TEXT_WORDING.not_observed] },
]

export interface TextOwnershipGap {
  readonly text: string
  readonly why: string
}

/** Every row id, so a parenthetical that names one can be told from prose. */
const ROW_ID = /\b[ABC][0-9]{1,2}\b/g

/** What a row says a member may take in: its `what`, and its `why` where it has one. */
function saidBy(path: InboundPath): string {
  return path.control.kind === 'no-text-reaches-the-model' ? `${path.what} ${path.control.why}` : path.what
}

/** The files, from the ownership table, that `said` names. */
function filesNamedIn(said: string, files: readonly string[]): readonly string[] {
  return files.filter((file) => said.includes(file))
}

/** The single row that owns `file`, or undefined while the table names no owner or more than one. */
function ownerOf(file: string, owners: readonly InstructionText[]): string | undefined {
  const owning = [...new Set(owners.filter((entry) => entry.file === file).map((entry) => entry.owner))]
  return owning.length === 1 ? owning[0] : undefined
}

/**
 * True when a parenthetical is a pointer and no claim of its own: every row id
 * inside it owns every file it names. `(CLAUDE.md: see A16)` points at the
 * owner; `(CLAUDE.md: see C1)` in B4's row, `(CLAUDE.md: see B4)` in B4's own
 * row, or a parenthetical naming a file with no row id at all, is a claim and
 * stays counted. A claim made inside a correctly addressed parenthetical is
 * stripped with the rest of it: `(a member's CLAUDE.md loads too: see A16)`
 * sends the reader to the owner, which is what the pointer rule asks for.
 */
function pointsAtTheOwner(inside: string, files: readonly string[], owners: readonly InstructionText[]): boolean {
  const named = filesNamedIn(inside, files)
  const ids = inside.match(ROW_ID) ?? []
  return named.length > 0 && ids.length > 0 && ids.every((id) => named.every((file) => ownerOf(file, owners) === id))
}

/** What a row says, without the pointers it makes to the row that owns a file: those name no text of their own. */
function withoutPointers(said: string, files: readonly string[], owners: readonly InstructionText[]): string {
  return said.replace(/\([^()]*\)/g, (inside) => (pointsAtTheOwner(inside, files, owners) ? '' : inside))
}

/**
 * Every way the ownership table and INBOUND_PATHS disagree (martha#135): a text
 * with no owner or with two, an owner that is not a row, an owner whose text
 * does not name its file or does not say what the text requires of it, a file
 * two rows claim, and a row that names a file it does not own. The test beside
 * this module plants each case, so a check that stops seeing one fails by name.
 */
export function gapsInInstructionTextOwnership(
  paths: readonly InboundPath[] = INBOUND_PATHS,
  owners: readonly InstructionText[] = INSTRUCTION_TEXT_OWNERS,
): readonly TextOwnershipGap[] {
  const rows = new Map(paths.map((path) => [path.id, path]))
  const files = [...new Set(owners.map((entry) => entry.file))]
  return [...owners.flatMap((entry) => gapsInOneText(entry, owners, rows)), ...files.flatMap((file) => gapsInOneFile(file, owners, paths))]
}

/**
 * The ways one text's own entry is wrong: two owners, an owner no row answers
 * to, an owner that does not name the file, and an owner that does not say
 * what the text requires it to say.
 */
function gapsInOneText(entry: InstructionText, owners: readonly InstructionText[], rows: ReadonlyMap<string, InboundPath>): readonly TextOwnershipGap[] {
  const gaps: TextOwnershipGap[] = []
  const owned = owners.filter((other) => other.text === entry.text).length
  if (owned !== 1) gaps.push({ text: entry.text, why: `it is owned ${owned} times, and a text has exactly one owner` })
  const owner = rows.get(entry.owner)
  if (owner === undefined) return [...gaps, { text: entry.text, why: `its owner ${entry.owner} is not a row in INBOUND_PATHS` }]
  const said = saidBy(owner)
  if (!said.includes(entry.file)) gaps.push({ text: entry.text, why: `its owner ${entry.owner} does not name ${entry.file}` })
  for (const words of entry.words) {
    if (!said.includes(words)) gaps.push({ text: entry.text, why: `its owner ${entry.owner} does not say "${words}", which this text requires of it` })
  }
  return gaps
}

/** The ways one file's ownership is wrong: two rows own it, or a row that does not own it names it. */
function gapsInOneFile(file: string, owners: readonly InstructionText[], paths: readonly InboundPath[]): readonly TextOwnershipGap[] {
  const owning = [...new Set(owners.filter((entry) => entry.file === file).map((entry) => entry.owner))].sort()
  const [owner = ''] = owning
  if (owning.length !== 1) return [{ text: file, why: `it is owned by ${owning.join(', ') || 'no row'}, and a file has exactly one owning row` }]
  const files = [...new Set(owners.map((entry) => entry.file))]
  return paths
    .filter((path) => namesTextOfAnotherRow(path, owner, file, files, owners))
    .map((path) => ({ text: file, why: `row ${path.id} names it too, and ${owner} is its owner` }))
}

/** True when a row says the file's name and is not the row that owns it. */
function namesTextOfAnotherRow(path: InboundPath, owner: string, file: string, files: readonly string[], owners: readonly InstructionText[]): boolean {
  return path.id !== owner && withoutPointers(saidBy(path), files, owners).includes(file)
}

/** The attestation a path's sender has, or `none` for a path nobody declared. */
export function attestationOf(path_id: string): SenderAttestation {
  return INBOUND_PATHS.find((path) => path.id === path_id)?.attestation ?? 'none'
}

/** True only where an attestation stands behind the sender. */
export function senderIsAttested(path_id: string): boolean {
  return attestationOf(path_id) !== 'none'
}
