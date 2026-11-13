// A member's own writes are kept in Martha's state, one file per launch and one line per write, and read back whole
// or not at all (martha#132, #129, #162).
//
// Real directories under a temporary home. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import fs, { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { OWN_WRITE_MODES, ownWritesOfLaunch, type OwnWrite, type OwnWrites } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import {
  openState,
  OWN_WRITES_LAUNCHES_KEPT,
  START_AGAIN,
  WHAT_A_SIGNED_RUN_NEEDS,
  OWN_WRITES_PLACE,
  OWN_WRITES_SUFFIX,
  ownWritesKeptForLaunch,
  ownWritesKeptForTheHistory,
  pruneOwnWritesOfOldLaunches,
  STATE_FILE_MODE,
  type MarthaState,
} from './keep_martha_state_outside_the_checkout.ts'
import { EDIT_TOOL, NOTEBOOK_EDIT_TOOL, WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'

const ownWritesDirectory = (state: MarthaState): string => join(state.directory, OWN_WRITES_PLACE)

/** A launch as the name of its own-writes file, which is how this file names launches: no dot, no path. */
const fileNameOfLaunch = (launch: string): string => `${encodeURIComponent(launch).replaceAll('.', '%2E')}${OWN_WRITES_SUFFIX}`

const filePath = (state: MarthaState, launch: string): string => join(ownWritesDirectory(state), fileNameOfLaunch(launch))
const allOwnWrites = (state: MarthaState): OwnWrites => ownWritesKeptForTheHistory(state).all()
const ofLaunch = (state: MarthaState, launch: string): OwnWrites => ownWritesOfLaunch(ownWritesKeptForLaunch(state, launch), launch)
const appendOwnWrite = (state: MarthaState, write: OwnWrite): { readonly refusal: string } | undefined => {
  const refusal = ownWritesKeptForTheHistory(state).append(write)
  return refusal === undefined ? undefined : { refusal }
}

const PERMISSIONS = 0o777
const NEWLINE = '\n'

function stateFor(t: TestContext): { home: string; state: MarthaState } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-own-writes-')))
  t.after(() => removeTheTree(home))
  const project = join(home, 'project')
  mkdirSync(project)
  const state = openState(join(home, 'state'), project)
  assert.ok('directory' in state, 'refusal' in state ? state.refusal : '')
  return { home, state }
}

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

function kept(state: MarthaState, write: OwnWrite): void {
  assert.equal(appendOwnWrite(state, write), undefined)
}

test('no file of own writes is no own writes', (t) => {
  const { state } = stateFor(t)
  assert.deepEqual(allOwnWrites(state), { writes: [], unread: [] })
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [] })
})

test('an own write is kept in a file named for its launch, as one line with exactly its eight fields, in a file only the owner may read', (t) => {
  const { state } = stateFor(t)
  const write = ownWrite()
  kept(state, write)
  const lines = readFileSync(filePath(state, 'launch-1'), 'utf8').split(NEWLINE)
  assert.deepEqual(lines, [JSON.stringify(write), ''])
  assert.deepEqual(Object.keys(JSON.parse(lines[0] ?? '')).sort(), [
    'blob',
    'launch',
    'mode',
    'path',
    'recorded_at',
    'session',
    'tool',
    'tool_use_id',
  ])
  assert.equal(lstatSync(filePath(state, 'launch-1')).mode & PERMISSIONS, STATE_FILE_MODE)
  assert.deepEqual(allOwnWrites(state), { writes: [write], unread: [] })
})

test('every launch is read back in the order of its first record, and one path keeps the last write made to it (martha#157)', (t) => {
  const { state } = stateFor(t)
  const first = ownWrite({ recorded_at: new Date(1000).toISOString() })
  const ofAnother = ownWrite({ launch: 'launch-2', tool: EDIT_TOOL, tool_use_id: 'toolu_2', recorded_at: new Date(2000).toISOString() })
  // A second write to a path the launch already wrote replaces it, so the history gives the bytes the checkout holds.
  const later = ownWrite({ blob: OTHER_SHA1_BLOB, tool: NOTEBOOK_EDIT_TOOL, tool_use_id: 'toolu_3', recorded_at: new Date(3000).toISOString() })
  for (const write of [first, ofAnother, later]) kept(state, write)
  assert.deepEqual(allOwnWrites(state), { writes: [ofAnother, later], unread: [] })
  assert.equal(readFileSync(filePath(state, 'launch-1'), 'utf8'), `${JSON.stringify(later)}${NEWLINE}`)
})

test('a launch reads only its own writes, and at one path the last kept is the one that counts, out of a file of its own', (t) => {
  const { state } = stateFor(t)
  const first = ownWrite()
  const elsewhere = ownWrite({ path: '/project/other.txt', tool_use_id: 'toolu_2' })
  const otherLaunch = ownWrite({ path: '/project/third.txt', launch: 'launch-2', tool_use_id: 'toolu_3' })
  const later = ownWrite({ blob: OTHER_SHA1_BLOB, mode: OWN_WRITE_MODES[1], tool: EDIT_TOOL, tool_use_id: 'toolu_4' })
  for (const write of [first, elsewhere, otherLaunch, later]) kept(state, write)
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [elsewhere, later] })
  assert.deepEqual(ofLaunch(state, 'launch-2'), { writes: [otherLaunch] })
  assert.deepEqual(ofLaunch(state, 'launch-3'), { writes: [] })
  assert.equal(readdirSync(ownWritesDirectory(state)).length, 2)
})

test("a launch's own writes are kept in a file named for the launch, and a launch whose name is a path is still no path", (t) => {
  const { state } = stateFor(t)
  const write = ownWrite({ launch: '../launch-1' })
  kept(state, write)
  assert.deepEqual(readdirSync(ownWritesDirectory(state)), [fileNameOfLaunch('../launch-1')])
  assert.equal(fileNameOfLaunch('../launch-1').includes('/'), false)
  assert.deepEqual(ofLaunch(state, '../launch-1'), { writes: [write] })
})

test('an own write kept under no launch at all is refused, and keeps nothing', (t) => {
  const { state } = stateFor(t)
  const refused = appendOwnWrite(state, ownWrite({ launch: '' }))
  assert.deepEqual(refused, {
    refusal: 'An own write is kept under the launch that made it, and an empty name is not a launch.',
  })
  assert.deepEqual(allOwnWrites(state), { writes: [], unread: [] })
})

const MALFORMED: ReadonlyArray<readonly [string, string]> = [
  ['not JSON', '{"path":'],
  ['a field too many', JSON.stringify({ ...ownWrite(), extra: 1 })],
  ['a field missing', JSON.stringify(Object.fromEntries(Object.entries(ownWrite()).filter(([key]) => key !== 'session')))],
  ['a relative path', JSON.stringify(ownWrite({ path: 'hello.txt' }))],
  ['a blob that is not a git object id', JSON.stringify(ownWrite({ blob: 'hello' }))],
  ['a link mode', JSON.stringify({ ...ownWrite(), mode: '120000' })],
  ['a gitlink mode', JSON.stringify({ ...ownWrite(), mode: '160000' })],
  ['an empty tool', JSON.stringify(ownWrite({ tool: '' }))],
  ['an empty tool_use_id', JSON.stringify(ownWrite({ tool_use_id: '' }))],
  ['an empty session', JSON.stringify(ownWrite({ session: '' }))],
  ['an empty launch', JSON.stringify(ownWrite({ launch: '' }))],
  ['a time that is not an instant', JSON.stringify(ownWrite({ recorded_at: 'yesterday' }))],
  ['a number for a path', JSON.stringify({ ...ownWrite(), path: 7 })],
  ['an array', '[]'],
]

for (const [what, line] of MALFORMED) {
  test(`a line with ${what} refuses that launch's own writes and no other launch's, naming it and the line (martha#162)`, (t) => {
    const { state } = stateFor(t)
    kept(state, ownWrite())
    const other = ownWrite({ launch: 'launch-2', tool_use_id: 'toolu_2' })
    kept(state, other)
    writeFileSync(filePath(state, 'launch-1'), `${line}${NEWLINE}`, { flag: 'a' })
    const why = `${filePath(state, 'launch-1')} line 2 is not an own write, so Martha reads none of this launch's own writes.`
    const expected = { refusal: `${why} ${START_AGAIN}` }
    assert.deepEqual(ofLaunch(state, 'launch-1'), expected)
    assert.deepEqual(ofLaunch(state, 'launch-2'), { writes: [other] })
    // The whole history reads past the torn launch and names it; it does not refuse the project's other launches
    // (martha#162 r=4). Its way back is the signed run's, not a new start, which cannot help there (r=5).
    assert.deepEqual(allOwnWrites(state), { writes: [other], unread: [`${why} ${WHAT_A_SIGNED_RUN_NEEDS}`] })
  })
}

test("a torn last line is read for what the writer finished, and the launch's own writes are not refused (martha#157)", (t) => {
  const { state } = stateFor(t)
  const first = ownWrite()
  kept(state, first)
  const other = ownWrite({ launch: 'launch-2', tool_use_id: 'toolu_2' })
  kept(state, other)
  const torn = JSON.stringify(ownWrite({ blob: OTHER_SHA1_BLOB, tool_use_id: 'toolu_3' })).slice(0, 40)
  writeFileSync(filePath(state, 'launch-1'), torn, { flag: 'a' })
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [first] })
  assert.deepEqual(ofLaunch(state, 'launch-2'), { writes: [other] })
  assert.deepEqual(allOwnWrites(state), { writes: [first, other], unread: [] })
})

test('a torn last line is cut off before the next record is kept, so the launch reads on with what it really kept (martha#162)', (t) => {
  const { state } = stateFor(t)
  const first = ownWrite()
  kept(state, first)
  const torn = JSON.stringify(ownWrite({ blob: OTHER_SHA1_BLOB, tool_use_id: 'toolu_2' })).slice(0, 40)
  writeFileSync(filePath(state, 'launch-1'), torn, { flag: 'a' })
  const next = ownWrite({ path: '/project/next.txt', tool_use_id: 'toolu_3' })
  kept(state, next)
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [first, next] })
  assert.equal(readFileSync(filePath(state, 'launch-1'), 'utf8'), `${JSON.stringify(first)}${NEWLINE}${JSON.stringify(next)}${NEWLINE}`)
})

test('a launch whose file is nothing but a torn line keeps its next record and nothing of the torn one (martha#162)', (t) => {
  const { state } = stateFor(t)
  const torn = JSON.stringify(ownWrite({ blob: OTHER_SHA1_BLOB, tool_use_id: 'toolu_2' })).slice(0, 40)
  mkdirSync(ownWritesDirectory(state), { recursive: true, mode: 0o700 })
  writeFileSync(filePath(state, 'launch-1'), torn, { mode: STATE_FILE_MODE })
  const next = ownWrite({ path: '/project/next.txt', tool_use_id: 'toolu_3' })
  kept(state, next)
  assert.equal(readFileSync(filePath(state, 'launch-1'), 'utf8'), `${JSON.stringify(next)}${NEWLINE}`)
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [next] })
})

test('a record whose path is not ASCII survives the cut that drops a torn line after it (martha#162 r=1)', (t) => {
  const { state } = stateFor(t)
  const first = ownWrite({ path: '/project/日本/é.txt', tool_use_id: 'toolu_1' })
  kept(state, first)
  const torn = JSON.stringify(ownWrite({ blob: OTHER_SHA1_BLOB, tool_use_id: 'toolu_2' })).slice(0, 40)
  writeFileSync(filePath(state, 'launch-1'), torn, { flag: 'a' })
  const next = ownWrite({ path: '/project/next.txt', tool_use_id: 'toolu_3' })
  kept(state, next)
  assert.equal(readFileSync(filePath(state, 'launch-1'), 'utf8'), `${JSON.stringify(first)}${NEWLINE}${JSON.stringify(next)}${NEWLINE}`)
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [first, next] })
})

test('a record the disk would not take at all is refused as it happens, and leaves nothing behind (martha#162)', (t) => {
  const { state } = stateFor(t)
  const first = ownWrite()
  kept(state, first)
  const real = fs.writeSync
  fs.writeSync = (() => {
    throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
  }) as typeof fs.writeSync
  try {
    assert.deepEqual(appendOwnWrite(state, ownWrite({ blob: OTHER_SHA1_BLOB, tool_use_id: 'toolu_2' })), {
      refusal: `${filePath(state, 'launch-1')} could not be written (ENOSPC), so Martha keeps no own write in it.`,
    })
  } finally {
    fs.writeSync = real
  }
  assert.equal(readFileSync(filePath(state, 'launch-1'), 'utf8'), `${JSON.stringify(first)}${NEWLINE}`)
})

test("a launch's own store keeps no write another launch made, in a file named for the launch it was asked for (martha#162)", (t) => {
  const { state } = stateFor(t)
  const elsewhere = ownWrite({ launch: 'launch-2', tool_use_id: 'toolu_2' })
  assert.equal(
    ownWritesKeptForLaunch(state, 'launch-1').append(elsewhere),
    `An own write of another launch is not kept in ${filePath(state, 'launch-1')}.`,
  )
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [] })
  assert.deepEqual(ofLaunch(state, 'launch-2'), { writes: [] })
})

test('a record kept only in part is refused when it happens, and leaves no half record behind (martha#162)', (t) => {
  const { state } = stateFor(t)
  const first = ownWrite()
  kept(state, first)
  const cut = JSON.stringify(ownWrite({ blob: OTHER_SHA1_BLOB, tool_use_id: 'toolu_2' }))
  const real = fs.writeSync
  fs.writeSync = ((descriptor: number, text: string) => real(descriptor, text.slice(0, 20))) as typeof fs.writeSync
  try {
    assert.deepEqual(appendOwnWrite(state, ownWrite({ blob: OTHER_SHA1_BLOB, tool_use_id: 'toolu_2' })), {
      refusal: `${filePath(state, 'launch-1')} kept only 20 of the ${Buffer.byteLength(`${cut}${NEWLINE}`)} bytes of an own write, so Martha keeps none of it.`,
    })
  } finally {
    fs.writeSync = real
  }
  assert.equal(readFileSync(filePath(state, 'launch-1'), 'utf8'), `${JSON.stringify(first)}${NEWLINE}`)
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [first] })
})

test('the launches past the newest ones kept are pruned away, and the newest are left, in one call (martha#162)', (t) => {
  const { state } = stateFor(t)
  const launches = Array.from({ length: OWN_WRITES_LAUNCHES_KEPT + 2 }, (_, index) => `launch-${index}`)
  for (const [index, launch] of launches.entries()) {
    kept(state, ownWrite({ launch, tool_use_id: `toolu_${index}` }))
    const when = new Date(index * 1000)
    utimesSync(filePath(state, launch), when, when)
  }
  assert.deepEqual(pruneOwnWritesOfOldLaunches(state), [])
  const left = new Set(readdirSync(ownWritesDirectory(state)))
  assert.equal(left.size, OWN_WRITES_LAUNCHES_KEPT)
  assert.equal(left.has(fileNameOfLaunch(launches[0]!)), false)
  assert.equal(left.has(fileNameOfLaunch(launches[1]!)), false)
  assert.equal(left.has(fileNameOfLaunch(launches[launches.length - 1]!)), true)
})

test('nothing is pruned while the launches kept are no more than the ones Martha keeps (martha#162)', (t) => {
  const { state } = stateFor(t)
  for (let index = 0; index < OWN_WRITES_LAUNCHES_KEPT; index++) kept(state, ownWrite({ launch: `launch-${index}`, tool_use_id: `toolu_${index}` }))
  assert.deepEqual(pruneOwnWritesOfOldLaunches(state), [])
  assert.equal(readdirSync(ownWritesDirectory(state)).length, OWN_WRITES_LAUNCHES_KEPT)
})

test('the history reads every launch kept, each launch in the order it kept them, the launches in the order of their first record (martha#162)', (t) => {
  const { state } = stateFor(t)
  // The launch whose first record came later is named first, so a history read that goes by the file names reads it
  // first: only the first record's time puts alpha after zulu.
  const first = ownWrite({ launch: 'zulu', recorded_at: new Date(1000).toISOString() })
  const elsewhere = ownWrite({ launch: 'alpha', tool_use_id: 'toolu_2', recorded_at: new Date(3000).toISOString() })
  const later = ownWrite({ launch: 'zulu', path: '/project/later.txt', recorded_at: new Date(2000).toISOString(), blob: OTHER_SHA1_BLOB, tool_use_id: 'toolu_3' })
  for (const write of [first, elsewhere, later]) kept(state, write)
  assert.deepEqual(allOwnWrites(state), { writes: [first, later, elsewhere], unread: [] })
})

test('a link in place of the file is refused, read or appended to, and the file it points at is left alone', (t) => {
  const { home, state } = stateFor(t)
  const target = join(home, 'elsewhere.jsonl')
  writeFileSync(target, `${JSON.stringify(ownWrite())}${NEWLINE}`, { mode: STATE_FILE_MODE })
  mkdirSync(ownWritesDirectory(state), { recursive: true, mode: 0o700 })
  symlinkSync(target, filePath(state, 'launch-1'))
  const read = ofLaunch(state, 'launch-1')
  assert.ok('refusal' in read)
  // The history reads past the file it cannot trust and names it, rather than refusing the whole project (martha#162 r=4).
  assert.deepEqual(allOwnWrites(state), { writes: [], unread: ['refusal' in read ? read.refusal : ''] })
  const appended = appendOwnWrite(state, ownWrite())
  assert.ok(appended !== undefined && /could not be read \(ELOOP\)\./.test(appended.refusal), String(appended?.refusal))
  assert.equal(readFileSync(target, 'utf8'), `${JSON.stringify(ownWrite())}${NEWLINE}`)
})

test('a file others may read is refused, read or appended to', (t) => {
  const { state } = stateFor(t)
  kept(state, ownWrite())
  chmodSync(filePath(state, 'launch-1'), 0o644)
  assert.deepEqual(ofLaunch(state, 'launch-1'), {
    refusal: `${filePath(state, 'launch-1')} is not a file only this user may read and write, so Martha does not trust it.`,
  })
  assert.deepEqual(appendOwnWrite(state, ownWrite()), {
    refusal: `${filePath(state, 'launch-1')} is not a file only this user may read and write, so Martha does not trust it.`,
  })
})
