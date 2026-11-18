// The one transcript a launch reads, held by its descriptor and read under its bounds (martha#658).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, closeSync, mkdirSync, openSync, realpathSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'

import { LONGEST_TRANSCRIPT_LINE, letTheTranscriptGo, openTheTranscript, theDescriptorIsAt, readTheNewLines, type AHeldTranscript } from './read_one_file_held_by_its_descriptor.ts'

/** The folder under the config folder a host adapter would name as holding the transcripts; any name serves. */
const HELD_IN = 'sessions'
/** Two lines a host could write; the reader never looks inside one. */
const FIRST = JSON.stringify({ line: 'first' })
const SECOND = JSON.stringify({ line: 'second', more: 'x'.repeat(40) })

/** A launch's config folder with one session's transcript in it, and the input that names it. */
function aLaunch(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'martha-658-transcript-'))
  t.after(() => removeTheTree(root))
  const config_dir = join(root, 'launch-config')
  const folder = join(config_dir, HELD_IN, '-work-project')
  mkdirSync(folder, { recursive: true })
  const session_id = '0a1b2c3d-0000-4000-8000-000000000001'
  const transcript_path = join(folder, `${session_id}.jsonl`)
  writeFileSync(transcript_path, `${FIRST}\n`)
  const uid = process.getuid?.() ?? 0
  return { root, folder, where: { config_dir, session_id, transcript_path, uid } }
}

const opened = (held: AHeldTranscript | { refused: string }): AHeldTranscript => {
  if ('refused' in held) assert.fail(held.refused)
  return held
}

test('the transcript is read by its descriptor, by offset, and a partial line waits for its newline', (t) => {
  const { where } = aLaunch(t)
  const held = opened(openTheTranscript(where, HELD_IN))
  t.after(() => letTheTranscriptGo(held))
  assert.deepEqual(readTheNewLines(held), { lines: [FIRST], skipped: 0 })
  appendFileSync(where.transcript_path, SECOND.slice(0, 20))
  assert.deepEqual(readTheNewLines(held), { lines: [], skipped: 0 })
  appendFileSync(where.transcript_path, `${SECOND.slice(20)}\n`)
  assert.deepEqual(readTheNewLines(held), { lines: [SECOND], skipped: 0 })
})

test('an over-long line is skipped across reads, never kept, and the line after it is read', (t) => {
  const { where } = aLaunch(t)
  const held = opened(openTheTranscript(where, HELD_IN))
  t.after(() => letTheTranscriptGo(held))
  readTheNewLines(held)
  appendFileSync(where.transcript_path, 'x'.repeat(LONGEST_TRANSCRIPT_LINE + 1))
  assert.deepEqual(readTheNewLines(held), { lines: [], skipped: 0 })
  assert.equal(held.rest, '')
  appendFileSync(where.transcript_path, 'x'.repeat(10))
  assert.deepEqual(readTheNewLines(held), { lines: [], skipped: 0 })
  appendFileSync(where.transcript_path, `xx\n${SECOND}\n`)
  assert.deepEqual(readTheNewLines(held), { lines: [SECOND], skipped: 1 })
})

test('an over-long line that ends inside one read is skipped and counted, and the lines around it are kept', (t) => {
  const { where } = aLaunch(t)
  const held = opened(openTheTranscript(where, HELD_IN))
  t.after(() => letTheTranscriptGo(held))
  appendFileSync(where.transcript_path, `${'x'.repeat(LONGEST_TRANSCRIPT_LINE + 1)}\n${SECOND}\n`)
  assert.deepEqual(readTheNewLines(held), { lines: [FIRST, SECOND], skipped: 1 })
})

test('a path outside the folder the adapter names, or naming another session, is refused by name', (t) => {
  const { where, root } = aLaunch(t)
  const elsewhere = join(root, `${where.session_id}.jsonl`)
  writeFileSync(elsewhere, '')
  assert.match(String((openTheTranscript({ ...where, transcript_path: elsewhere }, HELD_IN) as { refused: string }).refused), /^transcript path refused: it is not one folder below/)
  const deeper = join(where.config_dir, HELD_IN, 'a', 'b', `${where.session_id}.jsonl`)
  mkdirSync(dirname(deeper), { recursive: true })
  writeFileSync(deeper, '')
  assert.match(String((openTheTranscript({ ...where, transcript_path: deeper }, HELD_IN) as { refused: string }).refused), /it is not one folder below/)
  assert.match(String((openTheTranscript({ ...where, session_id: 'another' }, HELD_IN) as { refused: string }).refused), /does not name the session/)
})

test('a symlink at the transcript, or at a folder above it, is refused', (t) => {
  const { where, folder, root } = aLaunch(t)
  const target = join(root, 'target.jsonl')
  writeFileSync(target, `${SECOND}\n`)
  rmSync(where.transcript_path)
  symlinkSync(target, where.transcript_path)
  assert.match(String((openTheTranscript(where, HELD_IN) as { refused: string }).refused), /could not be opened as a file without following a link/)
  rmSync(where.transcript_path)
  writeFileSync(where.transcript_path, '')
  const real = `${folder}.real`
  renameSync(folder, real)
  symlinkSync(real, folder)
  assert.match(String((openTheTranscript(where, HELD_IN) as { refused: string }).refused), /could not be opened as a folder/)
})

test('a FIFO at the transcript is refused without blocking the beat', (t) => {
  const { where } = aLaunch(t)
  rmSync(where.transcript_path)
  execFileSync('mkfifo', [where.transcript_path])
  assert.match(String((openTheTranscript(where, HELD_IN) as { refused: string }).refused), /is not a file of the launch's user/)
})

test('a file swapped in after the open is never read: the session reads it as moved', (t) => {
  const { where, root } = aLaunch(t)
  const held = opened(openTheTranscript(where, HELD_IN))
  t.after(() => letTheTranscriptGo(held))
  renameSync(where.transcript_path, join(root, 'away.jsonl'))
  writeFileSync(where.transcript_path, `${SECOND}\n`)
  assert.deepEqual(readTheNewLines(held), { moved: true })
  rmSync(where.transcript_path)
  symlinkSync(join(root, 'away.jsonl'), where.transcript_path)
  assert.deepEqual(readTheNewLines(held), { moved: true })
})

test("a transcript or folder that is not the launch user's is refused", (t) => {
  const { where } = aLaunch(t)
  assert.match(String((openTheTranscript({ ...where, uid: where.uid + 1 }, HELD_IN) as { refused: string }).refused), /is not a folder of the launch's user/)
})

test('a descriptor opened through a folder that is a link is not the expected file, by the kernel\'s word', (t) => {
  const { where, folder } = aLaunch(t)
  const real = opened(openTheTranscript(where, HELD_IN))
  t.after(() => letTheTranscriptGo(real))
  assert.ok(theDescriptorIsAt(real.fd, where.transcript_path), 'the real transcript is not where it was opened')
  const linked = `${folder}.link`
  symlinkSync(folder, linked)
  const through = join(linked, `${where.session_id}.jsonl`)
  const fd = openSync(through, 'r')
  t.after(() => closeSync(fd))
  assert.equal(theDescriptorIsAt(fd, through), false, 'a descriptor reached through a linked folder passed as the expected path')
})

test('an ancestor of the config folder swapped for a link is refused at the open, by the kernel\'s word', (t) => {
  // The race the walk's comment names, sequenced: O_NOFOLLOW guards only each path's last part, so after the swap the
  // walk passes and the file opens from the look-alike tree; only the descriptor check stands between it and a read.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-658-ancestor-')))
  t.after(() => removeTheTree(root))
  const session_id = '0a1b2c3d-0000-4000-8000-000000000002'
  for (const tree of ['real', 'other']) {
    mkdirSync(join(root, tree, 'launch-config', HELD_IN, 'f'), { recursive: true })
    writeFileSync(join(root, tree, 'launch-config', HELD_IN, 'f', `${session_id}.jsonl`), `${tree === 'real' ? FIRST : SECOND}\n`)
  }
  const config_dir = join(root, 'real', 'launch-config')
  const where = { config_dir, session_id, transcript_path: join(config_dir, HELD_IN, 'f', `${session_id}.jsonl`), uid: process.getuid?.() ?? 0 }
  renameSync(join(root, 'real'), join(root, 'real-moved'))
  symlinkSync(join(root, 'other'), join(root, 'real'))
  assert.match(String((openTheTranscript(where, HELD_IN) as { refused: string }).refused), /what opened is not .*a folder on the way was swapped for a link/)
})
