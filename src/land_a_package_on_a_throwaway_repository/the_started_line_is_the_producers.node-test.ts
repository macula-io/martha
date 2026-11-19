// The night reads a member's start by the words `martha start` prints (#639 night 1). The proof's bash spells those
// words as STARTED_WORDS; this test holds them to the line the command itself makes, so a change to the producer
// fails here by name instead of on the next live night.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { startedLine } from '../run_the_martha_command/run_the_martha_command.ts'

const PROOF = join(import.meta.dirname, '..', '..', 'prove_a_clean_install_in_a_throwaway_container', 'prove_a_clean_install_in_a_throwaway_container.sh')

/** The one `STARTED_WORDS='…'` line of the proof, its words; a proof with none, or more than one, fails the test. */
function theProofsStartedWords(): string {
  const lines = readFileSync(PROOF, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('STARTED_WORDS='))
  assert.equal(lines.length, 1, `the proof defines STARTED_WORDS ${lines.length} times`)
  const words = /^STARTED_WORDS='([^']*)'$/.exec(lines[0] ?? '')?.[1]
  assert.ok(words !== undefined && words !== '', 'the proof spells STARTED_WORDS as one quoted string')
  return words
}

test("the proof's started words are the ones `martha start` prints, between the member and its pid", () => {
  const words = theProofsStartedWords()
  assert.equal(startedLine('a-member', 31337), `a-member ${words} 31337`)
})
