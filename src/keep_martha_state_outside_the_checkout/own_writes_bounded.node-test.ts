// The tests martha#157 adds: a torn tail is read for what it finished, and one path takes one line.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { OWN_WRITE_MODES, ownWritesOfLaunch, type OwnWrite, type OwnWrites } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import {
  openState,
  OWN_WRITES_PLACE,
  OWN_WRITES_SUFFIX,
  ownWritesKeptForLaunch,
  ownWritesKeptForTheHistory,
  START_AGAIN,
  STATE_FILE_MODE,
  WHAT_A_SIGNED_RUN_NEEDS,
  type MarthaState,
} from './keep_martha_state_outside_the_checkout.ts'
import { EDIT_TOOL, WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'

const NEWLINE = '\n'

const ownWritesDirectory = (state: MarthaState): string => join(state.directory, OWN_WRITES_PLACE)

const fileNameOfLaunch = (launch: string): string => `${encodeURIComponent(launch).replaceAll('.', '%2E')}${OWN_WRITES_SUFFIX}`

const filePath = (state: MarthaState, launch: string): string => join(ownWritesDirectory(state), fileNameOfLaunch(launch))

const ofLaunch = (state: MarthaState, launch: string): OwnWrites => ownWritesOfLaunch(ownWritesKeptForLaunch(state, launch), launch)

const allOwnWrites = (state: MarthaState): OwnWrites => ownWritesKeptForTheHistory(state).all()

const SHA1_BLOB = 'ce013625030ba8dba906f756967f9e9ca394464a'
const OTHER_SHA1_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'

function ownWrite(fields: Partial<OwnWrite> = {}): OwnWrite {
  return {
    path: '/project/hello.txt',
    blob: SHA1_BLOB,
    mode: OWN_WRITE_MODES[0],
    tool: WHOLE_FILE_TOOL,
    tool_use_id: 'toolu_1',
    session: 'session-1',
    launch: 'launch-1',
    recorded_at: new Date(0).toISOString(),
    ...fields,
  }
}

function stateFor(t: TestContext): MarthaState {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-own-writes-bounded-')))
  t.after(() => removeTheTree(home))
  const project = join(home, 'project')
  mkdirSync(project)
  const state = openState(join(home, 'state'), project)
  assert.ok('directory' in state, 'refusal' in state ? state.refusal : '')
  return state
}

function kept(state: MarthaState, write: OwnWrite): void {
  assert.equal(ownWritesKeptForTheHistory(state).append(write), undefined)
}

test('a complete last line whose newline was lost is kept, so a crash does not drop a write it finished (martha#157)', (t) => {
  const state = stateFor(t)
  const first = ownWrite()
  const lost = ownWrite({ path: '/project/next.txt', blob: OTHER_SHA1_BLOB, tool: EDIT_TOOL, tool_use_id: 'toolu_2' })
  mkdirSync(ownWritesDirectory(state), { recursive: true, mode: 0o700 })
  writeFileSync(filePath(state, 'launch-1'), `${JSON.stringify(first)}${NEWLINE}${JSON.stringify(lost)}`, { mode: STATE_FILE_MODE })
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [first, lost] })
  // The next write keeps it too, and gives it back the newline it lost rather than dropping it (martha#157).
  const next = ownWrite({ path: '/project/third.txt', tool_use_id: 'toolu_3' })
  kept(state, next)
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [first, lost, next] })
  assert.equal(readFileSync(filePath(state, 'launch-1'), 'utf8'), `${JSON.stringify(first)}${NEWLINE}${JSON.stringify(lost)}${NEWLINE}${JSON.stringify(next)}${NEWLINE}`)
})

test('a bad line with a newline after it still refuses the file, whether it is last or in the middle (martha#157)', (t) => {
  const state = stateFor(t)
  kept(state, ownWrite())
  writeFileSync(filePath(state, 'launch-1'), `not an own write${NEWLINE}${JSON.stringify(ownWrite({ tool_use_id: 'toolu_2' }))}${NEWLINE}`, { flag: 'a' })
  const why = `${filePath(state, 'launch-1')} line 2 is not an own write, so Martha reads none of this launch's own writes.`
  assert.deepEqual(ofLaunch(state, 'launch-1'), { refusal: `${why} ${START_AGAIN}` })
  assert.deepEqual(allOwnWrites(state), { writes: [], unread: [`${why} ${WHAT_A_SIGNED_RUN_NEEDS}`] })
})

test('a launch that writes one path two hundred times keeps one line for it, and still gives the latest (martha#157)', (t) => {  const state = stateFor(t)
  const blobs = Array.from({ length: 200 }, (_, index) => index.toString(16).padStart(40, '0'))
  for (const [index, blob] of blobs.entries()) kept(state, ownWrite({ blob, tool_use_id: `toolu_${index}` }))
  const elsewhere = ownWrite({ path: '/project/elsewhere.txt', tool_use_id: 'toolu_elsewhere' })
  kept(state, elsewhere)
  const lines = readFileSync(filePath(state, 'launch-1'), 'utf8').split(NEWLINE).filter((line) => line !== '')
  assert.equal(lines.length, 2, `the file holds one line for each path, not one for each write: ${String(lines.length)}`)
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [ownWrite({ blob: blobs[199] as string, tool_use_id: 'toolu_199' }), elsewhere] })
})

test('an append onto a file that cannot be trusted is refused, and leaves the file exactly as it was (martha#157)', (t) => {
  const state = stateFor(t)
  kept(state, ownWrite())
  writeFileSync(filePath(state, 'launch-1'), `not an own write${NEWLINE}`, { flag: 'a' })
  const before = readFileSync(filePath(state, 'launch-1'), 'utf8')
  assert.equal(ownWritesKeptForTheHistory(state).append(ownWrite({ tool_use_id: 'toolu_2' })), `${filePath(state, 'launch-1')} line 2 is not an own write, so Martha keeps no own write in it.`)
  assert.equal(readFileSync(filePath(state, 'launch-1'), 'utf8'), before, 'a refused append rewrote the file')
})
