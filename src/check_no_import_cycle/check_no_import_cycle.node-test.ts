// What the check's bite rests on (martha#525): a planted tree whose files load each other in a loop, judged by the same
// path the run CI makes uses, and the command itself asked for its verdict, so the loop it prints is the one a change
// would see.
//
// The mutants, each named in its test's title:
//   - the type-only filter dropped: a tree whose only loop is closed by `import type` must stay clean, so the filter is
//     what keeps it clean — and this tree's own core holds one such pair, which that mutant makes a finding;
//   - the group replaced by the first file the walk entered: a group holding two loops among four files must be named
//     once, by all four, so the one excused cannot hide the other.
//
// A third test, the file outside `src/`, is a boundary rather than a mutant: a path that is no source of the core is
// written among a source's imports and followed no further, and the test says what that means for a tree that names
// one. A walk that followed it would have to read the files of the repository's own checks, which it does not do.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { judgeTree } from './judge_a_tree.ts'
import type { DeclaredCycle } from './the_exceptions.ts'

/** The repository this check lives in: this file's directory, two levels below it. */
const CHECKOUT = join(import.meta.dirname, '..', '..')

/** A tree a test owns, holding `files` by their path under it, removed when the test ends. */
const plantedTree = (t: TestContext, files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(join(tmpdir(), 'martha-525-cycles-'))
  t.after(() => removeTheTree(root))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

/** Two files that load each other: the smallest loop there is. */
const A_PAIR_IN_A_LOOP: Readonly<Record<string, string>> = {
  'src/one/a.ts': "import { b } from '../two/b.ts'\nexport const a = b\n",
  'src/two/b.ts': "import { a } from '../one/a.ts'\nexport const b = a\n",
}

/** The command's own verdict on `root`, as a change would read it. */
const theCommandOn = (root: string): { readonly status: number | null; readonly said: string } => {
  const ran = spawnSync(process.execPath, [join(CHECKOUT, 'src', 'check_no_import_cycle', 'main.ts'), '--root', root], { encoding: 'utf8' })
  return { status: ran.status, said: `${ran.stdout}${ran.stderr}` }
}

test('the command fails a planted loop and prints the whole path it runs, from its first file round to it again', (t) => {
  const root = plantedTree(t, A_PAIR_IN_A_LOOP)
  const judged = judgeTree(root, [])
  assert.equal(judged.findings.length, 1, 'the pair is one loop')
  assert.deepEqual(judged.findings[0]?.through, ['one/a.ts', 'two/b.ts', 'one/a.ts'], 'the loop is the whole path, closed')
  const { status, said } = theCommandOn(root)
  // Exit 1 is the refused verdict, not any non-zero: exit 2 is "could not look", which must never read as a bite.
  assert.equal(status, 1, said)
  assert.ok(said.includes('src/one/a.ts -> src/two/b.ts -> src/one/a.ts'), said)
})

test('the type-only filter kept: a loop closed by `import type` is no loop, because a type is gone at run time', (t) => {
  const root = plantedTree(t, {
    'src/one/a.ts': "import type { B } from '../two/b.ts'\nexport const a: B = { b: 1 }\n",
    'src/two/b.ts': "import { a } from '../one/a.ts'\nexport interface B { readonly b: number }\nexport const b = a\n",
  })
  assert.deepEqual(judgeTree(root, []).findings, [], 'the type-only import closes nothing')
})

test('the walk stays in the core: a file that loads one outside src/ is no loop of the core', (t) => {
  const root = plantedTree(t, {
    'src/one/a.ts': "import { help } from '../../prove_the_core/planted.ts'\nexport const a = help\n",
    'prove_the_core/planted.ts': "import { a } from '../src/one/a.ts'\nexport const help = a\n",
  })
  assert.deepEqual(judgeTree(root, []).findings, [], 'the outside file is not a module of the core')
})

test('an export … from, a dynamic import and a require each close a loop the way an import does', (t) => {
  const throughAnExport = plantedTree(t, {
    'src/one/a.ts': "export { b } from '../two/b.ts'\n",
    'src/two/b.ts': "import { a } from '../one/a.ts'\nexport const b = a\n",
  })
  const throughADynamicImport = plantedTree(t, {
    'src/one/a.ts': "export const load = async () => (await import('../two/b.ts')).b\n",
    'src/two/b.ts': "import { load } from '../one/a.ts'\nexport const b = load\n",
  })
  const throughARequire = plantedTree(t, {
    'src/one/a.ts': "export const b = require('../two/b.ts')\n",
    'src/two/b.ts': "import { b } from '../one/a.ts'\nexport const a = b\n",
  })
  for (const [kind, root] of [['an export from', throughAnExport], ['a dynamic import', throughADynamicImport], ['a require', throughARequire]] as const) {
    assert.equal(judgeTree(root, []).findings.length, 1, `${kind} closes a loop`)
  }
})

test('a group whose files load each other by two different loops is named once, by all of its files', (t) => {
  // a -> b -> d -> a and a -> c -> d -> a: four files, one group, two loops, and the loop written runs through three.
  const root = plantedTree(t, {
    'src/a/a.ts': "import { b } from './b.ts'\nimport { c } from './c.ts'\nexport const a = [b, c]\n",
    'src/a/b.ts': "import { d } from './d.ts'\nexport const b = d\n",
    'src/a/c.ts': "import { d } from './d.ts'\nexport const c = d\n",
    'src/a/d.ts': "import { a } from './a.ts'\nexport const d = a\n",
  })
  const judged = judgeTree(root, [])
  assert.equal(judged.findings.length, 1, 'one group, however many loops run through it')
  assert.deepEqual(judged.findings[0]?.files, ['a/a.ts', 'a/b.ts', 'a/c.ts', 'a/d.ts'], 'the exception has to name every file of it')
  assert.deepEqual(judged.findings[0]?.through, ['a/a.ts', 'a/b.ts', 'a/d.ts', 'a/a.ts'], 'and the loop is written in full')
})

test('an exception excuses the group it names and nothing else, and one that excuses nothing is a finding of its own', (t) => {
  const root = plantedTree(t, A_PAIR_IN_A_LOOP)
  const thePair: DeclaredCycle = { files: ['one/a.ts', 'two/b.ts'], reason: 'planted', removed_by: '#525' }
  assert.deepEqual(judgeTree(root, [thePair]).findings, [], 'the group it names is excused')
  assert.deepEqual(judgeTree(root, [thePair]).stale, [], 'and it excuses something')
  const elsewhere: DeclaredCycle = { files: ['one/a.ts', 'three/c.ts'], reason: 'planted', removed_by: '#525' }
  const judged = judgeTree(root, [elsewhere])
  assert.equal(judged.findings.length, 1, 'a loop the exception does not name is still a finding')
  assert.deepEqual(judged.stale, [elsewhere], 'and the exception that named other files excuses nothing')
})

test('the core this check lives in holds no loop of value imports', () => {
  const judged = judgeTree(CHECKOUT)
  assert.ok(judged.files > 0, 'the check looked')
  assert.deepEqual(judged.findings.map((loop) => loop.through), [], 'no loop')
  assert.deepEqual(judged.stale, [], 'and no exception that has stopped matching the tree')
})
