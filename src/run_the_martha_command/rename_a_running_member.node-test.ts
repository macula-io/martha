// `martha rename <Old> <New>` refuses a member that is running (martha#985, gap 20 of #957; review r=1).
//
// The test lives with the launcher's other acts because it plants a launch record, and the launcher is the one slice
// that writes those: `martha crew remove` reads a member's running state the same way, and its test plants it the same
// way. What it holds is the refusal's own words and that a refusal before the declaration leaves the declaration and
// the node ids untouched.

import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { MEMBERS_FILE, openState, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { THE_PLACES_A_STATE_ROOT_KEEPS } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { EXIT_DONE, EXIT_REFUSED } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import { STOP } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'

const MARTHA = join(import.meta.dirname, '..', '..', 'bin', 'martha')

interface Place {
  readonly home: string
  readonly root: string
}

/** A checkout with a crew `martha init` declared. */
function aCrew(t: TestContext): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-rename-running-')))
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
    env: { PATH: process.env.PATH ?? '', HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1' },
  })
  return { status: run.status, said: `${run.stdout}${run.stderr}` }
}

/** The state this place's crew keeps, as the launcher opens it. */
function stateDirectory(place: Place): string {
  const state = openState(join(place.home, 'state', STATE_ROOT_NAME), place.root)
  assert.ok(!('refusal' in state), 'refusal' in state ? String(state.refusal) : '')
  return state.directory
}

/** A launch of `member` recorded as the launcher records one, whose host is `pid`: the member reads as running. */
function aLaunchOf(place: Place, member: string, pid: number): void {
  const records = join(stateDirectory(place), THE_PLACES_A_STATE_ROOT_KEEPS.records_place)
  mkdirSync(records, { recursive: true, mode: THE_PLACES_A_STATE_ROOT_KEEPS.only_its_owner_may_enter })
  const process_started_at = linuxProcessIdentities.identityOf(pid)
  assert.ok(process_started_at !== null, `the test could not read process ${pid}`)
  launchRecordsDirectory(records).keep(member, { member_name: member, node_id: 'ab'.repeat(32), pid, process_started_at })
}

const declarationOf = (place: Place): string => readFileSync(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')
const idsOf = (place: Place): string => readFileSync(join(stateDirectory(place), MEMBERS_FILE), 'utf8')

test('a member that is running is not renamed, and the refusal names martha stop (R2: the stop\'s own reading)', (t) => {
  const place = aCrew(t)
  assert.equal(martha(place, 'crew', 'add', 'Scout', 'builder').status, EXIT_DONE)
  // A live process that is not above this martha stands as the member's host, so the member reads as running.
  const host = spawn('sleep', ['30'], { stdio: 'ignore' })
  t.after(() => host.kill())
  aLaunchOf(place, 'Scout', host.pid!)
  const before = { declaration: declarationOf(place), ids: idsOf(place) }

  const run = martha(place, 'rename', 'Scout', 'Runner')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.said.includes(`Scout is running, so it stays on the crew. Stop it first: martha ${STOP} Scout`), run.said)
  assert.equal(declarationOf(place), before.declaration, 'the declaration is untouched')
  assert.equal(idsOf(place), before.ids, 'the node ids are untouched')
})
