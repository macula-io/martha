import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

import {
  PROGRAMS_RUN_BY_CI,
  settingsReadOutsideTheDeclaration,
  type Source,
} from './no_setting_outside_the_declaration.ts'

const src = join(import.meta.dirname, '..')

const sourcesUnder = (dir: string): Source[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(path => path.endsWith('.ts'))
    .map(path => ({ path: relative(src, join(dir, path)), text: readFileSync(join(dir, path), 'utf8') }))

const plant = (text: string, path = 'some_slice/some_slice.ts'): Source[] => [{ path, text }]

// --- the check bites ------------------------------------------------------------

test('a slice that reads the environment is named', () => {
  const found = settingsReadOutsideTheDeclaration(plant("const limit = process.env['CREW_LIMIT']\n"))
  assert.deepEqual(found, [{ path: 'some_slice/some_slice.ts', line: 1, why: 'reads the environment' }])
})

test('destructuring the environment is named too', () => {
  const found = settingsReadOutsideTheDeclaration(plant('const { env } = process\n'))
  assert.equal(found.length, 1)
})

test('a slice that finds the home directory is named', () => {
  const found = settingsReadOutsideTheDeclaration(plant("import { homedir } from 'node:os'\nconst at = homedir()\n"))
  assert.deepEqual(found.map(f => f.line), [1, 2])
})

test('a slice that writes a home-relative path is named', () => {
  for (const quote of ["'", '"', '`']) {
    const found = settingsReadOutsideTheDeclaration(plant(`const dir = ${quote}~/.config/crew${quote}\n`))
    assert.equal(found.length, 1, quote)
  }
})

test('a test file is not a slice and is not judged', () => {
  assert.deepEqual(settingsReadOutsideTheDeclaration(plant('process.env.X', 'a/a.node-test.ts')), [])
})

test('a program CI runs is not a slice of the running crew and is not judged', () => {
  for (const program of PROGRAMS_RUN_BY_CI) {
    assert.deepEqual(settingsReadOutsideTheDeclaration(plant('process.env.X', join(program, 'main.ts'))), [])
  }
})

test('a directory whose name only starts like a CI program is still judged', () => {
  for (const program of PROGRAMS_RUN_BY_CI) {
    assert.equal(settingsReadOutsideTheDeclaration(plant('process.env.X', join(`${program}_too`, 'x.ts'))).length, 1)
  }
})

// --- the tree -----------------------------------------------------------------

test('no slice in this repository reads a setting from anywhere but the declaration', () => {
  assert.deepEqual(settingsReadOutsideTheDeclaration(sourcesUnder(src)), [])
})

test('every program CI runs still exists, so the exception cannot outlive it', () => {
  const present = new Set(readdirSync(src))
  for (const program of PROGRAMS_RUN_BY_CI) assert.ok(present.has(program), `${program} is gone; drop it from PROGRAMS_RUN_BY_CI`)
})
