// No crew surface decides a member's state (martha#572 T2): the strip and the tab title draw the crew reader's answer,
// so neither may take a value from the slices that decide what a beat says or what the owner is shown. A type is
// allowed, because a type decides nothing at run time.
//
// The judge reads each source's syntax tree, never its text, and is tried first on planted sources, so a judge that
// finds nothing fails here rather than passing every slice.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'

import { lineOf, nodesOf, parseSource } from '../../prove_the_core/parse_a_source.ts'

const SRC = join(import.meta.dirname, '..')

/** The surfaces that draw the reader's answer. */
const SURFACES: readonly string[] = ['draw_the_crew_strip', 'title_a_members_tab']

/** The slices that decide a state: what a beat says, and what the owner is shown. */
const DECIDERS: readonly string[] = ['show_dashboard_beat', 'tell_the_owner_a_session_waits']

const TEST_FILE = /\.node-test\.ts$/

/** Whether an import or export brings in a value: anything but a declaration that is wholly about types. */
function bringsAValue(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return false
    const clause = node.exportClause
    return clause === undefined || !ts.isNamedExports(clause) || clause.elements.some((element) => !element.isTypeOnly)
  }
  const clause = node.importClause
  // An import with no clause runs the module, which is taking its values in all but name.
  if (clause === undefined) return true
  if (clause.isTypeOnly) return false
  if (clause.name !== undefined) return true
  const bindings = clause.namedBindings
  return bindings !== undefined && (ts.isNamespaceImport(bindings) || bindings.elements.some((element) => !element.isTypeOnly))
}

/** Each value `text` takes from a deciding slice, as `<file>:<line> takes a value from <slice>`. */
export function valuesFromADecider(text: string, path: string): readonly string[] {
  const { file } = parseSource(text, path)
  const found: string[] = []
  for (const node of nodesOf(file)) {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue
    const specifier = node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : ''
    const decider = DECIDERS.find((slice) => specifier.includes(`/${slice}/`))
    if (decider !== undefined && bringsAValue(node)) found.push(`${path}:${lineOf(file, node)} takes a value from ${decider}`)
  }
  return found
}

test('T2: the judge names a value taken from a deciding slice, and passes a type', () => {
  const planted = (line: string) => valuesFromADecider(line, 'planted.ts')
  assert.deepEqual(planted("import { OFFLINE } from '../show_dashboard_beat/show_dashboard_beat.ts'"), ['planted.ts:1 takes a value from show_dashboard_beat'])
  assert.deepEqual(planted("import { type DashboardRow, OFFLINE } from '../show_dashboard_beat/show_dashboard_beat.ts'"), ['planted.ts:1 takes a value from show_dashboard_beat'])
  assert.deepEqual(planted("import * as beat from '../show_dashboard_beat/show_dashboard_beat.ts'"), ['planted.ts:1 takes a value from show_dashboard_beat'])
  assert.deepEqual(planted("import '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'"), ['planted.ts:1 takes a value from tell_the_owner_a_session_waits'])
  assert.deepEqual(planted("export { whatTheOwnerIsShown } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'"), ['planted.ts:1 takes a value from tell_the_owner_a_session_waits'])
  assert.deepEqual(planted("import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'"), [])
  assert.deepEqual(planted("import { type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'"), [])
  assert.deepEqual(planted("import { seeTheCrew } from '../see_the_crew/see_the_crew.ts'"), [], 'the reader itself is what a surface draws from')
})

test('T2: no surface takes a value from a slice that decides a state', () => {
  const files = SURFACES.flatMap((slice) =>
    readdirSync(join(SRC, slice)).filter((name) => name.endsWith('.ts') && !TEST_FILE.test(name)).map((name) => join(slice, name)),
  )
  assert.ok(files.length >= SURFACES.length, `the judge read no surface: ${JSON.stringify(files)}`)
  assert.deepEqual(files.flatMap((file) => valuesFromADecider(readFileSync(join(SRC, file), 'utf8'), file)), [])
})
