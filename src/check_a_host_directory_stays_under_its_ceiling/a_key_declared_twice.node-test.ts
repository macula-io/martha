// A key package.json declares twice fails by name, and no writer drops one unseen (martha#753).
//
// JSON.parse keeps the last declaration of a key and drops the others without a word, so every reader built on the
// parsed manifest is blind to a duplicate: main carried one host ceiling twice, and nothing failed. These plants write
// package.json as TEXT — through JSON.stringify the duplicate would vanish, which is the bug — and judge it by the path
// the command CI runs takes, run the record command as the program it is, and hand a merge a stage that holds one.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { escaped, manifestPathOf } from '../../prove_the_core/declared_in_package_json.ts'
import { keysDeclaredTwice } from '../../prove_the_core/keys_declared_twice.ts'
import { CEILINGS_NAME, withCeilings } from '../../prove_the_core/the_host_ceilings.ts'
import { thePackageJsonOfAMerge } from '../redo_the_generated_files_of_a_merge/the_ceilings_a_merge_brings.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { LINTER_CONFIG, theManifestOfAPlantedTree } from './a_tree_whose_ceilings_a_test_reads.ts'
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
