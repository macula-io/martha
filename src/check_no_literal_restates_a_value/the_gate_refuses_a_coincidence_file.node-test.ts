// The gate refuses a coincidence file it cannot hold (martha#289 part b, r=4).
//
// A slice's coincidences.ts is exempt from the reach rules only because the check refuses what it cannot hold: a
// statement that is not a declaration, an entry it cannot read, and an entry about another slice's file. Those
// refusals are wired in main.ts, so this file drives main.ts itself, the way CI runs it: a throwaway repository, a
// commit that adds the coincidence file, and the gate over that commit's range with `--root`. Each refusal must end
// the run 2, "could not look", naming the place; a refusal that only dropped the file's entries would let the run
// pass, and goes red here.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { COINCIDENCE_FILE, COMPUTED, NOT_A_DECLARATION } from '../../prove_the_core/the_coincidences_a_slice_declares.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { lineOfAnEntryOutsideItsSlice } from './a_slice_excuses_only_its_own_files.ts'

const CHECK = join(import.meta.dirname, 'main.ts')

/** The name the gate prints at the head of each line: its own folder's. */
const NAME = basename(import.meta.dirname)

/** git with the identity a throwaway repository has no config for. */
const WITH_AN_AUTHOR = ['-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid']

const gitIn = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', [...WITH_AN_AUTHOR, ...args], { cwd, encoding: 'utf8' }).trim()

/** One slice holds a constant, another slice spells its value. */
const THE_TREE: Readonly<Record<string, string>> = {
  'src/a_slice/a_slice.ts': "export const A_WORD = 'a word'\n",
  'src/b_slice/b_slice.ts': "call('a word')\n",
}

const A_COINCIDENCES = `a_slice/${COINCIDENCE_FILE}`
const B_COINCIDENCES = `b_slice/${COINCIDENCE_FILE}`

/** A repository holding THE_TREE, then one commit adding `files`; the gate's run over that commit, as CI runs it. */
function gateOverACommitAdding(t: TestContext, files: Readonly<Record<string, string>>): { readonly status: number | null; readonly refused: readonly string[] } {
  const root = mkdtempSync(join(tmpdir(), 'coincidence-refused-'))
  t.after(() => removeTheTree(root))
  gitIn(root, 'init', '-q')
  const commit = (each: Readonly<Record<string, string>>): string => {
    for (const [path, text] of Object.entries(each)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    gitIn(root, 'add', '-A')
    gitIn(root, 'commit', '-q', '-m', 'a change')
    return gitIn(root, 'rev-parse', 'HEAD')
  }
  const base = commit(THE_TREE)
  const head = commit(Object.fromEntries(Object.entries(files).map(([path, text]) => [`src/${path}`, text])))
  const run = spawnSync(process.execPath, [CHECK, '--range', `${base}..${head}`, '--root', root], { encoding: 'utf8' })
  return { status: run.status, refused: run.stderr.split('\n').filter((line) => line.startsWith(`${NAME}: `) && line.includes(`${COINCIDENCE_FILE}:`)) }
}

test('a coincidence file holding a function ends the run 2, naming the statement', (t) => {
  const { status, refused } = gateOverACommitAdding(t, {
    [A_COINCIDENCES]: "export const COINCIDENCES = []\nexport function reachTheGlue(): string { return 'x' }\n",
  })
  assert.deepEqual(refused, [`${NAME}: ${A_COINCIDENCES}:2: ${NOT_A_DECLARATION}`])
  assert.equal(status, 2)
})

test('an entry the check cannot read ends the run 2, naming the entry', (t) => {
  const { status, refused } = gateOverACommitAdding(t, {
    [A_COINCIDENCES]: [
      "import { A_WORD } from './a_slice.ts'",
      'export const COINCIDENCES = [',
      "  { value: A_WORD.trim(), file: 'a_slice/a_slice.ts', reason: 'a reason' },",
      ']',
      '',
    ].join('\n'),
  })
  assert.deepEqual(refused, [`${NAME}: ${A_COINCIDENCES}:3: ${COMPUTED}`])
  assert.equal(status, 2)
})

test('an entry about another slice\'s file ends the run 2, naming the entry', (t) => {
  const { status, refused } = gateOverACommitAdding(t, {
    [A_COINCIDENCES]: [
      "import { A_WORD } from './a_slice.ts'",
      'export const COINCIDENCES = [',
      "  { value: A_WORD, file: 'b_slice/b_slice.ts', reason: 'a reason' },",
      ']',
      '',
    ].join('\n'),
  })
  const entry = { value: 'a word', file: 'b_slice/b_slice.ts', reason: 'a reason', declared_in: A_COINCIDENCES, line: 3 }
  assert.deepEqual(refused, [`${NAME}: ${lineOfAnEntryOutsideItsSlice(entry)}`])
  assert.equal(status, 2)
})

test('the same entry in the slice that holds the file is no refusal: the run is judged, and passes', (t) => {
  const { status, refused } = gateOverACommitAdding(t, {
    [B_COINCIDENCES]: [
      "import { A_WORD } from '../a_slice/a_slice.ts'",
      'export const COINCIDENCES = [',
      "  { value: A_WORD, file: 'b_slice/b_slice.ts', reason: 'a reason' },",
      ']',
      '',
    ].join('\n'),
  })
  assert.deepEqual(refused, [])
  assert.equal(status, 0)
})
