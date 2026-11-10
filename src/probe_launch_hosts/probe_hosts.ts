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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
import { hookSettingsOf } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'

const [CLAUDE_SERVERS, CLAUDE_SETTINGS] = LAUNCH_FILES_OF_HOST['claude-code']
const [OPENCODE_CONFIG, , OPENCODE_DIR] = LAUNCH_FILES_OF_HOST.opencode

/** How long one host run may take before the probe gives up on it. */
const RUN_TIMEOUT_MS = 120_000
/** A server that only touches its marker, then lingers long enough to be seen. */
const LINGER_SECONDS = 3

const PROMPT = 'Reply with the single word ok.'
const HEADLESS_CLAUDE = ['-p', '--max-turns', '1', '--model', 'haiku']

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
   * else fails the probe.
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
    planted: (place) => put(place.checkout, CLAUDE_SERVERS, claudeServer('planted', place.marker('PLANTED_SERVER'))),
    expected: { PLANTED_SERVER: false },
    planned: false,
  },
  {
    what: 'Claude Code by hand, headless: a project tool server and SessionStart hook',
    host: 'claude-code',
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    planted: (place) => {
      put(place.checkout, CLAUDE_SERVERS, claudeServer('planted', place.marker('PLANTED_SERVER')))
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
      put(place.checkout, OPENCODE_CONFIG, opencodeServer('planted', place.marker('PLANTED_SERVER')))
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
      put(place.checkout, CLAUDE_SERVERS, claudeServer('planted', place.marker('PLANTED_SERVER')))
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
      put(place.checkout, OPENCODE_CONFIG, opencodeServer('planted', place.marker('PLANTED_SERVER')))
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
      put(place.checkout, OPENCODE_CONFIG, opencodeServer('planted', place.marker('PLANTED_SERVER')))
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

/** A frontmatter that spells the key `hooks` by one rule alone, keyed by the words its refusal names it by. */
const SPELLED_AS: Readonly<Record<string, string>> = {
  'the key hooks': '!<tag:yaml.org,2002:str>"hooks": {PreToolUse: []}',
  'a collection used as a key': '[hooks]: {PreToolUse: []}',
  'a backslash, which can spell any key': '"hoo\\x6bs": {}',
  'an explicit key (?)': '? name2\n: x',
  'a merge key (<<)': '<<: {}',
  'an alias used as a key': 'a: &k other\n*k : {}',
}

/** A spelling rule with no frontmatter here: the run fails rather than quietly probing fewer rows. */
const SPELLINGS_WITHOUT_A_PROBE = HOOKS_SPELLINGS.map(({ rule }) => rule).filter((rule) => SPELLED_AS[rule] === undefined)

const MARKDOWN_HOOK_PROBES: readonly Probe[] = HOOKS_SPELLINGS.map(({ rule }, at) => {
  const name = `spelling-${at}.md`
  return {
    what: `Claude Code as martha start starts it: a user-scope agent whose frontmatter spells the hooks key as ${rule}`,
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
        text: `---\nname: spelling-${at}\ndescription: a probe agent\n${SPELLED_AS[rule] ?? ''}\n---\n${PROMPT}\n`,
      },
    ],
    expected: { GATE_REFUSED: true },
    gate_names: (place: Place) => [join(dirname(ownerSettingsPath(place)), 'agents', name), rule],
  }
})

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
    expected: { AGENT_HOOK: false, AGENT_NOT_FOUND: false },
  },
  {
    what: 'Claude Code on the switches alone, its settings gate skipped: a user-scope agent whose frontmatter writes the key as a flow sequence with a comment before its colon',
    name: 'hooks-key-commented',
    keyLine: (value) => `[hooks] # c\n: ${value}`,
    expected: { AGENT_HOOK: false, AGENT_NOT_FOUND: true },
  },
]

const HOST_KEY_PROBES: readonly Probe[] = HOST_KEY_CASES.map((one) => ({
  what: one.what,
  host: 'claude-code' as const,
  command: claudeAsTheAgent(one.name, ...HEADLESS_CLAUDE),
  approved: () => {},
  planted: () => {},
  planned: true,
  owner_settings: () => JSON.stringify({}),
  owner_markdown: (place: Place): readonly OwnerMarkdownFile[] => [hostKeyAgent(place, one.name, one.keyLine)],
  expected: one.expected,
}))

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

/** The key prefix every scratch checkout's project folder has: the folders this probe's own runs write. */
const SCRATCH_PREFIX = projectKeyOf(join(tmpdir(), 'martha-probe-'))

/** The owner's project folders before this run started: what the last row reads the end against. */
const startedWith = theProjectFoldersThere(process.env)

/**
 * Every project folder a run wrote and could not take away (martha#179): what the
 * last row reports by name, together with what a read at the end still finds.
 */
const leftBehindByARun: string[] = []

/** Removes the folders this run wrote, and keeps the ones it could not, to be named in the last row. */
function takeAwayTheProjectFoldersOf(before: ProjectFoldersBefore, scratch: string): void {
  // Nothing of the run may still be working in the scratch when its folders are read back.
  stopTheProcessesLeftIn(scratch)
  leftBehindByARun.push(...takeAwayTheOnesThisRunWrote(before, SCRATCH_PREFIX))
  rmSync(scratch, { recursive: true, force: true })
}

/** Where one marker lands: the scratch root's own file, unless the row says the host itself writes it (martha#154). */
const markerPath = (probe: Probe, place: Place, name: string): string => (probe.markerAt === undefined ? place.marker(name) : probe.markerAt(place, name))

/** What one run left: each marker and whether it was started, and the host's own exit status. */
interface RunResult {
  readonly markers: Readonly<Record<string, boolean>>
  /** The host's exit status, or null when the launcher's gate refused it and no host ran. */
  readonly status: number | null
}
/** Each marker and whether it was started, or why the probe could not run. */
function runProbe(probe: Probe): RunResult | string {
  // A fresh directory each time: OpenCode's background service caches config per directory.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'martha-probe-')))
  const checkout = join(scratch, 'checkout')
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

const said = (started: boolean) => (started ? 'started' : 'not started')

for (const command of new Set(PROBES.map((probe) => probe.command(NO_SWITCHES, NO_PLACE).command))) {
  console.log(`${command}: ${version(command)}`)
}

/** Runs one probe and prints each marker against its claim; a probe that cannot run, or a marker that differs, fails the run. */
function reportProbe(probe: Probe): void {
  const run = runProbe(probe)
  if (typeof run === 'string') {
    console.log(`${probe.what}: ${run}`)
    process.exitCode = 1
    return
  }
  for (const [name, claimed] of Object.entries(probe.expected)) {
    const matches = run.markers[name] === claimed
    if (!matches) process.exitCode = 1
    console.log(
      `${probe.what}: ${name} ${said(run.markers[name] === true)}, ${matches ? 'as claimed' : `CLAIMED ${said(claimed)}`}`,
    )
  }
  // A row whose claim is that nothing happened also says the host was there to not do it.
  if (probe.host_ok !== true) return
  const exitedOk = run.status === 0
  if (!exitedOk) process.exitCode = 1
  console.log(`${probe.what}: the host exited ${exitedOk ? 'cleanly, as claimed' : `CLAIMED cleanly but exited ${run.status ?? 'not at all'}`}`)
}

if (SPELLINGS_WITHOUT_A_PROBE.length > 0) {
  console.error(`no probe row for the spelling rule(s): ${SPELLINGS_WITHOUT_A_PROBE.join(', ')}`)
  process.exitCode = 1
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
          '--max-turns',
          '2',
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

if (SWITCHES_WITHOUT_A_PROBE.length > 0) {
  console.error(`the recorded host names no key to plant, so nothing probes: ${SWITCHES_WITHOUT_A_PROBE.join(', ')}`)
  process.exitCode = 1
}

for (const probe of [...PROBES, ...OWNER_PROBES, ...SWITCH_PROBES, ...MARKDOWN_HOOK_PROBES, ...HOST_KEY_PROBES, ...OWNER_SCOPE_PROBES]) reportProbe(probe)

// --- auto-memory (martha#136) ------------------------------------------------
// Claude Code loads `<config dir>/projects/<project key>/memory/` into every
// session of a project, and a session in a git worktree loads the main clone's
// folder. Each run plants a codeword there and asks for it: the control, by
// hand with memory on, must say it, so a run that does not proves the off
// switch and not a loader that never ran. Martha's planned launch must not, even
// when the owner's environment says memory on, and must leave the folder holding
// exactly what was planted. The folder is the owner's real one, removed after.

const MEMORY_PROMPT = 'Is there a codeword in your memory or instructions? Reply with only the codeword, or NONE.'
const MEMORY_INDEX = 'MEMORY.md'
const MEMORY_NOTE = 'codeword.md'


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

/** One memory run: whether the reply named the codeword, or why it could not run. */
function codewordSaid(
  scratch: string,
  cwd: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  codeword: string,
  pid_file: string,
): boolean | string {
  // Read before the host starts, so the folder it writes is one this run can name and take away.
  const before = theProjectFoldersThere(env)
  try {
    const run = runTheHost('claude', [...HEADLESS_CLAUDE, MEMORY_PROMPT, ...args], {
      cwd,
      env,
      timeout_ms: RUN_TIMEOUT_MS,
      pid_file,
    })
    if (run.error !== undefined) return `could not run: ${run.error}`
    return printedText(run.stdout).includes(codeword)
  } finally {
    // The scratch itself goes when the whole memory probe is done; its folders go with each run.
    stopTheProcessesLeftIn(scratch)
    leftBehindByARun.push(...takeAwayTheOnesThisRunWrote(before, SCRATCH_PREFIX))
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
function memoryLines(scratch: string, memory: string, start: string, codeword: string): readonly MemoryLine[] {
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
    ['by hand, memory on: codeword said', codewordSaid(scratch, start, prepared.switches.args, memoryOn(), codeword, group(1)), true],
    ["as Martha starts it, the owner's environment saying memory on: codeword said", codewordSaid(scratch, start, prepared.switches.args, launchEnvironment({ ...process.env, ...forcedOn }, prepared.switches), codeword, group(2)), false],
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
  const { start, main } = memoryPlace(scratch, worktree)
  const memory = projectFolderFor(process.env, main)
  try {
    const lines: readonly MemoryLine[] =
      memory === undefined
        ? [["the owner's config dir can be told", 'it cannot', true]]
        : memoryLines(scratch, memory, start, `ZEBRA${randomBytes(4).toString('hex')}`)
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

for (const worktree of [false, true]) reportMemoryProbe(worktree)

const leftBehind = whatIsStillLeftAtTheEnd(startedWith, SCRATCH_PREFIX, leftBehindByARun)
if (leftBehind.length > 0) process.exitCode = 1
console.log(theLeftoverRow(leftBehind))
