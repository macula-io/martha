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

import { userSettingsPath } from '../claude_code_host/settings_env_reaching_servers.ts'
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
type Command = (switches: HostSwitches) => { readonly command: string; readonly args: readonly string[] }

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
const NO_SUCH_AGENT = `--agent '${AGENT}' not found`
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
 * Claude Code started as the checkout's agent. The markers sit beside the
 * checkout (../ from where the host runs): AGENT_LOADED when the host ran it,
 * AGENT_NOT_FOUND when the host said it has no such agent.
 */
const claudeAsTheAgent = (...extra: readonly string[]): Command => (switches) => ({
  command: 'sh',
  args: [
    '-c',
    `"$@" 2> ../agent.err && touch ../AGENT_LOADED; grep -qF -e "${NO_SUCH_AGENT}" ../agent.err && touch ../AGENT_NOT_FOUND; true`,
    'claude-as-agent',
    'claude',
    ...extra,
    '--agent',
    AGENT,
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
    command: claudeAsTheAgent(...HEADLESS_CLAUDE),
    planted: plantFixedText,
    expected: { AGENT_LOADED: true, AGENT_NOT_FOUND: false },
    planned: false,
  },
  {
    what: "Claude Code as Martha starts it, headless: started as a checkout's agent (A16)",
    host: 'claude-code',
    command: claudeAsTheAgent(...HEADLESS_CLAUDE),
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
// The key is never typed here: it comes from the recorded host's own hook-set function, so a re-recording that
// renames it changes what this plants, and a recording that names none fails the run rather than probing nothing.
// Two rows, because they prove different things and one would hide the other:
//   - the key ALONE in the owner's user settings, gated: with no hook in the file, the switch is the only reason
//     the launcher has to refuse, so the refusal is that gate's and not another one's;
//   - the key BESIDE a SessionStart hook, on the switches alone: the hook that would mark OWNER_HOOK does not run,
//     which is what shows the key really is a switch on this host.

/** The key the recorded host tests as `=== true` to drop every hook, whichever settings file sets it. */
const HOOK_KILLING_KEY = CLAUDE_CODE_HOOK_SWITCHES.every_source[0]
const SWITCHES_WITHOUT_A_PROBE = HOOK_KILLING_KEY === undefined ? ['a key that turns every hook off, in any settings file'] : []
const killingKey = (): string => HOOK_KILLING_KEY ?? ''

/** The owner's user settings with a SessionStart hook and that key beside it: the hook that would mark OWNER_HOOK. */
const ownerHookAndSwitch = (place: Place) =>
  JSON.stringify({ hooks: touchAtStart(place.marker('OWNER_HOOK')), [killingKey()]: true })

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
      : [{
          ...common,
          what: `Claude Code ${as}: ${killingKey()}, which turns every hook off, beside a hook in the owner's user settings`,
          owner_settings: ownerHookAndSwitch,
          expected: { OWNER_HOOK: false },
        }]),
  ]
})

/** The switch alone, gated: no hook in the file, so the only reason the launcher has to refuse is the switch itself. */
const SWITCH_PROBES: readonly Probe[] = [
  {
    what: `Claude Code as martha start starts it: ${killingKey()} alone in the owner's user settings, with no hook beside it`,
    host: 'claude-code',
    command: claude(...HEADLESS_CLAUDE, PROMPT),
    approved: () => {},
    planted: () => {},
    planned: true,
    owner_settings: () => JSON.stringify({ [killingKey()]: true }),
    expected: { GATE_REFUSED: true },
    gate_names: (place: Place) => [ownerSettingsPath(place), killingKey()],
  },
]

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

/** The host's key for a project folder: every character that is not a letter or a digit becomes `-`. */
const projectKeyOf = (folder: string): string => folder.replaceAll(/[^A-Za-z0-9]/g, '-')

/**
 * The folder Claude Code keeps a project's sessions and memory in, under the
 * owner's config dir: a run in a scratch checkout writes one, which the probe
 * removes with the scratch. Undefined when the config dir cannot be told.
 */
function projectFolderOf(folder: string): string | undefined {
  const settings = userSettingsPath(process.env)
  return 'path' in settings ? join(dirname(settings.path), 'projects', projectKeyOf(folder)) : undefined
}

/** Removes the scratch and the host's project folder for each checkout run in it. */
function removeScratch(scratch: string, checkouts: readonly string[]): void {
  for (const folder of checkouts.map(projectFolderOf)) if (folder !== undefined) rmSync(folder, { recursive: true, force: true })
  rmSync(scratch, { recursive: true, force: true })
}

/** Each marker and whether it was started, or why the probe could not run. */
function runProbe(probe: Probe): Readonly<Record<string, boolean>> | string {
  // A fresh directory each time: OpenCode's background service caches config per directory.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'martha-probe-')))
  const checkout = join(scratch, 'checkout')
  try {
    mkdirSync(checkout)
    spawnSync('git', ['init', '-q', '.'], { cwd: checkout })
    const place: Place = { scratch, checkout, marker: (name) => join(scratch, name) }

    const inherited = environmentOf(probe, place)
    const switches = switchesFor(probe, place, inherited)
    if (typeof switches === 'string') return `refused by prepareLaunch: ${switches}`
    if ('gate' in switches) return gateSeen(probe, place, switches.gate)

    const { command, args } = probe.command(switches)
    const run = spawnSync(command, args, {
      cwd: checkout,
      env: launchEnvironment(inherited, switches),
      stdio: 'ignore',
      timeout: RUN_TIMEOUT_MS,
    })
    if (run.error !== undefined) return `could not run: ${run.error.message}`
    spawnSync('sleep', ['1'])
    return Object.fromEntries(Object.keys(probe.expected).map((name) => [name, existsSync(place.marker(name))]))
  } finally {
    removeScratch(scratch, [checkout])
  }
}

/** The markers of a run the launcher's gate refused: nothing started, and GATE_REFUSED when the refusal names what the probe planted. */
function gateSeen(probe: Probe, place: Place, refusal: string): Readonly<Record<string, boolean>> | string {
  const names = probe.gate_names?.(place) ?? []
  if (!names.every((name) => refusal.includes(name))) return `refused by the settings gate, not naming ${names.join(', ')}: ${refusal}`
  return Object.fromEntries(Object.keys(probe.expected).map((name) => [name, name === 'GATE_REFUSED']))
}

const said = (started: boolean) => (started ? 'started' : 'not started')

for (const command of new Set(PROBES.map((probe) => probe.command(NO_SWITCHES).command))) {
  console.log(`${command}: ${version(command)}`)
}

/** Runs one probe and prints each marker against its claim; a probe that cannot run, or a marker that differs, fails the run. */
function reportProbe(probe: Probe): void {
  const seen = runProbe(probe)
  if (typeof seen === 'string') {
    console.log(`${probe.what}: ${seen}`)
    process.exitCode = 1
    return
  }
  for (const [name, claimed] of Object.entries(probe.expected)) {
    const matches = seen[name] === claimed
    if (!matches) process.exitCode = 1
    console.log(
      `${probe.what}: ${name} ${said(seen[name] === true)}, ${matches ? 'as claimed' : `CLAIMED ${said(claimed)}`}`,
    )
  }
}

/** The host's project folders for scratch checkouts, so a run that leaves one behind fails. */
function scratchProjectFolders(): readonly string[] {
  const projects = projectFolderOf(tmpdir())
  if (projects === undefined) return []
  const root = dirname(projects)
  return existsSync(root) ? readdirSync(root).filter((name) => name.startsWith(`${projectKeyOf(join(tmpdir(), 'martha-probe-'))}`)) : []
}
const foldersBefore = new Set(scratchProjectFolders())

if (SPELLINGS_WITHOUT_A_PROBE.length > 0) {
  console.error(`no probe row for the spelling rule(s): ${SPELLINGS_WITHOUT_A_PROBE.join(', ')}`)
  process.exitCode = 1
}

if (SWITCHES_WITHOUT_A_PROBE.length > 0) {
  console.error(`the recorded host names no key to plant, so nothing probes: ${SWITCHES_WITHOUT_A_PROBE.join(', ')}`)
  process.exitCode = 1
}

for (const probe of [...PROBES, ...OWNER_PROBES, ...SWITCH_PROBES, ...MARKDOWN_HOOK_PROBES]) reportProbe(probe)

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
function codewordSaid(cwd: string, args: readonly string[], env: Readonly<Record<string, string | undefined>>, codeword: string): boolean | string {
  const run = spawnSync('claude', [...HEADLESS_CLAUDE, MEMORY_PROMPT, ...args], { cwd, env, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] })
  if (run.error !== undefined) return `could not run: ${run.error.message}`
  return run.stdout.includes(codeword)
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
  return [
    ['by hand, memory on: codeword said', codewordSaid(start, prepared.switches.args, memoryOn(), codeword), true],
    ["as Martha starts it, the owner's environment saying memory on: codeword said", codewordSaid(start, prepared.switches.args, launchEnvironment({ ...process.env, ...forcedOn }, prepared.switches), codeword), false],
    ['the memory folder holds exactly what was planted', JSON.stringify(filesUnder(folder)) === JSON.stringify(planted), true],
  ]
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no')

/** Runs the memory probe in a plain checkout or a worktree; each line against its claim, a mismatch failing the run. */
function reportMemoryProbe(worktree: boolean): void {
  const what = `Claude Code auto-memory, ${worktree ? "a worktree loading its main clone's folder" : 'a plain checkout'}`
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'martha-probe-')))
  const { start, main } = memoryPlace(scratch, worktree)
  const memory = projectFolderOf(main)
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
    removeScratch(scratch, [main, start])
  }
}

for (const worktree of [false, true]) reportMemoryProbe(worktree)

const leftBehind = scratchProjectFolders().filter((name) => !foldersBefore.has(name))
if (leftBehind.length > 0) process.exitCode = 1
console.log(`project folders this run left in the owner's config dir: ${leftBehind.length === 0 ? 'none, as claimed' : `${leftBehind.join(', ')}, CLAIMED none`}`)
