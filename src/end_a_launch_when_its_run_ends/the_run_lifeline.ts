// The end of the pipe a run keeps open for as long as its member may run (#472).
//
// This exists so a run that starts a member — a probe, a recorded-host test, a by-hand check — takes that member with
// it: however the run ends, a normal return, a throw, a signal, a SIGKILL, the end of the pipe closes, the kernel
// gives this launcher a zero-byte read, and the launcher does what it already does when a signal ends it. Nothing
// depends on a signal reaching anyone, and an orphaned `script` — which keeps a dead run's terminal alive and so
// defeats every signal in the chain — cannot defeat it.
//
// The descriptor is named once, in MARTHA_RUN_LIFELINE_FD, and never guessed: a fixed number would be an assumption
// about a chain this launcher does not own (`script`, then `sh`, then martha). A descriptor the variable names that is
// not a pipe this launcher can read refuses the launch by name before anything is made, so no run can believe it is
// protected when it is not.
//
// It is taken in twice over on purpose. The launcher reopens the pipe by path through /proc/self/fd, which is a
// descriptor this process opens and so close-on-exec: no member, tool server or nested martha holds it, and none finds
// a variable naming a descriptor that is no longer there. The number it was handed is closed, and the variable is
// dropped from the member's environment beside the launcher's other plumbing.
//
// A pipe of this shape is a FIFO, never a socketpair: the kernel refuses to reopen a socket through /proc/self/fd, and
// a descriptor that cannot be taken in this way cannot be held close-on-exec. The run makes it with keepTheLifelineIn.

import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { Socket } from 'node:net'
import process from 'node:process'

/** The one variable a run names its lifeline in. */
export const RUN_LIFELINE_VARIABLE = 'MARTHA_RUN_LIFELINE_FD'

/** A run is watching: its end of the pipe is open, taken in by this process, and read for its end. */
export interface Watching {
  readonly kind: 'watched'
  /** The environment the member may inherit: the run's own, with the lifeline's variable dropped. */
  readonly inherited: Readonly<Record<string, string | undefined>>
  /** Whether the run has gone. A pipe this process cannot read is never read as alive. */
  theRunIsGone(): boolean
  /** What to do the moment the run goes; a run already gone is told at once. */
  whenTheRunEnds(what: () => void): void
  /** Stops reading: the launch is over, and its run's end says nothing more. */
  forget(): void
}

/** What a launch has of its run: nothing (an owner's own start), a refusal, or the pipe it reads. */
export type TheRunsLifeline = { readonly kind: 'none' } | { readonly kind: 'refused'; readonly refusal: string } | Watching

/** The pipe's end, once read: 0 is the run gone, and a writer still there answers EAGAIN on a pipe opened unblocked. */
function thePipeIsAtItsEnd(fd: number): boolean {
  try {
    return readSync(fd, Buffer.alloc(1), 0, 1, null) === 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EAGAIN') return false
    throw error
  }
}

/** Why a named descriptor is no lifeline this launcher can read, by the name it was given in. */
const notALifeline = (notStarted: string, named: string, why: string): string => `${notStarted}: ${RUN_LIFELINE_VARIABLE} names ${named}, ${why}`

/**
 * The named descriptor taken in: reopened by path, close-on-exec, with the number this process was handed closed. Or
 * why it is no pipe to read: not a descriptor at all, not a pipe, or a pipe whose writer has already gone.
 */
function takenIn(named: string, notStarted: string): { readonly fd: number } | { readonly refusal: string } {
  const number = Number(named)
  if (!Number.isInteger(number) || number < 0) return { refusal: notALifeline(notStarted, named, 'which is not a descriptor number.') }
  let taken: number
  try {
    taken = openSync(`/proc/self/fd/${number}`, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (error) {
    return { refusal: notALifeline(notStarted, named, `which is not a descriptor this launcher can read (${(error as NodeJS.ErrnoException).code ?? String(error)}).`) }
  }
  closeSync(number)
  if (!fstatSync(taken).isFIFO()) {
    closeSync(taken)
    return { refusal: notALifeline(notStarted, named, 'which is not a pipe its run could keep open.') }
  }
  if (thePipeIsAtItsEnd(taken)) {
    closeSync(taken)
    return { refusal: notALifeline(notStarted, named, 'whose other end is already closed: the run that asked for this launch has gone.') }
  }
  return { fd: taken }
}

/** The taken-in pipe, read to its end: the launch is told the moment the run goes, and never reads silence as alive. */
function watching(fd: number, inherited: Readonly<Record<string, string | undefined>>): Watching {
  const pipe = new Socket({ fd, readable: true, writable: false })
  const told: (() => void)[] = []
  let gone = false
  const theRunWent = (): void => {
    gone = true
    for (const what of told.splice(0)) what()
  }
  pipe.on('end', theRunWent)
  // A pipe this process cannot read says nothing about the run, and nothing is the answer that keeps a member alive:
  // it is taken for the end of the run (martha#472: unknown is never clean).
  pipe.on('error', theRunWent)
  pipe.resume()
  // The pipe says when the run went; it never keeps this process up by itself. A launch refused while its run is still
  // there returns with nothing else held, and a pipe left referenced would end that launcher only when a run that may
  // outlive it ends — which is the deadlock the recorded host's synchronous runner hit (#472 r=1). What does keep a
  // launcher up is its member, and that is the one thing that must.
  pipe.unref()
  return {
    kind: 'watched',
    inherited,
    theRunIsGone: () => gone,
    whenTheRunEnds: (what) => (gone ? what() : told.push(what)),
    forget: () => pipe.destroy(),
  }
}

/**
 * What this launch has of the run that asked for it: nothing when no variable names a lifeline (an owner typing
 * `martha start` keeps their member past their shell, as before), a refusal when the variable names no pipe this
 * launcher can read, and otherwise the pipe itself, read until its end.
 */
export function theRunsLifeline(inherited: Readonly<Record<string, string | undefined>>, notStarted: string): TheRunsLifeline {
  const named = inherited[RUN_LIFELINE_VARIABLE]
  if (named === undefined || named === '') return { kind: 'none' }
  const taken = takenIn(named, notStarted)
  if ('refusal' in taken) return { kind: 'refused', refusal: taken.refusal }
  const without = { ...inherited }
  delete without[RUN_LIFELINE_VARIABLE]
  return watching(taken.fd, without)
}

/** Why a member is not started: the run that asked for it has gone, so nothing may run under it. */
export const THE_RUN_IS_GONE = 'the run that asked for it has gone'

/** Thrown where a member would be admitted after its run has gone, so the held job ends NOT_ADMITTED and never runs. */
export class TheRunIsGone extends Error {
  constructor() {
    super(THE_RUN_IS_GONE)
    this.name = 'TheRunIsGone'
  }
}

/**
 * The launcher's admission of a held member, refused by name when its run has gone: the hold exists so that the
 * decision to run is the launcher's, and this is that decision made knowing the run has ended.
 */
export function refusedIfTheRunIsGone<A>(made: { readonly theRunIsGone?: () => boolean }, admit: () => A): A {
  if (made.theRunIsGone?.() === true) throw new TheRunIsGone()
  return admit()
}

/**
 * What is left of a launch once its member's group is dead, in the order the signal path fixes (#472): the relay
 * directory, then the snapshot, then its launch record. The group goes first, before any of this, so the member is
 * not running for the instant the directories take to remove.
 */
export function takeTheLaunchOffTheDisk(
  made: { readonly relayDirectory: { remove(): void }; removeSnapshot(): void },
  dropTheRecord: () => void,
): void {
  made.relayDirectory.remove()
  made.removeSnapshot()
  dropTheRecord()
}

/** Sends SIGKILL to a whole process group; a group already gone is no error. */
export function killGroup(group: number): void {
  try {
    process.kill(-group, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}
