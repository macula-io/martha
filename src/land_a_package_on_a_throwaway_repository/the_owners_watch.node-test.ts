// The live run's watch rows (martha#843): the owner watched read-only, the builder's ring was sent to that screen, and the
// VERDICT line was drawn there. Each row fails by its own name, and the bytes are the ones the ring itself makes.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { notificationIdOf, notificationOf } from '../ring_the_owner/ring_the_owner.ts'
import { runTheGuard } from './main.ts'
import { THE_VERDICT } from './the_live_runs_claims.ts'
import { drawnPlain, READ_ONLY_FLAG, THE_OWNER_WATCHED, THE_RING_REACHED, THE_VERDICT_WAS_SHOWN, whichWatchClaimFails } from './the_owners_watch.ts'

const LIVE_RUN = { package: 'synthetic-bot/martha-live-x#1', builder: 'builder' }
const RECORDER = '4101'
const OWNER = '4202'

/** The listing tmux gives, the proof's own client first and the owner's with `flags`. */
const clients = (flags = `attached,focused,ignore-size,${READ_ONLY_FLAG}`): string =>
  `${RECORDER} /dev/pts/1 attached,ignore-size,${READ_ONLY_FLAG}\n${OWNER} /dev/pts/2 ${flags}\n`

/** The ring for `member`, as a terminal reads it once tmux has handed on the passthrough. */
const ringOf = (member: string): string => notificationOf(notificationIdOf(member), `${member} needs you`, 'landing')

/** The VERDICT line as a full-screen host draws it: a cursor move between words and the line wrapped at its width. */
const VERDICT_DRAWN = `\u001b[2;1HVERDICT\u001b[1C${LIVE_RUN.package}\r\n ${THE_VERDICT} the rest of the line`

const WATCHED = `\u001b[?1049h${VERDICT_DRAWN}\u001b[5;1Hthe landing menu${ringOf(LIVE_RUN.builder)}`

test('all three rows hold: the owner read-only, the builder\'s ring sent, and the VERDICT drawn (martha#843)', () => {
  assert.equal(whichWatchClaimFails(LIVE_RUN, WATCHED, clients(), RECORDER), undefined)
})

test('the owner watched read-only: the proof\'s own client is never the owner\'s, and a writable one is not watching', () => {
  const fails = (listing: string, recorder = RECORDER): string | undefined => whichWatchClaimFails(LIVE_RUN, WATCHED, listing, recorder)
  assert.match(fails(`${RECORDER} /dev/pts/1 attached,${READ_ONLY_FLAG}\n`) ?? '', new RegExp(`^${THE_OWNER_WATCHED}: no client but the proof's own`))
  assert.match(fails(clients('attached,focused')) ?? '', new RegExp(`^${THE_OWNER_WATCHED}: no client of the owner's .* is ${READ_ONLY_FLAG}`))
  assert.match(fails(clients(), '9999') ?? '', new RegExp(`^${THE_OWNER_WATCHED}: the proof's own client \\(pid 9999\\) is not in the listing`))
  assert.match(fails('') ?? '', new RegExp(`^${THE_OWNER_WATCHED}:`), 'no listing at all')
  assert.match(fails(`${RECORDER} /dev/pts/1 ${READ_ONLY_FLAG}\nnot a client line\n`) ?? '', new RegExp(`^${THE_OWNER_WATCHED}: no client but`), 'a line that is not a client names none')
})

test('the builder\'s ring sent: none at all, or only another member\'s, fails by name', () => {
  const fails = (watched: string): string | undefined => whichWatchClaimFails(LIVE_RUN, watched, clients(), RECORDER)
  assert.match(fails(VERDICT_DRAWN) ?? '', new RegExp(`^${THE_RING_REACHED}:`))
  assert.match(fails(`${VERDICT_DRAWN}${ringOf('reviewer')}`) ?? '', new RegExp(`^${THE_RING_REACHED}:`), 'the reviewer\'s ring is not the builder\'s')
})

test('the VERDICT drawn: matched as drawn, and a screen without it fails by name', () => {
  assert.equal(drawnPlain(VERDICT_DRAWN).includes(drawnPlain(`VERDICT ${LIVE_RUN.package} ${THE_VERDICT}`)), true, 'the cursor move and the wrap are read past')
  assert.match(whichWatchClaimFails(LIVE_RUN, `the landing menu${ringOf(LIVE_RUN.builder)}`, clients(), RECORDER) ?? '', new RegExp(`^${THE_VERDICT_WAS_SHOWN}:`))
  assert.match(whichWatchClaimFails({ ...LIVE_RUN, package: 'synthetic-bot/martha-live-x#2' }, WATCHED, clients(), RECORDER) ?? '', new RegExp(`^${THE_VERDICT_WAS_SHOWN}:`), 'another package\'s verdict is not this live run\'s')
})

test('the watch guard reads its file and the bytes, and a file that names too little cannot be looked at (martha#843)', () => {
  const place = mkdtempSync(join(tmpdir(), 'martha-843-watch-'))
  try {
    const file = join(place, 'watch.json')
    writeFileSync(file, JSON.stringify({ ...LIVE_RUN, clients: clients(), recorder: RECORDER }))
    assert.deepEqual(runTheGuard(['watch', file], WATCHED), { code: 0 })
    assert.equal(runTheGuard(['watch', file], VERDICT_DRAWN).code, 1, 'no ring refuses')
    writeFileSync(file, JSON.stringify({ ...LIVE_RUN, clients: clients() }))
    const said = runTheGuard(['watch', file], WATCHED)
    assert.equal(said.code, 2)
    assert.match(said.err ?? '', /names no recorder/)
  } finally {
    removeTheTree(place)
  }
})
