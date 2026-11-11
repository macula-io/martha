// The owner's turn is typed once the host has drawn its own input box (martha#264).
//
// Run 43030805227 stalled with the turn sitting in the host's box and no model request ever sent: the run had typed
// into a host that was still starting, because the wait before it was satisfied by anything the terminal showed —
// `martha start`'s own two lines above the host's screen included. These cases pin what does and does not count as the
// host being ready: the launcher's lines are not the box, and the host's box is.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HOST_PROMPT_MARK, textArrivingInChunks, theHostHasDrawnItsPrompt } from './drive_the_recorded_host.ts'

/** What `martha start` itself prints before the host draws anything, taken from the run #264 was found on. */
const THE_LAUNCHER_SAYING_THE_MEMBER_IS_UP = [
  'martha: Starting builder on the config you approved at 2026-11-11T13:38:11.031Z (fingerprint 50cf0052d3793c2e).',
  'builder started, pid 4319',
  '',
].join('\n')

/** The host's input box, as the host draws it: the mark, then the line the owner types on. */
const THE_HOSTS_BOX = `\x1b[2K${HOST_PROMPT_MARK} \x1b[1m\x1b[7m \x1b[27m`

test('#264: the launcher saying the member is up is not the host having drawn its box', () => {
  assert.equal(
    theHostHasDrawnItsPrompt(THE_LAUNCHER_SAYING_THE_MEMBER_IS_UP),
    false,
    'the run typed the owner\'s turn at a host that had drawn nothing, which is the stall #264 was found on: the text sat in the box and no model request was ever sent',
  )
})

test('#264: the host\'s own input box is what the turn waits for', () => {
  assert.equal(
    theHostHasDrawnItsPrompt(`${THE_LAUNCHER_SAYING_THE_MEMBER_IS_UP}${THE_HOSTS_BOX}`),
    true,
    'the host drew its box and the run never typed, so every recorded-host case would stall where this one is answered',
  )
})

test('#264: a screen the host has drawn its box on says so however much the launcher said first', () => {
  assert.equal(theHostHasDrawnItsPrompt(`${THE_LAUNCHER_SAYING_THE_MEMBER_IS_UP}${THE_LAUNCHER_SAYING_THE_MEMBER_IS_UP}${THE_HOSTS_BOX}`), true)
})

test('#264: a box mark split across two chunks is still read as drawn', () => {
  const bytes = Buffer.from(THE_HOSTS_BOX, 'utf8')
  // Cut inside the mark itself: the host drew it, and a reader that decodes each chunk on its own sees two halves
  // that are neither the mark nor anything else.
  const cut = bytes.indexOf(Buffer.from(HOST_PROMPT_MARK, 'utf8')) + 1
  const stream = textArrivingInChunks()
  const shown = stream.write(bytes.subarray(0, cut)) + stream.write(bytes.subarray(cut))
  assert.equal(
    theHostHasDrawnItsPrompt(shown),
    true,
    'a mark the host drew across two reads was read as never drawn, so the run would wait out its whole silence budget at a host that was ready',
  )
})
