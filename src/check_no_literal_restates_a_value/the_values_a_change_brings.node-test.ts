// The values a change brings, read from a repository (martha#289, R1).
//
// The rule itself is proved beside it with the values a change defines passed in by
// hand. This file proves the half that reads them from git: a constant the change
// REVALUES still names the copy holding the value it left behind, and a constant it
// ADDS names every old copy of its value — each on a line the change never touches,
// so only R1's whole-tree judgement can name it.
//
// Each case plants a throwaway repository and drives the gate through `--range`, the
// way CI does. A gate that judges no value over the whole tree, or that forgets the
// value a constant held before the change, goes red here and nowhere else.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { GONE } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'

const CHECK = join(import.meta.dirname, 'main.ts')

/** git with the identity a throwaway repository has no config for. */
const WITH_AN_AUTHOR = ['-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid']

const gitIn = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', [...WITH_AN_AUTHOR, ...args], { cwd, encoding: 'utf8' }).trim()

/** Writes one file, making the folders on the way to it. */
function writeUnder(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

/** A throwaway repository holding one commit, and the tip of it. */
function repositoryWith(files: Readonly<Record<string, string>>): { readonly root: string; readonly base: string } {
  const root = mkdtempSync(join(tmpdir(), 'restated-'))
  gitIn(root, 'init', '-q')
  return { root, base: commitOn(root, files) }
}

/** One more commit holding what `files` writes, and its sha. */
function commitOn(root: string, files: Readonly<Record<string, string>>): string {
  for (const [path, text] of Object.entries(files)) writeUnder(root, path, text)
  gitIn(root, 'add', '-A')
  gitIn(root, 'commit', '-q', '-m', 'a change')
  return gitIn(root, 'rev-parse', 'HEAD')
}

/** The findings the gate prints for one range, and how it exited. */
function judge(root: string, base: string, head: string): { readonly status: number | null; readonly findings: readonly string[] } {
  const run = spawnSync(process.execPath, [CHECK, '--range', `${base}..${head}`, '--root', root], { encoding: 'utf8' })
  return { status: run.status, findings: run.stdout.split('\n').filter((line) => line.includes(' restates ')) }
}

test('a revalued constant names the copy the value it left behind sits in, on a line the change never touches', (t) => {
  const { root, base } = repositoryWith({
    'src/a_tool/a_tool.ts': "export const TOOL = 'the-old-value'\n",
    'src/a_user/a_user.ts': "call('the-old-value')\n",
  })
  t.after(() => removeTheTree(root))

  const head = commitOn(root, { 'src/a_tool/a_tool.ts': "export const TOOL = 'the-newer-value'\n" })
  const { status, findings } = judge(root, base, head)

  assert.equal(status, 1)
  assert.deepEqual(findings, [`a_user/a_user.ts:1: 'the-old-value' restates a_tool/a_tool.ts TOOL ${GONE}`])
})

test('a constant the change adds names every old copy of its value, on a line the change never touches', (t) => {
  const { root, base } = repositoryWith({ 'src/a_user/a_user.ts': "call('a-fresh-value')\n" })
  t.after(() => removeTheTree(root))

  const head = commitOn(root, { 'src/a_new/a_new.ts': "export const FRESH = 'a-fresh-value'\n" })
  const { status, findings } = judge(root, base, head)

  assert.equal(status, 1)
  assert.deepEqual(findings, ["a_user/a_user.ts:1: 'a-fresh-value' restates a_new/a_new.ts FRESH"])
})
