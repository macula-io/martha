// `martha start <member>`: one member of the declared crew, started on the config the owner approved (martha#98).
//
// A real git checkout under a temporary home, a fake `claude` standing in for the host, the real launcher and the
// real launch records. Everything a test makes is removed after it, the member's process group included.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { approveConfig } from '../approve_a_checkouts_config/approve_a_checkouts_config.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { declareSoloCrew, SOLO_MEMBERS } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { nodeIdsFor, openState, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { NOT_STARTED } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { shortRelayRoot } from '../launch_a_claude_code_member/short_relay_root.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { launcherPlacesOf, startMember, type MemberStartRequest } from './start_a_member.ts'

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
  writeFileSync(command, ['#!/bin/sh', `: > '${ran}'`, `printf '%s\\n' "$@" > '${args}'`, 'exec sleep 600', ''].join('\n'), { mode: 0o700 })
  return { command, ran, args }
}

function requestFor(place: Place, command: string, member: string, lines: string[]): MemberStartRequest {
  const places = launcherPlacesOf(place.state, place.relay_root)
  assert.ok('rows' in places, 'refusal' in places ? places.refusal : '')
  return {
    root: place.root,
    home: place.home,
    member,
    args: ['-p', 'the owner prompt'],
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
  assert.ok(readFileSync(fake.args, 'utf8').includes('--mcp-config'), 'the approved copy is passed')
})
