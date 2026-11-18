// What the check's bite rests on (martha#525, and every tree of the repository since martha#748): a planted tree whose
// files load each other in a loop, judged by the same path the run CI makes uses, and the command itself asked for its
// verdict, so the loop it prints is the one a change would see.
//
// The mutants, each named in its test's title:
//   - the type-only filter dropped: a tree whose only loop is closed by `import type` must stay clean, so the filter is
//     what keeps it clean — and this tree's own core holds one such pair, which that mutant makes a finding;
//   - the group replaced by the first file the walk entered: a group holding two loops among four files must be named
//     once, by all four, so the one excused cannot hide the other;
//   - the roots walk narrowed back to `src/`: a loop planted under `installer/`, and one that runs between two trees,
//     must be findings, so a walk that reads one tree is what this test says is not enough;
//   - the skip read from the absolute path, or read at the top level only: a tree under a dot-directory must still be
//     read in full, and a loop inside an installed package must stay no finding while the one beside it is one;
//   - the repository root's own files left out: a loop through a file that sits directly in the root must be named.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { judgeTree } from './judge_a_tree.ts'
import type { DeclaredCycle } from './the_exceptions.ts'

/** The repository this check lives in: this file's directory, two levels below it. */
const CHECKOUT = join(import.meta.dirname, '..', '..')

/** Writes `files` by their path under `root`. */
const plant = (root: string, files: Readonly<Record<string, string>>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

/** A tree a test owns, holding `files` by their path under it, removed when the test ends. */
const plantedTree = (t: TestContext, files: Readonly<Record<string, string>>): string => {
  // Resolved, because CI runs the suite with TMPDIR on a symlink and the walk spells its paths from the root it is given.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-525-cycles-')))
  t.after(() => removeTheTree(root))
  plant(root, files)
  return root
}

/** A tree a test owns whose own path sits inside a directory named with a leading dot: the root is read in full. */
const plantedTreeInsideADotDirectory = (t: TestContext, files: Readonly<Record<string, string>>): string => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'martha-748-cycles-')))
  t.after(() => removeTheTree(base))
  const root = join(base, '.hidden-root')
  plant(root, files)
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
  assert.deepEqual(judged.findings[0]?.through, ['src/one/a.ts', 'src/two/b.ts', 'src/one/a.ts'], 'the loop is the whole path, closed')
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

test('a file of one tree that loads a file of another tree is a loop of the repository, and the whole path is named', (t) => {
  const root = plantedTree(t, {
    'src/one/a.ts': "import { help } from '../../prove_the_core/planted.ts'\nexport const a = help\n",
    'prove_the_core/planted.ts': "import { a } from '../src/one/a.ts'\nexport const help = a\n",
  })
  const judged = judgeTree(root, [])
  assert.equal(judged.findings.length, 1, 'the two files load each other, whichever trees they sit in')
  assert.deepEqual(judged.findings[0]?.files, ['prove_the_core/planted.ts', 'src/one/a.ts'], 'both files are named')
  const { status, said } = theCommandOn(root)
  assert.equal(status, 1, said)
  assert.ok(said.includes('prove_the_core/planted.ts'), said)
  assert.ok(said.includes('src/one/a.ts'), said)
})

test('a loop under a tree that is not src/ fails by name', (t) => {
  const root = plantedTree(t, {
    'installer/one.ts': "import { two } from './two.ts'\nexport const one = two\n",
    'installer/two.ts': "import { one } from './one.ts'\nexport const two = one\n",
  })
  const judged = judgeTree(root, [])
  assert.equal(judged.findings.length, 1, 'the tree outside src/ is judged like the core is')
  assert.deepEqual(judged.findings[0]?.files, ['installer/one.ts', 'installer/two.ts'], 'the whole group is named')
  const { status, said } = theCommandOn(root)
  assert.equal(status, 1, said)
  assert.ok(said.includes('installer/one.ts -> installer/two.ts -> installer/one.ts'), said)
})

test('a loop that runs between two trees is found, whichever two they are', (t) => {
  const acrossTheCoreAndACheck = plantedTree(t, {
    'prove_the_core/a.ts': "import { b } from '../src/b.ts'\nexport const a = b\n",
    'src/b.ts': "import { a } from '../prove_the_core/a.ts'\nexport const b = a\n",
  })
  const acrossTwoTreesAboveTheCore = plantedTree(t, {
    'architecture/a.ts': "import { b } from '../rehearse_a_release/b.ts'\nexport const a = b\n",
    'rehearse_a_release/b.ts': "import { a } from '../architecture/a.ts'\nexport const b = a\n",
  })
  assert.deepEqual(judgeTree(acrossTheCoreAndACheck, []).findings[0]?.files, ['prove_the_core/a.ts', 'src/b.ts'], 'a check and the core')
  assert.deepEqual(judgeTree(acrossTwoTreesAboveTheCore, []).findings[0]?.files, ['architecture/a.ts', 'rehearse_a_release/b.ts'], 'two trees, neither of them src/')
})

test('a file directly in the repository root is judged too, and a loop through it is named', (t) => {
  const root = plantedTree(t, {
    'root_one.mjs': "import { x } from './installer/x.ts'\nexport const one = x\n",
    'installer/x.ts': "import { one } from '../root_one.mjs'\nexport const x = one\n",
  })
  const judged = judgeTree(root, [])
  assert.equal(judged.findings.length, 1, 'the root file belongs to no tree, and is judged anyway')
  assert.deepEqual(judged.findings[0]?.files, ['installer/x.ts', 'root_one.mjs'], 'the root file is named by its bare name')
  const { status, said } = theCommandOn(root)
  assert.equal(status, 1, said)
  assert.ok(said.includes('root_one.mjs'), said)
})

test('installed packages are not this repository: a loop inside node_modules is no finding, and the one beside it is', (t) => {
  const root = plantedTree(t, {
    'installer/one.ts': "import { two } from './two.ts'\nexport const one = two\n",
    'installer/two.ts': "import { one } from './one.ts'\nexport const two = one\n",
    'installer/node_modules/a-package/a.js': "import { b } from './b.js'\nexport const a = b\n",
    'installer/node_modules/a-package/b.js': "import { a } from './a.js'\nexport const b = a\n",
  })
  const judged = judgeTree(root, [])
  assert.equal(judged.findings.length, 1, 'only the package of this repository is a finding')
  assert.deepEqual(judged.findings[0]?.files, ['installer/one.ts', 'installer/two.ts'], 'and the installed pair is not named')
})

test('a script whose own name starts with a dot is a source like any other', (t) => {
  const root = plantedTree(t, {
    'installer/.x.ts': "import { two } from './two.ts'\nexport const x = two\n",
    'installer/two.ts': "import { x } from './.x.ts'\nexport const two = x\n",
  })
  assert.deepEqual(judgeTree(root, []).findings[0]?.files, ['installer/.x.ts', 'installer/two.ts'], 'only dot-DIRECTORIES are skipped')
})

test('a tree whose own path sits inside a dot-directory is read in full', (t) => {
  const root = plantedTreeInsideADotDirectory(t, A_PAIR_IN_A_LOOP)
  const judged = judgeTree(root, [])
  assert.ok(judged.files > 0, 'the walk looked, though its root is inside a dot-directory')
  assert.equal(judged.findings.length, 1, 'and the loop planted in it is found')
  assert.deepEqual(judged.findings[0]?.through, ['src/one/a.ts', 'src/two/b.ts', 'src/one/a.ts'], 'spelled from the root, never from above it')
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
  assert.deepEqual(judged.findings[0]?.files, ['src/a/a.ts', 'src/a/b.ts', 'src/a/c.ts', 'src/a/d.ts'], 'the exception has to name every file of it')
  assert.deepEqual(judged.findings[0]?.through, ['src/a/a.ts', 'src/a/b.ts', 'src/a/d.ts', 'src/a/a.ts'], 'and the loop is written in full')
})

test('an exception excuses the group it names and nothing else, and one that excuses nothing is a finding of its own', (t) => {
  const root = plantedTree(t, A_PAIR_IN_A_LOOP)
  const thePair: DeclaredCycle = { files: ['src/one/a.ts', 'src/two/b.ts'], reason: 'planted', removed_by: '#525' }
  assert.deepEqual(judgeTree(root, [thePair]).findings, [], 'the group it names is excused')
  assert.deepEqual(judgeTree(root, [thePair]).stale, [], 'and it excuses something')
  const elsewhere: DeclaredCycle = { files: ['src/one/a.ts', 'src/three/c.ts'], reason: 'planted', removed_by: '#525' }
  const judged = judgeTree(root, [elsewhere])
  assert.equal(judged.findings.length, 1, 'a loop the exception does not name is still a finding')
  assert.deepEqual(judged.stale, [elsewhere], 'and the exception that named other files excuses nothing')
})

test('a tree that holds no script at all is "could not look": exit 2, never a pass', (t) => {
  const root = plantedTree(t, { 'readme.md': 'no script here\n' })
  assert.equal(judgeTree(root, []).files, 0, 'nothing was read, and the check says so rather than passing')
  const { status, said } = theCommandOn(root)
  assert.equal(status, 2, said)
  assert.ok(said.includes('could not look'), said)
})

test('the repository this check lives in holds no loop of value imports', () => {
  const judged = judgeTree(CHECKOUT)
  assert.ok(judged.files > 0, 'the check looked')
  assert.deepEqual(judged.findings.map((loop) => loop.through), [], 'no loop')
  assert.deepEqual(judged.stale, [], 'and no exception that has stopped matching the tree')
})
