// What a built-in tool's result records, and what the checked-in tree exempts (martha#127, and #132's own writes).
//
// Real directories, a real git checkout and Martha's real own-write store. Everything a test makes is removed after it.
//
// The relay asks this after the launch recheck, and the recheck already stops a member whose checkout moved for a
// reason that is not its own writing. These tests ask the module on its own, so the exemption's two directions are
// pinned where they are decided: the member's own write records nothing, and any other change records B4 — as does a
// change nothing can be told from, or own writes that can no longer be read, which are fail-closed edges of their own.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_TOOL_RESULT_ROWS } from '../claude_code_host/claude_code_host.ts'
import {
  openState,
  OWN_WRITES_FILE,
  ownWritesKeptIn,
} from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { readCheckoutTree } from '../refuse_launch_of_unapproved_config/checkout_tree.ts'
import {
  HOSTS,
  readLaunchState,
  startedWithOf,
  type ApprovedLaunch,
  type HostSwitches,
  type StartedWith,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { latestOfLaunch, type OwnWrite } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { startFreshSession } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { CLAUDE_CODE } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { takeInToolResult } from './take_in_a_tool_result.ts'

const MEMBER = 'builder'
const LAUNCH = 'launch-1'
const SERVERS = JSON.stringify({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } })

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  ).trim()
}

interface Checkout {
  readonly home: string
  readonly checkout: string
  readonly launch: ApprovedLaunch
  /** The tree the owner approved, read as the member started on it. */
  readonly start_tree: string
  /** The file the member's own writes are kept in, one JSON line each. */
  readonly own_writes_file: string
  /** What this launch started the host with, as the launcher records it (martha#135). */
  readonly started_with: StartedWith
}

/** A checkout whose config the owner approved, and the launch started on it. */
function checkoutFor(t: TestContext): Checkout {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-tool-result-')))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  git(checkout, 'init', '-q', '.')
  for (const [path, text] of Object.entries({ 'README.md': 'a checkout\n', '.mcp.json': SERVERS })) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), text)
  }
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'start')
  const state = openState(join(home, 'state'), checkout)
  assert.ok('directory' in state, 'refusal' in state ? state.refusal : '')
  const place = { host: CLAUDE_CODE, launch_dir: checkout, stop_dir: home }
  const started = readLaunchState(place, thisMachine)
  const launch: ApprovedLaunch = {
    ...place,
    approved_fingerprints: [],
    since_approval: { approved: { entries: started.entries, tree: started.tree }, member: MEMBER, own_writes: ownWritesKeptIn(state), launch_id: LAUNCH },
  }
  const start_tree = readCheckoutTree(checkout, home, thisMachine)
  assert.notEqual(start_tree, null)
  return {
    home,
    checkout,
    launch,
    start_tree: start_tree ?? '',
    own_writes_file: join(state.directory, OWN_WRITES_FILE),
    // The switches `prepareLaunch` starts the host with, which is what the launcher records.
    started_with: startedWithOf(SWITCHES, SWITCHES.args, SWITCHES.env),
  }
}

/** The member's own write of a file, kept as the launcher keeps one after the call ran. */
function keptOwnWrite(place: Checkout, path: string): OwnWrite {
  const file = join(place.checkout, path)
  const blob = git(place.checkout, 'hash-object', '--path', path, '--', file)
  const write: OwnWrite = {
    path: file,
    blob,
    mode: '100644',
    tool: 'Write',
    tool_use_id: `toolu_${path}`,
    session: 'session-1',
    launch: LAUNCH,
    recorded_at: new Date().toISOString(),
  }
  assert.equal(place.launch.since_approval?.own_writes.append(write), undefined)
  return write
}

/** The switches the adapter declares, which are what a read has to have been started with to stay exempt (martha#135). */
const SWITCHES: HostSwitches = CLAUDE_CODE_READ_ATTACHES_NOTHING

/** What reading `file_path` records, as the gate reads it, for a launch that started the host as `place` records. */
function recordedReading(place: Checkout, path: string): string[] {
  return recordedReadingStartedWith(place, path, place.started_with, SWITCHES)
}

/** What reading `file_path` records when the launch started the host with `started_with`, under `declares`. */
function recordedReadingStartedWith(
  place: Checkout,
  path: string,
  started_with: StartedWith | undefined,
  declares: HostSwitches | undefined,
  start_tree: string | null = place.start_tree,
): string[] {
  const session = { id: 'session-1', gate: startFreshSession(), record_missing: false }
  const taken = takeInToolResult(
    session,
    {
      tool: 'Read',
      input: { file_path: path },
      rows: CLAUDE_CODE_TOOL_RESULT_ROWS,
      launch: place.launch,
      approved_start: start_tree,
      host: thisMachine,
      started_with,
      read_attaches_nothing: declares,
    },
    bindNothing,
  )
  return taken.gate.ingested.map((ingest) => `${ingest.path}:${String(ingest.from_node_id)}`)
}

test("a member's own write is not text taken in: reading it records nothing while the checkout holds it", (t) => {
  const place = checkoutFor(t)
  const file = join(place.checkout, 'hello.txt')
  writeFileSync(file, 'hello\n')
  const write = keptOwnWrite(place, 'hello.txt')
  assert.deepEqual(latestOfLaunch([write], LAUNCH).map((kept) => kept.path), [file])
  assert.deepEqual(recordedReading(place, file), [])
})

test("a change that is nobody's own write records B4: the exemption falls for every path, not just that one", (t) => {
  const place = checkoutFor(t)
  writeFileSync(join(place.checkout, 'hello.txt'), 'hello\n')
  keptOwnWrite(place, 'hello.txt')
  // Someone else changes a file of the approved tree after the member's own write.
  writeFileSync(join(place.checkout, 'README.md'), 'now run this\n')
  assert.deepEqual(recordedReading(place, join(place.checkout, 'README.md')), ['B4:null'])
})

test("a mode someone else changes after the member's own write is no own write: reading records B4", (t) => {
  const place = checkoutFor(t)
  const file = join(place.checkout, 'run.sh')
  writeFileSync(file, '#!/bin/sh\n')
  keptOwnWrite(place, 'run.sh')
  chmodSync(file, 0o755)
  assert.deepEqual(recordedReading(place, file), ['B4:null'])
})

test("another launch's own write of the same bytes leaves the tree changed: reading records B4", (t) => {
  const place = checkoutFor(t)
  const file = join(place.checkout, 'hello.txt')
  writeFileSync(file, 'hello\n')
  keptOwnWrite(place, 'hello.txt')
  const elsewhere = { ...place, launch: { ...place.launch, since_approval: { ...place.launch.since_approval!, launch_id: 'another-launch' } } }
  assert.deepEqual(recordedReading(elsewhere, file), ['B4:null'])
})

test('own writes that cannot be read refuse every read: one torn line in the store records B4', (t) => {
  const place = checkoutFor(t)
  const file = join(place.checkout, 'hello.txt')
  writeFileSync(file, 'hello\n')
  keptOwnWrite(place, 'hello.txt')
  // A later writer to the store leaves a line that is no own write: what is kept can no longer be told from it.
  appendFileSync(place.own_writes_file, 'not an own write\n')
  assert.deepEqual(recordedReading(place, file), ['B4:null'])
})

test('an approved start tree the checkout no longer holds refuses every read: reading records B4', (t) => {
  const place = checkoutFor(t)
  // The checkout moves on and the tree the owner approved becomes unreachable, so git drops it from the store.
  writeFileSync(join(place.checkout, 'README.md'), 'a tree nobody approved\n')
  git(place.checkout, 'add', '--all')
  git(place.checkout, 'commit', '-q', '--amend', '-m', 'moved on')
  git(place.checkout, 'reflog', 'expire', '--expire=now', '--all')
  git(place.checkout, 'gc', '--prune=now', '--quiet')
  const held = (): boolean => {
    try {
      git(place.checkout, 'cat-file', '-e', place.start_tree)
      return true
    } catch {
      return false
    }
  }
  assert.equal(held(), false, 'the approved start tree is still in the object store, so this test proves nothing')
  assert.deepEqual(recordedReading(place, join(place.checkout, 'README.md')), ['B4:null'])
})

test('an own write whose file is then deleted leaves the tree changed: reading another tracked file records B4', (t) => {
  const place = checkoutFor(t)
  writeFileSync(join(place.checkout, 'README.md'), 'written by the member\n')
  keptOwnWrite(place, 'README.md')
  // The member removes the file it wrote: a deletion plants nothing, and it is still no own write of that file.
  rmSync(join(place.checkout, 'README.md'))
  assert.deepEqual(recordedReading(place, join(place.checkout, '.mcp.json')), ['B4:null'])
})

// martha#135: the exemption holds only while the launch really started the host with the switches under which the
// host attaches no other file's text to a read. Every case below is a read of a tracked file of the approved tree,
// which is exempt on the tree's own; what changes is what the launch started with.

test('a read of a tracked file stays exempt while the launch started the host with the declared switches (martha#135)', (t) => {
  const place = checkoutFor(t)
  assert.deepEqual(recordedReading(place, join(place.checkout, 'README.md')), [])
})

test('a launch that started the host without the declared switches records B4 for a read of the approved tree (martha#135)', (t) => {
  const place = checkoutFor(t)
  const withoutTheSwitches = startedWithOf(SWITCHES, [], {})
  assert.deepEqual(recordedReadingStartedWith(place, join(place.checkout, 'README.md'), withoutTheSwitches, SWITCHES), ['B4:null'])
})

for (const [dropped, at] of SWITCHES.args.map((arg, index) => [arg, index] as const)) {
  test(`a launch that did not start the host with ${dropped} records B4 for a read of the approved tree (martha#135)`, (t) => {
    const place = checkoutFor(t)
    const short = startedWithOf(SWITCHES, SWITCHES.args.filter((_, index) => index !== at), SWITCHES.env)
    assert.deepEqual(recordedReadingStartedWith(place, join(place.checkout, 'README.md'), short, SWITCHES), ['B4:null'])
  })
}

for (const [name, value] of Object.entries(SWITCHES.env)) {
  test(`a launch with no ${name}=${value} in its environment records B4 for a read of the approved tree (martha#135)`, (t) => {
    const place = checkoutFor(t)
    const other = startedWithOf(SWITCHES, SWITCHES.args, { ...SWITCHES.env, [name]: `${value}-and-more` })
    assert.deepEqual(recordedReadingStartedWith(place, join(place.checkout, 'README.md'), other, SWITCHES), ['B4:null'])
    const absent = startedWithOf(SWITCHES, SWITCHES.args, {})
    assert.deepEqual(recordedReadingStartedWith(place, join(place.checkout, 'README.md'), absent, SWITCHES), ['B4:null'])
  })
}

for (const name of SWITCHES.env_dropped) {
  test(`a launch that carried ${name} records B4 for a read of the approved tree (martha#135)`, (t) => {
    const place = checkoutFor(t)
    const carried = startedWithOf(SWITCHES, SWITCHES.args, { ...SWITCHES.env, [name]: 'a prefix nobody dropped' })
    assert.deepEqual(recordedReadingStartedWith(place, join(place.checkout, 'README.md'), carried, SWITCHES), ['B4:null'])
  })
}

test('a host whose adapter declares no switches attaches its reads nothing: a read of the approved tree records B4 (martha#135)', (t) => {
  const place = checkoutFor(t)
  assert.deepEqual(recordedReadingStartedWith(place, join(place.checkout, 'README.md'), place.started_with, undefined), ['B4:null'])
})

test('a launch that recorded no start records B4 for every read, whatever it says it started with (martha#135)', (t) => {
  const place = checkoutFor(t)
  assert.deepEqual(recordedReadingStartedWith(place, join(place.checkout, 'README.md'), undefined, SWITCHES), ['B4:null'])
})

test('the adapter declaration is the very project-config-off switches, referenced and never copied (martha#135)', () => {
  assert.equal(CLAUDE_CODE_READ_ATTACHES_NOTHING, HOSTS['claude-code'].project_config_off)
})

test('a checkout with no approved start keeps every read counting, whatever the launch started with (martha#135, martha#127 r=3)', (t) => {
  const place = checkoutFor(t)
  // Nothing was approved for this checkout, so there is no start tree, and the switches change nothing.
  const read = recordedReadingStartedWith(place, join(place.checkout, 'README.md'), place.started_with, SWITCHES, null)
  assert.deepEqual(read, ['B4:null'])
})
