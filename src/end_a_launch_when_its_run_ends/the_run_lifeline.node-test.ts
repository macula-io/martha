// The lifeline a run keeps, and what the launcher makes of it (#472).
//
// Real descriptors and a real named pipe: the run's end of a pipe is the whole mechanism, and a stand-in for it would
// prove nothing about what the kernel does when the run goes.

import assert from 'node:assert/strict'
import { closeSync, constants, lstatSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { NOT_STARTED } from '../end_a_launch/end_a_launch.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { keepTheLifelineIn, type TheRunsEnd } from './keep_the_lifeline_in.ts'
import { RUN_LIFELINE_VARIABLE, takeTheLaunchOffTheDisk, theRunsLifeline } from './the_run_lifeline.ts'

/** A directory of this test's own, removed with everything in it. */
const aDirectoryOfItsOwn = (name: string): string => mkdtempSync(join(tmpdir(), `martha-${name}-`))

/** Waits until the launch has been told, which arrives on a turn of the event loop rather than in this one. */
async function untilItIsGone(taken: { theRunIsGone(): boolean }): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!taken.theRunIsGone() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
}

test('a launch with no variable naming a lifeline is watched by nothing: an owner owns their member (#472)', () => {
  const lifeline = theRunsLifeline({ HOME: '/home/test' }, NOT_STARTED)
  assert.equal(lifeline.kind, 'none')
})

test('a variable that names no descriptor number refuses the launch by name (#472)', () => {
  const lifeline = theRunsLifeline({ [RUN_LIFELINE_VARIABLE]: 'the fourth descriptor' }, NOT_STARTED)
  assert.equal(lifeline.kind, 'refused')
  if (lifeline.kind !== 'refused') return
  assert.ok(lifeline.refusal.startsWith(NOT_STARTED), 'the refusal is the launcher\'s own')
  assert.ok(lifeline.refusal.includes(RUN_LIFELINE_VARIABLE), 'it names the variable it read')
  assert.ok(lifeline.refusal.includes('the fourth descriptor'), 'and what the variable held')
})

test('a variable naming a descriptor this process does not hold refuses the launch, rather than starting an unwatched member (#472)', () => {
  const closed = openSync('/dev/null', 'r')
  closeSync(closed)
  const lifeline = theRunsLifeline({ [RUN_LIFELINE_VARIABLE]: String(closed) }, NOT_STARTED)
  assert.equal(lifeline.kind, 'refused')
  if (lifeline.kind !== 'refused') return
  assert.ok(lifeline.refusal.includes(String(closed)), lifeline.refusal)
  assert.ok(lifeline.refusal.includes('ENOENT'), 'the kernel\'s own reason is in it')
})

test('a descriptor that is not a pipe refuses the launch by name (#472)', () => {
  const directory = aDirectoryOfItsOwn('lifeline-not-a-pipe')
  try {
    const path = join(directory, 'a-file')
    writeFileSync(path, 'not a pipe\n')
    // The launcher closes the number it was handed as it takes the pipe in, so this test does not close it again.
    const handed = openSync(path, 'r')
    const lifeline = theRunsLifeline({ [RUN_LIFELINE_VARIABLE]: String(handed) }, NOT_STARTED)
    assert.equal(lifeline.kind, 'refused')
    if (lifeline.kind === 'refused') assert.ok(lifeline.refusal.includes('not a pipe'), lifeline.refusal)
  } finally {
    removeTheTree(directory)
  }
})

test('a pipe whose run has already gone refuses the launch by name: no member starts under a run that is not there (#472)', () => {
  const directory = aDirectoryOfItsOwn('lifeline-already-gone')
  const lifeline = keepTheLifelineIn(directory)
  try {
    lifeline.closeTheRunsEnd()
    const taken = theRunsLifeline(inheritedWithItsOwnDescriptor(lifeline), NOT_STARTED)
    assert.equal(taken.kind, 'refused')
    if (taken.kind !== 'refused') return
    assert.ok(taken.refusal.includes('already closed'), taken.refusal)
    assert.ok(taken.refusal.includes('has gone'), 'it says what that means for the launch')
  } finally {
    lifeline.close()
    removeTheTree(directory)
  }
})

test('a run\'s end that closes tells the launch, and the member\'s environment carries no variable naming the pipe (#472)', async () => {
  const directory = aDirectoryOfItsOwn('lifeline-watched')
  const lifeline = keepTheLifelineIn(directory)
  const handed = openSync(lifeline.path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const taken = theRunsLifeline({ PATH: '/usr/bin', [RUN_LIFELINE_VARIABLE]: String(handed) }, NOT_STARTED)
    assert.equal(taken.kind, 'watched')
    if (taken.kind !== 'watched') return
    assert.equal(taken.theRunIsGone(), false, 'a run still holding its end has not gone')
    assert.equal(RUN_LIFELINE_VARIABLE in taken.inherited, false, 'the member is handed no variable naming the pipe')
    assert.equal(taken.inherited['PATH'], '/usr/bin', 'and keeps everything else it inherited')
    assert.throws(() => closeSync(handed), 'the descriptor the launcher was handed is no longer open under that number')
    let told = 0
    taken.whenTheRunEnds(() => (told += 1))
    lifeline.closeTheRunsEnd()
    await untilItIsGone(taken)
    assert.equal(told, 1, 'the launch is told the moment the run goes')
    assert.equal(taken.theRunIsGone(), true)
    taken.forget()
  } finally {
    lifeline.close()
    removeTheTree(directory)
  }
})

test('a run that is already gone says so at once to whatever asks, and never reads as alive (#472)', async () => {
  const directory = aDirectoryOfItsOwn('lifeline-told-at-once')
  const lifeline = keepTheLifelineIn(directory)
  const handed = openSync(lifeline.path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const taken = theRunsLifeline({ [RUN_LIFELINE_VARIABLE]: String(handed) }, NOT_STARTED)
    assert.equal(taken.kind, 'watched')
    if (taken.kind !== 'watched') return
    lifeline.closeTheRunsEnd()
    await untilItIsGone(taken)
    let told = 0
    taken.whenTheRunEnds(() => (told += 1))
    assert.equal(told, 1, 'a run already gone is told at once, not only to those who asked before it went')
    taken.forget()
  } finally {
    lifeline.close()
    removeTheTree(directory)
  }
})

test('a run\'s lifeline is a named pipe: a socket could not be reopened, and a descriptor that cannot be taken in cannot be held close-on-exec (#472)', () => {
  const directory = aDirectoryOfItsOwn('lifeline-is-a-pipe')
  const lifeline = keepTheLifelineIn(directory)
  try {
    assert.equal(lstatSync(lifeline.path).isFIFO(), true)
    assert.equal(lifeline.stdio.length, 4, 'the lifeline is the child\'s fourth stream')
  } finally {
    lifeline.close()
    removeTheTree(directory)
  }
})

test('a run\'s end keeps the member\'s transcripts after the relay and before the snapshot, and the record last (#472, martha#646)', () => {
  const order: string[] = []
  const made = {
    relayDirectory: { remove: (): void => void order.push('relay') },
    keepTranscripts: (): void => void order.push('keep'),
    removeSnapshot: (): void => void order.push('snapshot'),
  }
  takeTheLaunchOffTheDisk(made, () => order.push('record'))
  assert.deepEqual(order, ['relay', 'keep', 'snapshot', 'record'],
    'the keep does not sit between the relay and the snapshot with the record last, so it can lose what the snapshot holds')
})

/**
 * The lifeline as a launch finds it when the run's child holds it: the read end opened here under a number this process
 * knows, which is what the launcher is handed, and the run's own end still open.
 */
function inheritedWithItsOwnDescriptor(lifeline: TheRunsEnd): Readonly<Record<string, string>> {
  const handed = openSync(lifeline.path, constants.O_RDONLY | constants.O_NONBLOCK)
  return { [RUN_LIFELINE_VARIABLE]: String(handed) }
}
