// The ceiling bites (martha#322).
//
// A host directory's ceiling is only worth having if it fails a directory that
// grew by one line of code, and stays quiet for what is not code. These plants
// are small trees, each judged by the same path the command CI runs takes
// (judge_the_tree.ts), so a change to the counting or the judgement reaches both.
// What decides whether a file is code is the linter, answered from the tree's own
// eslint config, and what decides whether a line is code is the compiler: a plant
// that only exercised a helper would prove neither.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { MANIFEST } from '../../prove_the_core/declared_in_package_json.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { describe } from './check_a_host_directory_stays_under_its_ceiling.ts'
import { judgeTheTree } from './judge_the_tree.ts'
import { withLoweredCeilings } from './record_the_ceilings.ts'

/** A tree to judge: the two lists, the ceilings, and the files under it. */
interface Planted {
  readonly adapters?: readonly string[]
  readonly glue?: readonly string[]
  readonly ceilings?: Readonly<Record<string, number>>
  readonly files?: Readonly<Record<string, string>>
}

/** The linter's config the linter itself reads: code by extension, as the repository's own does. */
const LINTER_CONFIG = "export default [{ files: ['**/*.{ts,tsx}'], rules: { 'max-depth': ['error', { max: 2 }] } }]\n"

const plantedPackageJson = (planted: Planted): string =>
  `${JSON.stringify(
    {
      martha: {
        hostAdapters: planted.adapters ?? [],
        hostGlue: planted.glue ?? [],
        hostCeilings: planted.ceilings ?? {},
      },
    },
    null,
    2,
  )}\n`

/** Writes the tree, and removes it when the test ends. */
const craft = (t: TestContext, planted: Planted): string => {
  const root = mkdtempSync(join(tmpdir(), 'ceilings-'))
  t.after(() => removeTheTree(root))
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  write('eslint.config.mjs', LINTER_CONFIG)
  write(MANIFEST, plantedPackageJson(planted))
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

test('recording brings a ceiling down, and never raises one nor invents one', async (t) => {
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

  const root = craft(t, { adapters: ['src/shrunk'], ceilings: { 'src/shrunk': 30 }, files: { 'src/shrunk/a.ts': TWO_LINES } })
  assert.deepEqual(await findingsIn(root), [], 'a ceiling above the count is not a failure until it is recorded down')
})
