// The lab families' reader looks up no home of its own (martha#731, design r=3).
//
// read_lab_family_digests.ts resolves its file only from the environment it is
// handed. node:os could hand it another home, from the password database, that no
// test can redirect by its environment. So the route is closed by structure: the
// reader and every file of the tree it imports, read by the parser, import no
// node:os, and load no module by a route their imports do not show. This test sits
// here because the parser is a package only prove_the_core may import.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { test } from 'node:test'

import { moduleReferencesOf, type ModuleReference } from '../read_a_source/parse_a_source.ts'

const REPOSITORY = join(import.meta.dirname, '../..')
const READER = join(REPOSITORY, 'src', 'check_nothing_private_gets_in', 'read_lab_family_digests.ts')
const HOME_FROM_THE_SYSTEM = ['node:os', 'os']
// node:module holds createRequire, and with it a load no import shows.
const LOADS_BY_A_HIDDEN_ROUTE = ['node:module', 'module']

/** Every file of the tree the reader loads, with the modules each refers to. */
const referencesFrom = (entry: string): Map<string, readonly ModuleReference[]> => {
  const seen = new Map<string, readonly ModuleReference[]>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    const references = moduleReferencesOf(readFileSync(file, 'utf8'), file)
    seen.set(file, references)
    for (const reference of references) if (reference.specifier?.startsWith('.') === true) visit(resolve(dirname(file), reference.specifier))
  }
  visit(entry)
  return seen
}

test('the lab families\' reader imports no node:os, by any route: a home it could look up there is not the one it is handed (martha#731)', () => {
  const files = referencesFrom(READER)
  assert.ok(files.size > 1, 'the walk did not follow the reader\'s own imports')
  for (const [file, references] of files) {
    const name = relative(REPOSITORY, file)
    for (const reference of references) {
      const where = `${name}:${reference.line}`
      assert.ok(reference.specifier !== null, `${where} imports a module whose name is computed`)
      assert.ok(!HOME_FROM_THE_SYSTEM.includes(reference.specifier), `${where} imports ${reference.specifier}`)
      assert.ok(!LOADS_BY_A_HIDDEN_ROUTE.includes(reference.specifier), `${where} imports ${reference.specifier}`)
      assert.ok(reference.kind !== 'dynamic_import' && reference.kind !== 'require', `${where} loads ${reference.specifier} by ${reference.kind}`)
    }
  }
})
