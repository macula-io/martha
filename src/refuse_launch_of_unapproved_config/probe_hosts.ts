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
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  fingerprintOf,
  LAUNCH_FILES_OF_HOST,
  launchEnvironment,
  prepareLaunch,
  readLaunchState,
  type Host,
  type HostSwitches,
} from './refuse_launch_of_unapproved_config.ts'

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
    approved_fingerprints: [fingerprintOf(readLaunchState(where))],
  })
  if (!prepared.allow) return prepared.refusal
  probe.planted(place)
  return prepared.switches
}

/** Each marker and whether it was started, or why the probe could not run. */
function runProbe(probe: Probe): Readonly<Record<string, boolean>> | string {
  // A fresh directory each time: OpenCode's background service caches config per directory.
  const scratch = mkdtempSync(join(tmpdir(), 'martha-probe-'))
  try {
    const checkout = join(scratch, 'checkout')
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
    rmSync(scratch, { recursive: true, force: true })
  }
}

const said = (started: boolean) => (started ? 'started' : 'not started')

for (const command of new Set(PROBES.map((probe) => probe.command(NO_SWITCHES).command))) {
  console.log(`${command}: ${version(command)}`)
}

for (const probe of PROBES) {
  const seen = runProbe(probe)
  if (typeof seen === 'string') {
    console.log(`${probe.what}: ${seen}`)
    process.exitCode = 1
    continue
  }
  for (const [name, claimed] of Object.entries(probe.expected)) {
    const matches = seen[name] === claimed
    if (!matches) process.exitCode = 1
    console.log(
      `${probe.what}: ${name} ${said(seen[name] === true)}, ${matches ? 'as claimed' : `CLAIMED ${said(claimed)}`}`,
    )
  }
}
