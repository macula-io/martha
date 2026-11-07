import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OWN_WRITE_MODES } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { treeTheRunMaySee, type BaseEntry, type LiveEntry } from './whose_tree.ts'

const [REGULAR, EXECUTABLE] = OWN_WRITE_MODES
// git's modes for a symbolic link and a submodule: entries that are not a regular file.
const SYMLINK = '120000'
const GITLINK = '160000'

const blob = (char: string) => char.repeat(40)
const base = (path: string, id: string, mode: string = REGULAR): BaseEntry => ({ path, mode, blob: id })
const file = (path: string, id: string, mode: string = REGULAR): LiveEntry => ({ path, regular: true, mode, blob: id })
const own = (path: string, id: string, mode: string = REGULAR) => ({ path, blob: id, mode })

test('a live tree equal to the base passes, and every file is copied', () => {
  const seen = treeTheRunMaySee({ base: [base('a.ts', blob('1')), base('b.ts', blob('2'), EXECUTABLE)], own_writes: [], live: [file('a.ts', blob('1')), file('b.ts', blob('2'), EXECUTABLE)] })
  assert.deepEqual(seen.refusals, [])
  assert.deepEqual(seen.files.map((f) => f.path), ['a.ts', 'b.ts'])
})

test('a file neither base nor own write is refused by path', () => {
  const seen = treeTheRunMaySee({ base: [base('a.ts', blob('1'))], own_writes: [], live: [file('a.ts', blob('9')), file('planted.ts', blob('3'))] })
  assert.deepEqual(seen.refusals.map((r) => r.path), ['a.ts', 'planted.ts'])
})

test('a file the member wrote, in any session, passes; at another path it does not', () => {
  const live = [file('a.ts', blob('9')), file('new.ts', blob('3'))]
  const passes = treeTheRunMaySee({ base: [base('a.ts', blob('1'))], own_writes: [own('a.ts', blob('8')), own('a.ts', blob('9')), own('new.ts', blob('3'))], live })
  assert.deepEqual(passes.refusals, [])
  const elsewhere = treeTheRunMaySee({ base: [base('a.ts', blob('1'))], own_writes: [own('b.ts', blob('9')), own('new.ts', blob('3'))], live })
  assert.deepEqual(elsewhere.refusals.map((r) => r.path), ['a.ts'])
})

test('the same bytes with another mode are not the same entry', () => {
  const seen = treeTheRunMaySee({ base: [base('a.sh', blob('1'))], own_writes: [], live: [file('a.sh', blob('1'), EXECUTABLE)] })
  assert.deepEqual(seen.refusals.map((r) => r.path), ['a.sh'])
})

test('a deleted file adds no text and passes', () => {
  const seen = treeTheRunMaySee({ base: [base('a.ts', blob('1')), base('gone.ts', blob('2'))], own_writes: [], live: [file('a.ts', blob('1'))] })
  assert.deepEqual(seen.refusals, [])
})

test('a symlink or gitlink in the base is refused, even where the live tree leaves it alone', () => {
  const seen = treeTheRunMaySee({ base: [base('link', blob('1'), SYMLINK), base('sub', blob('2'), GITLINK)], own_writes: [], live: [] })
  assert.deepEqual(seen.refusals.map((r) => r.path), ['link', 'sub'])
})

test('a live entry that is not a regular file is refused, whatever the base holds', () => {
  const seen = treeTheRunMaySee({ base: [base('a.ts', blob('1'))], own_writes: [], live: [{ path: 'a.ts', regular: false }] })
  assert.deepEqual(seen.refusals.map((r) => r.path), ['a.ts'])
})

test('an own write recorded with a non-regular mode never passes a path', () => {
  const seen = treeTheRunMaySee({ base: [], own_writes: [own('l', blob('1'), SYMLINK)], live: [file('l', blob('1'), SYMLINK)] })
  assert.deepEqual(seen.refusals.map((r) => r.path), ['l'])
})
