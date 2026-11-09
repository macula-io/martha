import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { CONVERSIONS_A_LAUNCH_PASSES, CONVERSIONS_A_LAUNCH_REFUSES, whyAConvertedFileIsRefused, type ApprovedAttributes } from './conversions_a_launch_passes.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'

// Every test reads a real checkout and a real launcher-owned git dir, and removes them when it ends.

interface Place {
  /** The checkout the owner approved, with its tree and its own git dir a member can write. */
  readonly checkout: string
  /** The launcher's own git dir, with the checkout's objects as an alternate and nothing else. */
  readonly judge: string
  /** The approved tree, whose attributes are the only ones a launch obeys. */
  readonly tree: string
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

function place(t: TestContext, files: Readonly<Record<string, string>>): Place {
  const root = mkdtempSync(join(tmpdir(), 'martha-conversions-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const checkout = join(root, 'checkout')
  const judge = join(root, 'judge.git')
  mkdirSync(checkout, { recursive: true })
  git(checkout, 'init', '-q', '.')
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(checkout, name)), { recursive: true })
    writeFileSync(join(checkout, name), content)
  }
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the owner’s tree')
  const tree = git(checkout, 'rev-parse', 'HEAD^{tree}')
  git(root, 'init', '-q', '--bare', judge)
  writeFileSync(join(judge, 'objects', 'info', 'alternates'), `${join(checkout, '.git', 'objects')}\n`)
  return { checkout, judge, tree }
}

const asked = (where: Place): ApprovedAttributes => ({ repository: where.judge, tree: where.tree, processes: thisMachine.processes })

/** The attributes this file refuses, one file per attribute, all in one tree: the whole class in one read. */
const REFUSED = { '.gitattributes': 'script.sh ident\nencoded.bin working-tree-encoding=UTF-16\nfiltered.dat filter=upcase\n' }

test('a file that matches the approved blob only through ident, working-tree-encoding or a filter is refused by name', (t) => {
  const where = place(t, { ...REFUSED, 'script.sh': '#!/bin/sh\n# $Id$\necho hi\n', 'filtered.dat': 'y\n' })

  const ident = whyAConvertedFileIsRefused(asked(where), 'script.sh') ?? ''
  assert.ok(ident.includes('script.sh'), ident)
  assert.ok(ident.includes('ident'), ident)

  const encoding = whyAConvertedFileIsRefused(asked(where), 'encoded.bin') ?? ''
  assert.ok(encoding.includes('encoded.bin'), encoding)
  assert.ok(encoding.includes('working-tree-encoding'), encoding)

  const filtered = whyAConvertedFileIsRefused(asked(where), 'filtered.dat') ?? ''
  assert.ok(filtered.includes('filtered.dat'), filtered)
  assert.ok(filtered.includes('filter attribute'), filtered)
})

test("a file the approved tree marks for line endings only passes, as the owner ruled: text, eol, and nothing at all", (t) => {
  const where = place(t, {
    '.gitattributes': 'auto.txt text=auto\nwindows.txt text eol=crlf\nplain.md nothing\n',
    'auto.txt': 'one\ntwo\n',
    'windows.txt': 'one\r\ntwo\r\n',
    'plain.md': 'plain\n',
  })
  for (const path of ['auto.txt', 'windows.txt', 'plain.md']) {
    assert.equal(whyAConvertedFileIsRefused(asked(where), path), undefined, path)
  }
  assert.deepEqual([...CONVERSIONS_A_LAUNCH_PASSES], ['text', 'eol'])
  assert.deepEqual([...CONVERSIONS_A_LAUNCH_REFUSES], ['ident', 'working-tree-encoding', 'filter'])
})

test("the checkout's own attributes decide nothing: ident written into .git/info/attributes does not reach the answer", (t) => {
  const where = place(t, { 'notes.md': 'plain\n' })
  writeFileSync(join(where.checkout, '.git', 'info', 'attributes'), 'notes.md ident\n')
  assert.equal(whyAConvertedFileIsRefused(asked(where), 'notes.md'), undefined)
})

test('git cannot answer for the path in the launcher’s dir: the file is refused rather than passed', (t) => {
  const where = place(t, { '.gitattributes': 'script.sh ident\n', 'script.sh': '#!/bin/sh\n# $Id$\n' })
  const nowhere = { repository: join(where.judge, 'no-such-dir'), tree: where.tree, processes: thisMachine.processes }
  const refusal = whyAConvertedFileIsRefused(nowhere, 'script.sh') ?? ''
  assert.ok(refusal.includes('script.sh') && refusal.includes('cannot'), refusal)
})
