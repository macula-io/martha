// The config text's own syntax, pinned on the parser directly (martha#443 part 3 follow-up).
//
// These were the two cases in the guard's test file that called `entriesInText` itself, moved beside the parser they
// prove so that a person changing the parser reads its cases in its own directory. What needs a checkout and the
// guard's own refusal stays beside the guard, in
// ../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.node-test.ts: this file is no
// assertion changed, only where it stands.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { entriesInText } from './git_config_a_later_run_reads.ts'

// Mercurius's G6 (martha#192 r=3): git reads `[core] ; note` as the header and
// nothing else — the key on the next line is its own entry (measured, 2.56.0, and in
// five spellings: `; note`, `;note`, `# note`, `#note`, and either one stuck to the
// bracket). The guard called the line an unmodelled form and refused every write into
// the checkout, which is the refusing side but refuses a config git reads perfectly.
test('a comment after a section header is no entry, and the key below it is git\'s (#192 r=3)', () => {
  assert.deepEqual(entriesInText('/scratch/config', '[core] ; note\n\tkey = v\n'), { kind: 'entries', entries: [{ file: '/scratch/config', line: 2, key: 'core.key', value: 'v' }] })
})

test('an old-style subsection is lowercased as git lowercases it (#192 r=2)', () => {
  // git reads `[sec.Sub]` as the section `sec.sub` (measured), and a guard that kept
  // the case would read a key under a name git never looks the key up by.
  const read = entriesInText('/scratch/config', '[sec.Sub]\n\tkey = v\n')
  assert.deepEqual(read, { kind: 'entries', entries: [{ file: '/scratch/config', line: 2, key: 'sec.sub.key', value: 'v' }] })
})
