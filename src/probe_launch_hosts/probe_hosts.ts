// What each host starts, on the two ways it can be started: by hand in a fresh
// checkout, and the way Martha starts it (`prepareLaunch`). This is the evidence
// behind the launched rows' residuals and the table in docs/publish-gate.md.
//
// Every probe states what docs/publish-gate.md claims it sees, and the run exits
// non-zero when a host does anything else, so a host upgrade that flips a
// result cannot pass unnoticed.
//
// Run it by hand after a host upgrade: `npm run probe:launch`. It is not part of
// `npm test`: it needs both coding tools installed, and the headless probes make
// one small model call each. Every probe works in its own scratch directory,
// whose config only touches marker files there, and removes it.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import {
  projectFolderFor,
  projectKeyOf,
  takeAwayTheOnesThisRunWrote,
  theLeftoverRow,
  theProjectFoldersThere,
  whatIsStillLeftAtTheEnd,
  type ProjectFoldersBefore,
} from './the_project_folders_a_run_wrote.ts'
import { runTheHost, stopTheProcessesLeftIn } from './stop_a_host_that_outlives_the_run.ts'
import {
  CLAUDE_MEMORY_OFF,
  fingerprintOf,
  LAUNCH_FILES_OF_HOST,
  launchEnvironment,
  prepareLaunch,
  readLaunchState,
  type Host,
  type HostSwitches,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { INSTRUCTION_FILES } from '../inbound_paths/inbound_paths.ts'
import { HOOKS_SPELLINGS, PLUGIN_DIRS_VARIABLE } from '../claude_code_host/hooks_and_plugins_the_owner_declares.ts'
import { CLAUDE_CODE_HOOK_SWITCHES } from '../claude_code_host/recorded_claude_code_host.ts'
import { USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { CLAUDE_CODE_OUTPUT_STYLES_FOLDER, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { memoryDenyRules, ownerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { deniedWriteIn, printedText } from './the_write_the_host_was_refused.ts'
import { memoryTheHostLoadedFor } from './what_the_host_loaded.ts'
import { skillsListedIn } from './the_skills_the_host_listed.ts'
import { hookSettingsOf } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { absencesWithoutAHostProof, judgeRow, type RowClaims } from './an_absence_row_proves_the_host_ran.ts'

const [CLAUDE_SERVERS, CLAUDE_SETTINGS] = LAUNCH_FILES_OF_HOST['claude-code']
const [OPENCODE_CONFIG, , OPENCODE_DIR] = LAUNCH_FILES_OF_HOST.opencode

/** How long one host run may take before the probe gives up on it. */
const RUN_TIMEOUT_MS = 120_000
/** A server that only touches its marker, then lingers long enough to be seen. */
const LINGER_SECONDS = 3

const PROMPT = 'Reply with the single word ok.'
/**
 * A headless run with room for one tool call before the reply (martha#223). At one turn a
 * host that spends it on a tool call exits non-zero, and every row that reads the host's
 * exit — or reading the model's answer — reports that as a failure of the tree under test.
 */
const HEADLESS_CLAUDE = ['-p', '--max-turns', '3', '--model', 'haiku']

/** One scratch checkout: where its files go and where markers land. */
interface Place {
  readonly scratch: string
  readonly checkout: string
  marker(name: string): string
}

/** The command line of one run, given the switches a planned launch adds. */
type Command = (switches: HostSwitches, place: Place) => { readonly command: string; readonly args: readonly string[] }

/** A place for a command that builds nothing from paths: the version banner asks only for the binary's name. */
const NO_PLACE: Place = { scratch: tmpdir(), checkout: tmpdir(), marker: (name) => join(tmpdir(), name) }

interface Probe {
  readonly what: string
  readonly host: Host
  readonly command: Command
  /** Config the checkout holds when the owner approves it. Absent for a start by hand. */
  readonly approved?: (place: Place) => void
  /** Config written into the checkout afterwards: by hand, all of it; planned, after approval. */
  readonly planted: (place: Place) => void
  /** Each marker, and whether docs/publish-gate.md says it is started. */
  readonly expected: Readonly<Record<string, boolean>>
  /** Run through `prepareLaunch`, on approved config. */
  readonly planned: boolean
  /** Set in the environment the host inherits, as an owner's shell might. */
  readonly inherited?: Readonly<Record<string, string>>
  /**
   * The owner's user settings, written to a config folder of the probe's own
   * that CLAUDE_CONFIG_DIR names, so the developer's own settings and plugins
   * stay out of the run (martha#121).
   */
  readonly owner_settings?: (place: Place) => string
  /**
   * The owner's own markdown, written under the config folder CLAUDE_CONFIG_DIR
   * names: an agent, skill or command whose frontmatter can carry hooks
   * (martha#146). Each is placed at `<config folder>/<folder>/<name>`.
   */
  readonly owner_markdown?: (place: Place) => readonly OwnerMarkdownFile[]
  /**
   * Run the launcher's own settings gate (hookSettingsOf) before the host, as
   * martha start does. When it refuses, naming every one of these words, the
   * host is not started and GATE_REFUSED is marked; a refusal naming anything
   * else fails the probe. When it does not refuse, GATE_PASSED is marked, which
   * is how a row claims that a file is let through by the gate itself rather than
   * by a host that never got that far (martha#243).
   */
  readonly gate_names?: (place: Place) => readonly string[]
  /**
   * Where a marker lands when it is not the scratch root's own file: a file the host itself writes into a place the
   * gate denies, whose presence or absence is the row's evidence (martha#154).
   */
  readonly markerAt?: (place: Place, name: string) => string
  /**
   * Also require the host itself to have exited cleanly, for a row whose claim is
   * that something did NOT happen: a host that quits on the config before it gets
   * that far would leave the same markers as one that ran and rightly did nothing.
   */
  readonly host_ok?: true
  /**
   * Markers read from what the host printed, for a row whose claim is that the host
   * TRIED something and was refused (martha#154 r=2): a row that only says the file
   * is absent is satisfied by a host that never attempted the write at all. The run
   * is asked for json output, and this reads the refusal out of it.
   */
  readonly from_output?: (place: Place, printed: string) => Readonly<Record<string, boolean>>
}

/** One file of the owner's own markdown, at `<config folder>/<folder>/<name>`. */
interface OwnerMarkdownFile {
  readonly folder: string
  readonly name: string
  readonly text: string
}

function put(dir: string, name: string, content: string): void {
  mkdirSync(dirname(join(dir, name)), { recursive: true })
  writeFileSync(join(dir, name), content)
}

const linger = (marker: string) => `touch ${marker}; sleep ${LINGER_SECONDS}`

/** The name a planted tool server is declared under, read back where a row needs the host to have listed it (martha#188). */
const PLANTED_SERVER_NAME = 'planted'

const claudeServer = (name: string, marker: string) =>
  JSON.stringify({ mcpServers: { [name]: { command: 'sh', args: ['-c', linger(marker)] } } })
const claudeHook = (marker: string) =>
  JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch ${marker}` }] }] } })
const opencodeServer = (name: string, marker: string) =>
  JSON.stringify({ mcp: { servers: { [name]: { type: 'local', command: ['sh', '-c', linger(marker)], enabled: true } } } })
const opencodePlugin = (marker: string) =>
  `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, '')\nexport const Probe = async () => ({})\n`

/**
 * Approved hooks for the stop: one after every tool call (the launcher's), one
 * when the turn ends, one when the session ends. `after` is what the
 * after-call hook does once it has marked that it ran.
 */
const claudeStopHooks = (place: Place, after: string) => {
  const hook = (command: string) => [{ hooks: [{ type: 'command', command }] }]
  return JSON.stringify({
    hooks: {
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `touch ${place.marker('AFTER_CALL_HOOK')}; ${after}` }] }],
      Stop: hook(`touch ${place.marker('STOP_HOOK')}`),
      SessionEnd: hook(`touch ${place.marker('SESSION_END_HOOK')}`),
    },
  })
}

/** The launcher's stop: SIGKILL the member's whole process group, and do not return before it lands. */
const KILL_THE_GROUP = `kill -KILL -- "-$MEMBER_GROUP"; sleep ${RUN_TIMEOUT_MS / 1000}`
/** An after-call hook that only reports, and lets the host go on. */
const ONLY_REPORT = 'true'

/** Claude Code as the leader of its own process group, whose id the hooks read as MEMBER_GROUP. */
const claudeInItsOwnGroup = (...extra: readonly string[]): Command => (switches) => ({
  command: 'setsid',
  args: ['sh', '-c', 'export MEMBER_GROUP=$$; exec "$0" "$@"', 'claude', ...extra, ...switches.args],
})
/** A prompt that makes one tool call before the reply. */
const ONE_CALL_PROMPT = 'Run the shell command `true` with the Bash tool, then reply with the single word ok.'
// The prompt goes before `--allowedTools`, which takes every argument up to the next option.
const ONE_CALL_CLAUDE = ['-p', '--max-turns', '3', '--model', 'haiku', ONE_CALL_PROMPT, '--allowedTools', 'Bash(true)']

// --- a checkout's fixed text: CLAUDE.md files and agents (A16, martha#121) ------

const NESTED_DIR = 'sub'
const NESTED_FILE = join(NESTED_DIR, 'notes.txt')
const AGENT = 'probe-agent'
/** What Claude Code prints, and only it, when it has no agent by that name (2.1.319). */
const noSuchAgent = (name: string) => `--agent '${name}' not found`
/** A prompt that reads a file below the top, which is when the host loads that directory's CLAUDE.md. */
const READ_BELOW_PROMPT = `Use the Read tool on ${NESTED_FILE}, then reply with the single word ok.`
const READ_BELOW_CLAUDE = ['-p', '--max-turns', '3', '--model', 'haiku', READ_BELOW_PROMPT, '--allowedTools', 'Read']

/** The checkout's fixed text: a CLAUDE.md at the top, one below it, and an agent. */
function plantFixedText(place: Place): void {
  put(place.checkout, INSTRUCTION_FILES.checkout, 'Probe instructions at the top.\n')
  put(place.checkout, join(NESTED_DIR, INSTRUCTION_FILES.checkout), 'Probe instructions below the top.\n')
  put(place.checkout, NESTED_FILE, 'a file below the top\n')
  put(place.checkout, join('.claude', 'agents', `${AGENT}.md`), `---\nname: ${AGENT}\ndescription: a probe agent\n---\nReply with the single word ok.\n`)
}

/**
 * Settings whose InstructionsLoaded hook marks each of the checkout's two
 * CLAUDE.md files the host loads, by the path the host reports. A file the
 * owner keeps elsewhere marks nothing. A PostToolUse hook on Read marks
 * READ_BELOW when the model read the file below the top, so a run in which
 * that read never happened cannot pass for one in which the nested file
 * did not load.
 */
function instructionsHook(place: Place): string {
  const read = join(place.scratch, 'mark_read_below.mjs')
  writeFileSync(
    read,
    `import { readFileSync, writeFileSync } from 'node:fs'\n` +
      `import { resolve } from 'node:path'\n` +
      `const input = JSON.parse(readFileSync(0, 'utf8'))\n` +
      `const path = resolve(input.cwd, String(input.tool_input?.file_path))\n` +
      `if (path === ${JSON.stringify(join(place.checkout, NESTED_FILE))}) writeFileSync(${JSON.stringify(place.marker('READ_BELOW'))}, '')\n`,
  )
  const script = join(place.scratch, 'mark_instructions.mjs')
  const marks = {
    [join(place.checkout, INSTRUCTION_FILES.checkout)]: place.marker('TOP_CLAUDE_MD'),
    [join(place.checkout, NESTED_DIR, INSTRUCTION_FILES.checkout)]: place.marker('NESTED_CLAUDE_MD'),
  }
  writeFileSync(
    script,
    `import { readFileSync, writeFileSync } from 'node:fs'\n` +
      `const marks = ${JSON.stringify(marks)}\n` +
      `const loaded = JSON.parse(readFileSync(0, 'utf8')).file_path\n` +
      `if (Object.hasOwn(marks, loaded)) writeFileSync(marks[loaded], '')\n`,
  )
  return JSON.stringify({
    hooks: {
      InstructionsLoaded: [{ hooks: [{ type: 'command', command: `node ${script}` }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: `touch ${place.marker('SETTINGS_HOOK')}` }] }],
      PostToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: `node ${read}` }] }],
    },
  })
}

/**
 * Claude Code started as the agent `name`, which is looked up where `owner_markdown`
 * puts it or in the checkout. The markers sit beside the checkout (../ from where
 * the host runs): AGENT_LOADED when the host ran it, AGENT_NOT_FOUND when the host
 * said it has no such agent. A host with no login in its config folder never
 * reaches a model call, so AGENT_LOADED says nothing about whether it loaded.
 */
const claudeAsTheAgent = (name: string, ...extra: readonly string[]): Command => (switches) => ({
  command: 'sh',
  args: [
    '-c',
    `"$@" 2> ../agent.err && touch ../AGENT_LOADED; grep -qF -e "${noSuchAgent(name)}" ../agent.err && touch ../AGENT_NOT_FOUND; true`,
    'claude-as-agent',
    'claude',
    ...extra,
    '--agent',
    name,
    PROMPT,
    ...switches.args,
  ],
})

const claude = (...extra: readonly string[]): Command => (switches) => ({
  command: 'claude',
  args: [...extra, ...switches.args],
})
const opencode = (...extra: readonly string[]): Command => (switches) => ({
  command: 'opencode',
  args: [...extra, ...switches.args],
})

const PROBES: readonly Probe[] = [
  {
    what: "Claude Code by hand, headless: a checkout's CLAUDE.md at the top and below it",
    host: 'claude-code',
    command: claude(...READ_BELOW_CLAUDE),
    planted: (place) => {
      plantFixedText(place)
      put(place.checkout, CLAUDE_SETTINGS, instructionsHook(place))
    },
    expected: { SETTINGS_HOOK: true, READ_BELOW: true, TOP_CLAUDE_MD: true, NESTED_CLAUDE_MD: true },
    planned: false,
  },
  {
    what: "Claude Code as Martha starts it, headless: a checkout's CLAUDE.md at the top and below it (A16)",
    host: 'claude-code',
    command: claude(...READ_BELOW_CLAUDE),
    approved: (place) => put(place.checkout, CLAUDE_SETTINGS, instructionsHook(place)),
    planted: plantFixedText,
    expected: { SETTINGS_HOOK: true, READ_BELOW: true, TOP_CLAUDE_MD: false, NESTED_CLAUDE_MD: false },
    planned: true,
  },
  {
    what: "Claude Code by hand, headless: started as a checkout's agent",
    host: 'claude-code',
    command: claudeAsTheAgent(AGENT, ...HEADLESS_CLAUDE),
    planted: plantFixedText,
    expected: { AGENT_LOADED: true, AGENT_NOT_FOUND: false },
    planned: false,
  },
  {
    what: "Claude Code as Martha starts it, headless: started as a checkout's agent (A16)",
    host: 'claude-code',
    command: claudeAsTheAgent(AGENT, ...HEADLESS_CLAUDE),
    planted: plantFixedText,
    expected: { AGENT_LOADED: false, AGENT_NOT_FOUND: true },
    planned: true,
  },
  {
    what: 'Claude Code by hand, interactive health check: a project tool server',
    host: 'claude-code',
    command: claude('mcp', 'list'),
    planted: (place) => put(place.checkout, CLAUDE_SERVERS, claudeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER'))),
    // The list it prints is the proof it ran and read this checkout's config: the claim is about the server it did NOT
    // start, and a host that quit on the config would print no list at all (martha#188).
    from_output: (_place: Place, printed: string) => ({ LISTED_SERVER: printed.includes(PLANTED_SERVER_NAME) }),
    expected: { PLANTED_SERVER: false, LISTED_SERVER: true },
    planned: false,
  },
  {
    what: 'Claude Code by hand, headless: a project tool server and SessionStart hook',
    host: 'claude-code',
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    planted: (place) => {
      put(place.checkout, CLAUDE_SERVERS, claudeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER')))
      put(place.checkout, CLAUDE_SETTINGS, claudeHook(place.marker('PLANTED_HOOK')))
    },
    expected: { PLANTED_SERVER: true, PLANTED_HOOK: true },
    planned: false,
  },
  {
    what: 'OpenCode by hand, debug config: a project tool server and plugin',
    host: 'opencode',
    command: opencode('debug', 'config'),
    planted: (place) => {
      put(place.checkout, OPENCODE_CONFIG, opencodeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER')))
      put(place.checkout, join(OPENCODE_DIR, 'plugin', 'probe.ts'), opencodePlugin(place.marker('PLANTED_PLUGIN')))
    },
    expected: { PLANTED_SERVER: true, PLANTED_PLUGIN: true },
    planned: false,
  },
  {
    what: 'Claude Code as Martha starts it, headless: config rewritten after approval',
    host: 'claude-code',
    // The prompt goes before the switches: `--mcp-config` takes every argument up to the next option.
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    approved: (place) => {
      put(place.checkout, CLAUDE_SERVERS, claudeServer('approved', place.marker('APPROVED_SERVER')))
      put(place.checkout, CLAUDE_SETTINGS, claudeHook(place.marker('APPROVED_HOOK')))
    },
    planted: (place) => {
      put(place.checkout, CLAUDE_SERVERS, claudeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER')))
      put(place.checkout, CLAUDE_SETTINGS, claudeHook(place.marker('PLANTED_HOOK')))
    },
    expected: { APPROVED_SERVER: true, APPROVED_HOOK: true, PLANTED_SERVER: false, PLANTED_HOOK: false },
    planned: true,
  },
  {
    what: 'OpenCode as Martha starts it, run: config rewritten and a plugin added after approval',
    host: 'opencode',
    command: (switches) => ({ command: 'opencode', args: ['run', ...switches.args, PROMPT] }),
    approved: (place) =>
      put(place.checkout, OPENCODE_CONFIG, opencodeServer('approved', place.marker('APPROVED_SERVER'))),
    planted: (place) => {
      put(place.checkout, OPENCODE_CONFIG, opencodeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER')))
      put(place.checkout, join(OPENCODE_DIR, 'plugin', 'probe.ts'), opencodePlugin(place.marker('PLANTED_PLUGIN')))
    },
    expected: { APPROVED_SERVER: true, PLANTED_SERVER: false, PLANTED_PLUGIN: false },
    planned: true,
  },
  {
    what: "OpenCode as Martha starts it, run: the owner's environment says project config on",
    host: 'opencode',
    command: (switches) => ({ command: 'opencode', args: ['run', ...switches.args, PROMPT] }),
    approved: (place) =>
      put(place.checkout, OPENCODE_CONFIG, opencodeServer('approved', place.marker('APPROVED_SERVER'))),
    planted: (place) => {
      put(place.checkout, OPENCODE_CONFIG, opencodeServer(PLANTED_SERVER_NAME, place.marker('PLANTED_SERVER')))
      put(place.checkout, join(OPENCODE_DIR, 'plugin', 'probe.ts'), opencodePlugin(place.marker('PLANTED_PLUGIN')))
    },
    inherited: { OPENCODE_CONFIG_PROJECT_DISABLE: '0', OPENCODE_DISABLE_PROJECT_CONFIG: '0' },
    expected: { APPROVED_SERVER: true, PLANTED_SERVER: false, PLANTED_PLUGIN: false },
    planned: true,
  },
  {
    what: 'Claude Code as Martha starts it, headless: an after-call hook that only reports',
    host: 'claude-code',
    command: claudeInItsOwnGroup(...ONE_CALL_CLAUDE),
    approved: (place) => put(place.checkout, CLAUDE_SETTINGS, claudeStopHooks(place, ONLY_REPORT)),
    planted: () => {},
    expected: { AFTER_CALL_HOOK: true, STOP_HOOK: true, SESSION_END_HOOK: true },
    planned: true,
  },
  {
    what: "Claude Code as Martha starts it, headless: the after-call hook waits for the launcher to SIGKILL the member's group",
    host: 'claude-code',
    command: claudeInItsOwnGroup(...ONE_CALL_CLAUDE),
    approved: (place) => put(place.checkout, CLAUDE_SETTINGS, claudeStopHooks(place, KILL_THE_GROUP)),
    planted: () => {},
    expected: { AFTER_CALL_HOOK: true, STOP_HOOK: false, SESSION_END_HOOK: false },
    planned: true,
  },
]

function version(command: string): string {
  const run = spawnSync(command, ['--version'], { encoding: 'utf8' })
  return run.error === undefined ? run.stdout.trim().split('\n')[0] ?? '' : `not installed (${run.error.message})`
}

const NO_SWITCHES: HostSwitches = { args: [], env: {}, env_dropped: [] }

// --- the owner's user hooks and plugins (martha#121, finding 1) ---------------
//
// A member's host loads the owner's user settings, with --setting-sources user.
// Run ungated, each of these shows that a hook or plugin there runs in a session
// started on Martha's switches; gated, that the launcher's gate refuses it and
// nothing starts. The config folder holds no login, so the host stops before
// any model call, after its SessionStart hooks ran.

const OWNER_CONFIG = 'owner-config'
const ownerSettingsPath = (place: Place) => join(place.scratch, OWNER_CONFIG, USER_SETTINGS_FILE)
const touchAtStart = (marker: string) => ({ SessionStart: [{ hooks: [{ type: 'command', command: `touch ${marker}` }] }] })
const ownerHook = (place: Place) => JSON.stringify({ hooks: touchAtStart(place.marker('OWNER_HOOK')) })

/** A plugin folder whose one hook marks PLUGIN_HOOK when a session starts. */
function pluginFolder(place: Place): string {
  const folder = join(place.scratch, 'probe-plugin')
  put(folder, join('.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'probe-plugin', version: '0.0.1' }))
  put(folder, join('hooks', 'hooks.json'), JSON.stringify({ hooks: touchAtStart(place.marker('PLUGIN_HOOK')) }))
  return folder
}
const pluginInOwnerSettings = (place: Place) => JSON.stringify({ env: { [PLUGIN_DIRS_VARIABLE]: pluginFolder(place) } })

// --- the settings that turn every hook off (martha#122) -----------------------
//
// The keys are never typed here: they come from the recorded host's own hook-set function, so a re-recording that
// renames one changes what this plants, and a recording that names none fails the run rather than probing nothing.
// One pair of rows for EACH key the recording names, because a re-recording can add a second way to turn every hook
// off, and a pair written for the first alone would leave the new one probing nothing while the run stayed green:
//   - the key BESIDE a SessionStart hook, on the switches alone: the hook that would mark OWNER_HOOK does not run,
//     which is what shows the key really is a switch on this host. The row also claims the host exited cleanly, since
//     its evidence is an absence: a host that quit on the file would look exactly like one that ran and dropped it;
//   - the key ALONE in the owner's user settings, gated: with no hook in the file, the switch is the only reason
//     the launcher has to refuse, so the refusal is that gate's and not another one's.

/** Every key the recorded host tests as `=== true` to drop every hook, whichever settings file sets it. */
const HOOK_KILLING_KEYS: readonly string[] = CLAUDE_CODE_HOOK_SWITCHES.every_source
/** A recording that names no key: the run fails rather than quietly probing fewer rows. */
const SWITCHES_WITHOUT_A_PROBE = HOOK_KILLING_KEYS.length === 0 ? ['a key that turns every hook off, in any settings file'] : []

/** The owner's user settings with a SessionStart hook and one of those keys beside it: the hook that would mark OWNER_HOOK. */
const ownerHookAndSwitch = (place: Place, key: string) =>
  JSON.stringify({ hooks: touchAtStart(place.marker('OWNER_HOOK')), [key]: true })

const OWNER_PROBES: readonly Probe[] = [false, true].flatMap((gated): Probe[] => {
  const as = gated ? 'as martha start starts it, its settings gate included' : 'on the switches alone, its settings gate skipped'
  const refused = (marker: string) => (gated ? { [marker]: false, GATE_REFUSED: true } : { [marker]: true })
  const common = { host: 'claude-code' as const, command: claude(...HEADLESS_CLAUDE, PROMPT), approved: () => {}, planted: () => {}, planned: true }
  return [
    {
      ...common,
      what: `Claude Code ${as}: a SessionStart hook in the owner's user settings`,
      owner_settings: ownerHook,
      expected: refused('OWNER_HOOK'),
      ...(gated ? { gate_names: (place: Place) => [ownerSettingsPath(place), 'SessionStart'] } : {}),
    },
    {
      ...common,
      what: `Claude Code ${as}: a plugin folder in the owner's user settings env`,
      owner_settings: pluginInOwnerSettings,
      expected: refused('PLUGIN_HOOK'),
      ...(gated ? { gate_names: (place: Place) => [ownerSettingsPath(place), PLUGIN_DIRS_VARIABLE] } : {}),
    },
    ...(gated
      ? []
      : HOOK_KILLING_KEYS.map((key): Probe => ({
          ...common,
          what: `Claude Code ${as}: ${key}, which turns every hook off, beside a hook in the owner's user settings`,
          owner_settings: (place: Place) => ownerHookAndSwitch(place, key),
          expected: { OWNER_HOOK: false },
          host_ok: true,
        }))),
  ]
})

/** Each key alone, gated: no hook in the file, so the only reason the launcher has to refuse is the key itself. */
const SWITCH_PROBES: readonly Probe[] = HOOK_KILLING_KEYS.map((key): Probe => ({
  what: `Claude Code as martha start starts it: ${key} alone in the owner's user settings, with no hook beside it`,
  host: 'claude-code',
  command: claude(...HEADLESS_CLAUDE, PROMPT),
  approved: () => {},
  planted: () => {},
  planned: true,
  owner_settings: () => JSON.stringify({ [key]: true }),
  expected: { GATE_REFUSED: true },
  gate_names: (place: Place) => [ownerSettingsPath(place), key],
}))

// --- the owner's own agents, skills and commands (martha#146) ----------------
//
// A member's host is started with --setting-sources user, so it reads the
// owner's user scope, and an agent, skill or command there can carry hooks in
// its frontmatter. A member that runs one gets those hooks for as long as it
// runs, and what they print reaches the member with no row recording it. Gated,
// the launcher refuses before the host starts, naming the file and the spelling
// of the key it found. One row per spelling, because each is a different way
// YAML writes the one key the host looks for, and a spelling that stopped being
// caught would be a row that stopped refusing.

/**
 * The frontmatters that spell the key `hooks` by one rule alone, keyed by the
 * words its refusal names it by. A rule may have more than one: a rule that
 * takes a class has more than one member, and each member is its own row
 * (martha#243).
 */
const SPELLED_AS: Readonly<Record<string, readonly string[]>> = {
  'the key hooks': ['!<tag:yaml.org,2002:str>"hooks": {PreToolUse: []}'],
  'a collection used as a key': ['[hooks]: {PreToolUse: []}'],
  'a backslash outside a double-quoted value': [
    '"hoo\\x6bs": {}',
    '&x: "hoo\\x6bs": {PreToolUse: []}',
    '!x: "hoo\\x6bs": {PreToolUse: []}',
  ],
  'an explicit key (?)': ['? name2\n: x'],
  'a merge key (<<)': ['<<: {}'],
  'an alias used as a key': ['a: &k other\n*k : {}'],
}

/** A spelling rule with no frontmatter here: the run fails rather than quietly probing fewer rows. */
const SPELLINGS_WITHOUT_A_PROBE = HOOKS_SPELLINGS.map(({ rule }) => rule).filter((rule) => (SPELLED_AS[rule] ?? []).length === 0)

const MARKDOWN_HOOK_PROBES: readonly Probe[] = HOOKS_SPELLINGS.flatMap(({ rule }, ruleAt) =>
  (SPELLED_AS[rule] ?? []).map((spelling, at) => {
    const name = `spelling-${ruleAt}-${at}.md`
    return {
      what: `Claude Code as martha start starts it: a user-scope agent whose frontmatter spells the hooks key as ${rule}, spelling ${at + 1}`,
      host: 'claude-code' as const,
      command: claude(...HEADLESS_CLAUDE, PROMPT),
      approved: () => {},
      planted: () => {},
      planned: true,
      owner_settings: () => JSON.stringify({}),
      owner_markdown: (): readonly OwnerMarkdownFile[] => [
        {
          folder: 'agents',
          name,
          text: `---\nname: spelling-${ruleAt}-${at}\ndescription: a probe agent\n${spelling}\n---\n${PROMPT}\n`,
        },
      ],
      expected: { GATE_REFUSED: true },
      gate_names: (place: Place) => [join(dirname(ownerSettingsPath(place)), 'agents', name), rule],
    }
  }),
)

// --- the two spellings the launcher passes, asked of the host (martha#174) ---
//
// The gate refuses a frontmatter holding one of HOOKS_SPELLINGS. It passes two
// other spellings YAML has for the key `hooks` — both named in #146's r=2 review
// — and that review had no way to ask the host what it makes of them. These rows
// ask it: each plants one as a user-scope agent, starts the host as that agent,
// and reads the one marker the agent's own SessionStart and UserPromptSubmit
// hooks touch. The premise they rest on is HOOKS_SPELLINGS as it stands: a rule
// that starts refusing either one leaves the row's own answer unchanged.
//
// The control writes the key as `hooks`, so a run in which the host ran no
// agent's own hooks at all cannot pass for one in which it does not read a
// spelling: nothing here is proved by an absence alone. These rows take Martha's
// switches alone, with the launcher's settings gate skipped, because that gate
// refuses the control: `martha start` would not start any of the three. The
// config folder holds no login, so the host stops before any model call, after
// the hooks an agent file declares before the turn have run.
//
// What 2.1.319 answers: a binary-tagged scalar used as the key is not the key
// `hooks` — the host names the frontmatter key it read as the base64 text — and
// a flow sequence key whose colon the next line opens does not parse at all
// ("YAML Parse error: Multiline implicit key"), so the file is ignored and there
// is no agent by that name to start. Neither one runs a hook. A host upgrade
// that starts reading either fails its row.

/** A user-scope agent whose frontmatter writes the key `hooks` one way, with hooks that mark that they ran. */
function hostKeyAgent(place: Place, name: string, keyLine: (value: string) => string): OwnerMarkdownFile {
  const hook = (event: string) => `${event}: [{hooks: [{type: command, command: "touch ${place.marker('AGENT_HOOK')}"}]}]`
  return {
    folder: 'agents',
    name: `${name}.md`,
    text: `---\nname: ${name}\ndescription: a probe agent\n${keyLine(`{${hook('SessionStart')}, ${hook('UserPromptSubmit')}}`)}\n---\n${PROMPT}\n`,
  }
}

/** The control, and the two spellings the launcher passes, each with what the host does with it: whether its hooks run, and whether there is an agent by that name. */
const HOST_KEY_CASES: ReadonlyArray<{
  readonly what: string
  readonly name: string
  readonly keyLine: (value: string) => string
  readonly expected: Readonly<Record<string, boolean>>
  /** A SessionStart hook in the owner's user settings, which proves the host ran while this agent's own hooks did not (martha#188). */
  readonly owner_hook?: true
}> = [
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key as `hooks` (the control for the two below)',
    name: 'hooks-key-control',
    keyLine: (value) => `hooks: ${value}`,
    expected: { AGENT_HOOK: true, AGENT_NOT_FOUND: false },
  },
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key as a binary-tagged scalar',
    name: 'hooks-key-binary-tagged',
    keyLine: (value) => `!!binary aG9va3M=: ${value}`,
    // Both its own claims are absences, so the row also plants a SessionStart hook in the owner's user settings: that
    // marker is the host reaching the session, and without it a host that quit on the agent file would pass (martha#188).
    owner_hook: true,
    expected: { OWNER_HOOK: true, AGENT_HOOK: false, AGENT_NOT_FOUND: false },
  },
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key as a flow sequence with a comment before its colon',
    name: 'hooks-key-commented',
    keyLine: (value) => `[hooks] # c\n: ${value}`,
    expected: { AGENT_HOOK: false, AGENT_NOT_FOUND: true },
  },
  // The two spellings that made the narrowed scan enter a value where a key opens: an anchor and a local tag ending in
  // a colon. Each runs, so the gate's refusal of them is warranted, and a host that stopped reading one fails its row
  // (martha#243).
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key behind an anchor ending in a colon',
    name: 'hooks-key-anchored',
    keyLine: (value) => `&x: "hoo\\x6bs": ${value}`,
    expected: { AGENT_HOOK: true, AGENT_NOT_FOUND: false },
  },
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key behind a local tag ending in a colon',
    name: 'hooks-key-tagged',
    keyLine: (value) => `!x: "hoo\\x6bs": ${value}`,
    expected: { AGENT_HOOK: true, AGENT_NOT_FOUND: false },
  },
]

const HOST_KEY_PROBES: readonly Probe[] = HOST_KEY_CASES.map((one) => ({
  what: one.what,
  host: 'claude-code' as const,
  command: claudeAsTheAgent(one.name, ...HEADLESS_CLAUDE),
  approved: () => {},
  planted: () => {},
  planned: true,
  owner_settings: (place: Place) => JSON.stringify(one.owner_hook === true ? { hooks: touchAtStart(place.marker('OWNER_HOOK')) } : {}),
  owner_markdown: (place: Place): readonly OwnerMarkdownFile[] => [hostKeyAgent(place, one.name, one.keyLine)],
  expected: one.expected,
}))

// --- the trash, and the skills the host syncs from the owner's account (martha#243) ---
//
// Two places under the owner's skills folder are read as the host reads them. The
// trash: the host loads a SKILL.md directly in `skills/.trash` — as the skill
// `.trash` — and loads nothing below an entry in it, so the gate must read the
// same depth (measured on 2.1.322, and on this host's init event: `.trash` is
// listed, `inner/` is not). And the synced folder: a skill the host writes again
// from the owner's account at every start, which the gate judges like any other
// until the owner or the admin turns that sync off with `syncClaudeAiSkills:
// false`, a setting the host reads as `=== false` from any source.

const TRASH_TOP = 'trash-top'
const TRASH_BELOW = 'trash-below'

const TRASH_PROBE: Probe = {
  what: 'Claude Code as martha start starts it: the skill files under the owner skills folder, the one the host loads at the top of the trash and the one below an entry it does not',
  host: 'claude-code',
  command: (switches) => ({
    command: 'claude',
    args: ['-p', '--model', 'haiku', '--output-format', 'stream-json', '--verbose', PROMPT, ...switches.args],
  }),
  approved: () => {},
  planted: () => {},
  planned: true,
  owner_settings: () => JSON.stringify({}),
  owner_markdown: (): readonly OwnerMarkdownFile[] => [
    { folder: 'skills/.trash', name: 'SKILL.md', text: `---\nname: ${TRASH_TOP}\ndescription: a probe skill\n---\n${PROMPT}\n` },
    { folder: 'skills/.trash/entry', name: 'SKILL.md', text: `---\nname: ${TRASH_BELOW}\ndescription: a probe skill\n---\n${PROMPT}\n` },
  ],
  from_output: (_place: Place, printed: string) => {
    const listed = skillsListedIn(printed)
    return { TRASH_TOP_LISTED: listed.includes('.trash'), TRASH_BELOW_LISTED: listed.includes('entry') }
  },
  expected: { TRASH_TOP_LISTED: true, TRASH_BELOW_LISTED: false },
}

/** Two skills a signed-in host serves, as the clean-install run met them: one backslash each, inside a quoted description, and no hook. */
const SERVED_SKILLS: readonly OwnerMarkdownFile[] = [
  {
    folder: 'skills/synced/acct-1/google-workspace',
    name: 'SKILL.md',
    text: '---\nname: google-workspace\ndescription: "Read this before the first Google Drive call. Use it to change a Google Doc, even \\"change it\\" or \\"add a tab\\"."\n---\nBody.\n',
  },
  {
    folder: 'skills/synced/acct-1/xlsx',
    name: 'SKILL.md',
    text: '---\nname: xlsx\ndescription: "Use this any time a spreadsheet is the input, by name or path \\u{2014} even casually."\n---\nBody.\n',
  },
]

/** The same skills, with one of them really declaring a hook. */
const HOOKED_SYNCED: readonly OwnerMarkdownFile[] = SERVED_SKILLS.map((file, at) =>
  at === 1 ? { ...file, text: `---\nname: xlsx\ndescription: a skill\nhooks:\n  PreToolUse: []\n---\nBody.\n` } : file,
)

/** The synced folder's own paths, as the gate names them in a refusal. */
const syncedPathsOf = (place: Place, files: readonly OwnerMarkdownFile[]): readonly string[] =>
  files.map((file) => join(dirname(ownerSettingsPath(place)), file.folder, file.name))

const SYNCED_PROBES: readonly Probe[] = [
  {
    what: 'Claude Code as martha start starts it: two skills the host syncs from the owner account, each holding a backslash in a quoted description and no hook (martha#243)',
    host: 'claude-code' as const,
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    approved: () => {},
    planted: () => {},
    planned: true,
    owner_settings: () => JSON.stringify({}),
    owner_markdown: (): readonly OwnerMarkdownFile[] => SERVED_SKILLS,
    expected: { GATE_PASSED: true },
    gate_names: (place: Place) => syncedPathsOf(place, SERVED_SKILLS),
  },
  {
    what: 'Claude Code as martha start starts it: a synced skill whose frontmatter really declares a hook is refused, naming the file and the rule (martha#243)',
    host: 'claude-code' as const,
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    approved: () => {},
    planted: () => {},
    planned: true,
    owner_settings: () => JSON.stringify({}),
    owner_markdown: (): readonly OwnerMarkdownFile[] => HOOKED_SYNCED,
    expected: { GATE_REFUSED: true },
    gate_names: (place: Place) => [syncedPathsOf(place, HOOKED_SYNCED)[1] ?? '', 'the key hooks'],
  },
  {
    what: "Claude Code as martha start starts it: the same synced skill with `syncClaudeAiSkills: false` in the owner's settings, which the host reads as off, so the gate lets the start through (martha#243)",
    host: 'claude-code' as const,
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    approved: () => {},
    planted: () => {},
    planned: true,
    owner_settings: () => JSON.stringify({ syncClaudeAiSkills: false }),
    owner_markdown: (): readonly OwnerMarkdownFile[] => HOOKED_SYNCED,
    expected: { GATE_PASSED: true },
    gate_names: (place: Place) => syncedPathsOf(place, HOOKED_SYNCED),
  },
]

/** The environment a probe's host inherits: the owner's own config folder when it has one, and no plugin folder from the developer's shell. */
function environmentOf(probe: Probe, place: Place): Record<string, string | undefined> {
  if (probe.owner_settings === undefined && probe.owner_markdown === undefined) return { ...process.env, ...probe.inherited }
  const config = dirname(ownerSettingsPath(place))
  if (probe.owner_settings !== undefined) put(config, USER_SETTINGS_FILE, probe.owner_settings(place))
  for (const file of probe.owner_markdown?.(place) ?? []) put(join(config, file.folder), file.name, file.text)
  const { [PLUGIN_DIRS_VARIABLE]: _developers, ...rest } = process.env
  return { ...rest, CLAUDE_CONFIG_DIR: config, ...probe.inherited }
}

/** The launcher's settings gate on this planned launch: undefined when it passes, else its refusal. */
function gateRefusal(probe: Probe, inherited: Record<string, string | undefined>, prepared: Extract<ReturnType<typeof prepareLaunch>, { readonly allow: true }>): string | undefined {
  if (probe.gate_names === undefined) return undefined
  const gate = hookSettingsOf(launchEnvironment(inherited, prepared.switches), [], prepared)
  return typeof gate === 'string' ? gate : undefined
}

/** The switches to start with, or why the planned launch was refused. */
function switchesFor(probe: Probe, place: Place, inherited: Record<string, string | undefined> = {}): HostSwitches | string | { readonly gate: string } {
  if (!probe.planned) {
    probe.planted(place)
    return NO_SWITCHES
  }
  probe.approved?.(place)
  const where = { host: probe.host, launch_dir: place.checkout, stop_dir: place.scratch }
  const prepared = prepareLaunch({
    ...where,
    snapshot_root: join(place.scratch, 'snapshots'),
    approved_fingerprints: [fingerprintOf(readLaunchState(where, thisMachine))],
  }, thisMachine)
  if (!prepared.allow) return prepared.refusal
  const gate = gateRefusal(probe, inherited, prepared)
  if (gate !== undefined) return { gate }
  probe.planted(place)
  return prepared.switches
}

/**
 * The key prefix of each scratch this run made, as the host names the folder for it.
 * One per scratch, because a scratch is realpath'd when it is made and a TMPDIR
 * reached through a link (the CI's own) keys the folder by the path it leads to.
 *
 * Only a scratch this run made goes in here: the set is what the last row removes
 * by, and a generic name such as `<tmpdir>/martha-probe-` would also take away the
 * folders of another probe:launch running at the same time against the same config
 * dir (martha#179 r=2). The two places that make a scratch are the two that add.
 */
const theScratchPrefixes = new Set<string>()

/**
 * Registers one scratch this run made: the only way a name gets into what the last row
 * removes by. Exported because a test plays this run with a scratch of its own, and then
 * plants another run's folder beside it.
 */
export function aScratchThisRunMade(scratch: string): void {
  theScratchPrefixes.add(projectKeyOf(scratch))
}

/**
 * The whole of what the run left, read once at the end by the two facts this file
 * owns: the scratches it registered, and what its runs could not take away. A test
 * calls this with another run's folders planted, which is how the removal is held to
 * this run's own folders and not to a name every probe's folder starts with.
 */
export function whatThisRunLeftAtTheEnd(startedWith: ProjectFoldersBefore): readonly string[] {
  return whatIsStillLeftAtTheEnd(startedWith, theScratchPrefixes, leftBehindByARun)
}

/**
 * Every project folder a run wrote and could not take away (martha#179): what the
 * last row reports by name, together with what a read at the end still finds.
 */
const leftBehindByARun: string[] = []

/** Removes the folders this run wrote, and keeps the ones it could not, to be named in the last row. */
function takeAwayTheProjectFoldersOf(before: ProjectFoldersBefore, scratch: string): void {
  // Nothing of the run may still be working in the scratch when its folders are read back.
  stopTheProcessesLeftIn(scratch)
  leftBehindByARun.push(...takeAwayTheOnesThisRunWrote(before, projectKeyOf(scratch)))
  rmSync(scratch, { recursive: true, force: true })
}

/** Where one marker lands: the scratch root's own file, unless the row says the host itself writes it (martha#154). */
const markerPath = (probe: Probe, place: Place, name: string): string => (probe.markerAt === undefined ? place.marker(name) : probe.markerAt(place, name))

/** What one run left: each marker and whether it was started, and the host's own exit status. */
interface RunResult {
  readonly markers: Readonly<Record<string, boolean>>
  /** The host's exit status, or null when the launcher's gate refused it and no host ran. */
  readonly status: number | null
  /** How many times the host was made before this result stood; absent or 1 means once. */
  readonly attempts?: number
}

/**
 * How many times a row whose claim rests on the host's clean exit is made before its result
 * stands (martha#223). A host that spent every turn it was given, or the model service failing,
 * is not evidence about the tree: on one live run in five a row read `the host exited CLAIMED
 * cleanly but exited 1` on an unchanged tree. A row that is really wrong is wrong in every
 * attempt and is still reported.
 */
const ATTEMPTS_FOR_A_CLEAN_EXIT = 3

/**
 * Whether to make this run again instead of judging it (martha#223): only when the host's exit
 * is the attempt's **only** red. A row whose marker already came out wrong is this row's answer
 * and stands at once — a write that got through and then exited 1 is an intermittent failure of
 * the deny rules, which is the defect these rows exist to find, and making it again in a fresh
 * scratch would hide it.
 */
export function onlyTheExitFailed(probe: RowClaims, run: RunResult | string): boolean {
  if (probe.host_ok !== true || typeof run === 'string') return false
  const failed = judgeRow(probe, run).filter((line) => line.failed)
  return failed.length === 1 && failed[0]?.about === 'the exit'
}

/** A run, with how many times the host was made before this result stood. */
const afterAttempts = (run: RunResult | string, attempts: number): RunResult | string => (typeof run === 'string' ? run : { ...run, attempts })

/** One probe's row, made again only while the host's exit is the only thing that failed. */
function runProbe(probe: Probe): RunResult | string {
  for (let attempt = 1; attempt < ATTEMPTS_FOR_A_CLEAN_EXIT; attempt += 1) {
    const run = oneRunOfAProbe(probe)
    if (!onlyTheExitFailed(probe, run)) return afterAttempts(run, attempt)
  }
  return afterAttempts(oneRunOfAProbe(probe), ATTEMPTS_FOR_A_CLEAN_EXIT)
}

/** One run of a probe's host, in a scratch of its own. */
function oneRunOfAProbe(probe: Probe): RunResult | string {
  // A fresh directory each time: OpenCode's background service caches config per directory.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'martha-probe-')))
  const checkout = join(scratch, 'checkout')
  aScratchThisRunMade(scratch)
  let before: ProjectFoldersBefore | undefined
  try {
    mkdirSync(checkout)
    spawnSync('git', ['init', '-q', '.'], { cwd: checkout })
    const place: Place = { scratch, checkout, marker: (name) => join(scratch, name) }

    const inherited = environmentOf(probe, place)
    const switches = switchesFor(probe, place, inherited)
    if (typeof switches === 'string') return `refused by prepareLaunch: ${switches}`
    if ('gate' in switches) return aRunTheGateRefused(probe, place, switches.gate)

    const { command, args } = probe.command(switches, place)
    // Read the project folders of the config dir this host will use, not of the developer's own.
    const host_env = launchEnvironment(inherited, switches)
    before = theProjectFoldersThere(host_env)
    const run = runTheHost(command, args, {
      cwd: checkout,
      env: host_env,
      timeout_ms: RUN_TIMEOUT_MS,
      pid_file: join(scratch, 'host-group'),
    })
    if (run.error !== undefined) return `could not run: ${run.error}`
    spawnSync('sleep', ['1'])
    const printed = printedText(run.stdout)
    return {
      markers: {
        // The gate was asked and did not refuse, which only a row that names the gate can claim. It is written at the
        // gate step, before any host runs, so a row whose claim is that a file gets through does not rest on the host
        // (martha#243).
        ...(probe.gate_names === undefined ? {} : { GATE_PASSED: true }),
        ...Object.fromEntries(Object.keys(probe.expected).map((name) => [name, existsSync(markerPath(probe, place, name))])),
        ...(probe.from_output?.(place, printed) ?? {}),
      },
      status: run.status,
    }
  } finally {
    // On the failure paths too: a run that threw still wrote its folders.
    if (before === undefined) rmSync(scratch, { recursive: true, force: true })
    else takeAwayTheProjectFoldersOf(before, scratch)
  }
}

/**
 * The run a settings-gate refusal leaves: a failure for a row that needs the host to have run, whose claim is about what
 * the host would have tried, and the refusal's own markers for the others (martha#154 r=2).
 */
function aRunTheGateRefused(probe: Probe, place: Place, refusal: string): RunResult | string {
  if (probe.host_ok === true) return `the launcher's own settings gate refused this run (${refusal}), so the host never ran and the row proves nothing`
  const seen = gateSeen(probe, place, refusal)
  return typeof seen === 'string' ? seen : { markers: seen, status: null }
}

/** The markers of a run the launcher's gate refused: nothing started, and GATE_REFUSED when the refusal names what the probe planted. */
function gateSeen(probe: Probe, place: Place, refusal: string): Readonly<Record<string, boolean>> | string {
  const names = probe.gate_names?.(place) ?? []
  if (!names.every((name) => refusal.includes(name))) return `refused by the settings gate, not naming ${names.join(', ')}: ${refusal}`
  return Object.fromEntries(Object.keys(probe.expected).map((name) => [name, name === 'GATE_REFUSED']))
}

/** Runs one probe and prints each marker against its claim; a probe that cannot run, or a marker that differs, fails the run. */
function reportProbe(probe: Probe): void {
  const run = runProbe(probe)
  if (typeof run === 'string') {
    console.log(`${probe.what}: ${run}`)
    process.exitCode = 1
    return
  }
  for (const line of judgeRow(probe, run)) {
    if (line.failed) process.exitCode = 1
    console.log(line.text)
  }
  // A row that needed the host made again reads differently from one that did not (martha#223).
  if (run.attempts !== undefined && run.attempts > 1) console.log(`${probe.what}: the host was made ${run.attempts} times before this result stood`)
}

// --- the folders the host loads the owner's own text from (martha#154) -------
//
// The gate's own rules, `memoryDenyRules(ownerMemoryPlaces(...))` (the same call the launcher makes), go into the
// settings the host reads, and each row has the host attempt the very write those rules name, in every folder the
// recorded host loads the owner's user scope from. By hand the same write lands, so the pair shows the rules the launch
// carries are what refused it, not a host that never tried.
//
// The write is asked for with `--permission-mode acceptEdits` and the config folder added, on both runs: without them
// the host asks the owner for a folder outside the checkout and never attempts the write, and the row would show only
// that nothing was asked.

/** The config folder each run writes into: the probe's own, named as the owner's by CLAUDE_CONFIG_DIR. */
const userScopeConfig = (place: Place) => dirname(ownerSettingsPath(place))

/** The places the gate denies, from the call the launcher makes, over this run's own config folder. */
const userScopePlaces = (place: Place) => {
  const config = userScopeConfig(place)
  return ownerMemoryPlaces({
    launcher_env: { HOME: place.scratch, CLAUDE_CONFIG_DIR: config },
    member_env: { HOME: place.scratch },
    home: place.scratch,
    launch_dir: place.checkout,
    settings_files: [],
    user_scope: {
      markdown_kinds: RECORDED_HOST.markdown_kinds,
      output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
      reported_output_styles_dir: join(config, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
    },
  })
}

/** Every folder under the config dir the host loads the owner's text from, by the recording's names and the field's. */
const OWNER_SCOPE_FOLDERS: readonly string[] = [...RECORDED_HOST.markdown_kinds, CLAUDE_CODE_OUTPUT_STYLES_FOLDER]

const OWNER_SCOPE_PROBES: readonly Probe[] = OWNER_SCOPE_FOLDERS.flatMap((folder) =>
  [false, true].map((gated): Probe => {
    const target = (place: Place) => join(userScopeConfig(place), folder, 'probe-note.md')
    return {
      what: `Claude Code ${gated ? 'as martha start starts it, the permission rules the launch carries in the settings it reads' : 'by hand, with none of the launch\'s rules'}: a write into the ${folder} folder of the owner's config dir (martha#154)`,
      host: 'claude-code',
      command: (switches, place) => ({
        command: 'claude',
        args: [
          '-p',
          // Room for a turn that does not reach the Write (martha#223): a model that spends
          // both turns elsewhere exits non-zero, and this row's host_ok reads that as the
          // launch having failed rather than as the write never being tried.
          '--max-turns',
          '4',
          '--model',
          'haiku',
          '--permission-mode',
          'acceptEdits',
          '--output-format',
          'json',
          `--add-dir=${userScopeConfig(place)}`,
          `Use the Write tool to create the file ${target(place)} with the single line: probe. Do nothing else.`,
          ...switches.args,
        ],
      }),
      approved: () => {},
      planted: () => {},
      planned: gated,
      owner_settings: (place) => (gated ? JSON.stringify({ permissions: { deny: memoryDenyRules(userScopePlaces(place)) } }) : JSON.stringify({})),
      markerAt: target,
      // A refused write is the row's claim, and it takes the host itself to have run: a gate refusal, a crash or a
      // model that did nothing is a failure, not "not started, as claimed" (martha#154 r=2).
      ...(gated ? { host_ok: true as const, from_output: (place: Place, printed: string) => ({ OWNER_SCOPE_WRITE_DENIED: deniedWriteIn(printed, target(place)) }) } : {}),
      expected: { OWNER_SCOPE_FILE: !gated, ...(gated ? { OWNER_SCOPE_WRITE_DENIED: true } : {}) },
    }
  }),
)

/** Every row this run reports; the absence check reads the same list the run does, so a test can judge the real rows. */
export const ALL_PROBES: readonly Probe[] = [
  ...PROBES,
  ...OWNER_PROBES,
  ...SWITCH_PROBES,
  ...MARKDOWN_HOOK_PROBES,
  ...HOST_KEY_PROBES,
  TRASH_PROBE,
  ...SYNCED_PROBES,
  ...OWNER_SCOPE_PROBES,
]

/**
 * The turn budget each row starts the model with, by the row's own words, so a test reads the
 * commands the probe really builds rather than a constant restated beside it (martha#223).
 */
export function turnBudgets(): readonly { readonly what: string; readonly maxTurns: number | undefined }[] {
  return ALL_PROBES.map((probe) => {
    const { args } = probe.command(NO_SWITCHES, NO_PLACE)
    const at = args.indexOf('--max-turns')
    return { what: probe.what, maxTurns: at < 0 ? undefined : Number(args[at + 1]) }
  })
}

// --- auto-memory (martha#136) ------------------------------------------------
// Claude Code loads `<config dir>/projects/<project key>/memory/` into every
// session of a project, and a session in a git worktree loads the main clone's
// folder. Each run plants a codeword there and starts the host once: the control,
// by hand with memory on, must be seen loading it, so a run that shows nothing
// proves the off switch and not a loader that never ran. Martha's planned launch
// must show nothing, even when the owner's environment says memory on, and must
// leave the folder holding exactly what was planted. The folder is the owner's real
// one, removed after.
//
// What was loaded is read from the host's own record of the session (martha#223),
// not from an answer: the transcript quotes each file the host read in. Asking the
// model used to be the row, and the model sometimes spent every turn it was given
// without answering — one run in five, whatever the budget — so a tree where
// nothing was wrong went red.

const MEMORY_INDEX = 'MEMORY.md'
const MEMORY_NOTE = 'codeword.md'

/** The record the host writes its session into: a transcript, one json line per entry. */
const SESSION_RECORD = '.jsonl'

/** Every file under `dir`, relative, sorted. */
function filesUnder(dir: string): string[] {
  return existsSync(dir) ? (readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath.slice(dir.length), entry.name).replace(/^\//, '')).sort()) : []
}

/** The environment with the off switch unset: memory on, as the host defaults. */
function memoryOn(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const name of Object.keys(CLAUDE_MEMORY_OFF)) env[name] = undefined
  return env
}

/**
 * The session records the host has written in the project folders given, by path. Only the
 * folders a run's own checkouts key are ever passed (martha#223 r=2): the owner's projects root
 * holds every session on the machine, and a transcript some other session started there is not
 * this run's record — reading the whole root once made a Martha arm that wrote nothing read
 * `no, as claimed` as soon as a neighbour started a session.
 */
export function theRecordsIn(folders: readonly (string | undefined)[]): readonly string[] {
  return folders
    .flatMap((folder) => (folder !== undefined && existsSync(folder) ? readdirSync(folder).map((name) => join(folder, name)) : []))
    .filter((path) => path.endsWith(SESSION_RECORD))
    .sort()
}

/**
 * What one memory run showed: whether the host recorded reading the codeword in, or why there
 * was no record to read (martha#223). The record is written when the session starts, so a run
 * whose model spent every turn still answers this row; a run that wrote no record at all is
 * named, never read as "the codeword was not loaded".
 *
 * The record is looked for in the project folders this run's own checkouts key — the folder it
 * started the host in, and the main clone's for a worktree, which is where the host keeps a
 * worktree session — and only in the files that appear while this run is the one running.
 */
function theCodewordWasLoaded(
  scratch: string,
  start: string,
  main: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  codeword: string,
  pid_file: string,
): boolean | string {
  // Read before the host starts, so the folder it writes is one this run can name and take away.
  const before = theProjectFoldersThere(env)
  const ourFolders = [start, main].map((folder) => projectFolderFor(env, folder))
  const recordsBefore = new Set(theRecordsIn(ourFolders))
  try {
    const run = runTheHost('claude', [...HEADLESS_CLAUDE, PROMPT, ...args], {
      cwd: start,
      env,
      timeout_ms: RUN_TIMEOUT_MS,
      pid_file,
    })
    if (run.error !== undefined) return `could not run: ${run.error}`
    const written = theRecordsIn(ourFolders).filter((path) => !recordsBefore.has(path))
    if (written.length === 0) return 'the host wrote no session record in its own project folder, so there is nothing to read'
    const record = written.map((path) => readFileSync(path, 'utf8')).join('\n')
    return memoryTheHostLoadedFor(record, start).some((file) => file.text.includes(codeword))
  } finally {
    // The scratch itself goes when the whole memory probe is done; its folders go with each run.
    stopTheProcessesLeftIn(scratch)
    leftBehindByARun.push(...takeAwayTheOnesThisRunWrote(before, projectKeyOf(scratch)))
  }
}

/** A checkout to start in, and the folder whose memory the host loads for it: its own, or the main clone's for a worktree. */
function memoryPlace(scratch: string, worktree: boolean): { readonly start: string; readonly main: string } {
  const main = join(scratch, 'checkout')
  mkdirSync(main)
  spawnSync('git', ['init', '-q', '.'], { cwd: main })
  spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@invalid', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: main })
  if (!worktree) return { start: main, main }
  const start = join(scratch, 'worktree')
  spawnSync('git', ['worktree', 'add', '-q', start], { cwd: main })
  return { start, main }
}

/** One line of the memory probe: what was asked, what was seen (or why it could not run), and what docs/publish-gate.md claims. */
type MemoryLine = readonly [line: string, seen: boolean | string, claimed: boolean]

/** Plants the codeword in the memory folder the host loads for the run, then runs the control and Martha's launch. */
function memoryLines(scratch: string, memory: string, main: string, start: string, codeword: string): readonly MemoryLine[] {
  const folder = join(memory, 'memory')
  put(folder, MEMORY_INDEX, `- [codeword](${MEMORY_NOTE}) - the codeword is ${codeword}\n`)
  put(folder, MEMORY_NOTE, `---\nname: codeword\ndescription: the codeword\n---\nThe codeword is ${codeword}.\n`)
  const planted = filesUnder(folder)

  const where = { host: 'claude-code' as const, launch_dir: start, stop_dir: scratch }
  const prepared = prepareLaunch({ ...where, snapshot_root: join(scratch, 'snapshots'), approved_fingerprints: [fingerprintOf(readLaunchState(where, thisMachine))] }, thisMachine)
  if (!prepared.allow) return [['prepareLaunch allows the launch', prepared.refusal, true]]
  // Both runs pass the same switches; only the environment differs, so the control isolates the off switch.
  const forcedOn = Object.fromEntries(Object.keys(CLAUDE_MEMORY_OFF).map((name) => [name, '0']))
  const group = (at: number) => join(scratch, `host-group-${at}`)
  return [
    ['by hand, memory on: the host recorded reading the codeword in', theCodewordWasLoaded(scratch, start, main, prepared.switches.args, memoryOn(), codeword, group(1)), true],
    ["as Martha starts it, the owner's environment saying memory on: the host recorded reading the codeword in", theCodewordWasLoaded(scratch, start, main, prepared.switches.args, launchEnvironment({ ...process.env, ...forcedOn }, prepared.switches), codeword, group(2)), false],
    ['the memory folder holds exactly what was planted', JSON.stringify(filesUnder(folder)) === JSON.stringify(planted), true],
  ]
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no')

/** Takes away each folder named, skipping the ones the config dir could not tell. */
function takeAwayTheFoldersOf(...folders: readonly (string | undefined)[]): void {
  for (const folder of folders) if (folder !== undefined) rmSync(folder, { recursive: true, force: true })
}

/** Runs the memory probe in a plain checkout or a worktree; each line against its claim, a mismatch failing the run. */
function reportMemoryProbe(worktree: boolean): void {
  const what = `Claude Code auto-memory, ${worktree ? "a worktree loading its main clone's folder" : 'a plain checkout'}`
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'martha-probe-')))
  aScratchThisRunMade(scratch)
  const { start, main } = memoryPlace(scratch, worktree)
  const memory = projectFolderFor(process.env, main)
  try {
    const lines: readonly MemoryLine[] =
      memory === undefined
        ? [["the owner's config dir can be told", 'it cannot', true]]
        : memoryLines(scratch, memory, main, start, `ZEBRA${randomBytes(4).toString('hex')}`)
    if (lines.some(([, seen, claimed]) => seen !== claimed)) process.exitCode = 1
    for (const [line, seen, claimed] of lines) {
      console.log(`${what}: ${line} ${typeof seen === 'string' ? seen : yesNo(seen)}, ${seen === claimed ? 'as claimed' : `CLAIMED ${yesNo(claimed)}`}`)
    }
  } finally {
    stopTheProcessesLeftIn(scratch)
    // The folders this probe made for itself: the one it plants the codeword in, and a
    // worktree's own. They are made before a run reads what is there, so a run's own
    // read-back would count them as already there; the probe made them, so it takes them.
    takeAwayTheFoldersOf(memory, projectFolderFor(process.env, start))
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Everything the run does once its rows exist. A test imports the rows, so none of this may run on import. */
function main(): void {
  for (const command of new Set(PROBES.map((probe) => probe.command(NO_SWITCHES, NO_PLACE).command))) {
    console.log(`${command}: ${version(command)}`)
  }
  if (SPELLINGS_WITHOUT_A_PROBE.length > 0) {
    console.error(`no probe row for the spelling rule(s): ${SPELLINGS_WITHOUT_A_PROBE.join(', ')}`)
    process.exitCode = 1
  }
  if (SWITCHES_WITHOUT_A_PROBE.length > 0) {
    console.error(`the recorded host names no key to plant, so nothing probes: ${SWITCHES_WITHOUT_A_PROBE.join(', ')}`)
    process.exitCode = 1
  }
  const unproven = absencesWithoutAHostProof(ALL_PROBES)
  if (unproven.length > 0) {
    console.error(`a row whose claim is an absence proves nothing that the host ran, so a host that never ran would pass it: ${unproven.join(' | ')}`)
    process.exitCode = 1
  }
  const startedWith = theProjectFoldersThere(process.env)
  for (const probe of ALL_PROBES) reportProbe(probe)
  for (const worktree of [false, true]) reportMemoryProbe(worktree)

  const leftBehind = whatThisRunLeftAtTheEnd(startedWith)
  if (leftBehind.length > 0) process.exitCode = 1
  console.log(theLeftoverRow(leftBehind))
}

if (import.meta.main) main()
