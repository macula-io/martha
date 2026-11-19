// A key package.json declares twice fails by name, and no writer drops one unseen (martha#753).
//
// JSON.parse keeps the last declaration of a key and drops the others without a word, so every reader built on the
// parsed manifest is blind to a duplicate: main carried one host ceiling twice, and nothing failed. These plants write
// package.json as TEXT — through JSON.stringify the duplicate would vanish, which is the bug — and judge it by the path
// the command CI runs takes, run the record command as the program it is, and hand a merge a stage that holds one.
//
// The declarations two different values apart are planted too (martha#778): a copy of the same line proves the key is
// seen, and only two values prove the reader kept the other one and a writer would have dropped it unseen.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { escaped, manifestPathOf, manifestTextOf } from '../../prove_the_core/read_the_manifest_and_the_linter/declared_in_package_json.ts'
import { keysDeclaredTwice } from '../../prove_the_core/read_the_manifest_and_the_linter/keys_declared_twice.ts'
import { CEILINGS_NAME, withCeilings } from '../../prove_the_core/read_the_manifest_and_the_linter/the_host_ceilings.ts'
import { thePackageJsonOfAMerge } from '../redo_the_generated_files_of_a_merge/the_ceilings_a_merge_brings.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { A_PLANTED_SLICE_CAP, LINTER_CONFIG, theManifestOfAPlantedTree } from './a_tree_whose_ceilings_a_test_reads.ts'
import { describe } from './check_a_host_directory_stays_under_its_ceiling.ts'
import { judgeTheTree } from './judge_the_tree.ts'

const AN_ADAPTER = 'src/an_adapter'
const TWO_LINES = 'export const a = 1\nexport const b = 2\n'

/** The record command, as the program CI and a member run. */
const THE_CHECK = join(import.meta.dirname, 'main.ts')

/** The words that open the finding for the planted adapter's ceiling, as a pattern. */
const THE_CEILING_TWICE = new RegExp(`declares ${escaped(`${CEILINGS_NAME}.${AN_ADAPTER}`)} 2 times`)

/**
 * `text` with the line that declares `spelling` declared once more, just before it: the duplicate a hand edit or a
 * merge of lines leaves. The copy carries a comma, so the text stays JSON that `JSON.parse` reads without a word.
 */
function withTheLineDeclaredAgain(text: string, spelling: string): { readonly text: string; readonly line: number } {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => line.trimStart().startsWith(`${spelling}:`))
  assert.ok(at >= 0, `the planted manifest declares ${spelling}`)
  const original = lines[at] ?? ''
  lines.splice(at, 0, `${original.replace(/,$/, '')},`)
  return { text: lines.join('\n'), line: at + 1 }
}

/** A manifest declaring one adapter at `ceiling`, the adapter's ceiling declared twice. */
function aManifestWithTheCeilingTwice(ceiling: number): { readonly text: string; readonly line: number } {
  return withTheLineDeclaredAgain(theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: ceiling } }), `"${AN_ADAPTER}"`)
}

/** A tree whose package.json is `manifest`, written as it is; removed when the test ends. */
function craft(t: TestContext, manifest: string): string {
  const root = mkdtempSync(join(tmpdir(), 'twice-'))
  t.after(() => removeTheTree(root))
  writeFileSync(join(root, 'eslint.config.mjs'), LINTER_CONFIG)
  mkdirSync(join(root, AN_ADAPTER), { recursive: true })
  writeFileSync(join(root, AN_ADAPTER, 'a.ts'), TWO_LINES)
  writeFileSync(manifestPathOf(root), manifest)
  return root
}

test('a host ceiling declared twice fails the check, naming the key and both lines', async (t) => {
  const twice = aManifestWithTheCeilingTwice(2)
  const findings = (await judgeTheTree(craft(t, twice.text))).findings.map(describe)
  assert.deepEqual(findings, [
    `package.json declares ${CEILINGS_NAME}.${AN_ADAPTER} 2 times, at line ${String(twice.line)} ("${AN_ADAPTER}") and ` +
      `line ${String(twice.line + 1)} ("${AN_ADAPTER}"): JSON.parse keeps the last and hides the rest`,
  ])
})

test('a key declared twice at the root is found too: any object, not only the ceilings', () => {
  const twice = withTheLineDeclaredAgain(theManifestOfAPlantedTree({}), '"type"')
  assert.deepEqual(keysDeclaredTwice(twice.text), [{ key: 'type', lines: [twice.line, twice.line + 1], spellings: ['"type"', '"type"'] }])
})

test('two spellings of one name are one key, as JSON.parse reads them, and each line shows its own spelling', () => {
  const text = '{\n  "a": 1,\n  "\\u0061": 2\n}\n'
  assert.deepEqual(keysDeclaredTwice(text), [{ key: 'a', lines: [2, 3], spellings: ['"a"', '"\\u0061"'] }])
})

test('an object inside an array is read as well, its key named with the index', () => {
  const text = '{\n  "files": [\n    {},\n    { "x": 1,\n      "x": 2 }\n  ]\n}\n'
  assert.deepEqual(keysDeclaredTwice(text), [{ key: 'files[1].x', lines: [4, 5], spellings: ['"x"', '"x"'] }])
})

/** The record command run over `root`: its exit code, and what it printed to stderr. */
function record(root: string): { readonly status: number | null; readonly stderr: string } {
  const run = spawnSync(process.execPath, [THE_CHECK, '--repository', root, '--record'], { encoding: 'utf8' })
  return { status: run.status, stderr: run.stderr }
}

test('the record command refuses a manifest with a key declared twice and leaves it as it was, with nothing to lower', (t) => {
  const twice = aManifestWithTheCeilingTwice(2)
  const root = craft(t, twice.text)
  const recorded = record(root)
  assert.equal(recorded.status, 2, `the record run did not refuse: ${recorded.stderr}`)
  assert.match(recorded.stderr, THE_CEILING_TWICE)
  assert.equal(readFileSync(manifestPathOf(root), 'utf8'), twice.text, 'the record run wrote the manifest')
})

test('the record command refuses it too when a ceiling would come down, and writes nothing', (t) => {
  const twice = aManifestWithTheCeilingTwice(3)
  const root = craft(t, twice.text)
  const recorded = record(root)
  assert.equal(recorded.status, 2, `the record run did not refuse: ${recorded.stderr}`)
  assert.equal(readFileSync(manifestPathOf(root), 'utf8'), twice.text, 'the record run wrote the manifest')
})

test('the one writer of the maps refuses a text that declares a key twice, rather than dropping one', () => {
  const twice = aManifestWithTheCeilingTwice(2)
  assert.throws(() => withCeilings(twice.text, { [AN_ADAPTER]: 2 }), THE_CEILING_TWICE)
})

test('a merge refuses a stage that declares a key twice, naming the stage and the key', () => {
  const once = theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 2 } })
  const merged = thePackageJsonOfAMerge('/a/clone', once, aManifestWithTheCeilingTwice(2).text, once)
  assert.ok('refused' in merged, 'the merge wrote a manifest from a stage that hides a declaration')
  assert.match(merged.refused, /^stage 2 of package\.json: package\.json /)
  assert.match(merged.refused, THE_CEILING_TWICE)
})

// Every map `martha` declares, one key of it declared twice with two different values (martha#778).
//
// A copy of the declaring line proves the key is seen; it proves nothing about which value a reader kept or a writer
// would drop, because both declarations say the same thing. These plants differ in value, and each map's name is taken
// from this repository's own manifest rather than from a list here, so a map added later is judged without this file
// being edited.

/** The repository this check lives in: its own package.json is where the maps under `martha` are read from. */
const THE_REPOSITORY = join(import.meta.dirname, '..', '..')

/** The key a plant declares twice: a name no map of the manifest holds, so the plant carries nothing but its two lines. */
const THE_PLANTED_KEY = 'a-key-a-plant-declares-twice'

/** The value a plant's second declaration holds: the one JSON.parse keeps, and the one that hides the first. */
const A_PLANTED_VALUE = 2

/** What a plant writes where its map goes, before the two declarations are put in the marker's place. */
const THE_MARK_OF_A_MAP = 'the map a plant writes in the marker\'s place'

/** The map a plant puts in the marker's place: one key declared twice, holding two different values. */
const A_MAP_HOLDING_ONE_KEY_TWICE = `{\n    "${THE_PLANTED_KEY}": 1,\n    "${THE_PLANTED_KEY}": ${String(A_PLANTED_VALUE)}\n  }`

/** A manifest text declaring one key of `map` twice, and the line each declaration stands on. */
interface APlantOfAMap {
  readonly text: string
  readonly lines: readonly [number, number]
}

/** Whether a value `martha` holds is a map: an object of keys, never an array. */
const isAMap = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The maps `martha` declares, read from this repository's own manifest. */
const theMapsUnderMartha = (): string[] => {
  const martha = (JSON.parse(manifestTextOf(THE_REPOSITORY)) as { martha?: Readonly<Record<string, unknown>> }).martha
  return Object.entries(martha ?? {}).filter(([, value]) => isAMap(value)).map(([name]) => name)
}

/** A manifest declaring `map` with one key twice, holding two different values, and the line each declaration is on. */
function aPlantDeclaringTheMapTwice(map: string): APlantOfAMap {
  const martha: Record<string, unknown> = { hostAdapters: [], hostGlue: [], hostCeilings: {}, sliceCap: A_PLANTED_SLICE_CAP }
  martha[map] = THE_MARK_OF_A_MAP
  const text = JSON.stringify({ type: 'module', martha }, null, 2).replace(`"${THE_MARK_OF_A_MAP}"`, A_MAP_HOLDING_ONE_KEY_TWICE)
  const lines = text.split('\n')
  const lineHolding = (value: number): number => lines.findIndex((line) => line.trim().startsWith(`"${THE_PLANTED_KEY}": ${String(value)}`)) + 1
  return { text, lines: [lineHolding(1), lineHolding(A_PLANTED_VALUE)] }
}

/** The finding a plant's two declarations must print, in the check's own words. */
const THE_FINDING_FOR_THE_PLANT = (map: string, lines: readonly [number, number]): string =>
  `package.json declares martha.${map}.${THE_PLANTED_KEY} 2 times, at ` +
  `line ${String(lines[0])} ("${THE_PLANTED_KEY}") and line ${String(lines[1])} ("${THE_PLANTED_KEY}"): ` +
  'JSON.parse keeps the last and hides the rest'

test('a key declared twice with two different values fails in every map martha declares, naming both lines (martha#778)', async (t) => {
  const maps = theMapsUnderMartha()
  assert.ok(maps.length > 0, 'this repository declares a map under martha')
  const passed: string[] = []
  for (const map of maps) {
    const plant = aPlantDeclaringTheMapTwice(map)
    // The plant is the hidden kind: JSON.parse keeps the later declaration and says nothing about the first.
    assert.equal((JSON.parse(plant.text) as { martha: Record<string, Record<string, number>> }).martha[map]?.[THE_PLANTED_KEY], A_PLANTED_VALUE)
    const found = (await judgeTheTree(craft(t, plant.text))).findings.filter((finding) => finding.kind === 'duplicate_key').map(describe)
    if (found.length !== 1 || found[0] !== THE_FINDING_FOR_THE_PLANT(map, plant.lines)) passed.push(`martha.${map}: a key declared twice with two values passed the check`)
  }
  assert.deepEqual(passed, [])
})

test('the program CI runs fails on a map outside the ceilings, and its stderr names the key and both lines (martha#778)', (t) => {
  const map = theMapsUnderMartha().find((name) => !CEILINGS_NAME.endsWith(`.${name}`))
  assert.ok(map !== undefined, 'this repository declares a map under martha that is not the ceilings')
  const plant = aPlantDeclaringTheMapTwice(map)
  const run = spawnSync(process.execPath, [THE_CHECK, '--repository', craft(t, plant.text)], { encoding: 'utf8' })
  assert.equal(run.status, 1, `the check did not fail on the plant: ${run.stderr}`)
  assert.match(run.stderr, new RegExp(escaped(THE_FINDING_FOR_THE_PLANT(map, plant.lines))))
})
