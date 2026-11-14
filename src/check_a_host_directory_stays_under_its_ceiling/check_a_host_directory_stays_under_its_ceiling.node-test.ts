// The ceiling bites (martha#322), both ways (martha#341).
//
// A host directory's ceiling is only worth having if it fails a directory that
// grew by one line of code, and stays quiet for what is not code. These plants
// are small trees, each judged by the same path the command CI runs takes
// (judge_the_tree.ts), so a change to the counting or the judgement reaches both.
// What decides whether a file is code is the linter, answered from the tree's own
// eslint config, and what decides whether a line is code is the compiler: a plant
// that only exercised a helper would prove neither.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { manifestPathOf } from '../../prove_the_core/declared_in_package_json.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { LINTER_CONFIG, theManifestOfAPlantedTree, type Planted } from './a_tree_whose_ceilings_a_test_reads.ts'
import { describe, RECORD_COMMAND } from './check_a_host_directory_stays_under_its_ceiling.ts'
import { judgeTheTree } from './judge_the_tree.ts'
import { withLoweredCeilings, withLoweredSliceCeilings } from './record_the_ceilings.ts'
import { describeASlice } from './the_core_slices_under_the_cap.ts'

const plantedPackageJson = theManifestOfAPlantedTree

/** Writes the tree, and removes it when the test ends. */
const craft = (t: TestContext, planted: Planted): string => {
  const root = mkdtempSync(join(tmpdir(), 'ceilings-'))
  t.after(() => removeTheTree(root))
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  write('eslint.config.mjs', LINTER_CONFIG)
  writeFileSync(manifestPathOf(root), plantedPackageJson(planted))
  for (const [path, text] of Object.entries(planted.files ?? {})) write(path, text)
  return root
}

/** What a red run would print over the tree. */
const findingsIn = async (root: string): Promise<string[]> => {
  const judged = await judgeTheTree(root)
  return judged.findings.map(describe)
}

/** Two lines of code, and lines that are not code: blank, a comment, and a block comment. */
const TWO_LINES = 'export const a = 1\nexport const b = 2\n'
const NO_CODE = '\n// a line of commentary\n\n/*\n   a block of it\n*/\n'

test('a directory at its ceiling passes, and one code line over fails naming it, its count and its ceiling', async (t) => {
  const files = { 'src/an_adapter/an_adapter.ts': TWO_LINES + NO_CODE }
  const at = craft(t, { adapters: ['src/an_adapter'], ceilings: { 'src/an_adapter': 2 }, files })
  assert.deepEqual(await findingsIn(at), [], 'the commentary and the blank lines of the file spend no budget')

  const over = craft(t, { adapters: ['src/an_adapter'], ceilings: { 'src/an_adapter': 1 }, files })
  assert.deepEqual(await findingsIn(over), [
    'src/an_adapter: 2 lines of code, ceiling 1 (martha.hostCeilings)\n' +
      '  an adapter composes slices of the core; a decision inside it belongs in a slice',
  ])
})

test('a declared directory with no ceiling fails, naming the list that declared it', async (t) => {
  const files = { 'src/an_adapter/a.ts': TWO_LINES, 'src/the_glue/g.ts': TWO_LINES }
  const root = craft(t, { adapters: ['src/an_adapter'], glue: ['src/the_glue'], files })
  assert.deepEqual(await findingsIn(root), [
    'martha.hostAdapters names src/an_adapter, which has no ceiling in martha.hostCeilings',
    'martha.hostGlue names src/the_glue, which has no ceiling in martha.hostCeilings',
  ])
})

test('a host recording kept as JSON beside the sources does not count', async (t) => {
  const files = {
    'src/an_adapter/an_adapter.ts': TWO_LINES,
    'src/an_adapter/recorded_the_host.json': '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n',
  }
  const root = craft(t, { adapters: ['src/an_adapter'], ceilings: { 'src/an_adapter': 2 }, files })
  assert.deepEqual(await findingsIn(root), [], 'the recording carries no budget, so the ceiling holds')
})

test('code in a dot directory counts, at whatever depth it sits', async (t) => {
  const files = {
    'src/an_adapter/an_adapter.ts': TWO_LINES,
    'src/an_adapter/.claude-plugin/plugin.ts': TWO_LINES,
    'src/an_adapter/hooks/a/b/c/deep.ts': TWO_LINES,
  }
  const root = craft(t, { adapters: ['src/an_adapter'], ceilings: { 'src/an_adapter': 6 }, files })
  assert.deepEqual(await findingsIn(root), [])
  assert.deepEqual(
    await findingsIn(craft(t, { adapters: ['src/an_adapter'], ceilings: { 'src/an_adapter': 5 }, files })),
    [
      'src/an_adapter: 6 lines of code, ceiling 5 (martha.hostCeilings)\n' +
        '  an adapter composes slices of the core; a decision inside it belongs in a slice',
    ],
    'the dot directory and the nested one are counted, so dropping either from the walk frees five lines of budget',
  )
})

test('a test file beside the sources does not count', async (t) => {
  const files = {
    'src/an_adapter/an_adapter.ts': TWO_LINES,
    'src/an_adapter/an_adapter.node-test.ts': TWO_LINES.repeat(50),
  }
  const root = craft(t, { adapters: ['src/an_adapter'], ceilings: { 'src/an_adapter': 2 }, files })
  assert.deepEqual(await findingsIn(root), [])
})

test('recording brings a ceiling down, and never raises one nor invents one', () => {
  const text = plantedPackageJson({
    adapters: ['src/shrunk', 'src/grew', 'src/newcomer'],
    ceilings: { 'src/shrunk': 30, 'src/grew': 5 },
  })
  const recorded = withLoweredCeilings(text, { 'src/shrunk': 12, 'src/grew': 40, 'src/newcomer': 9 })
  assert.deepEqual(recorded.lowered, [{ directory: 'src/shrunk', from: 30, to: 12 }])
  const after = JSON.parse(recorded.text) as { martha: { hostCeilings: Record<string, number> } }
  assert.deepEqual(after.martha.hostCeilings, { 'src/shrunk': 12, 'src/grew': 5 }, 'nothing was raised or added')
  assert.equal(withLoweredCeilings(recorded.text, { 'src/shrunk': 99 }).text, recorded.text, 'and a rise writes nothing')
  assert.ok(recorded.text.includes(`"src/shrunk": 12`), 'the number is written as the map holds it, unformatted')
})

test('a ceiling above its directory fails naming the headroom and the command that lowers it (#341)', async (t) => {
  const files = { 'src/an_adapter/an_adapter.ts': TWO_LINES, 'src/the_glue/g.ts': TWO_LINES }
  const root = craft(t, {
    adapters: ['src/an_adapter'],
    glue: ['src/the_glue'],
    ceilings: { 'src/an_adapter': 3, 'src/the_glue': 2 },
    files,
  })
  assert.deepEqual(await findingsIn(root), [
    'src/an_adapter: 2 lines of code, ceiling 3 (martha.hostCeilings): 1 line(s) of room to grow back unseen\n' +
      `  lower it in the change that shrank it: ${RECORD_COMMAND}`,
  ])
})

test('after recording, a tree with headroom passes: the check fails exactly when recording would write (#341)', async (t) => {
  const files = { 'src/shrunk/a.ts': TWO_LINES, 'src/held/h.ts': TWO_LINES }
  const root = craft(t, { adapters: ['src/shrunk', 'src/held'], ceilings: { 'src/shrunk': 3, 'src/held': 2 }, files })
  assert.equal((await findingsIn(root)).length, 1, 'the shrunk directory fails before it is recorded')

  const judged = await judgeTheTree(root)
  const recorded = withLoweredCeilings(readFileSync(manifestPathOf(root), 'utf8'), judged.code)
  assert.deepEqual(recorded.lowered, [{ directory: 'src/shrunk', from: 3, to: 2 }])
  writeFileSync(manifestPathOf(root), recorded.text)
  assert.deepEqual(await findingsIn(root), [], 'and nothing fails once the ceiling follows the code down')
})

// --- #415: every core slice under one cap, and the few above it at their own ceiling -------------------------------

/** What a red run would print over the tree about its core slices. */
const sliceFindingsIn = async (root: string): Promise<string[]> => (await judgeTheTree(root)).slice_findings.map(describeASlice)

const THREE_LINES = `${TWO_LINES}export const c = 3\n`
const MOVE_IT = '  move the decision into the slice that owns it, not into a new slice made to hold it'

test('#415: a core slice at the cap passes, and one code line over fails naming it, its count and the cap', async (t) => {
  assert.deepEqual(await sliceFindingsIn(craft(t, { slice_cap: 2, files: { 'src/a_slice/a.ts': TWO_LINES + NO_CODE } })), [])
  assert.deepEqual(await sliceFindingsIn(craft(t, { slice_cap: 2, files: { 'src/a_slice/a.ts': THREE_LINES } })), [
    `src/a_slice: 3 lines of code, over the cap of 2 (martha.sliceCap)\n${MOVE_IT}`,
  ])
})

test('#415: a new slice over the cap fails as any slice does, and a host directory is never held to the cap', async (t) => {
  const files = { 'src/an_adapter/a.ts': THREE_LINES, 'src/a_new_slice/n.ts': THREE_LINES }
  const root = craft(t, { slice_cap: 2, adapters: ['src/an_adapter'], ceilings: { 'src/an_adapter': 3 }, files })
  assert.deepEqual(await findingsIn(root), [], 'the adapter is held to its own ceiling')
  assert.deepEqual(await sliceFindingsIn(root), [`src/a_new_slice: 3 lines of code, over the cap of 2 (martha.sliceCap)\n${MOVE_IT}`])
})

test('#415: src/host_contract is a core slice under the cap, though package.json names it as the contract', async (t) => {
  const root = craft(t, { slice_cap: 2, host_contract: 'src/host_contract', files: { 'src/host_contract/host_contract.ts': THREE_LINES } })
  assert.deepEqual(await sliceFindingsIn(root), [`src/host_contract: 3 lines of code, over the cap of 2 (martha.sliceCap)\n${MOVE_IT}`])
  assert.deepEqual(Object.keys((await judgeTheTree(root)).slices), ['src/host_contract'])
})

test('#415: a tree that declares no cap fails by name, and is never passed because nothing held its slices', async (t) => {
  assert.deepEqual(await sliceFindingsIn(craft(t, { slice_cap: null, files: { 'src/a_slice/a.ts': TWO_LINES } })), [
    'martha.sliceCap is not declared, so no core slice is held to a ceiling',
  ])
})

test('#415: a slice above the cap is held to its own ceiling: over it fails, and room under it fails until it is recorded', async (t) => {
  const files = { 'src/big/b.ts': THREE_LINES }
  assert.deepEqual(await sliceFindingsIn(craft(t, { slice_cap: 1, slice_ceilings: { 'src/big': 3 }, files })), [], 'at its ceiling')
  assert.deepEqual(await sliceFindingsIn(craft(t, { slice_cap: 1, slice_ceilings: { 'src/big': 2 }, files })), [
    `src/big: 3 lines of code, ceiling 2 (martha.sliceCeilings)\n${MOVE_IT}`,
  ])
  assert.deepEqual(await sliceFindingsIn(craft(t, { slice_cap: 1, slice_ceilings: { 'src/big': 4 }, files })), [
    `src/big: 3 lines of code, ceiling 4 (martha.sliceCeilings): 1 line(s) of room to grow back unseen\n  lower it in the change that shrank it: ${RECORD_COMMAND}`,
  ])
})

test('#415: an exception for a slice at or under the cap, or for no slice at all, fails by name', async (t) => {
  const root = craft(t, { slice_cap: 3, slice_ceilings: { 'src/shrunk': 4, 'src/gone': 9 }, files: { 'src/shrunk/s.ts': THREE_LINES } })
  assert.deepEqual(await sliceFindingsIn(root), [
    `martha.sliceCeilings holds src/shrunk at 4, and it is 3 lines, at or under the cap of 3\n  remove the exception in the change that shrank it: ${RECORD_COMMAND}`,
    'martha.sliceCeilings names src/gone, which is no core slice',
  ])
})

test('#415: recording lowers an exception, takes out one at or under the cap, and never raises one nor invents one', () => {
  const text = plantedPackageJson({ slice_cap: 10, slice_ceilings: { 'src/shrunk': 30, 'src/under': 12, 'src/grew': 15 } })
  const recorded = withLoweredSliceCeilings(text, { 'src/shrunk': 20, 'src/under': 10, 'src/grew': 40, 'src/newcomer': 50 })
  assert.deepEqual(recorded.lowered, [{ directory: 'src/shrunk', from: 30, to: 20 }])
  assert.deepEqual(recorded.removed, ['src/under'])
  const after = JSON.parse(recorded.text) as { martha: { sliceCeilings: Record<string, number> } }
  assert.deepEqual(after.martha.sliceCeilings, { 'src/shrunk': 20, 'src/grew': 15 }, 'nothing was raised or added, and the slice under the cap lost its exception')
  assert.equal(withLoweredSliceCeilings(recorded.text, { 'src/shrunk': 20, 'src/grew': 99 }).text, recorded.text, 'and a rise writes nothing')
})

test('#415: after recording, a tree whose slice shrank under the cap passes', async (t) => {
  const root = craft(t, { slice_cap: 3, slice_ceilings: { 'src/shrunk': 5 }, files: { 'src/shrunk/s.ts': TWO_LINES } })
  assert.equal((await sliceFindingsIn(root)).length, 1, 'the stale exception fails before it is recorded')
  const recorded = withLoweredSliceCeilings(readFileSync(manifestPathOf(root), 'utf8'), (await judgeTheTree(root)).slices)
  writeFileSync(manifestPathOf(root), recorded.text)
  assert.deepEqual(await sliceFindingsIn(root), [])
})
