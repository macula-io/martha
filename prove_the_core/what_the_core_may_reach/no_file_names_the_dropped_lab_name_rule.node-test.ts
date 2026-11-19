// The private scan checks no lab machine names (martha#773). The owner decided on
// 2026-11-18 that those names may be public, and the rule, its secret and its
// digest file were removed. A reader of any of them that comes back would bring
// back a check a member's machine cannot run, so every tracked file is read for
// their names and the test fails naming the file and the name.
//
// The names are put together at run time, so this file is not a hit of its own.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const REPOSITORY = join(import.meta.dirname, '../..')

/** The names the removed rule went by: its secret, the owner's act, its slice and its file. */
export const DROPPED_NAMES: readonly string[] = [
  ['MARTHA', 'LAB', 'HOSTS'].join('_'),
  ['keep', 'lab-families'].join(':'),
  ['keep', 'the', 'lab', 'families'].join('_'),
  ['lab', 'families.json'].join('_'),
  ['lab', 'family', 'digests'].join('_'),
]

/** Each dropped name a text holds. */
export const droppedNamesIn = (text: string): string[] => DROPPED_NAMES.filter((name) => text.includes(name))

const trackedFiles = (): string[] =>
  execFileSync('git', ['-C', REPOSITORY, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter((path) => path !== '')

test('the check finds each dropped name, so a clean tree is not a blind one', () => {
  assert.deepEqual(droppedNamesIn('env: MARTHA_L' + 'AB_HOSTS: x'), [DROPPED_NAMES[0]])
  assert.deepEqual(droppedNamesIn('"keep:lab-fa' + 'milies": "node x"'), [DROPPED_NAMES[1]])
  assert.deepEqual(droppedNamesIn('src/keep_the_lab_fa' + 'milies/main.ts'), [DROPPED_NAMES[2]])
  assert.deepEqual(droppedNamesIn('~/.config/martha/lab_fa' + 'milies.json'), [DROPPED_NAMES[3]])
  assert.deepEqual(droppedNamesIn("from './lab_family_di" + "gests.ts'"), [DROPPED_NAMES[4]])
  assert.deepEqual(droppedNamesIn('a lab hostname is still refused'), [])
})

test('no tracked file names the dropped lab-name rule: its secret, its act, its slice or its file (martha#773)', () => {
  const files = trackedFiles()
  assert.ok(files.length > 100, `git listed only ${files.length} tracked files`)
  const found = files.flatMap((path) => [...droppedNamesIn(path), ...droppedNamesIn(readFileSync(join(REPOSITORY, path), 'latin1'))].map((name) => `${path}: ${name}`))
  assert.deepEqual(found, [], `the dropped lab-name rule is named again:\n${found.join('\n')}`)
})
