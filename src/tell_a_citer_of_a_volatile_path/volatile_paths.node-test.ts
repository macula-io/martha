// A path a reboot deletes, said to the member that cited it (martha#314).
//
// These cases pin the rule on its own: which paths a text cites under the roots in force, each once and in the order
// it appears, and the one line the member reads. The roots are always handed in, so no case depends on the machine the
// suite runs on, and the note is read for the handover tool's own name rather than for a word a test spelt.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import { theRootsInForce, theVolatileNote, volatilePathsIn } from './volatile_paths.ts'

const ROOT = '/var/scratch'
const RUNTIME = '/run/user/1000'

test('#314: a path under a root is cited once, in the order it appears', () => {
  assert.deepEqual(volatilePathsIn(`${ROOT}/verdict.md and again ${ROOT}/verdict.md`, [ROOT]), [`${ROOT}/verdict.md`])
  assert.deepEqual(volatilePathsIn(`${ROOT}/a then ${ROOT}/b and ${ROOT}/a`, [ROOT]), [`${ROOT}/a`, `${ROOT}/b`])
})

test('#314: the root itself is a path the note names', () => {
  assert.deepEqual(volatilePathsIn(`scratch is ${ROOT}`, [ROOT]), [ROOT])
})

test('#314: a deeper directory that merely ends in a root, a longer name, and a URL are not paths under it', () => {
  assert.deepEqual(volatilePathsIn('/home/test/work/var/scratch/x', [ROOT]), [])
  assert.deepEqual(volatilePathsIn(`${ROOT}foo/x`, [ROOT]), [])
  assert.deepEqual(volatilePathsIn('see https://github.com/macula-io/martha/pull/314', [ROOT]), [])
  assert.deepEqual(volatilePathsIn('the handover is /home/test/martha/handovers/HANDOVER.md', [ROOT]), [])
})

test('#314: a path after an equals sign or a star is a path', () => {
  assert.deepEqual(volatilePathsIn(`run --work=${ROOT}/x now`, [ROOT]), [`${ROOT}/x`])
  assert.deepEqual(volatilePathsIn(`see **${ROOT}/x** for the log`, [ROOT]), [`${ROOT}/x`])
})

test('#314: the sentence punctuation after a path is not part of it', () => {
  assert.deepEqual(volatilePathsIn(`Logs in ${ROOT}/t1.log. Read ${ROOT}/t1.log first`, [ROOT]), [`${ROOT}/t1.log`])
  assert.deepEqual(volatilePathsIn(`(${ROOT}/a), "${ROOT}/b"`, [ROOT]), [`${ROOT}/a`, `${ROOT}/b`])
})

test('#314: roots the crew declares are the roots in force, and the machine\'s own only when it declares none', () => {
  assert.deepEqual(theRootsInForce([ROOT], [RUNTIME]), [ROOT])
  assert.deepEqual(theRootsInForce([], [RUNTIME]), [RUNTIME])
  // A declared root displaces the machine's rather than adding to it, so a root the crew leaves out is an ordinary path.
  assert.deepEqual(volatilePathsIn(`${ROOT}/a and ${RUNTIME}/b`, theRootsInForce([ROOT], [RUNTIME])), [`${ROOT}/a`])
})

test('#314: the note names the paths, what a reboot does to them, and where to write them instead', () => {
  const one = theVolatileNote([`${ROOT}/verdict.md`])
  assert.match(one, new RegExp(`${ROOT}/verdict\\.md does not survive a reboot`), 'the note does not say the one path goes')
  assert.match(one, /kept in memory/, 'the note does not say why a reboot takes it')
  assert.ok(one.includes(WRITE_MY_HANDOVER_TOOL), `the note does not send the member to the handover tool: ${one}`)

  const two = theVolatileNote([`${ROOT}/a`, `${ROOT}/b`])
  assert.match(two, /do not survive a reboot/, 'two paths are not said in the plural')
})
