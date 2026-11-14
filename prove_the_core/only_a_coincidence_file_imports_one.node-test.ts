// Only a coincidence file imports a coincidence file (martha#289 r=3, ruling P).
//
// A coincidences.ts is exempt from the reach rules because it never runs: the checker reads it as a syntax tree.
// That holds only while no running code imports it, so any other importer is named: a slice, a test, glue, an
// adapter or a program, by import, export-from, import() or require with a literal name. A coincidence file may
// import another, which is how a shared reason travels from the slice that owns the fact.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { coreSources } from './core_sources.ts'
import { codeFoldersOf, manifestOf } from './declared_in_package_json.ts'
import { importsOfACoincidenceFile, IMPORTS_A_COINCIDENCE_FILE } from './only_a_coincidence_file_imports_one.ts'

const repository = join(import.meta.dirname, '..')
const source = (path: string, text: string) => ({ path, text: `${text}\n` })
const named = (...sources: { path: string; text: string }[]) =>
  importsOfACoincidenceFile(sources).map((finding) => `${finding.path}:${finding.line}: ${finding.why}`)

test('a coincidence file importing another is quiet', () => {
  assert.deepEqual(named(source('a_slice/coincidences.ts', "import { SHARED } from '../a_owner/coincidences.ts'")), [])
})

test('any other importer is named, by every way a module is reached with a literal name', () => {
  const at = (path: string) => `${path}:1: ${IMPORTS_A_COINCIDENCE_FILE}`
  assert.deepEqual(named(source('a_slice/a_slice.ts', "import { SHARED } from '../a_owner/coincidences.ts'")), [at('a_slice/a_slice.ts')], 'a slice')
  assert.deepEqual(named(source('a_slice/a.node-test.ts', "import type { X } from './coincidences.ts'")), [at('a_slice/a.node-test.ts')], 'a test, even for a type')
  assert.deepEqual(named(source('an_adapter/x.ts', "const read = await import('../a_owner/coincidences.ts')")), [at('an_adapter/x.ts')], 'import()')
  assert.deepEqual(named(source('a_glue/x.ts', "export { SHARED } from '../a_owner/coincidences.ts'")), [at('a_glue/x.ts')], 'export-from')
  assert.deepEqual(named(source('a_program/main.ts', "const all = require('../a_owner/coincidences')")), [at('a_program/main.ts')], 'require, without the extension')
  assert.deepEqual(named(source('a_slice/coincidences_more.ts', "import { SHARED } from '../a_owner/coincidences.ts'")), [at('a_slice/coincidences_more.ts')], 'a file whose name only starts the same')
})

test('a module whose name only contains the word is not a coincidence file', () => {
  assert.deepEqual(named(source('a_slice/a_slice.ts', "import { X } from '../a_owner/coincidences_of_x.ts'\nimport { Y } from 'coincidences'")), [])
})

test('no file in any code folder of this repository imports a coincidence file, unless it is one', () => {
  const folders = codeFoldersOf(manifestOf(repository))
  const sources = folders.flatMap((folder) => coreSources(join(repository, folder)).map((one) => ({ ...one, path: join(folder, one.path) })))
  assert.ok(sources.length > 1, 'the walk read the code folders')
  assert.deepEqual(importsOfACoincidenceFile(sources), [])
})
