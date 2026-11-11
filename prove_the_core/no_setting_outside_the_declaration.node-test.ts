import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { test } from 'node:test'

import { coreSources } from './core_sources.ts'
import { CORE, escaped, isTestFile, manifestOf, programsRunByScriptsOf, testSuffixesOf } from './declared_in_package_json.ts'
import {
  adapterReachesBeyondItsKind,
  glueReachesBeyondTheContract,
  nodeModulesBeyondADecision,
  settingsReadOutsideTheDeclaration,
  slicesImportingPrograms,
  type Source,
} from './no_setting_outside_the_declaration.ts'

const repository = join(import.meta.dirname, '..')
const src = join(repository, CORE)
const manifest = manifestOf(repository)

const underTheCore = new RegExp(`^${escaped(CORE)}/`)
// An entry of the manifest's martha section, declared as <core>/<directory> or <core>/<path>.
const declaredPath = (entry: string) => entry.replace(underTheCore, '')

// Which files under src/ are not slices, as package.json declares them: the test
// files its test script runs, the programs its other scripts run with node, and
// the host glue it lists under martha.hostGlue.
const testSuffixes = testSuffixesOf(manifest)
const programsRunByScripts = programsRunByScriptsOf(manifest)

// The host glue: the code that implements the host contract on one machine. It is
// declared as <core>/<directory>; it is not a slice, and reaching the machine is its job.
const hostGlue = (manifest.martha?.hostGlue ?? []).map(declaredPath)
// The host adapters: each composes the contract for one coding tool from glue and slices.
const hostAdapters = (manifest.martha?.hostAdapters ?? []).map(declaredPath)
// The host contract the glue implements, the one place glue may import from in the core.
const hostContract = declaredPath(manifest.martha?.hostContract ?? '')
// Files inside a host adapter that are decisions rather than the adapter's machinery
// (martha#158). The directory they sit in is an adapter, so the slice rule does not reach
// them; what reaches them is the one rule a decision cannot break wherever it lives: it
// reads the machine through the host, so it imports no Node module but pure computation.
const decisionFiles = (manifest.martha?.decisionFiles ?? []).map(declaredPath)

const isSlice = (path: string) => {
  const top = path.split(sep)[0] ?? ''
  return !isTestFile(testSuffixes, path) && !programsRunByScripts.includes(top) && !hostGlue.includes(top) && !hostAdapters.includes(top)
}

const isTestOrProgram = (path: string) => isTestFile(testSuffixes, path) || programsRunByScripts.includes(path.split(sep)[0] ?? '')
const sourcesIn = (directories: readonly string[]) =>
  coreSources(src).filter(source => directories.includes(source.path.split(sep)[0] ?? '') && !isTestFile(testSuffixes, source.path))

interface PlantedCase { readonly text: string; readonly lines: readonly number[] }
interface Planted {
  readonly caught: Readonly<Record<string, readonly PlantedCase[]>>
  readonly quiet: readonly string[]
  readonly glue: { readonly caught: readonly PlantedCase[]; readonly quiet: readonly string[] }
  readonly adapter: { readonly caught: readonly PlantedCase[]; readonly quiet: readonly string[] }
}
const planted = JSON.parse(readFileSync(join(import.meta.dirname, 'planted_reaches.json'), 'utf8')) as Planted

const PLANTED_PATH = join('some_slice', 'some_slice.ts')
const judgeAt = (path: string, text: string) => settingsReadOutsideTheDeclaration([{ path, text }], isSlice)
const judge = (text: string) => judgeAt(PLANTED_PATH, text)

const linesOf = (found: readonly { line: number }[]) => [...new Set(found.map(finding => finding.line))]

// An import of one module, written so that no text walk reads this file as importing it.
const importOf = (specifier: string) => ['import', '{ x }', 'from', `'${specifier}'`].join(' ')

// --- what package.json says is not a slice -------------------------------------

test('package.json names a test glob and at least one program, so the exemptions are not empty by accident', () => {
  assert.notDeepEqual(testSuffixes, [])
  assert.notDeepEqual(programsRunByScripts, [])
})

test('a test file, a program a script runs, host glue and a host adapter are not slices; a directory that only starts like one is', () => {
  for (const suffix of testSuffixes) assert.equal(isSlice(join('a', `a${suffix}`)), false)
  for (const directory of [...programsRunByScripts, ...hostGlue, ...hostAdapters]) {
    assert.equal(isSlice(join(directory, 'main.ts')), false)
    assert.equal(isSlice(join(`${directory}_too`, 'x.ts')), true)
  }
})

test('the host contract and every host glue and host adapter entry are one directory under the core that exists', () => {
  const directories = new Set(coreSources(src).map(source => source.path.split(sep)[0]))
  const entries = [manifest.martha?.hostContract ?? '', ...(manifest.martha?.hostGlue ?? []), ...(manifest.martha?.hostAdapters ?? [])]
  for (const entry of entries) {
    assert.match(entry, new RegExp(`^${escaped(CORE)}/[^/]+$`), entry)
    assert.ok(directories.has(declaredPath(entry)), entry)
  }
  assert.notDeepEqual(hostGlue, [])
  assert.notDeepEqual(hostAdapters, [])
})

// --- the decisions declared inside a host adapter ---------------------------------

test('package.json names files inside a host adapter as decisions, and each one is there', () => {
  const files = new Set(coreSources(src).map(source => source.path))
  assert.notDeepEqual(decisionFiles, [], 'the declaration is read')
  for (const path of decisionFiles) {
    const top = path.split(sep)[0] ?? ''
    assert.ok(files.has(path), `${path} is not a file under ${CORE}`)
    assert.ok(hostAdapters.includes(top), `${path} is not inside a host adapter, so declaring it does nothing`)
    assert.equal(isSlice(path), false, `${path} is inside an adapter, which is why it is declared`)
  }
})

for (const path of [...decisionFiles]) {
  test(`a decision declared inside a host adapter reads the machine through the host, not Node's own modules: ${path}`, () => {
    const source = coreSources(src).find((candidate) => candidate.path === path)
    assert.ok(source !== undefined, `${path} is read`)
    // The same rule the planted cases below judge, called on the file itself, so one definition
    // decides both and a change to it reaches the repository as well as the plants (review r=1).
    assert.deepEqual(nodeModulesBeyondADecision([source]), [], `${path} imports only its own code and the Node modules a decision may`)
  })
}

test('caught: a declared decision importing node:fs, node:child_process, node:process or a package is named, and node:path and its own code are not', () => {
  const caught = ['node:fs', 'node:child_process', 'node:process', 'some-package']
  const quiet = ['node:path', 'node:crypto', '../some_slice/some_slice.ts']
  for (const path of decisionFiles) {
    for (const specifier of caught) {
      const found = nodeModulesBeyondADecision([{ path, text: `${importOf(specifier)}\n` }])
      assert.deepEqual(linesOf(found), [1], `${path} importing ${specifier}`)
      assert.equal(found[0]?.path, path)
    }
    for (const specifier of quiet) assert.deepEqual(nodeModulesBeyondADecision([{ path, text: `${importOf(specifier)}\n` }]), [], specifier)
  }
})

test('caught: a decision importing a module whose name is computed is named', () => {
  for (const path of decisionFiles) {
    const found = nodeModulesBeyondADecision([{ path, text: 'export const a = await import(name)\n' }])
    assert.deepEqual(linesOf(found), [1], path)
  }
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
  const notSlices = [...hostGlue, ...hostAdapters, ...programsRunByScripts].map(directory => `../${directory}/main.ts`)
  for (const specifier of [...notSlices, `./${someTest}`]) {
    const found = judge(`${importOf(specifier)}\n`)
    assert.deepEqual(linesOf(found), [1], `${specifier}\n${JSON.stringify(found)}`)
  }
  assert.deepEqual(judge(`${importOf('../declare_crew/declare_crew.ts')}\n`), [])
})

for (const glue of hostGlue) {
  const at = join(glue, 'planted.ts')
  const judgeGlue = (text: string) => glueReachesBeyondTheContract([{ path: at, text }], hostContract)

  test(`caught: machine glue ${glue} importing beyond the host contract, node:* and its own directory (review r=3, r=5)`, () => {
    assert.ok(planted.glue.caught.length > 0)
    for (const { text, lines } of planted.glue.caught) {
      const found = judgeGlue(text)
      assert.deepEqual(linesOf(found), lines, `${text}\n${JSON.stringify(found)}`)
      for (const finding of found) assert.equal(finding.path, at)
    }
  })

  test(`machine glue ${glue} may import the host contract, node:* and its own directory`, () => {
    for (const text of planted.glue.quiet) assert.deepEqual(judgeGlue(`${text.replaceAll('{contract}', hostContract)}\n`), [], text)
  })
}

for (const adapter of hostAdapters) {
  const at = join(adapter, 'planted.ts')
  const judgeAdapter = (text: string) => adapterReachesBeyondItsKind([{ path: at, text }], isTestOrProgram)

  test(`caught: host adapter ${adapter} importing a test, a program or a package (review r=5)`, () => {
    const programs = programsRunByScripts.map(program => importOf(`../${program}/main.ts`))
    const tests = testSuffixes.map(suffix => importOf(`../some_slice/some_slice${suffix}`))
    assert.ok(programs.length > 0 && tests.length > 0)
    const generated = [...programs, ...tests].map(text => ({ text: `${text}\n`, lines: [1] }))
    for (const { text, lines } of [...generated, ...planted.adapter.caught]) {
      const found = judgeAdapter(text)
      assert.deepEqual(linesOf(found), lines, `${text}\n${JSON.stringify(found)}`)
      for (const finding of found) assert.equal(finding.path, at)
    }
  })

  test(`host adapter ${adapter} may import slices, glue, the host contract, node:* and its own directory`, () => {
    const glue = hostGlue.map(directory => importOf(`../${directory}/x.ts`))
    for (const text of [...glue, ...planted.adapter.quiet]) {
      assert.deepEqual(judgeAdapter(`${text.replaceAll('{contract}', hostContract)}\n`), [], text)
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
  assert.deepEqual(settingsReadOutsideTheDeclaration(slices, isSlice), [])
})

test('no directory package.json runs as a program is one a slice imports from', () => {
  const slices: Source[] = coreSources(src).filter(source => isSlice(source.path))
  assert.deepEqual(slicesImportingPrograms(slices, programsRunByScripts), [])
})

test('caught: a program script pointing into a directory a slice imports (review r=5)', () => {
  assert.notDeepEqual(programsRunByScripts, [])
  for (const program of programsRunByScripts) {
    const slice = { path: PLANTED_PATH, text: `${importOf(`../${program}/shared.ts`)}\n` }
    assert.deepEqual(linesOf(slicesImportingPrograms([slice], programsRunByScripts)), [1], program)
    assert.deepEqual(slicesImportingPrograms([slice], []), [], program)
  }
})

test('the machine glue in this repository imports only the host contract, node:* and its own directory', () => {
  const glue: Source[] = sourcesIn(hostGlue)
  assert.ok(glue.length > 0, 'the walk read the glue')
  assert.deepEqual(glueReachesBeyondTheContract(glue, hostContract), [])
})

test('the host adapters in this repository import no test, no program and no package', () => {
  const adapters: Source[] = sourcesIn(hostAdapters)
  assert.ok(adapters.length > 0, 'the walk read the adapters')
  assert.deepEqual(adapterReachesBeyondItsKind(adapters, isTestOrProgram), [])
})

test('the programs package.json runs exist, so an exemption cannot outlive its program', () => {
  const directories = new Set(coreSources(src).map(source => source.path.split(sep)[0]))
  for (const program of programsRunByScripts) assert.ok(directories.has(program), program)
})
