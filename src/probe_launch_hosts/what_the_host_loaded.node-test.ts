// The memory rows read what the host recorded loading, not what the model said (martha#223).
// These tests hold the reading to the host's own shape: the transcript's `attachment` entry
// lists each file with its path and text, and only the files the host itself labelled as the
// owner's auto-memory count -- the owner's instruction files carry other text, and one of them
// holding the same words must not make the row say the memory was loaded.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { memoryTheHostLoaded } from './what_the_host_loaded.ts'

const CODEWORD = 'ZEBRA0123abcd'

/** One transcript line of the kind the host writes for an attachment. */
const anAttachment = (files: readonly Readonly<Record<string, string>>[]) => JSON.stringify({ type: 'attachment', uuid: 'u1', attachment: { type: 'instructions', files } })

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
