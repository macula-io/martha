// What the clean-install proof loads out of the installed release is there (martha#496), and the check bites.
//
// The tree case runs the check over the installer as it stands, so the root suite fails by name when a file or a
// constant the proof loads has moved. The plants are installer sources as text, judged by the same function: each
// finding is made to happen once, by name. The exports the compiler resolves are proved on a planted tree on disk,
// a re-export followed and a missing file seen.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

import {
  describe,
  exportsIn,
  type ExportsOf,
  type InstallerSource,
  judgeTheLoads,
  LOADER,
  SOURCE_FOLDER,
} from './what_the_clean_install_loads_is_there.ts'

const REPOSITORY = join(import.meta.dirname, '../..')
const INSTALLER = 'installer'

/** Every installer source a load could stand in: its .mjs files, its own dependencies left out. */
function theInstallersSources(): InstallerSource[] {
  const root = join(REPOSITORY, INSTALLER)
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.mjs') && !path.split('/').includes('node_modules'))
    .map((path) => ({ path: relative(REPOSITORY, join(root, path)), text: readFileSync(join(root, path), 'utf8') }))
}

const PROOF = 'installer/a_proof/a_proof.mjs'
const MODULE = `${SOURCE_FOLDER}/a_slice/a_slice.ts`

/** A load as the proof writes one, reading `names` out of src/a_slice/<file>. */
const aLoad = (names: string, file = 'a_slice.ts'): string =>
  `const { ${names} } = await ${LOADER}(installed, 'a_slice', '${file}')\n`

/** Exports as a map, standing in for the compiler. */
const exporting = (modules: Record<string, readonly string[]>): ExportsOf => (module) =>
  module in modules ? new Set(modules[module]) : null

const said = (text: string, exportsOf: ExportsOf): string[] =>
  judgeTheLoads([{ path: PROOF, text }], exportsOf).map(describe)

test('every module the clean-install proof loads is in the tree and exports every name read from it', () => {
  const sources = theInstallersSources()
  assert.deepEqual(judgeTheLoads(sources, exportsIn(REPOSITORY)).map(describe), [])
})

test('loads whose files are there and whose names are exported pass, renamed and asserted ones too', () => {
  const text = aLoad('ONE, two: renamed') + `const { THREE } = /** @type {any} */ (await ${LOADER}(installed, 'a_slice', 'a_slice.ts'))\n`
  assert.deepEqual(said(text, exporting({ [MODULE]: ['ONE', 'two', 'THREE'] })), [])
})

test('a load of a file that has moved is named, with its line and the module it looked for', () => {
  assert.deepEqual(said(aLoad('ONE', 'moved_away.ts'), exporting({ [MODULE]: ['ONE'] })), [
    `${PROOF}:1: ${LOADER} loads ${SOURCE_FOLDER}/a_slice/moved_away.ts, and there is no such file in the tree the release is packed from`,
  ])
})

test('a name the module no longer exports is named, the one that would read as undefined', () => {
  assert.deepEqual(said('\n' + aLoad('ONE, RELAY_PLUGIN_DIR'), exporting({ [MODULE]: ['ONE'] })), [
    `${PROOF}:2: reads RELAY_PLUGIN_DIR from ${MODULE}, which does not export it; the load would give undefined`,
  ])
})

test('a load whose path is computed, or whose result is not destructured, is named rather than passed', () => {
  const computed = `const { ONE } = await ${LOADER}(installed, 'a_slice', file)\n`
  assert.match(said(computed, exporting({}))[0] ?? '', new RegExp(`^${PROOF}:1: a ${LOADER} load the check cannot read: the path is not`))
  const whole = `const all = await ${LOADER}(installed, 'a_slice', 'a_slice.ts')\n`
  assert.match(said(whole, exporting({}))[0] ?? '', /the result is not destructured/)
  const spread = `const { ...rest } = await ${LOADER}(installed, 'a_slice', 'a_slice.ts')\n`
  assert.match(said(spread, exporting({}))[0] ?? '', /the result is not destructured/)
})

test('installer sources that load nothing through the loader are a finding, never a pass', () => {
  assert.deepEqual(said(`const x = await import('./elsewhere.mjs')\n`, exporting({})), [
    `no ${LOADER} load found in 1 installer source(s); the clean-install proof loads its modules through it, so the check would be looking at nothing`,
  ])
})

test('the exports are the compiler\'s: a re-export is followed and a missing file is null', () => {
  const tree = mkdtempSync(join(tmpdir(), 'martha-496-'))
  try {
    mkdirSync(join(tree, SOURCE_FOLDER, 'a_slice'), { recursive: true })
    writeFileSync(join(tree, SOURCE_FOLDER, 'a_slice', 'origin.ts'), 'export const MOVED = 1\nexport function work(): void {}\n')
    writeFileSync(join(tree, MODULE), "export * from './origin.ts'\nexport { work as renamed } from './origin.ts'\nexport const OWN = 2\n")
    const exportsOf = exportsIn(tree)
    assert.deepEqual([...(exportsOf(MODULE) ?? [])].sort(), ['MOVED', 'OWN', 'renamed', 'work'])
    assert.equal(exportsOf(`${SOURCE_FOLDER}/a_slice/gone.ts`), null)
  } finally {
    removeTheTree(tree)
  }
})
