import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { blobUnderTheTree, rawBlobOf, type LauncherStore } from '../hash_a_file_under_a_tree/hash_a_file_under_a_tree.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { judgeTheCheckout, objectFormatOf } from './the_launcher_judges_the_tree.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'

// Every test reads a real checkout and a real launcher-owned git dir, and removes them when it ends.

interface Place {
  readonly home: string
  readonly checkout: string
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

function place(t: TestContext, files: Readonly<Record<string, string>>): Place {
  const home = mkdtempSync(join(tmpdir(), 'martha-judge-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout, { recursive: true })
  git(checkout, 'init', '-q', '.')
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(checkout, name)), { recursive: true })
    writeFileSync(join(checkout, name), content)
  }
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the owner’s tree')
  return { home, checkout }
}

function judged(where: Place, attribute_tree: string | null = null) {
  const git_dir = join(where.checkout, '.git')
  return judgeTheCheckout({ top: where.checkout, git_dir, attribute_tree }, objectFormatOf(git_dir, thisMachine) ?? 'sha1', thisMachine)
}

const head = (where: Place): string => git(where.checkout, 'rev-parse', 'HEAD^{tree}')

// --- the checkout's own settings decide nothing (martha#167 §1) -----------------

test('a clean filter named in the checkout’s own config never runs, and the checkout that names it is refused', (t) => {
  const where = place(t, { 'hook.sh': '#!/bin/sh\necho approved\n' })
  const approved = head(where)
  const marker = join(where.home, 'the-filter-ran')

  git(where.checkout, 'config', 'filter.probe.clean', `sh -c 'touch ${marker}; cat'`)
  writeFileSync(join(where.checkout, '.git', 'info', 'attributes'), 'hook.sh filter=probe\n')
  writeFileSync(join(where.checkout, 'hook.sh'), '#!/bin/sh\necho planted\n')

  const read = judged(where, approved)
  assert.equal(existsSync(marker), false, 'the clean filter named outside the tree must never run')
  assert.equal(read.kind, 'tree')
  const live = read.kind === 'tree' ? read.tree : ''
  assert.notEqual(live, approved, 'the file whose bytes changed must not hash as the approved one')
})

test('the checkout’s core.worktree, core.attributesFile and core.fsmonitor decide nothing', (t) => {
  const where = place(t, { 'hook.sh': '#!/bin/sh\necho approved\n' })
  const approved = head(where)
  const elsewhere = join(where.home, 'elsewhere')
  mkdirSync(elsewhere, { recursive: true })
  writeFileSync(join(elsewhere, 'hook.sh'), '#!/bin/sh\necho planted\n')
  writeFileSync(join(where.home, 'attributes'), 'hook.sh ident\n')
  const marker = join(where.home, 'fsmonitor-ran')

  git(where.checkout, 'config', 'core.worktree', elsewhere)
  git(where.checkout, 'config', 'core.attributesFile', join(where.home, 'attributes'))
  git(where.checkout, 'config', 'core.fsmonitor', `sh -c 'touch ${marker}; echo'`)

  const read = judged(where, approved)
  assert.equal(existsSync(marker), false, 'no program named in the checkout’s config runs')
  assert.equal(read.kind, 'tree')
  assert.equal(read.kind === 'tree' ? read.tree : '', approved, 'the tree is still this checkout’s own')
})

// --- the keeps (martha#167 §3) --------------------------------------------------

test('a checkout whose committed attributes convert line endings still reads as its own tree, as the owner ruled', (t) => {
  const where = place(t, { '.gitattributes': 'script.sh text eol=lf\n', 'script.sh': 'one\ntwo\n' })
  writeFileSync(join(where.checkout, 'script.sh'), 'one\r\ntwo\r\n')

  const read = judged(where)
  assert.equal(read.kind, 'tree')
  assert.equal(read.kind === 'tree' ? read.tree : '', head(where), 'a line-ending conversion is not a change the gate refuses')
})

test('an approved tree that does not read back as itself is refused rather than judged against', (t) => {
  const where = place(t, { 'hook.sh': '#!/bin/sh\necho approved\n' })
  const approved = head(where)
  writeFileSync(join(where.checkout, 'hook.sh'), '#!/bin/sh\necho planted\n')
  git(where.checkout, 'add', '--all')
  const planted = git(where.checkout, 'write-tree')
  assert.notEqual(planted, approved)

  // The tree object the id names is replaced by another tree's: the id no longer describes what sits under it.
  const objects = join(where.checkout, '.git', 'objects')
  for (const id of [approved]) {
    const object = join(objects, id.slice(0, 2), id.slice(2))
    if (!existsSync(object)) continue
    execFileSync('chmod', ['u+w', object])
    writeFileSync(object, execFileSync('cat', [join(objects, planted.slice(0, 2), planted.slice(2))]))
  }

  const read = judged(where, approved)
  assert.equal(read.kind, 'refused', 'a tree that does not read back as itself is refused')
  const refusal = read.kind === 'refused' ? read.refusal : ''
  assert.ok(refusal.includes('martha#167'), refusal)
  assert.ok(refusal.includes('approve the checkout again'), refusal)
})

test('a subtree forged under the approved tree is refused, not read as the tree the owner approved', (t) => {
  const where = place(t, { 'sub/hook.sh': '#!/bin/sh\necho approved\n' })
  const approved = head(where)
  const approved_subtree = git(where.checkout, 'rev-parse', 'HEAD:sub')

  writeFileSync(join(where.checkout, 'sub', 'hook.sh'), '#!/bin/sh\necho planted\n')
  git(where.checkout, 'add', '--all')
  const planted_subtree = git(where.checkout, 'ls-tree', git(where.checkout, 'write-tree'), 'sub').split(/\s+/)[2] ?? ''
  assert.notEqual(planted_subtree, approved_subtree)

  // The object the approved subtree's id names is replaced by another subtree's. `read-tree` hands its entries on without
  // a word, and an index that kept the cache-tree `read-tree` primed would hand the approved id back as if it had
  // computed it; only the id recomputed from those entries tells the two apart.
  const objects = join(where.checkout, '.git', 'objects')
  const object = join(objects, approved_subtree.slice(0, 2), approved_subtree.slice(2))
  execFileSync('chmod', ['u+w', object])
  writeFileSync(object, execFileSync('cat', [join(objects, planted_subtree.slice(0, 2), planted_subtree.slice(2))]))

  const read = judged(where, approved)
  assert.equal(read.kind, 'refused', 'a tree whose subtree was forged is not the tree the owner approved')
  const refusal = read.kind === 'refused' ? read.refusal : ''
  assert.ok(refusal.includes('does not read back as itself'), refusal)
})

test('a file the checkout never carried keeps its blob, so a later read under that approval reads the same tree', (t) => {
  const where = place(t, { 'hook.sh': '#!/bin/sh\necho approved\n' })
  writeFileSync(join(where.checkout, 'new.sh'), '#!/bin/sh\necho brand new\n')

  const first = judged(where)
  assert.equal(first.kind, 'tree')
  const approved = first.kind === 'tree' ? first.tree : ''
  assert.notEqual(approved, head(where), 'the file the checkout never carried is in the tree that is approved')

  const again = judged(where, approved)
  assert.equal(again.kind, 'tree', 'an approval holding a new file is read again once its blob outlives the read that wrote it')
  assert.equal(again.kind === 'tree' ? again.tree : '', approved, 'and it reads as the very tree that was approved')
})

// --- the bytes first (martha#167 §4, Saturnus’s condition (a)) ------------------

test('a file whose own bytes are the approved blob is answered without git being asked at all', () => {
  const bytes = Buffer.from('#!/bin/sh\necho approved\n')
  const approved_blob = rawBlobOf(bytes, 'sha1')
  const store = countingStore()
  const judged_blob = blobUnderTheTree(store.store, 'hook.sh', bytes, (blob) => blob === approved_blob)
  assert.deepEqual(judged_blob, { blob: approved_blob, raw: true })
  assert.equal(store.calls, 0, 'a raw match starts no program, so runNow is never called')
})

test('a file whose bytes match nothing is put to git, in the launcher’s own repository', () => {
  const store = countingStore()
  const judged_blob = blobUnderTheTree(store.store, 'hook.sh', Buffer.from('one thing\n'), () => false)
  assert.equal(judged_blob, undefined, 'git was asked and answered nothing, so the file cannot be hashed')
  assert.equal(store.calls, 1, 'git is asked once, and only for a file the bytes did not explain')
})

/** A store whose `runNow` counts every call and answers nothing: what matters is whether git was asked at all. */
function countingStore(): { readonly calls: number; readonly store: LauncherStore } {
  const counted = { calls: 0 }
  const store: LauncherStore = {
    repository: '/nonexistent-judge-git-dir',
    tree: 'the approved tree',
    format: 'sha1',
    scratch: thisMachine.stores.scratch,
    processes: {
      runNow: () => {
        counted.calls += 1
        return { exit_code: null, stdout: '', stderr: '' }
      },
    },
  }
  return {
    get calls() {
      return counted.calls
    },
    store,
  }
}
