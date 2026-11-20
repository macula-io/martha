// `martha crew add|remove|set-model|set-host` (martha#307), run as the owner runs it: bin/martha in a real checkout under
// a temporary home. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { DECLARATION_DIRECTORY, DECLARATION_FILE, SOLO_MEMBERS, THE_ENGINES_HOST } from '../declare_crew/declare_crew.ts'
import { ADD, HOST_DEFAULT, REMOVE, SET_HOST, SET_MODEL } from '../declare_crew/change_a_member.ts'
import { MEMBERS_FILE, openState, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { THE_PLACES_A_STATE_ROOT_KEEPS } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { EXIT_DONE, EXIT_REFUSED, EXIT_USAGE } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import { STOP } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'

const MARTHA = join(import.meta.dirname, '..', '..', 'bin', 'martha')
const CREW = 'crew'
const [BUILDER, REVIEWER] = SOLO_MEMBERS

interface Place {
  readonly home: string
  readonly root: string
}

/** A checkout with a crew `martha init` declared. */
function aCrew(t: TestContext): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-crew-verbs-')))
  t.after(() => removeTheTree(home))
  const root = join(home, 'project')
  mkdirSync(root)
  execFileSync('git', ['init', '-q', '.'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Ada Owner'], { cwd: root })
  const place = { home, root }
  assert.equal(martha(place, 'init').status, EXIT_DONE)
  return place
}

/** bin/martha run in the place's checkout, with its standard input a pipe. */
function martha(place: Place, ...args: string[]) {
  const run = spawnSync(process.execPath, [MARTHA, ...args], {
    cwd: place.root,
    encoding: 'utf8',
    input: '',
    env: { PATH: process.env.PATH, HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1' },
  })
  return { status: run.status, said: `${run.stdout}${run.stderr}` }
}

const declarationOf = (place: Place): string => readFileSync(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')
const membersOf = (place: Place): readonly Record<string, unknown>[] => (JSON.parse(declarationOf(place)) as { members: Record<string, unknown>[] }).members

/** The state this place's crew keeps, as the command opens it. */
function stateOf(place: Place) {
  const state = openState(join(place.home, 'state', STATE_ROOT_NAME), place.root)
  assert.ok(!('refusal' in state), 'refusal' in state ? state.refusal : '')
  return state
}

/** A launch of `member` recorded as the launcher records one, whose host is `pid`. */
function aLaunchOf(place: Place, member: string, pid: number): void {
  const records = join(stateOf(place).directory, THE_PLACES_A_STATE_ROOT_KEEPS.records_place)
  mkdirSync(records, { recursive: true, mode: THE_PLACES_A_STATE_ROOT_KEEPS.only_its_owner_may_enter })
  const process_started_at = linuxProcessIdentities.identityOf(pid)
  assert.ok(process_started_at !== null, `the test could not read process ${pid}`)
  launchRecordsDirectory(records).keep(member, { member_name: member, node_id: 'ab'.repeat(32), pid, process_started_at })
}

test('#307: add, set-model, set-host and remove each change the declaration, and the added member gets a node id', (t) => {
  const place = aCrew(t)
  const added = martha(place, CREW, ADD, 'scout', BUILDER.role)
  assert.equal(added.status, EXIT_DONE, added.said)
  assert.match(added.said, /scout is on the crew now, as builder\./)
  assert.match(added.said, /is a file of the checkout: commit it when you are ready\./)
  assert.deepEqual(membersOf(place).at(-1), { name: 'scout', role: BUILDER.role })
  const ids = JSON.parse(readFileSync(join(stateOf(place).directory, MEMBERS_FILE), 'utf8')) as Record<string, string>
  assert.match(ids['scout'] ?? '', /^[0-9a-f]+$/)

  assert.equal(martha(place, CREW, SET_MODEL, 'scout', 'a-model').status, EXIT_DONE)
  assert.equal(martha(place, CREW, SET_HOST, 'scout', THE_ENGINES_HOST).status, EXIT_DONE)
  assert.deepEqual(membersOf(place).at(-1), { name: 'scout', role: BUILDER.role, model: 'a-model', host: THE_ENGINES_HOST })
  assert.equal(martha(place, CREW, SET_MODEL, 'scout', HOST_DEFAULT).status, EXIT_DONE)
  assert.equal(membersOf(place).at(-1)!['model'], null)

  const removed = martha(place, CREW, REMOVE, 'scout')
  assert.equal(removed.status, EXIT_DONE, removed.said)
  assert.deepEqual(membersOf(place).map((member) => member['name']), SOLO_MEMBERS.map((member) => member.name))
})

test('#307: a change the reader refuses is refused, and the declaration is left byte for byte as it was', (t) => {
  const place = aCrew(t)
  const before = declarationOf(place)
  const run = martha(place, CREW, ADD, 'scout', 'astronaut')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.match(run.said, /is not a role of this mode/)
  assert.equal(declarationOf(place), before)
})

test('#307: a running member is not removed, and the refusal names martha stop (R2: the stop\'s own reading)', (t) => {
  const place = aCrew(t)
  // A live process that is not above this martha stands as the member's host, so the member reads as running and the
  // act does not read as one run inside a member.
  const host = spawn('sleep', ['30'], { stdio: 'ignore' })
  t.after(() => host.kill())
  aLaunchOf(place, REVIEWER.name, host.pid!)
  const before = declarationOf(place)
  const run = martha(place, CREW, REMOVE, REVIEWER.name.toUpperCase())
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.said.includes(`${REVIEWER.name} is running, so it stays on the crew. Stop it first: martha ${STOP} ${REVIEWER.name}`), run.said)
  assert.equal(declarationOf(place), before)
})

test('#307: a change made inside a member goes ahead, and is written (martha#619, cut to one act at #601)', (t) => {
  const place = aCrew(t)
  // This test's own process stands as the member's host: martha runs below it, as a member's shell would.
  aLaunchOf(place, BUILDER.name, process.pid)
  const run = martha(place, CREW, SET_MODEL, BUILDER.name, 'a-model')
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.match(declarationOf(place), /a-model/)
  // Drawing the strip only reads, so `martha crew` alone is never one of the owner's own acts.
})

test('#307: words no crew verb takes are a usage error, and write nothing', (t) => {
  const place = aCrew(t)
  const before = declarationOf(place)
  for (const words of [[ADD, 'scout'], [REMOVE], [SET_MODEL, BUILDER.name], ['set-focus', BUILDER.name, 'tests'], ['--all']]) {
    assert.equal(martha(place, CREW, ...words).status, EXIT_USAGE, words.join(' '))
  }
  assert.equal(declarationOf(place), before)
})
