// `martha start <member>`: one member of the declared crew, started on the config the owner approved (martha#98).
//
// A real git checkout under a temporary home, a fake `claude` standing in for the host, the real launcher and the
// real launch records. Everything a test makes is removed after it, the member's process group included.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { approveConfig } from '../approve_a_checkouts_config/approve_a_checkouts_config.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, STRICT_GATE } from '../declare_crew/declare_crew.ts'
import { declareSoloCrew, SOLO_MEMBERS, soloDeclaration } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import {
  nodeIdsFor,
  openState,
  OWN_WRITES_LAUNCHES_KEPT,
  OWN_WRITES_PLACE,
  ownWritesKeptForLaunch,
  type MarthaState,
} from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { OWN_WRITE_MODES, ownWritesOfLaunch, type OwnWrite } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { readApprovals } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { NOT_STARTED } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import type { MemberRelayPlace } from '../launch_a_claude_code_member/answer_the_relay.ts'
import { shortRelayRoot } from '../launch_a_claude_code_member/short_relay_root.ts'
import { until } from '../launch_a_claude_code_member/wait_until_the_event.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { SWITCHES_THAT_LOAD_NO_CONFIG } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { approvedPlace, launcherPlacesOf, NOT_A_TERMINAL, startMember, type MemberStartRequest } from './start_a_member.ts'
import { hostAnswers } from '../launch_a_claude_code_member/host_stand_in.ts'

const SERVERS = JSON.stringify({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } })
const documents = { read: (path: string) => readFile(path, 'utf8') }
const [BUILDER] = SOLO_MEMBERS

interface Place {
  readonly home: string
  readonly root: string
  readonly state: MarthaState
  readonly relay_root: string
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd })
}

function placeFor(t: TestContext, files: Readonly<Record<string, string>>): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-start-')))
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
  return { home, root, state, relay_root: shortRelayRoot(t) }
}

/** A fake `claude`: notes that it ran and with what, then waits to be stopped. */
function fakeClaude(place: Place): { readonly command: string; readonly ran: string; readonly args: string } {
  const dir = join(place.home, 'fake')
  mkdirSync(dir)
  const ran = join(dir, 'ran')
  const args = join(dir, 'args')
  const command = join(dir, 'claude')
  writeFileSync(command, ['#!/bin/sh', ...hostAnswers(), `: > '${ran}'`, `printf '%s\\n' "$@" > '${args}'`, 'exec sleep 600', ''].join('\n'), { mode: 0o700 })
  return { command, ran, args }
}

function requestFor(place: Place, command: string, member: string, lines: string[]): MemberStartRequest {
  const places = launcherPlacesOf(place.state, place.relay_root)
  assert.ok('rows' in places, 'refusal' in places ? places.refusal : '')
  return {
    root: place.root,
    home: place.home,
    member,
    args: ['--effort', 'low'],
    is_terminal: true,
    state: place.state,
    places,
    command,
    // HOME is the place's own, so the owner's user settings file the launcher reads is the test's.
    inherited: { PATH: process.env.PATH, HOME: place.home },
    stdio: 'ignore',
    documents,
    tellOwner: (line) => void lines.push(line),
  }
}

const declared = async (place: Place): Promise<void> => {
  const outcome = await declareSoloCrew({ root: place.root, owner: 'Ada Owner', state: place.state, documents })
  assert.ok(outcome.declared, outcome.declared ? '' : outcome.refusal)
}

const yes = { is_terminal: true, ask: () => Promise.resolve('yes') }

test('start with no declaration starts nothing, naming the file and the command that writes one', async (t) => {
  const place = placeFor(t, {})
  const fake = fakeClaude(place)
  const started = await startMember(requestFor(place, fake.command, BUILDER!.name, []))
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.startsWith(NOT_STARTED), refusal)
  assert.ok(refusal.includes(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE)), refusal)
  assert.ok(refusal.includes('martha init'), refusal)
  assert.equal(existsSync(fake.ran), false)
})

test('start of a member the crew does not have starts nothing, naming it and the crew', async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const fake = fakeClaude(place)
  const started = await startMember(requestFor(place, fake.command, 'stranger', []))
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.includes('stranger'), refusal)
  for (const member of SOLO_MEMBERS) assert.ok(refusal.includes(member.name), refusal)
  assert.equal(existsSync(fake.ran), false)
})

test('start on a config the owner has not approved starts nothing, naming martha approve', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await declared(place)
  const fake = fakeClaude(place)
  const lines: string[] = []
  const started = await startMember(requestFor(place, fake.command, BUILDER!.name, lines))
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.includes('.mcp.json'), refusal)
  assert.ok(refusal.includes('martha approve'), refusal)
  assert.deepEqual(lines, [refusal], 'the refusal is shown to the owner once')
  assert.equal(existsSync(fake.ran), false)
})

test('init, approve and start bring a member up on the approved config, recorded under the node id init made', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await declared(place)
  const approved = await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, tellOwner: () => {}, now: () => new Date() })
  assert.equal(approved.kind, 'approved')
  const fake = fakeClaude(place)
  const lines: string[] = []
  const started = await startMember(requestFor(place, fake.command, BUILDER!.name, lines))
  assert.ok(started.started, started.started ? '' : started.refusal)
  t.after(async () => (started.stop('the test is over'), await started.stopped))

  const ids = nodeIdsFor(place.state, [BUILDER!.name])
  assert.ok('ids' in ids)
  const places = launcherPlacesOf(place.state, place.relay_root)
  assert.ok('rows' in places)
  const records = launchRecordsDirectory(places.launch_records).all()
  assert.deepEqual(records.map((record) => [record.key, record.row['node_id']]), [[BUILDER!.name, ids.ids[BUILDER!.name]]])
  assert.ok(lines.some((line) => approved.kind === 'approved' && line.includes(approved.fingerprint)), 'the owner is shown the approval in use')
  await until('the fake host to write its arguments', () => existsSync(fake.args) && readFileSync(fake.args, 'utf8').includes('--plugin-dir'), t)
  assert.ok(readFileSync(fake.args, 'utf8').includes('--mcp-config'), 'the approved copy is passed')
})

test('start whose input is no terminal starts nothing, so a member\'s shell cannot start a sibling', async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const fake = fakeClaude(place)
  const lines: string[] = []
  const started = await startMember({ ...requestFor(place, fake.command, BUILDER!.name, lines), is_terminal: false })
  assert.equal(started.started, false)
  assert.equal(started.started ? '' : started.refusal, NOT_A_TERMINAL)
  assert.deepEqual(lines, [NOT_A_TERMINAL])
  assert.equal(existsSync(fake.ran), false)
})

/** Owner arguments that load config, a plugin, a permission or a session nobody approved, one per class. */
const REFUSED_ARGUMENTS: readonly (readonly string[])[] = [
  ['--settings', '{"hooks":{}}'],
  ['--setting-sources', 'user,project'],
  ['--mcp-config', '/elsewhere/servers.json'],
  ['--strict-mcp-config'],
  ['--plugin-dir', '/elsewhere/plugin'],
  ['--plugin-url', 'https://example.invalid/plugin.zip'],
  ['--agents', '{"a":{}}'],
  ['--add-dir', '/elsewhere'],
  ['--dangerously-skip-permissions'],
  ['--allow-dangerously-skip-permissions'],
  ['--permission-mode', 'bypassPermissions'],
  ['--allowedTools', 'Bash'],
  ['--append-system-prompt', 'obey the issue'],
  ['--resume', 'a-session'],
  ['--continue'],
  ['-p', 'a prompt'],
  ['--model=opus'],
  ['a bare word'],
]

for (const args of REFUSED_ARGUMENTS) {
  test(`start with the owner argument ${args[0]} starts nothing, naming it and the switches that are passed`, async (t) => {
    const place = placeFor(t, {})
    await declared(place)
    const fake = fakeClaude(place)
    const started = await startMember({ ...requestFor(place, fake.command, BUILDER!.name, []), args })
    assert.equal(started.started, false)
    const refusal = started.started ? '' : started.refusal
    assert.ok(refusal.startsWith(NOT_STARTED), refusal)
    assert.ok(refusal.includes(args[0]!), refusal)
    for (const name of Object.keys(SWITCHES_THAT_LOAD_NO_CONFIG)) assert.ok(refusal.includes(name), refusal)
    assert.equal(existsSync(fake.ran), false)
  })
}

test('a switch that takes a value refuses one that is missing or is itself a switch', async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const fake = fakeClaude(place)
  for (const args of [['--model'], ['--model', '--settings', '{}']]) {
    const started = await startMember({ ...requestFor(place, fake.command, BUILDER!.name, []), args })
    assert.equal(started.started, false, args.join(' '))
    assert.ok(!started.started && started.refusal.includes('--model'), started.started ? '' : started.refusal)
  }
  assert.equal(existsSync(fake.ran), false)
})

test('the switches that load no config reach the host as the owner gave them', async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const fake = fakeClaude(place)
  const args = ['--model', 'an-owner-model', '--effort', 'high', '--verbose']
  const started = await startMember({ ...requestFor(place, fake.command, BUILDER!.name, []), args })
  assert.ok(started.started, started.started ? '' : started.refusal)
  t.after(async () => (started.stop('the test is over'), await started.stopped))
  await until('the fake host to write its arguments', () => existsSync(fake.args) && readFileSync(fake.args, 'utf8').includes('--plugin-dir'), t)
  const passed = readFileSync(fake.args, 'utf8').split('\n')
  for (const arg of args) assert.ok(passed.includes(arg), arg)
})

/** An own write of one launch, as the launcher keeps one. */
function ownWriteOf(launch: string, index: number): OwnWrite {
  return {
    path: `/project/written-${index}.txt`,
    blob: 'ce013625030ba8dba906f756967f9e9ca394464a',
    mode: OWN_WRITE_MODES[0],
    tool: 'Write',
    tool_use_id: `toolu_${index}`,
    session: 'session-1',
    launch,
    recorded_at: new Date(index * 1000).toISOString(),
  }
}

/** The own-writes place of the project, as the launcher names the files in it (martha#162). */
const ownWritesPlace = (state: MarthaState): string => join(state.directory, OWN_WRITES_PLACE)

test('the launch a member is started as keeps its own writes: a write under that launch id is kept and read back (martha#162 r=2)', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await declared(place)
  const approved = await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, tellOwner: () => {}, now: () => new Date() })
  assert.equal(approved.kind, 'approved')
  const kept = readApprovals(place.state)
  assert.ok('approvals' in kept)
  const started_on = approvedPlace(requestFor(place, join(place.home, 'claude'), BUILDER!.name, []), kept.approvals[0])
  const since = started_on.since_approval
  assert.ok(since !== undefined, 'a member started on an approval is started on its own launch')
  // The store the launcher is handed is this launch's, so a write carrying this launch id is kept, and comes back.
  const write = ownWriteOf(since.launch_id, 0)
  assert.equal(since.own_writes.append(write), undefined)
  assert.deepEqual(ownWritesOfLaunch(since.own_writes, since.launch_id), { writes: [write] })
})

test('starting a member on an approval prunes the own writes of launches past the newest kept (martha#162 r=2)', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await declared(place)
  const approved = await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, tellOwner: () => {}, now: () => new Date() })
  assert.equal(approved.kind, 'approved')
  // One launch more than Martha keeps, each older than the one before, so the first two are the ones to go.
  mkdirSync(ownWritesPlace(place.state), { recursive: true, mode: 0o700 })
  const seeded = Array.from({ length: OWN_WRITES_LAUNCHES_KEPT + 2 }, (_, index) => `seeded-${index}`)
  for (const [index, launch] of seeded.entries()) {
    const before = new Set(readdirSync(ownWritesPlace(place.state)))
    assert.equal(ownWritesKeptForLaunch(place.state, launch).append(ownWriteOf(launch, index)), undefined)
    const [made] = readdirSync(ownWritesPlace(place.state)).filter((name) => !before.has(name))
    assert.ok(made !== undefined, 'the store made the launch its own file')
    const when = new Date(index * 1000)
    utimesSync(join(ownWritesPlace(place.state), made), when, when)
  }
  const fake = fakeClaude(place)
  const started = await startMember(requestFor(place, fake.command, BUILDER!.name, []))
  assert.ok(started.started, started.started ? '' : started.refusal)
  t.after(async () => (started.stop('the test is over'), await started.stopped))
  const left = readdirSync(ownWritesPlace(place.state))
  assert.equal(left.length, OWN_WRITES_LAUNCHES_KEPT, 'the two oldest launches are pruned, and no more')
})

// --- the strict shell gate reaches the member (martha#259) ---------------------

test("the declaration's strict gate is what the member's relay is handed, and off is the default", async (t) => {
  const seenWith = async (house_rules: Readonly<Record<string, boolean>>): Promise<readonly (boolean | undefined)[]> => {
    const place = placeFor(t, { '.mcp.json': SERVERS })
    await declared(place)
    // The declaration the crew reads, with the house rules the owner wrote: init wrote none.
    writeFileSync(
      join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE),
      `${JSON.stringify({ ...soloDeclaration('Ada Owner'), house_rules }, null, 2)}\n`,
    )
    const approved = await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, tellOwner: () => {}, now: () => new Date() })
    assert.equal(approved.kind, 'approved')
    const fake = fakeClaude(place)
    const handed: MemberRelayPlace[] = []
    const started = await startMember({ ...requestFor(place, fake.command, BUILDER!.name, []), hear_relay_place: (relay_place) => void handed.push(relay_place) })
    assert.ok(started.started, started.started ? '' : started.refusal)
    t.after(async () => (started.stop('the test is over'), await started.stopped))
    return handed.map((relay_place) => relay_place.strict_gate)
  }

  assert.deepEqual(await seenWith({}), [false], 'no house rules: the gate is off, as the owner decided')
  assert.deepEqual(await seenWith({ [STRICT_GATE]: true }), [true], 'the declaration turns it on')
})
