// A member's own writes are kept in Martha's state, one line each, and read back whole or not at all (martha#132, #129).
//
// Real directories under a temporary home. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { OWN_WRITE_MODES, ownWritesOfLaunch, type OwnWrite, type OwnWrites } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { openState, OWN_WRITES_FILE, ownWritesKeptIn, STATE_FILE_MODE, type MarthaState } from './keep_martha_state_outside_the_checkout.ts'

const allOwnWrites = (state: MarthaState): OwnWrites => ownWritesKeptIn(state).all()
const appendOwnWrite = (state: MarthaState, write: OwnWrite): { readonly refusal: string } | undefined => {
  const refusal = ownWritesKeptIn(state).append(write)
  return refusal === undefined ? undefined : { refusal }
}
const ofLaunch = (state: MarthaState, launch: string): OwnWrites => ownWritesOfLaunch(ownWritesKeptIn(state), launch)

const PERMISSIONS = 0o777

function stateFor(t: TestContext): { home: string; state: MarthaState } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-own-writes-')))
  t.after(() => rmSync(home, { recursive: true, force: true }))
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
    tool: 'Write',
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

const filePath = (state: MarthaState): string => join(state.directory, OWN_WRITES_FILE)

test('no file of own writes is no own writes', (t) => {
  const { state } = stateFor(t)
  assert.deepEqual(allOwnWrites(state), { writes: [] })
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [] })
})

test('an own write is kept as one line with exactly its eight fields, in a file only the owner may read', (t) => {
  const { state } = stateFor(t)
  const write = ownWrite()
  kept(state, write)
  const lines = readFileSync(filePath(state), 'utf8').split('\n')
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
  assert.equal(lstatSync(filePath(state)).mode & PERMISSIONS, STATE_FILE_MODE)
  assert.deepEqual(allOwnWrites(state), { writes: [write] })
})

test('every own write is read back in the order it was kept, whatever its launch', (t) => {
  const { state } = stateFor(t)
  const writes = [
    ownWrite(),
    ownWrite({ launch: 'launch-2', tool: 'Edit', tool_use_id: 'toolu_2' }),
    ownWrite({ blob: OTHER_SHA1_BLOB, tool: 'NotebookEdit', tool_use_id: 'toolu_3' }),
  ]
  for (const write of writes) kept(state, write)
  assert.deepEqual(allOwnWrites(state), { writes })
})

test("a launch reads only its own writes, and at one path the last kept is the one that counts", (t) => {
  const { state } = stateFor(t)
  const first = ownWrite()
  const elsewhere = ownWrite({ path: '/project/other.txt', tool_use_id: 'toolu_2' })
  const otherLaunch = ownWrite({ path: '/project/third.txt', launch: 'launch-2', tool_use_id: 'toolu_3' })
  const later = ownWrite({ blob: OTHER_SHA1_BLOB, mode: OWN_WRITE_MODES[1], tool: 'Edit', tool_use_id: 'toolu_4' })
  for (const write of [first, elsewhere, otherLaunch, later]) kept(state, write)
  assert.deepEqual(ofLaunch(state, 'launch-1'), { writes: [elsewhere, later] })
  assert.deepEqual(ofLaunch(state, 'launch-2'), { writes: [otherLaunch] })
  assert.deepEqual(ofLaunch(state, 'launch-3'), { writes: [] })
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
  test(`a line with ${what} refuses the whole file, naming it and the line`, (t) => {
    const { state } = stateFor(t)
    kept(state, ownWrite())
    writeFileSync(filePath(state), `${line}\n`, { flag: 'a' })
    const expected = { refusal: `${filePath(state)} line 2 is not an own write, so Martha reads none of it.` }
    assert.deepEqual(allOwnWrites(state), expected)
    assert.deepEqual(ofLaunch(state, 'launch-1'), expected)
  })
}

test('a link in place of the file is refused, read or appended to, and the file it points at is left alone', (t) => {
  const { home, state } = stateFor(t)
  const target = join(home, 'elsewhere.jsonl')
  writeFileSync(target, `${JSON.stringify(ownWrite())}\n`, { mode: STATE_FILE_MODE })
  symlinkSync(target, filePath(state))
  assert.ok('refusal' in allOwnWrites(state))
  assert.ok('refusal' in ofLaunch(state, 'launch-1'))
  const appended = appendOwnWrite(state, ownWrite())
  assert.ok(appended !== undefined && /could not be opened to append to \(ELOOP\), so Martha keeps no own write in it\./.test(appended.refusal))
  assert.equal(readFileSync(target, 'utf8'), `${JSON.stringify(ownWrite())}\n`)
})

test('a file others may read is refused, read or appended to', (t) => {
  const { state } = stateFor(t)
  kept(state, ownWrite())
  chmodSync(filePath(state), 0o644)
  assert.deepEqual(allOwnWrites(state), {
    refusal: `${filePath(state)} is not a file only this user may read and write, so Martha does not trust it.`,
  })
  assert.deepEqual(appendOwnWrite(state, ownWrite()), {
    refusal: `${filePath(state)} is not a file only this user may read and write, so Martha keeps no own write in it.`,
  })
})
