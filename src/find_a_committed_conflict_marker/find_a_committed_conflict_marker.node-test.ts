// The finder is pinned on texts written out by hand, never built from the markers it holds, so a marker dropped from
// its list goes red. The tree reader is pinned on a throwaway repository and a real git, so what is pinned is what git
// really answers for a commit.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { markersInText, theMarkersAt, theMarkersSaid } from './find_a_committed_conflict_marker.ts'

/** The lines of a text the finder named, as `line marker`. */
const theLinesOf = (text: string): readonly string[] => markersInText('notes.md', text).map((one) => `${String(one.line)} ${one.marker}`)

test('#968: a diff3 block is named line by line, its base marker and its divider included', () => {
  const text = ['ours', '<<<<<<< HEAD', 'a', '||||||| 895300e', 'b', '=======', 'c', '>>>>>>> origin/main', 'after'].join('\n')
  assert.deepEqual(theLinesOf(text), ['2 <<<<<<<', '4 |||||||', '6 =======', '8 >>>>>>>'])
})

test('#968: a base marker alone is a marker, wherever it stands', () => {
  assert.deepEqual(theLinesOf('one\n||||||| merged common ancestors\ntwo\n'), ['2 |||||||'])
})

test('#968: a divider outside a block is a heading underline, not a marker', () => {
  assert.deepEqual(theLinesOf('A heading\n=======\n\ntext\n'), [])
})

test('#968: a divider after a block has closed is not a marker', () => {
  const text = ['<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> theirs', 'Heading', '======='].join('\n')
  assert.deepEqual(theLinesOf(text), ['1 <<<<<<<', '3 =======', '5 >>>>>>>'])
})

test('#968: a divider written with a carriage return inside a block is a marker', () => {
  assert.deepEqual(theLinesOf('<<<<<<< HEAD\r\na\r\n=======\r\nb\r\n'), ['1 <<<<<<<', '3 ======='])
})

test('#968: a marker needs its space, and a marker inside a line is none', () => {
  assert.deepEqual(theLinesOf('<<<<<<<HEAD\nsay <<<<<<< HEAD\n >>>>>>> x\n========\n'), [])
})

test('#968: the clause names the first ten findings and counts the rest', () => {
  const found = Array.from({ length: 12 }, (_, index) => ({ path: 'a.md', line: index + 1, marker: '<<<<<<<' }))
  assert.equal(theMarkersSaid(found), 'a.md:1, a.md:2, a.md:3, a.md:4, a.md:5, a.md:6, a.md:7, a.md:8, a.md:9, a.md:10 and 2 more')
  assert.equal(theMarkersSaid(found.slice(0, 2)), 'a.md:1, a.md:2')
})

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync(GIT, [...args], { cwd, encoding: 'utf8' }).trim()

/** A real git, so a test sees what git does rather than what a stand-in is told to say. */
const runReal = async (request: ProcessRequest): Promise<ProcessOutcome> => {
  const outcome = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
  return { exit_code: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr }
}

/** A throwaway repository holding `files`, committed once; answers its path and the commit. */
function aCommitHolding(t: TestContext, files: Readonly<Record<string, string>>): { readonly path: string; readonly commit: string } {
  const path = mkdtempSync(join(tmpdir(), 'martha-968-markers-'))
  t.after(() => removeTheTree(path))
  gitIn(path, 'init', '--quiet', '--initial-branch=main')
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(path, file)), { recursive: true })
    writeFileSync(join(path, file), text)
  }
  gitIn(path, 'add', '-A')
  gitIn(path, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '-m', 'the work')
  return { path, commit: gitIn(path, 'rev-parse', 'HEAD') }
}

test('#968: the tree at a commit is read file by file, and only the marker lines are named', async (t) => {
  const at = aCommitHolding(t, {
    'README.md': '# widget\n\nA heading\n=======\n',
    'docs/CHANGELOG.md': 'one\n<<<<<<< HEAD\ntwo\n||||||| 895300e\n=======\nthree\n>>>>>>> origin/main\n',
    'src/base_only.ts': 'x\n||||||| merged common ancestors\n',
  })
  const found = await theMarkersAt(hostForTests({ run: runReal }).host, at.path, at.commit)
  assert.ok('ok' in found, `the tree was not read: ${JSON.stringify(found)}`)
  assert.equal(theMarkersSaid(found.ok), 'docs/CHANGELOG.md:2, docs/CHANGELOG.md:4, docs/CHANGELOG.md:5, docs/CHANGELOG.md:7, src/base_only.ts:2')
})

test('#968: a tree with no marker line answers none', async (t) => {
  const at = aCommitHolding(t, { 'README.md': '# widget\n\nA heading\n=======\n' })
  assert.deepEqual(await theMarkersAt(hostForTests({ run: runReal }).host, at.path, at.commit), { ok: [] })
})

test('#968: a commit git cannot search is refused, naming it', async (t) => {
  const at = aCommitHolding(t, { 'README.md': '# widget\n' })
  const found = await theMarkersAt(hostForTests({ run: runReal }).host, at.path, '0000000000000000000000000000000000000001')
  assert.ok('refused' in found, `an unknown commit was searched: ${JSON.stringify(found)}`)
  assert.match(found.refused, /could not be searched for a conflict marker at 0{39}1/)
})
