// The host draws a phrase a word at a time, moving the cursor to where each next word starts, so a probe that waits
// for the phrase in the raw screen waits forever and then drives the host into a state it never meant to leave
// (martha#693: the clear probe never accepted the bypass warning, and its Return took the dialog's "No, exit").
//
// The fixture beside this file is one warning screen exactly as host 2.1.327 drew it, kept from a run of that probe.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { plain, says } from './a_screen_drawn_in_pieces.ts'

const DRAWN = readFileSync(join(import.meta.dirname, 'the_bypass_warning_as_the_host_drew_it.txt'), 'utf8')

test('a phrase the host drew in pieces is found, and the raw screen does not hold it', () => {
  assert.ok(
    !DRAWN.includes('Enter to confirm'),
    'the fixture holds the phrase whole, so it would pass a match that never had to read a drawn screen',
  )
  assert.ok(says(DRAWN, 'Enter to confirm'), 'the warning\'s own line is not found in the screen the host drew')
})

test('a phrase the screen does not hold is not found', () => {
  assert.ok(!says(DRAWN, 'No such line was drawn on this screen'))
})

test('what a terminal draws with is taken out, and a screen with no moves reads as itself', () => {
  assert.equal(plain('\u001b[31mred\u001b[0m'), 'red')
  assert.equal(plain('\u001b]0;a title\u0007text'), 'text')
  assert.equal(plain('two  words'), 'twowords')
  assert.ok(says('Enter to confirm', 'Enter to confirm'))
})
