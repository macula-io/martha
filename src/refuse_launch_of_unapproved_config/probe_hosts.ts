// What each host starts from a fresh checkout with nobody asked: the evidence
// behind the launched rows' residuals and the table in docs/publish-gate.md.
//
// Run it by hand after a host upgrade: `npm run probe:launch`. It is not part of
// `npm test`: it needs both coding tools installed, and the headless Claude Code
// probes make one small model call each. Every probe works in its own scratch
// directory, whose config only touches a marker file there, and removes it.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { LAUNCH_FILES_OF_HOST } from './refuse_launch_of_unapproved_config.ts'

const [CLAUDE_SERVERS, CLAUDE_SETTINGS] = LAUNCH_FILES_OF_HOST['claude-code']
const [OPENCODE_CONFIG, , OPENCODE_DIR] = LAUNCH_FILES_OF_HOST.opencode

/** How long one host run may take before the probe gives up on it. */
const RUN_TIMEOUT_MS = 90_000
/** A server that only touches the marker, then lingers long enough to be seen. */
const LINGER_SECONDS = 3

const HEADLESS_CLAUDE = ['-p', '--max-turns', '1', '--model', 'haiku', 'Reply with the single word ok.']

interface Probe {
  readonly what: string
  readonly command: string
  readonly args: readonly string[]
  readonly plant: (checkout: string, marker: string) => void
}

function put(dir: string, name: string, content: string): void {
  mkdirSync(dirname(join(dir, name)), { recursive: true })
  writeFileSync(join(dir, name), content)
}

const claudeServer = (marker: string) =>
  JSON.stringify({ mcpServers: { probe: { command: 'sh', args: ['-c', `touch ${marker}; sleep ${LINGER_SECONDS}`] } } })

const PROBES: readonly Probe[] = [
  {
    what: 'Claude Code, interactive health check: a project tool server',
    command: 'claude',
    args: ['mcp', 'list'],
    plant: (checkout, marker) =>
      put(checkout, CLAUDE_SERVERS, claudeServer(marker)),
  },
  {
    what: 'Claude Code, headless: a project tool server',
    command: 'claude',
    args: HEADLESS_CLAUDE,
    plant: (checkout, marker) =>
      put(checkout, CLAUDE_SERVERS, claudeServer(marker)),
  },
  {
    what: 'Claude Code, headless: a project SessionStart hook',
    command: 'claude',
    args: HEADLESS_CLAUDE,
    plant: (checkout, marker) =>
      put(checkout, CLAUDE_SETTINGS, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch ${marker}` }] }] } })),
  },
  {
    what: 'OpenCode, debug config: a project tool server',
    command: 'opencode',
    args: ['debug', 'config'],
    plant: (checkout, marker) =>
      put(checkout, OPENCODE_CONFIG, JSON.stringify({ mcp: { servers: { probe: { type: 'local', command: ['sh', '-c', `touch ${marker}; sleep ${LINGER_SECONDS}`], enabled: true } } } })),
  },
  {
    what: 'OpenCode, debug config: a project plugin',
    command: 'opencode',
    args: ['debug', 'config'],
    plant: (checkout, marker) =>
      put(checkout, join(OPENCODE_DIR, 'plugin', 'probe.ts'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, '')\nexport const Probe = async () => ({})\n`),
  },
]

function version(command: string): string {
  const run = spawnSync(command, ['--version'], { encoding: 'utf8' })
  return run.error === undefined ? run.stdout.trim().split('\n')[0] ?? '' : `not installed (${run.error.message})`
}

function runProbe(probe: Probe): string {
  // A fresh directory each time: OpenCode's background service caches config per directory.
  const scratch = mkdtempSync(join(tmpdir(), 'martha-probe-'))
  try {
    const checkout = join(scratch, 'checkout')
    mkdirSync(checkout)
    spawnSync('git', ['init', '-q', '.'], { cwd: checkout })
    const marker = join(scratch, 'STARTED')
    probe.plant(checkout, marker)
    const run = spawnSync(probe.command, probe.args, { cwd: checkout, stdio: 'ignore', timeout: RUN_TIMEOUT_MS })
    if (run.error !== undefined) return `could not run: ${run.error.message}`
    spawnSync('sleep', ['1'])
    return existsSync(marker) ? 'STARTED with nobody asked' : 'not started'
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

for (const command of new Set(PROBES.map((probe) => probe.command))) {
  console.log(`${command}: ${version(command)}`)
}
for (const probe of PROBES) {
  console.log(`${probe.what}: ${runProbe(probe)}`)
}
