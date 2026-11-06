import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { test } from 'node:test'

import { coreSources } from './core_sources.ts'
import {
  glueReachesBeyondTheContract,
  settingsReadOutsideTheDeclaration,
  type Source,
} from './no_setting_outside_the_declaration.ts'

/** The core's directory, relative to the repository. */
const CORE = 'src'
const repository = join(import.meta.dirname, '..')
const src = join(repository, CORE)
const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
  martha?: { hostContract?: string; hostGlue?: string[] }
}
const scripts = manifest.scripts

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const underTheCore = new RegExp(`^${escaped(CORE)}/`)
// An entry of the manifest's martha section, declared as <core>/<directory>.
const directoryUnderTheCore = (entry: string) => entry.replace(underTheCore, '')

// Which files under src/ are not slices, as package.json declares them: the test
// files its test script runs, the programs its other scripts run with node, and
// the host glue it lists under martha.hostGlue.
const testGlob = new RegExp(`'${escaped(CORE)}/\\*\\*/\\*([^']+)'`, 'g')
const programRun = new RegExp(`\\bnode\\s+${escaped(CORE)}/([^/\\s]+)/`, 'g')
const testSuffixes = [...(scripts['test'] ?? '').matchAll(testGlob)].map(match => match[1] ?? '')
const programsRunByScripts = Object.entries(scripts)
  .filter(([name]) => name !== 'test')
  .flatMap(([, command]) => [...command.matchAll(programRun)].map(match => match[1] ?? ''))

// The host glue: the code that implements the host contract on one machine. It is
// declared as <core>/<directory>; it is not a slice, and reaching the machine is its job.
const hostGlue = (manifest.martha?.hostGlue ?? []).map(directoryUnderTheCore)
// The host contract the glue implements, the one place glue may import from in the core.
const hostContract = directoryUnderTheCore(manifest.martha?.hostContract ?? '')

const isSlice = (path: string) => {
  const top = path.split(sep)[0] ?? ''
  return !testSuffixes.some(suffix => path.endsWith(suffix)) && !programsRunByScripts.includes(top) && !hostGlue.includes(top)
}

interface PlantedCase { readonly text: string; readonly lines: readonly number[] }
interface Planted {
  readonly caught: Readonly<Record<string, readonly PlantedCase[]>>
  readonly quiet: readonly string[]
  readonly glue: { readonly caught: readonly PlantedCase[]; readonly quiet: readonly string[] }
}
const planted = JSON.parse(readFileSync(join(import.meta.dirname, 'planted_reaches.json'), 'utf8')) as Planted

const PLANTED_PATH = join('some_slice', 'some_slice.ts')
const judge = (text: string) => settingsReadOutsideTheDeclaration([{ path: PLANTED_PATH, text }], isSlice)

const linesOf = (found: readonly { line: number }[]) => [...new Set(found.map(finding => finding.line))]

// An import of one module, written so that no text walk reads this file as importing it.
const importOf = (specifier: string) => ['import', '{ x }', 'from', `'${specifier}'`].join(' ')

// --- what package.json says is not a slice -------------------------------------

test('package.json names a test glob and at least one program, so the exemptions are not empty by accident', () => {
  assert.notDeepEqual(testSuffixes, [])
  assert.notDeepEqual(programsRunByScripts, [])
})

test('a test file, a program a script runs and host glue are not slices; a directory that only starts like one is', () => {
  for (const suffix of testSuffixes) assert.equal(isSlice(join('a', `a${suffix}`)), false)
  for (const directory of [...programsRunByScripts, ...hostGlue]) {
    assert.equal(isSlice(join(directory, 'main.ts')), false)
    assert.equal(isSlice(join(`${directory}_too`, 'x.ts')), true)
  }
})

test('the host contract and every host glue entry are one directory under the core that exists', () => {
  const directories = new Set(coreSources(src).map(source => source.path.split(sep)[0]))
  const entries = [manifest.martha?.hostContract ?? '', ...(manifest.martha?.hostGlue ?? [])]
  for (const entry of entries) {
    assert.match(entry, new RegExp(`^${escaped(CORE)}/[^/]+$`), entry)
    assert.ok(directories.has(directoryUnderTheCore(entry)), entry)
  }
  assert.notDeepEqual(hostGlue, [])
})

// --- every planted reach is caught, at its own line -----------------------------

for (const [kind, cases] of Object.entries(planted.caught)) {
  test(`caught: ${kind}`, () => {
    assert.ok(cases.length > 0)
    for (const { text, lines } of cases) {
      const found = judge(text)
      assert.deepEqual(linesOf(found), lines, `${text}\n${JSON.stringify(found)}`)
      for (const finding of found) assert.equal(finding.path, PLANTED_PATH)
    }
  })
}

test('caught: a slice importing what is not a slice, the host glue, a program or a test (review r=3)', () => {
  const someTest = `some_slice${testSuffixes[0] ?? ''}`
  const notSlices = [...hostGlue, ...programsRunByScripts].map(directory => `../${directory}/main.ts`)
  for (const specifier of [...notSlices, `./${someTest}`]) {
    const found = judge(`${importOf(specifier)}\n`)
    assert.deepEqual(linesOf(found), [1], `${specifier}\n${JSON.stringify(found)}`)
  }
  assert.deepEqual(judge(`${importOf('../declare_crew/declare_crew.ts')}\n`), [])
})

for (const glue of hostGlue) {
  const at = join(glue, 'planted.ts')
  const judgeGlue = (text: string) => glueReachesBeyondTheContract([{ path: at, text }], hostContract)

  test(`caught: host glue ${glue} importing beyond the host contract and node:* (review r=3)`, () => {
    assert.ok(planted.glue.caught.length > 0)
    for (const { text, lines } of planted.glue.caught) {
      const found = judgeGlue(text)
      assert.deepEqual(linesOf(found), lines, `${text}\n${JSON.stringify(found)}`)
      for (const finding of found) assert.equal(finding.path, at)
    }
  })

  test(`host glue ${glue} may import the host contract and node:*`, () => {
    for (const text of planted.glue.quiet) assert.deepEqual(judgeGlue(`${text.replaceAll('{contract}', hostContract)}\n`), [], text)
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
  assert.deepEqual(settingsReadOutsideTheDeclaration(slices, isSlice), [])
})

test('the host glue in this repository imports only the host contract and node:*', () => {
  const glue: Source[] = coreSources(src).filter(source => {
    const top = source.path.split(sep)[0] ?? ''
    return hostGlue.includes(top) && !testSuffixes.some(suffix => source.path.endsWith(suffix))
  })
  assert.ok(glue.length > 0, 'the walk read the glue')
  assert.deepEqual(glueReachesBeyondTheContract(glue, hostContract), [])
})

test('the programs package.json runs exist, so an exemption cannot outlive its program', () => {
  const directories = new Set(coreSources(src).map(source => source.path.split(sep)[0]))
  for (const program of programsRunByScripts) assert.ok(directories.has(program), program)
})
