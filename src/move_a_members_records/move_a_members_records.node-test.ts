// `martha rename <Old> <New>`: the declaration changes first, and what the member left moves with its name
// (martha#985, gap 20 of #957).
//
// Each test runs the real bin/martha in a checkout of its own. What a rename is judged on is the reader that would use
// the records after it: the stamps a wake reads its newest handover by, the dashboard row the crew's buttons show, the
// park a start reads, and the node id a name keeps — never the file names alone.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { DECLARATION_DIRECTORY, DECLARATION_FILE, SOLO_MEMBERS } from '../declare_crew/declare_crew.ts'
import { keepTheCrewsFilesAsDirectories, handoverStampsIn } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { CREW_ROW_PLACE, MEMBERS_FILE, crewStateDirectory, openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { stateRootOf } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { EXIT_DONE, EXIT_REFUSED } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import { HANDOVERS_PLACE, theHandoverFile } from '../write_my_handover/write_my_handover.ts'
import { theNewestHandover } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { theRowWithNothingSaid } from '../show_dashboard_beat/show_dashboard_beat.ts'

const MARTHA = join(import.meta.dirname, '..', '..', 'bin', 'martha')
const AT = new Date('2026-11-20T12:00:00Z')

interface Place {
  readonly home: string
  readonly root: string
}

function aPlace(t: TestContext): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-rename-')))
  t.after(() => removeTheTree(home))
  const root = join(home, 'project')
  mkdirSync(root)
  execFileSync('git', ['init', '-q', '.'], { cwd: root })
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Ada Owner\n')
  return { home, root }
}

function martha(place: Place, ...args: string[]) {
  const run = spawnSync(process.execPath, [MARTHA, ...args], {
    cwd: place.root,
    encoding: 'utf8',
    input: '',
    env: { PATH: process.env.PATH ?? '', HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1' },
  })
  return { status: run.status, out: run.stdout, err: run.stderr, said: `${run.stdout}${run.stderr}` }
}

/** The crew's own places, read the way the launcher reads them. */
function placesOf(place: Place): { readonly state: string; readonly crew: string; readonly declaration: string } {
  const opened = openState(stateRootOf(place.home, join(place.home, 'state')), place.root)
  if ('refusal' in opened) throw new Error(String(opened.refusal))
  const crew = crewStateDirectory(opened.state_root, place.root)
  if ('refusal' in crew) throw new Error(String(crew.refusal))
  return { state: opened.directory, crew: crew.path, declaration: join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE) }
}

/** The node ids Martha keeps, by name. */
function nodeIds(place: Place): Readonly<Record<string, string>> {
  const { state } = placesOf(place)
  return existsSync(join(state, MEMBERS_FILE)) ? (JSON.parse(readFileSync(join(state, MEMBERS_FILE), 'utf8')) as Record<string, string>) : {}
}

/** A member of the crew, added the way an owner adds one, so it has a node id of its own. */
function added(place: Place, name: string): void {
  const run = martha(place, 'crew', 'add', name, 'builder')
  assert.equal(run.status, EXIT_DONE, run.said)
}

test('a rename keeps the member\'s node id under the new name, and leaves the old name nowhere', (t) => {
  const place = aPlace(t)
  assert.equal(martha(place, 'init').status, EXIT_DONE)
  added(place, 'Scout')
  const id = nodeIds(place)['Scout']
  assert.match(id ?? '', /^[0-9a-f]{64}$/)
  const run = martha(place, 'rename', 'Scout', 'Runner')
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.equal(nodeIds(place)['Runner'], id, 'the same id, under the new name')
  assert.equal(nodeIds(place)['Scout'], undefined, 'the old name holds no id')
  const declared = JSON.parse(readFileSync(placesOf(place).declaration, 'utf8')) as { members: { name: string }[] }
  assert.ok(declared.members.some((member) => member.name === 'Runner'), 'the declaration names the new name')
  assert.ok(!declared.members.some((member) => member.name === 'Scout'), 'and not the old one')
})

test('a rename leaves the handover the old name wrote as one the new name resumes (mutant: the stamp not rewritten)', (t) => {
  const place = aPlace(t)
  assert.equal(martha(place, 'init').status, EXIT_DONE)
  added(place, 'Scout')
  const { crew } = placesOf(place)
  const handovers = keepTheCrewsFilesAsDirectories(crew).place(HANDOVERS_PLACE)
  assert.ok(!('refusal' in handovers))
  const file = join(handovers.path, theHandoverFile('Scout', AT))
  assert.equal(handovers.keep(theHandoverFile('Scout', AT), 'the work Scout left\n'), undefined)
  assert.equal(handoverStampsIn(crew).write(file, { member: 'Scout', predecessor_id: 'a-session', written_at: AT.toISOString(), digest: 'digest', record_length: 0, record_digest: 'record' }), undefined)

  assert.equal(martha(place, 'rename', 'Scout', 'Runner').status, EXIT_DONE)
  const wake = theNewestHandover(handovers, handoverStampsIn(crew), 'Runner')
  assert.equal(wake.kind, 'a_handover', wake.kind === 'unreadable' ? wake.refusal : '')
  if (wake.kind !== 'a_handover') return
  assert.match(wake.handover.file, /_Runner\.md$/)
  assert.equal(wake.handover.content, 'the work Scout left\n', 'the successor resumes what the predecessor left')
})

test('a rename moves the dashboard row and the park the old name had (mutant: the row left under the old name)', (t) => {
  const place = aPlace(t)
  assert.equal(martha(place, 'init').status, EXIT_DONE)
  added(place, 'Scout')
  const { crew } = placesOf(place)
  mkdirSync(join(crew, CREW_ROW_PLACE), { recursive: true })
  const rows = dashboardRowsIn(join(crew, CREW_ROW_PLACE))
  assert.equal(rows.change('Scout', (held) => ({ ...(held ?? { member: 'Scout', session: 'a-session', at: AT.getTime(), ...theRowWithNothingSaid() }) })).kept, true)
  assert.equal(martha(place, 'rename', 'Scout', 'Runner').status, EXIT_DONE)
  assert.notEqual(dashboardRowsIn(join(crew, CREW_ROW_PLACE)).read('Runner'), null, 'the new name has the row')
})

test('each refusal leaves the declaration, the node ids and the records as they were', (t) => {
  const place = aPlace(t)
  assert.equal(martha(place, 'init').status, EXIT_DONE)
  added(place, 'Scout')
  const before = { declaration: readFileSync(placesOf(place).declaration, 'utf8'), ids: JSON.stringify(nodeIds(place)) }
  for (const [what, words] of [
    ['not a plain name', ['rename', 'Scout', 'not a name']],
    ['the same name', ['rename', 'Scout', 'scout']],
    ['one already on the crew', ['rename', 'Scout', SOLO_MEMBERS[0]!.name]],
    ['one the declaration does not know', ['rename', 'Nobody', 'Runner']],
  ] as const) {
    const run = martha(place, ...words)
    assert.equal(run.status, EXIT_REFUSED, `${what}: ${run.said}`)
    assert.equal(readFileSync(placesOf(place).declaration, 'utf8'), before.declaration, `${what}: the declaration is untouched`)
    assert.equal(JSON.stringify(nodeIds(place)), before.ids, `${what}: the ids are untouched`)
  }
})
