import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { test } from 'node:test'

import { coreSources } from './core_sources.ts'
import { settingsReadOutsideTheDeclaration, type Source } from './no_setting_outside_the_declaration.ts'

const repository = join(import.meta.dirname, '..')
const src = join(repository, 'src')
const scripts = (JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts

// Which files under src/ are not slices, as package.json declares them: the test
// files its test script runs, and the programs its other scripts run with node.
const testSuffixes = [...(scripts['test'] ?? '').matchAll(/'src\/\*\*\/\*([^']+)'/g)].map(match => match[1] ?? '')
const programsRunByScripts = Object.entries(scripts)
  .filter(([name]) => name !== 'test')
  .flatMap(([, command]) => [...command.matchAll(/\bnode\s+src\/([^/\s]+)\//g)].map(match => match[1] ?? ''))

const isSlice = (path: string) =>
  !testSuffixes.some(suffix => path.endsWith(suffix)) && !programsRunByScripts.includes(path.split(sep)[0] ?? '')

interface Planted {
  readonly caught: Readonly<Record<string, readonly { readonly text: string; readonly lines: readonly number[] }[]>>
  readonly quiet: readonly string[]
}
const planted = JSON.parse(readFileSync(join(import.meta.dirname, 'planted_reaches.json'), 'utf8')) as Planted

const PLANTED_PATH = join('some_slice', 'some_slice.ts')
const judge = (text: string) => settingsReadOutsideTheDeclaration([{ path: PLANTED_PATH, text }])

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

// --- every planted reach is caught, at its own line -----------------------------

for (const [kind, cases] of Object.entries(planted.caught)) {
  test(`caught: ${kind}`, () => {
    assert.ok(cases.length > 0)
    for (const { text, lines } of cases) {
      const found = judge(text)
      assert.deepEqual([...new Set(found.map(finding => finding.line))], lines, `${text}\n${JSON.stringify(found)}`)
      for (const finding of found) assert.equal(finding.path, PLANTED_PATH)
    }
  })
}

// --- what is not a reach is left alone ----------------------------------------

test('words in comments, strings and regular expressions, properties, types and allowed imports are not reaches', () => {
  for (const text of planted.quiet) assert.deepEqual(judge(`${text}\n`), [], text)
})

// --- the tree -----------------------------------------------------------------

test('no slice in this repository reads a setting from anywhere but the declaration', () => {
  const slices: Source[] = coreSources(src).filter(source => isSlice(source.path))
  assert.ok(slices.length > 1, 'the walk read the core')
  assert.deepEqual(settingsReadOutsideTheDeclaration(slices), [])
})

test('the programs package.json runs exist, so an exemption cannot outlive its program', () => {
  const directories = new Set(coreSources(src).map(source => source.path.split(sep)[0]))
  for (const program of programsRunByScripts) assert.ok(directories.has(program), program)
})
