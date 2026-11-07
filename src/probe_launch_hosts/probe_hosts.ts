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

/** The switches to start with, or why the planned launch was refused. */
function switchesFor(probe: Probe, place: Place): HostSwitches | string {
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

    const switches = switchesFor(probe, place)
    if (typeof switches === 'string') return `refused by prepareLaunch: ${switches}`

    const { command, args } = probe.command(switches)
    const run = spawnSync(command, args, {
      cwd: checkout,
      env: launchEnvironment({ ...process.env, ...probe.inherited }, switches),
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

for (const probe of PROBES) reportProbe(probe)

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
