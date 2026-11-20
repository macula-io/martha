// The dry release harness calls the installer's steps in installRelease's own order, read from both sources (martha#659).
// An installer that moves a step, or a harness that does, fails here by name, naming both orders. Nothing here is a
// list of steps typed by hand: the steps are the names the harness imports from the installer.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { callOrderIn, namesImportedFrom, stepsIn } from '../read_a_source/the_order_a_function_calls_in.ts'

const REPO = join(import.meta.dirname, '../..')
const HARNESS = join(REPO, 'rehearse_a_release', 'place_main_as_a_dry_release', 'dry_release.mjs')
const INSTALL = join(REPO, 'installer', 'install_a_release', 'install_a_release.mjs')
const COMMAND = join(REPO, 'installer', 'bin', 'martha-install.mjs')
/** Where the harness imports the installer from, relative to itself. */
const THE_INSTALLER = '../../installer/'

const read = (path: string): string => readFileSync(path, 'utf8')

/** The installer's steps the harness uses: every name it imports from the installer. */
const theSteps = (): string[] => namesImportedFrom(read(HARNESS), HARNESS, THE_INSTALLER)

/** What installRelease runs, with placedRelease taken in where it is called. */
const theInstallers = (steps: readonly string[]): string[] => stepsIn(callOrderIn(read(INSTALL), INSTALL, 'installRelease', ['placedRelease']), steps)

/** The steps the installer's own command runs before it calls installRelease: the places it hands in. */
const theCommandsBefore = (steps: readonly string[]): string[] => {
  const order = callOrderIn(read(COMMAND), COMMAND, 'main')
  const at = order.indexOf('installRelease')
  assert.notEqual(at, -1, "the installer's command calls installRelease")
  return stepsIn(order.slice(0, at), steps)
}

/** What the harness runs. */
const theHarnesss = (steps: readonly string[]): string[] => stepsIn(callOrderIn(read(HARNESS), HARNESS, 'placeADryRelease'), steps)

test("the harness calls the installer's steps in installRelease's own order", () => {
  const steps = theSteps()
  const before = theCommandsBefore(steps)
  const installer = theInstallers(steps)
  const harness = theHarnesss(steps).filter((step) => !before.includes(step))
  assert.ok(installer.length > before.length, `installRelease's steps were read: ${installer.join(' > ')}`)
  assert.deepEqual(harness, installer, `the harness runs ${harness.join(' > ')}, and installRelease runs ${installer.join(' > ')}`)
})

test("every installer step the harness imports is one installRelease calls, or one the installer's command calls before it", () => {
  const steps = theSteps()
  assert.ok(steps.length > 0, 'the harness imports steps from the installer')
  const known = [...theInstallers(steps), ...theCommandsBefore(steps)]
  assert.deepEqual(steps.filter((step) => !known.includes(step)), [])
})

// --- the reader ------------------------------------------------------------------------------------------------------

const A = 'planted.mjs'

test('an argument that is a call runs before the call it is passed to', () => {
  assert.deepEqual(callOrderIn('function f () { a(b(), c()) }', A, 'f'), ['b', 'c', 'a'])
  assert.deepEqual(callOrderIn('async function f () { x.h(await x.g()) }', A, 'f'), ['g', 'h'])
})

test('a function passed as an argument runs inside the call, after it', () => {
  const text = 'function f () { place({ unpack: () => u(), accept: async function () { await d() } }); s() }'
  assert.deepEqual(callOrderIn(text, A, 'f'), ['place', 'u', 'd', 's'])
})

test('a function named to be taken in is replaced by its own order, where it is called', () => {
  const text = 'function inner () { b(); c() }\nfunction f () { a(); inner(); d() }'
  assert.deepEqual(callOrderIn(text, A, 'f', ['inner']), ['a', 'b', 'c', 'd'])
  assert.deepEqual(callOrderIn(text, A, 'f'), ['a', 'inner', 'd'])
})

test('a function that is not declared is refused, never read as one that calls nothing', () => {
  assert.throws(() => callOrderIn('function f () { a() }', A, 'g'), /no function g is declared/)
  assert.throws(() => callOrderIn('function f () { inner() }', A, 'f', ['inner']), /no function inner is declared/)
})

test('the names a source imports from a folder, by their exported names, and only from that folder', () => {
  const text = "import { a, b as c } from '../x/one.mjs'\nimport { d } from './own.mjs'\nimport e from '../x/two.mjs'"
  assert.deepEqual(namesImportedFrom(text, A, '../x/'), ['a', 'b'])
})

test('only the steps are kept, each at its first call', () => {
  assert.deepEqual(stepsIn(['x', 'b', 'a', 'b', 'y'], ['a', 'b']), ['b', 'a'])
})
