// What the "nothing reads the kept transcripts" check's bite rests on (martha#646, D4): a planted tree with a reader,
// judged by the same path the CI run uses, and the command's own verdict asked for, so the line it prints is the one a
// later slice would see.
//
// The mutants, each named in its test's title:
//   - the read calls skipped: a call that only makes the place's path must stay no finding, so it is the read calls
//     that make one;
//   - the writer's own directory judged like any other: the adapter that writes the place must pass reading it back;
//   - a test judged like the core: a test that reads the place to prove it must stay no finding;
//   - the path matcher widened to a word's first letters: a text that only starts with the place's own name must stay
//     no finding;
//   - a tree with nothing to judge, or with no name declared for the place, called a pass: both are refused instead.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { TRANSCRIPTS_PLACE } from '../../src/keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { NAME, theGate } from './nothing_reads_the_kept_transcripts.ts'

/** The repository this check lives in: this file's directory, two levels below it. */
const CHECKOUT = join(import.meta.dirname, '..', '..')

/** The state slice's own declaration, copied into a planted tree so the place's name is the real one. */
const THE_DECLARATION = 'src/keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
const THE_DECLARED = `export const TRANSCRIPTS_PLACE = ${JSON.stringify(TRANSCRIPTS_PLACE)}\n`

/** A slice that does nothing with the place, so a planted tree always has something to judge. */
const A_PLAIN_SLICE: Readonly<Record<string, string>> = { 'src/a_plain_slice/plain.ts': 'export const a = 1\n' }

/** Writes `files` by their path under `root`. */
const plant = (root: string, files: Readonly<Record<string, string>>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

/** A tree a test owns, holding the place's declaration and `files`, removed when the test ends. */
const plantedTree = (t: TestContext, files: Readonly<Record<string, string>>): string => {
  // Resolved, because CI runs the suite with TMPDIR on a symlink and the walk spells its paths from the root it is given.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-646-kept-')))
  t.after(() => removeTheTree(root))
  plant(root, { [THE_DECLARATION]: THE_DECLARED, ...A_PLAIN_SLICE, ...files })
  return root
}

/** A read of the place by its own constant, in a slice that should not have one. */
const A_READER_BY_THE_CONSTANT = `import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { TRANSCRIPTS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

export const read = (stateRoot: string): string => readFileSync(join(stateRoot, TRANSCRIPTS_PLACE, 'one.jsonl'), 'utf8')
`

test('the real core reads the kept transcripts nowhere', () => {
  const [code, lines] = theGate(CHECKOUT)
  assert.equal(code, 0)
  assert.equal(lines.length, 1)
  assert.match(lines[0] ?? '', new RegExp(`^${NAME}: read [1-9][0-9]* source\\(s\\) of the core, and none of them reads the kept transcripts$`))
})

test('a slice that reads the place by its own constant is a finding, by file and line', (t) => {
  const root = plantedTree(t, { 'src/a_later_slice/reads.ts': A_READER_BY_THE_CONSTANT })
  const [code, lines] = theGate(root)
  assert.equal(code, 1)
  assert.deepEqual(lines, [
    `${NAME}: 1 read(s) of the kept transcripts in the core, where only src/keep_the_transcripts_of_a_launch/ may touch them:`,
    '  src/a_later_slice/reads.ts:6: readFileSync names the kept place',
  ])
})

test('a slice that reads the place by its path is a finding, however the path is written', (t) => {
  const root = plantedTree(t, {
    'src/a_later_slice/template.ts': 'import { readFileSync } from \'node:fs\'\n' +
      `export const r = (stateRoot: string): string => readFileSync(\`\${stateRoot}/${TRANSCRIPTS_PLACE}/one.jsonl\`, 'utf8')\n`,
    'src/a_later_slice/literal.ts': 'import { readdirSync } from \'node:fs\'\n' +
      `export const names = (stateRoot: string): string[] => readdirSync(\`\${stateRoot}/${TRANSCRIPTS_PLACE}\`)\n`,
  })
  const [code, lines] = theGate(root)
  assert.equal(code, 1)
  assert.deepEqual(lines.filter((line) => line.includes('names the kept place')).map((line) => line.split(':')[0]?.trim()).sort(), [
    'src/a_later_slice/literal.ts', 'src/a_later_slice/template.ts',
  ])
})

test('the writer reads the place back, and a test reads it to prove it: neither is a finding', (t) => {
  const root = plantedTree(t, {
    'src/keep_the_transcripts_of_a_launch/writes.ts': A_READER_BY_THE_CONSTANT,
    'src/a_later_slice/reads.node-test.ts': A_READER_BY_THE_CONSTANT,
  })
  assert.equal(theGate(root)[0], 0)
})

test('a call that only makes the place\'s path, or a text that only starts with its name, is no finding', (t) => {
  const root = plantedTree(t, {
    'src/a_later_slice/names.ts': 'import { join } from \'node:path\'\n\n' +
      'import { TRANSCRIPTS_PLACE } from \'../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts\'\n\n' +
      'export const place = (stateRoot: string): string => join(stateRoot, TRANSCRIPTS_PLACE)\n',
    'src/a_later_slice/similar.ts': 'import { readFileSync } from \'node:fs\'\n' +
      `export const r = (stateRoot: string): string => readFileSync(\`\${stateRoot}/${TRANSCRIPTS_PLACE}_old/one.jsonl\`, 'utf8')\n`,
  })
  assert.equal(theGate(root)[0], 0)
})

test('a tree with nothing to judge, or no declared name for the place, is refused rather than passed', (t) => {
  const nothingToJudge = realpathSync(mkdtempSync(join(tmpdir(), 'martha-646-kept-')))
  t.after(() => removeTheTree(nothingToJudge))
  assert.equal(theGate(nothingToJudge)[0], 2)

  const noDeclaration = realpathSync(mkdtempSync(join(tmpdir(), 'martha-646-kept-')))
  t.after(() => removeTheTree(noDeclaration))
  plant(noDeclaration, A_PLAIN_SLICE)
  const [code, lines] = theGate(noDeclaration)
  assert.equal(code, 2)
  assert.match(lines[0] ?? '', /declares no name for the place/)
})

test('the command prints the finding and exits 1, so a CI step reads the same verdict', (t) => {
  const root = plantedTree(t, { 'src/a_later_slice/reads.ts': A_READER_BY_THE_CONSTANT })
  const run = spawnSync(process.execPath, [join(CHECKOUT, 'prove_the_core/what_the_core_may_reach/nothing_reads_the_kept_transcripts.ts'), '--root', root], { encoding: 'utf8' })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /src\/a_later_slice\/reads\.ts:6: readFileSync names the kept place/)
})
