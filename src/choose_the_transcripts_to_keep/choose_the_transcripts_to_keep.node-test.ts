// What a member's config folder holds, chosen for keeping once its launch ends (martha#646). Only the choices are
// tested here: this slice reads no file and writes none, so a token's shape, the bounds and the mark are held without
// a filesystem, and the adapter's own file work is held in its own test.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TOKEN_PREFIXES } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import {
  chooseTheTranscripts,
  HOST_PROJECTS_PLACE,
  TRANSCRIPTS_FILE_BYTES_KEPT,
  TRANSCRIPTS_LAUNCHES_KEPT,
  TRANSCRIPTS_LAUNCH_BYTES_KEPT,
  TRANSCRIPTS_SUFFIX,
  type WhatTheConfigFolderHolds,
} from './choose_the_transcripts_to_keep.ts'

const THE_LAUNCH_KEY = 'sk-ant-the-launches-own-key'

/** One fixture file: its path under the member's config folder, its size, and its text. */
const aFile = (path: string, text: string) => ({ path, bytes: Buffer.byteLength(text), text })

const aTranscriptPath = (name: string) => `${HOST_PROJECTS_PLACE}/the-project/${name}${TRANSCRIPTS_SUFFIX}`

const choosing = (files: WhatTheConfigFolderHolds['files'], theLaunchKey = THE_LAUNCH_KEY) =>
  chooseTheTranscripts({ files, theLaunchKey })

test('only the host\'s own transcripts are kept, never the rest of the member\'s config folder (martha#646)', () => {
  const chosen = choosing([
    aFile('settings.json', '{"model":"sonnet"}'),
    aFile(aTranscriptPath('s-1'), '{"type":"user"}'),
    aFile(`${HOST_PROJECTS_PLACE}/the-project/notes.txt`, 'not a transcript'),
    aFile(`${HOST_PROJECTS_PLACE}/s-2${TRANSCRIPTS_SUFFIX}`, 'one level too high'),
    aFile(`s-3${TRANSCRIPTS_SUFFIX}`, 'not under projects'),
  ])
  assert.deepEqual(chosen.kept.map((one) => one.path), [aTranscriptPath('s-1')], 'a file that is not the host\'s transcript was kept, or a transcript was left behind')
})

test('a token of every shape the repo names is redacted, and a classic one the nightly\'s list would have kept is too (martha#646, Mars D3)', () => {
  for (const prefix of TOKEN_PREFIXES) {
    const token = `${prefix}abcdefghijklmnop`
    const chosen = choosing([aFile(aTranscriptPath('s-1'), `{"text":"git push with ${token} here"}`)])
    assert.equal(chosen.kept[0]?.text.includes(token), false, `a ${prefix} token was kept in the clear`)
    assert.deepEqual(chosen.marked, [aTranscriptPath('s-1')], `a ${prefix} token was not marked for the sidecar`)
  }
})

test('the key the launch handed the member is redacted by its exact value, whatever shape it has (martha#646)', () => {
  const chosen = choosing([aFile(aTranscriptPath('s-1'), `{"text":"ANTHROPIC_API_KEY=${THE_LAUNCH_KEY}"}`)])
  assert.equal(chosen.kept[0]?.text.includes(THE_LAUNCH_KEY), false, 'the launch\'s own key was kept in the clear')
})

test('a token split by a line break is withheld whole, since no piece of the text is the token (martha#646)', () => {
  const split = `sk-ant-abcdefgh\nijklmnop`
  const chosen = choosing([aFile(aTranscriptPath('s-1'), `{"text":"${split}"}`)])
  assert.equal(chosen.kept[0]?.text.includes('abcdefgh'), false, 'the part after the line break was kept, so the token can be read across it')
  assert.deepEqual(chosen.marked, [aTranscriptPath('s-1')], 'a split token was not marked')
})

test('a transcript over the per-file bound is replaced by a line that says so, never kept in part (martha#646)', () => {
  const path = aTranscriptPath('s-1')
  const chosen = choosing([{ path, bytes: TRANSCRIPTS_FILE_BYTES_KEPT + 1, text: 'never read whole' }])
  assert.equal(chosen.kept[0]?.path, path)
  assert.match(chosen.kept[0]?.text ?? '', /too large to keep/, 'a file over the bound was not replaced by its note')
  assert.equal(chosen.kept[0]?.text.includes('never read whole'), false, 'a file over the bound was kept in part')
})

test('the transcripts of one launch stop at their own bound, and the ones past it are named by their note (martha#646)', () => {
  const first = aTranscriptPath('s-1')
  const second = aTranscriptPath('s-2')
  const half = TRANSCRIPTS_LAUNCH_BYTES_KEPT / 2
  const chosen = choosing([
    { path: first, bytes: half, text: 'a'.repeat(16) },
    { path: second, bytes: half + 1, text: 'b'.repeat(16) },
  ])
  assert.equal(chosen.kept.find((one) => one.path === first)?.text.includes('a'.repeat(16)), true, 'a file inside the launch bound was dropped')
  assert.match(chosen.kept.find((one) => one.path === second)?.text ?? '', /too large to keep/, 'the file that passed the launch bound was kept')
})

test('the worst case the product states is the two constants\' own product, read from them (martha#646, Mars item 3)', () => {
  assert.equal(TRANSCRIPTS_LAUNCHES_KEPT * TRANSCRIPTS_LAUNCH_BYTES_KEPT, 1024 * 1024 * 1024, 'the kept launches times the bound per launch is not the stated 1 GiB per project')
})
