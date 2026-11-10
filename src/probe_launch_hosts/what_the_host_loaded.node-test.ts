// The memory rows read what the host recorded loading, not what the model said (martha#223).
// These tests hold the reading to the host's own shape: the transcript's `attachment` entry
// lists each file with its path and text, and only the files the host itself labelled as the
// owner's auto-memory count -- the owner's instruction files carry other text, and one of them
// holding the same words must not make the row say the memory was loaded.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { memoryTheHostLoaded, memoryTheHostLoadedFor } from './what_the_host_loaded.ts'
import { theRecordsIn } from './probe_hosts.ts'

const CODEWORD = 'ZEBRA0123abcd'
/** The folder a run starts its host in, and one that is no run of ours. */
const OUR_CHECKOUT = '/srv/git/martha/checkout'
const ANOTHER_SESSIONS_CHECKOUT = '/srv/git/martha/another'

/** One transcript line of the kind the host writes for an attachment. */
const anAttachment = (files: readonly Readonly<Record<string, string>>[], cwd?: string) =>
  JSON.stringify({ type: 'attachment', uuid: 'u1', ...(cwd === undefined ? {} : { cwd }), attachment: { type: 'instructions', files } })

const aMemoryFile = { path: '/cfg/projects/k/memory/MEMORY.md', type: 'AutoMem', content: `the codeword is ${CODEWORD}` }

test('the host records each memory file it read in, with its text (martha#223)', () => {
  const transcript = [anAttachment([{ path: '/cfg/projects/k/memory/MEMORY.md', type: 'AutoMem', content: `the codeword is ${CODEWORD}` }]), '{"type":"user"}'].join('\n')
  assert.deepEqual(memoryTheHostLoaded(transcript), [{ path: '/cfg/projects/k/memory/MEMORY.md', text: `the codeword is ${CODEWORD}` }])
})

test('the owner\'s instructions are not the owner\'s memory, even when they hold the same words (martha#223)', () => {
  const transcript = anAttachment([{ path: '/srv/git/martha/CLAUDE.md', type: 'Project', content: `the codeword is ${CODEWORD}` }])
  assert.deepEqual(memoryTheHostLoaded(transcript), [])
})

test('a transcript with no attachment, or lines that are not json, records no memory (martha#223)', () => {
  assert.deepEqual(memoryTheHostLoaded(''), [])
  assert.deepEqual(memoryTheHostLoaded('not json at all\n{"type":"user","message":"hi"}'), [])
})

test('a session that loaded nothing records nothing, which is the row the off switch makes (martha#223)', () => {
  const transcript = anAttachment([{ path: '/srv/git/martha/CLAUDE.md', type: 'Project', content: 'something else' }])
  assert.equal(memoryTheHostLoaded(transcript).some((file) => file.text.includes(CODEWORD)), false)
})

test('an entry another session wrote into the same file is not this run\'s record (martha#223 r=2)', () => {
  const theirs = anAttachment([aMemoryFile], ANOTHER_SESSIONS_CHECKOUT)
  const ours = anAttachment([aMemoryFile], OUR_CHECKOUT)
  assert.deepEqual(memoryTheHostLoadedFor(theirs, OUR_CHECKOUT), [])
  assert.deepEqual(memoryTheHostLoadedFor(ours, OUR_CHECKOUT), [{ path: aMemoryFile.path, text: aMemoryFile.content }])
})

test('an entry that does not say where its session started is taken, inside a folder already this run\'s (martha#223 r=2)', () => {
  const unsaid = anAttachment([aMemoryFile])
  assert.deepEqual(memoryTheHostLoadedFor(unsaid, OUR_CHECKOUT), [{ path: aMemoryFile.path, text: aMemoryFile.content }])
})

test('the records read are only those under the project folders the run names (martha#223 r=2)', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'martha-probe-records-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const ours = join(root, 'ours')
  const anotherSessions = join(root, 'another-session')
  for (const folder of [ours, anotherSessions]) mkdirSync(folder, { recursive: true })
  writeFileSync(join(ours, 'a.jsonl'), '{}\n')
  writeFileSync(join(anotherSessions, 'b.jsonl'), '{}\n')
  writeFileSync(join(anotherSessions, 'notes.txt'), 'not a record\n')

  assert.deepEqual(theRecordsIn([ours]), [join(ours, 'a.jsonl')])
  assert.deepEqual(
    theRecordsIn([ours, undefined]),
    [join(ours, 'a.jsonl')],
    'a folder the run could not name adds nothing, and the root is not walked',
  )
})

