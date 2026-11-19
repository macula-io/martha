// The owner's change written over the crew's declaration (martha#307): the file is replaced in one rename, only when it
// still holds the bytes the change was made from, and never through a link.
//
// Real directories under a temporary home. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { writeAChangedDeclaration } from './write_a_changed_declaration.ts'

const BEFORE = '{ "before": 1 }\n'
const AFTER = '{\n  "after": 2\n}\n'

function aProject(t: TestContext): { root: string; directory: string; declaration: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-crew-change-')))
  t.after(() => removeTheTree(home))
  const root = join(home, 'project')
  const directory = join(root, DECLARATION_DIRECTORY)
  mkdirSync(directory, { recursive: true })
  const declaration = join(directory, DECLARATION_FILE)
  writeFileSync(declaration, BEFORE)
  return { root, directory, declaration }
}

test('#307: the changed text replaces the declaration, and nothing else is left in its directory', (t) => {
  const { root, directory, declaration } = aProject(t)
  assert.equal(writeAChangedDeclaration(root, { before: BEFORE, after: AFTER }), undefined)
  assert.equal(readFileSync(declaration, 'utf8'), AFTER)
  assert.deepEqual(readdirSync(directory), [DECLARATION_FILE])
})

test('#307: a declaration that changed since the change was made from it is refused, and left as it is', (t) => {
  const { root, directory, declaration } = aProject(t)
  const meanwhile = '{ "meanwhile": 3 }\n'
  writeFileSync(declaration, meanwhile)
  const refusal = writeAChangedDeclaration(root, { before: BEFORE, after: AFTER })
  assert.equal(refusal, `${declaration} changed while this ran, so the change was not written. Run it again.`)
  assert.equal(readFileSync(declaration, 'utf8'), meanwhile)
  assert.deepEqual(readdirSync(directory), [DECLARATION_FILE])
})

test('#307: a declaration directory that is a link is refused, and nothing is written through it', (t) => {
  const { root, directory, declaration } = aProject(t)
  const elsewhere = join(root, 'elsewhere')
  mkdirSync(elsewhere)
  writeFileSync(join(elsewhere, DECLARATION_FILE), BEFORE)
  removeTheTree(directory)
  symlinkSync(elsewhere, directory)
  const refusal = writeAChangedDeclaration(root, { before: BEFORE, after: AFTER })
  assert.equal(refusal, `${directory} is a link, and Martha changes a crew only in a directory of the checkout's own.`)
  assert.equal(readFileSync(declaration, 'utf8'), BEFORE)
  assert.deepEqual(readdirSync(elsewhere), [DECLARATION_FILE])
})
