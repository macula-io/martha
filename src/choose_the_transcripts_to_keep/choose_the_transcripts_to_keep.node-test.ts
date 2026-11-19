// What a member's config folder holds, chosen for keeping once its launch ends (martha#646). Only the choices are
// tested here: this slice reads no file and writes none, so a token's shape, the bounds and the mark are held without
// a filesystem, and the adapter's own file work is held in its own test.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TOKEN_PREFIXES } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import {
  chooseTheTranscripts,
  COULD_NOT_READ,
  REDACTED,
  theWithheldLines,
  TRANSCRIPTS_FILE_BYTES_KEPT,
  TRANSCRIPTS_LAUNCHES_KEPT,
  TRANSCRIPTS_LAUNCH_BYTES_KEPT,
  TRANSCRIPTS_SUFFIX,
  WITHHELD,
  WITHHELD_LINE,
  type WhatTheConfigFolderHolds,
} from './choose_the_transcripts_to_keep.ts'

// Deliberately no token shape at all: a key that looked like one would be caught by the shape redaction and would say
// nothing about the exact-value redaction the launch's own key gets.
// The host's own word for a project's transcripts, spelled here as a fixture rather than read from the slice.
const THE_HOSTS_PROJECTS_PLACE = 'projects'

const THE_LAUNCH_KEY = 'launch-key-9f3c2b7e1a'

/** One fixture file: its path under the member's config folder, its size, and its text. */
const aFile = (path: string, text: string) => ({ path, bytes: Buffer.byteLength(text), text })

/**
 * One line of the host's own record, as the host writes it: a JSON record whose text value is `text`. Serialized, never
 * spelled, so a line break in `text` reaches the fixture as the two characters the host's file holds (martha#646 r=1 R1).
 */
const aLineOf = (text: string) => `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`

/** What the kept text's one record holds at its first content text. */
const theKeptTextOf = (kept: string): string =>
  (JSON.parse(kept.trim()) as { message: { content: { text: string }[] } }).message.content[0]?.text ?? ''

const aTranscriptPath = (name: string) => `${THE_HOSTS_PROJECTS_PLACE}/the-project/${name}${TRANSCRIPTS_SUFFIX}`

const choosing = (files: WhatTheConfigFolderHolds['files'], theLaunchKey = THE_LAUNCH_KEY) =>
  chooseTheTranscripts({ files, theLaunchKey })

test('only the host\'s own transcripts are kept, never the rest of the member\'s config folder (martha#646)', () => {
  const chosen = choosing([
    aFile('notes.txt', 'not a transcript'),
    aFile(aTranscriptPath('s-1'), '{"type":"user"}'),
    aFile(`${THE_HOSTS_PROJECTS_PLACE}/the-project/notes.txt`, 'not a transcript'),
    aFile(`${THE_HOSTS_PROJECTS_PLACE}/s-2${TRANSCRIPTS_SUFFIX}`, 'one level too high'),
    aFile(`s-3${TRANSCRIPTS_SUFFIX}`, 'not under projects'),
    aFile(`another-place/the-project/s-4${TRANSCRIPTS_SUFFIX}`, 'the same shape under another root'),
  ])
  assert.deepEqual(chosen.kept.map((one) => one.path), [aTranscriptPath('s-1')], 'a file that is not the host\'s transcript was kept, or a transcript was left behind')
})

test('a token of every shape the repo names is redacted, and a classic one the nightly\'s list would have kept is too (martha#646, Mars D3)', () => {
  for (const prefix of TOKEN_PREFIXES) {
    const token = `${prefix}abcdefghijklmnop`
    const chosen = choosing([aFile(aTranscriptPath('s-1'), aLineOf(`git push with ${token} here`))])
    assert.equal(chosen.kept[0]?.text.includes(token), false, `a ${prefix} token was kept in the clear`)
    assert.deepEqual(chosen.marked, [aTranscriptPath('s-1')], `a ${prefix} token was not marked for the sidecar`)
  }
})

test('the key the launch handed the member is redacted by its exact value, whatever shape it has (martha#646)', () => {
  const chosen = choosing([aFile(aTranscriptPath('s-1'), aLineOf(`ANTHROPIC_API_KEY=${THE_LAUNCH_KEY}`))])
  assert.equal(chosen.kept[0]?.text.includes(THE_LAUNCH_KEY), false, 'the launch\'s own key was kept in the clear')
})

test('a token a line break split is withheld whole, on the value as the host wrote it, never on the file\'s bytes (martha#646 r=1 R1)', () => {
  // The host writes a line break in a value as the two characters `\n`, so a reading of the file's bytes never sees the
  // break the token was split by. The value is decoded first, so the break is a break, and no piece of it is the token.
  const split = 'sk-ant-abc\ndefghijklmnop'
  const line = aLineOf(split)
  assert.equal(line.includes(split), false, 'the fixture wrote the break raw, so it would not hold the host\'s own two characters')
  const chosen = choosing([aFile(aTranscriptPath('s-1'), line)])
  assert.equal(theKeptTextOf(chosen.kept[0]?.text ?? ''), WITHHELD, 'the value a line break split a token across was kept in part')
  assert.equal(chosen.kept[0]?.text.includes('defghijklmnop'), false, 'the part after the line break was kept, so the token can be read across it')
  assert.deepEqual(chosen.marked, [aTranscriptPath('s-1')], 'a split token was not marked')
})

test('a token a terminal escape split is withheld whole, and the escape is the six characters the host writes (martha#646 r=1 R1)', () => {
  const split = 'ghp_ABCDEFGHIJ\u001b[0mKLMNOPQRSTUVWXYZ0123'
  const line = aLineOf(split)
  assert.equal(line.includes('\u001b'), false, 'the fixture wrote a raw escape, so it would not hold the host\'s own six characters')
  const chosen = choosing([aFile(aTranscriptPath('s-1'), line)])
  assert.equal(theKeptTextOf(chosen.kept[0]?.text ?? ''), WITHHELD, 'the value a terminal escape split a token across was kept in part')
  assert.deepEqual(chosen.marked, [aTranscriptPath('s-1')], 'a token split by an escape was not marked')
})

test('the launch\'s own key, split across a line break in a value, is withheld whole (martha#646 r=1 R1, Terra\'s probe E)', () => {
  const chosen = choosing([aFile(aTranscriptPath('s-1'), aLineOf(`key=${THE_LAUNCH_KEY.slice(0, 8)}\n${THE_LAUNCH_KEY.slice(8)}`))])
  assert.equal(theKeptTextOf(chosen.kept[0]?.text ?? ''), WITHHELD, 'the launch key was kept split across a break, so its two halves are readable')
})

test('only the string holding a token is redacted, and the record around it is kept (martha#646 r=1 R1)', () => {
  const token = `${TOKEN_PREFIXES[0] ?? 'ghp_'}abcdefghijklmnop`
  const chosen = choosing([aFile(aTranscriptPath('s-1'), aLineOf(`echo ${token}`))])
  const record = JSON.parse(chosen.kept[0]?.text ?? '{}') as { type: string; message: { content: { type: string; text: string }[] } }
  assert.equal(record.type, 'assistant', 'the record\'s own fields were lost')
  assert.equal(record.message.content[0]?.type, 'text', 'the record\'s structure was lost')
  assert.equal(record.message.content[0]?.text.includes(token), false, 'the token was kept in the clear')
})

test('a line that does not parse whole is withheld whole and kept unmarked (martha#646 r=1 R1)', () => {
  const cut = `{"type":"assistant","text":"half a record`
  const chosen = choosing([aFile(aTranscriptPath('s-1'), `${cut}\n`), aFile(aTranscriptPath('s-2'), aLineOf('nothing secret'))])
  assert.equal(chosen.kept[0]?.text, `${WITHHELD_LINE}\n`, 'a line that does not parse was kept in part')
  assert.deepEqual(chosen.marked, [], 'a line nothing was found in was marked as holding a token')
  assert.equal(chosen.kept[1]?.text, aLineOf('nothing secret'), 'a clean line beside it was not kept as written')
})

test('a transcript over the per-file bound is replaced by a line that says so, never kept in part (martha#646)', () => {
  const path = aTranscriptPath('s-1')
  const chosen = choosing([{ path, bytes: TRANSCRIPTS_FILE_BYTES_KEPT + 1, text: 'never read whole' }])
  assert.equal(chosen.kept[0]?.path, path)
  assert.match(chosen.kept[0]?.text ?? '', /too large to keep/, 'a file over the bound was not replaced by its note')
  assert.match(chosen.kept[0]?.text ?? '', /of one file\]$/, 'the note does not name the per-file bound, so the launch bound alone could be what stopped it')
  assert.equal(chosen.kept[0]?.text.includes('never read whole'), false, 'a file over the bound was kept in part')
})

test('the transcripts of one launch stop at their own bound, and the ones past it are named by their note (martha#646)', () => {
  const first = aTranscriptPath('s-1')
  const second = aTranscriptPath('s-2')
  const half = TRANSCRIPTS_LAUNCH_BYTES_KEPT / 2
  const chosen = choosing([
    { path: first, bytes: 32, text: aLineOf('the first transcript') },
    // Not read: the reader stopped at the launch's bound and said which bound stopped it. Its size is what `stat` said.
    { path: second, bytes: half + 1, unread: 'launch' },
  ])
  assert.equal(chosen.kept.find((one) => one.path === first)?.text, aLineOf('the first transcript'), 'a file inside the launch bound was dropped')
  assert.match(chosen.kept.find((one) => one.path === second)?.text ?? '', /of one launch\]$/, 'the file that passed the launch bound was kept, or the note names another bound')
})

test('a transcript that could not be read is said so, never kept as an empty file (martha#646 r=1 R4)', () => {
  const path = aTranscriptPath('s-1')
  const chosen = choosing([{ path, bytes: 0, unread: 'could-not-read' }])
  assert.equal(chosen.kept[0]?.text, COULD_NOT_READ, 'a transcript nothing could be read of was kept as a file with no content')
})

test('a line no token touched is kept exactly as the host wrote it, never written out again (martha#646 r=3 R8, Terra\'s probe H)', () => {
  // Written out again, the host's own bytes come back changed: a number past 2^53 loses its last digits and 2.50 becomes
  // 2.5, so a reader would be reading something the host never wrote.
  const asWritten = '{"id":12345678901234567890,"ratio" : 2.50}\n'
  const chosen = choosing([aFile(aTranscriptPath('s-1'), asWritten)])
  assert.equal(chosen.kept[0]?.text, asWritten, 'a line no redaction applied to was written out again, so the host\'s own bytes came back changed')
})

test('a token in a record\'s own key is redacted too, never kept in the clear (martha#646 r=3 R7, Terra\'s probe G)', () => {
  const token = `${TOKEN_PREFIXES[0] ?? 'ghp_'}abcdefghijklmnopqrst`
  const asWritten = `${JSON.stringify({ type: 'user', env: { [token]: 1 } })}\n`
  const chosen = choosing([aFile(aTranscriptPath('s-1'), asWritten)])
  assert.equal(chosen.kept[0]?.text.includes(token), false, 'a token used as a record key was kept in the clear')
  assert.deepEqual(chosen.marked, [aTranscriptPath('s-1')], 'a token in a key was not marked for the sidecar')
  const record = JSON.parse(chosen.kept[0]?.text ?? '{}') as { env: Readonly<Record<string, unknown>> }
  assert.deepEqual(record.env, { [REDACTED]: 1 }, 'the record around the redacted key was lost, or the key was dropped instead of redacted')
})

test('a planted file of junk lines is kept as one line, and the launch\'s other transcripts are kept whole beside it (martha#646 r=3 R6)', () => {
  // Kept one withheld line each, this file's kept text would be tens of times its own size; a whole file of them grew
  // past what a joined string can hold and threw, which took every transcript of the launch with it (Terra's probe F).
  const junk = 'x\n'.repeat(TRANSCRIPTS_FILE_BYTES_KEPT / 4096)
  const chosen = choosing([aFile(aTranscriptPath('s-1'), junk), aFile(aTranscriptPath('s-2'), aLineOf('the clean one'))])
  const theJunkKept = chosen.kept[0]?.text ?? ''
  assert.equal(theJunkKept, `${theWithheldLines(TRANSCRIPTS_FILE_BYTES_KEPT / 4096)}\n`, 'the junk file was not kept as the one line that says how many lines were withheld')
  assert.equal(chosen.kept[1]?.text, aLineOf('the clean one'), 'one planted file cost the launch its other transcripts')
})

test('a line that is not one of the host\'s records at all is withheld unparsed, so a file of them costs no parse each (martha#646 r=3 R6)', () => {
  // The host writes one JSON object or array a line. Anything else is not its record, and parsing every one of a big file
  // of them meant throwing on every one; it is withheld, and never handed to a reader.
  const chosen = choosing([aFile(aTranscriptPath('s-1'), `123\n"a string"\n{'not': 'json'}\n${aLineOf('the clean one')}`)])
  assert.equal(chosen.kept[0]?.text, `${theWithheldLines(3)}\n${aLineOf('the clean one')}`, 'a line that is not the host\'s record was parsed, kept, or not counted in the run it belongs to')
})

test('a run of lines that do not parse is kept as one line naming how many, not one line each (martha#646 r=3 R6)', () => {
  const three = ['{"half a record', 'and one more', '}neither parses'].join('\n')
  const clean = aLineOf('the clean one')
  const chosen = choosing([aFile(aTranscriptPath('s-1'), `${three}\n${clean}`)])
  assert.equal(chosen.kept[0]?.text, `${theWithheldLines(3)}\n${clean}`, 'a run of lines that do not parse was kept one withheld line each, so the kept text grew with the file')
})

test('the launch bound stops a file the per-file bound has room for, counted on what is kept rather than on what was read (martha#646 r=3 R6)', () => {
  // A value a line break split a token across is kept as WITHHELD, which is longer than the value was: so a file can be
  // inside the per-file bound and still keep more than its own size, and the launch's room is what it passes.
  const amplified = aLineOf(`${TOKEN_PREFIXES[0] ?? 'ghp_'}abcdefgh\nijklmnopqrst`)
  const enough = Math.ceil(TRANSCRIPTS_LAUNCH_BYTES_KEPT / WITHHELD.length)
  const first = aTranscriptPath('s-1')
  const second = aTranscriptPath('s-2')
  const chosen = choosing([aFile(first, aLineOf('the first one')), aFile(second, amplified.repeat(enough))])
  assert.equal(chosen.kept.find((one) => one.path === first)?.text, aLineOf('the first one'), 'a file inside the launch bound was dropped')
  assert.match(chosen.kept.find((one) => one.path === second)?.text ?? '', /of one launch\]$/, 'a file whose kept text passes the launch bound was kept, or the note names another bound')
  assert.ok(Buffer.byteLength(amplified.repeat(enough)) < TRANSCRIPTS_LAUNCH_BYTES_KEPT, 'the fixture read more than the launch bound, so it does not say what was counted')
})

test('the worst case the product states is the two constants\' own product, read from them (martha#646, Mars item 3)', () => {
  assert.equal(TRANSCRIPTS_LAUNCHES_KEPT * TRANSCRIPTS_LAUNCH_BYTES_KEPT, 1024 * 1024 * 1024, 'the kept launches times the bound per launch is not the stated 1 GiB per project')
})
