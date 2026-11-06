import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { test } from 'node:test'

import { coreSources } from '../host_contract/imports_beyond_the_core.ts'
import { settingsReadOutsideTheDeclaration, type Source } from './no_setting_outside_the_declaration.ts'

const src = join(import.meta.dirname, '..')
const scripts = (JSON.parse(readFileSync(join(src, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts

// Which files under src/ are not slices, as package.json declares them: the test
// files its test script runs, and the programs its other scripts run with node.
const testSuffixes = [...(scripts['test'] ?? '').matchAll(/'src\/\*\*\/\*([^']+)'/g)].map(match => match[1] ?? '')
const programsRunByScripts = Object.entries(scripts)
  .filter(([name]) => name !== 'test')
  .flatMap(([, command]) => [...command.matchAll(/\bnode\s+src\/([^/\s]+)\//g)].map(match => match[1] ?? ''))

const isSlice = (path: string) =>
  !testSuffixes.some(suffix => path.endsWith(suffix)) && !programsRunByScripts.includes(path.split(sep)[0] ?? '')

interface Planted {
  readonly caught: Readonly<Record<string, readonly string[]>>
  readonly located: { readonly text: string; readonly line: number; readonly why: string }
  readonly quiet: readonly string[]
}
const planted = JSON.parse(readFileSync(join(import.meta.dirname, 'planted_reaches.json'), 'utf8')) as Planted

const judge = (text: string) => settingsReadOutsideTheDeclaration([{ path: 'some_slice/some_slice.ts', text }])
const caught = (text: string) => assert.notDeepEqual(judge(text), [], `got past the check:\n${text}`)

// --- what package.json says is not a slice -------------------------------------

test('package.json names a test glob and at least one program, so the exemptions are not empty by accident', () => {
  assert.notDeepEqual(testSuffixes, [])
  assert.notDeepEqual(programsRunByScripts, [])
})

test('a test file and a program a script runs are not slices; a directory that only starts like one is', () => {
  for (const suffix of testSuffixes) assert.equal(isSlice(join('a', `a${suffix}`)), false)
  for (const program of programsRunByScripts) {
    assert.equal(isSlice(join(program, 'main.ts')), false)
    assert.equal(isSlice(join(`${program}_too`, 'x.ts')), true)
  }
})

// --- every way to reach the environment is caught -----------------------------

for (const [kind, texts] of Object.entries(planted.caught)) {
  test(`caught: ${kind}`, () => {
    assert.ok(texts.length > 0)
    for (const text of texts) caught(text)
  })
}

test('a finding names its file and line', () => {
  const { text, line, why } = planted.located
  assert.deepEqual(judge(text), [{ path: 'some_slice/some_slice.ts', line, why }])
})

// --- what is not a reach is left alone ----------------------------------------

test('the words in comments, strings and regular expressions, and a property named process, are not reaches', () => {
  for (const text of planted.quiet) assert.deepEqual(judge(`${text}\n`), [], text)
})

// --- the tree -----------------------------------------------------------------

test('no slice in this repository reads a setting from anywhere but the declaration', () => {
  const slices: Source[] = coreSources(src).filter(source => isSlice(source.path))
  assert.deepEqual(settingsReadOutsideTheDeclaration(slices), [])
})

test('the programs package.json runs exist, so an exemption cannot outlive its program', () => {
  const directories = new Set(coreSources(src).map(source => source.path.split(sep)[0]))
  for (const program of programsRunByScripts) assert.ok(directories.has(program), program)
})
