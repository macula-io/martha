// `martha approve`: the owner, on their own terminal, reads the config a member would start from and says yes to
// it; the yes is kept outside the checkout for the next `martha start` (martha#98).
//
// A real git checkout under a temporary home, and a terminal stood in for. Everything a test makes is removed.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { openState, readApprovals, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { CLAUDE_CODE } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { fingerprintOf, readLaunchState } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { approveConfig, NOT_A_TERMINAL, type OwnersTerminal } from './approve_a_checkouts_config.ts'

const SERVERS = JSON.stringify({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } })

interface Place {
  readonly home: string
  readonly root: string
  readonly state: MarthaState
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd })
}

function placeFor(t: TestContext, files: Readonly<Record<string, string>>): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-approve-')))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const root = join(home, 'project')
  mkdirSync(root)
  git(root, 'init', '-q', '.')
  writeFileSync(join(root, 'README.md'), 'a project\n')
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text)
  git(root, 'add', '--all')
  git(root, 'commit', '-q', '-m', 'start')
  const state = openState(join(home, 'state'), root)
  assert.ok('directory' in state)
  return { home, root, state }
}

/** A terminal that answers `answer`, and remembers what it was asked. */
function terminalAnswering(answer: string, is_terminal = true): OwnersTerminal & { readonly asked: string[] } {
  const asked: string[] = []
  return {
    is_terminal,
    asked,
    ask: (question) => {
      asked.push(question)
      return Promise.resolve(answer)
    },
  }
}

const approving = (place: Place, terminal: OwnersTerminal, lines: string[]) => ({
  root: place.root,
  home: place.home,
  state: place.state,
  terminal,
  tellOwner: (line: string) => void lines.push(line),
  now: () => new Date('2026-11-06T23:59:00.000Z'),
})

const fingerprintAt = (place: Place): string =>
  fingerprintOf(readLaunchState({ host: CLAUDE_CODE, launch_dir: place.root, stop_dir: place.home }, thisMachine))

test('approve with no terminal refuses by name, asks nothing and keeps nothing', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  const terminal = terminalAnswering('yes', false)
  const lines: string[] = []
  const outcome = await approveConfig(approving(place, terminal, lines))
  assert.equal(outcome.kind, 'refused')
  assert.equal(outcome.kind === 'refused' ? outcome.refusal : '', NOT_A_TERMINAL)
  assert.deepEqual(terminal.asked, [])
  assert.deepEqual(readApprovals(place.state), { approvals: [] })
})

test('approve shows every file the config holds and the fingerprint, and keeps the owner\'s yes', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  const lines: string[] = []
  const outcome = await approveConfig(approving(place, terminalAnswering('yes'), lines))
  const fingerprint = fingerprintAt(place)
  assert.deepEqual(outcome, { kind: 'approved', fingerprint })
  const shown = lines.join('\n')
  assert.ok(shown.includes('.mcp.json'), shown)
  assert.ok(shown.includes(fingerprint), shown)
  const kept = readApprovals(place.state)
  assert.ok('approvals' in kept)
  assert.deepEqual(kept.approvals.map((approval) => [approval.fingerprint, approval.approved_at]), [[fingerprint, '2026-11-06T23:59:00.000Z']])
})

test('any answer but yes keeps nothing', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  for (const answer of ['', 'y', 'no', 'YES please']) {
    const outcome = await approveConfig(approving(place, terminalAnswering(answer), []))
    assert.equal(outcome.kind, 'refused', answer)
  }
  assert.deepEqual(readApprovals(place.state), { approvals: [] })
})

test('a checkout with no config that starts code has nothing to approve, and asks nothing', async (t) => {
  const place = placeFor(t, {})
  const terminal = terminalAnswering('yes')
  const outcome = await approveConfig(approving(place, terminal, []))
  assert.equal(outcome.kind, 'nothing')
  assert.deepEqual(terminal.asked, [])
  assert.deepEqual(readApprovals(place.state), { approvals: [] })
})

test('a config the launch gate could never start is refused with the gate\'s reason, and never asked about', async (t) => {
  const place = placeFor(t, { 'servers.json': SERVERS })
  symlinkSync('servers.json', join(place.root, '.mcp.json'))
  const terminal = terminalAnswering('yes')
  const outcome = await approveConfig(approving(place, terminal, []))
  assert.equal(outcome.kind, 'refused')
  assert.match(outcome.kind === 'refused' ? outcome.refusal : '', /\.mcp\.json is a symlink/)
  assert.deepEqual(terminal.asked, [])
})

test('approving a config already approved keeps no second line', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await approveConfig(approving(place, terminalAnswering('yes'), []))
  const terminal = terminalAnswering('yes')
  const outcome = await approveConfig(approving(place, terminal, []))
  assert.deepEqual(outcome, { kind: 'approved', fingerprint: fingerprintAt(place) })
  assert.deepEqual(terminal.asked, [])
  const kept = readApprovals(place.state)
  assert.ok('approvals' in kept)
  assert.equal(kept.approvals.length, 1)
})
