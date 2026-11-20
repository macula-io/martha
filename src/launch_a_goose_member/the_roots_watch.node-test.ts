// The re-check after every result of an engine member (#541 package A, design G1): a folder read whole and compared,
// the folders the recording names, and the order of the three checks.

import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { aFolderRead, theFirstDifference, theFoldersReadBackWhole, theRootsWatch } from './the_roots_watch.ts'

function aFolder(t: TestContext): string {
  const made = realpathSync(mkdtempSync(join(tmpdir(), 'martha-541-watch-')))
  t.after(() => removeTheTree(made))
  return made
}

/** A folder with a file, a folder in it and a link, and the read taken of it. */
function aFolderWithEntries(t: TestContext) {
  const folder = join(aFolder(t), 'watched')
  mkdirSync(join(folder, 'inner'), { recursive: true })
  writeFileSync(join(folder, 'inner', 'a.yaml'), 'one')
  symlinkSync('inner/a.yaml', join(folder, 'link'))
  return { folder, before: aFolderRead(folder) }
}

const differenceAfter = (folder: string, before: ReturnType<typeof aFolderRead>): string | undefined => theFirstDifference(folder, before, aFolderRead(folder))

test('a folder read again unchanged has no difference; a file changed, removed or added, a mode changed, or a link moved is named (#541 package A; mutants: bytes, mode, link target, added entries not read)', (t) => {
  const { folder, before } = aFolderWithEntries(t)
  assert.equal(differenceAfter(folder, before), undefined)
  const file = join(folder, 'inner', 'a.yaml')
  writeFileSync(file, 'two')
  assert.equal(differenceAfter(folder, before), `${file} was changed after the launch wrote its root`)
  writeFileSync(file, 'one')
  chmodSync(file, 0o600)
  assert.equal(differenceAfter(folder, before), `${file} was changed after the launch wrote its root`, 'a mode change is a change')
  chmodSync(file, 0o644)
  assert.equal(differenceAfter(folder, before), undefined, 'the file put back as it was')
  rmSync(join(folder, 'link'))
  symlinkSync('inner', join(folder, 'link'))
  assert.equal(differenceAfter(folder, before), `${join(folder, 'link')} was changed after the launch wrote its root`, 'a link that leads elsewhere is a change')
  rmSync(join(folder, 'link'))
  assert.equal(differenceAfter(folder, before), `${join(folder, 'link')} was removed after the launch wrote its root`)
  symlinkSync('inner/a.yaml', join(folder, 'link'))
  writeFileSync(join(folder, 'inner', 'b.yaml'), '')
  assert.equal(differenceAfter(folder, before), `${join(folder, 'inner', 'b.yaml')} was added after the launch wrote its root`)
})

test('a folder absent at the snapshot and made later is named; one removed is named; one that cannot be read is a difference, never a pass (#541 package A)', (t) => {
  const at = aFolder(t)
  const folder = join(at, 'later')
  const absent = aFolderRead(folder)
  assert.equal(differenceAfter(folder, absent), undefined)
  mkdirSync(folder)
  assert.equal(differenceAfter(folder, absent), `${folder} was made after the launch wrote its root`)
  const made = aFolderRead(folder)
  rmdirSync(folder)
  assert.equal(differenceAfter(folder, made), `${folder} was removed after the launch wrote its root`)
  mkdirSync(join(folder, 'shut'), { recursive: true })
  const readable = aFolderRead(folder)
  chmodSync(join(folder, 'shut'), 0o000)
  const shut = differenceAfter(folder, readable)
  chmodSync(join(folder, 'shut'), 0o700)
  assert.ok(shut?.includes('cannot be read whole'), `a folder this user cannot read is not read as unchanged: ${shut}`)
})

test("on the recording, the folders compared whole are the root's config/ and .agents/; a recording without one refuses (#541 package A, design r=4 R1)", () => {
  assert.deepEqual(theFoldersReadBackWhole(RECORDED_GOOSE_ENGINE, '/r'), { folders: ['/r/config', '/r/.agents'] })
  const without = theFoldersReadBackWhole({ engine_folders: { under_root: { config: ['config'] }, without_root: {} } }, '/r')
  assert.ok('refusal' in without && without.refusal.includes('agents_home'), JSON.stringify(without))
})

test('the watch takes its snapshot when it is made, and checks the owner, the files, then the folders, the first that fails saying why (#541 package A; mutants: snapshot taken late, order changed)', (t) => {
  const { folder } = aFolderWithEntries(t)
  let owners: string | undefined
  let files: string | undefined
  const check = theRootsWatch({ owners_settings: () => owners, the_files_as_written: () => files, folders: [folder] })
  writeFileSync(join(folder, 'after.yaml'), '')
  owners = 'owner'
  files = 'files'
  assert.equal(check(), 'owner')
  owners = undefined
  assert.equal(check(), 'files')
  files = undefined
  assert.equal(check(), `the launch's engine root no longer holds what it wrote: ${join(folder, 'after.yaml')} was added after the launch wrote its root, and the engine reads its gates, prompt and providers from there`)
})
