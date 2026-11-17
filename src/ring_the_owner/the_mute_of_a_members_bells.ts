// The owner's own silence for one member's bells (martha#371), kept in the crew's own place and read wherever a bell is
// about to be rung.
//
// This exists because a crew's declaration switches the bells on or off for every member at once (`house_rules.
// owner_bell`), and an owner with one noisy member had no way to keep the bell for the rest of the crew. The mute is
// that one member's silence: the row still says "needs you" while the member's host is asking, and what is silenced is
// the bell and the notification.
//
// WHO FLIPS IT. Only the owner, at a terminal, with `martha bells <member> muted|heard`. There is no crew tool for it
// and no act in `who_may_act`, for the reason ../release_a_held_member settled for the gate: a member's model can call
// a tool, and the one thing the bell warns the owner about must not be able to silence its own warning. The residual is
// that slice's too, said rather than hidden: a terminal is the same OS user's, so a second member that already has one
// can type this as well (A13).
//
// WHERE IT IS KEPT. `<crew>/the-bells/the_bells_of_a_member.jsonl`, one line per flip, through the crew's own `lines`
// seam (../audit_the_gate_for_a_member's StateLines), so no slice reaches a path on this machine itself. It is history,
// never a rewritten state: who silenced what and when stays readable after every later flip, which is also what lets
// the owner audit a silence instead of taking it on trust.
//
// WHAT A BROKEN FILE DOES: THE BELL RINGS. A file that cannot be read is not a mute, and a line that is not a flip makes
// the whole file untrustworthy, so neither is honoured. A silence must never be the product of a failure — the failure
// that matters is a member going silent and the owner never learning why — and un-muting is the safe direction, because
// it makes the bell audible again. The reader says `why` so `martha bells` can refuse and tell the owner their mute is
// not in force, instead of leaving them believing in a silence that is not there.

import { join } from 'node:path'

import { sameMemberName } from '../declare_crew/declare_crew.ts'
import type { Refused } from '../host_contract/host_contract.ts'

/**
 * The crew's own state files, as the host keeps them: a slice names a file and the host writes or reads it, so no slice
 * reaches a path on this machine itself (../keep_martha_state_outside_the_checkout is the adapter's own answer, and a
 * slice may not import it).
 *
 * Spelled here rather than taken from the gate's audit, which has the same shape: that slice is sealed by its own test
 * (../audit_the_gate_for_a_member's the_audit_never_reaches_a_turn), because its lines carry what the gate refused and
 * who sent it, so no file but the audit's own may even name it. What is shared between the two is a shape, not a value.
 */
export interface StateLines {
  /** Keeps one more line in `path`, or says why it could not. */
  readonly append: (path: string, line: string, what: string) => Refused | undefined
  /** The whole text of `path`, or why it cannot be read. */
  readonly read: (path: string) => { readonly text: string } | Refused
}

/** The folder inside the crew's own state directory that holds the flips: one file for the whole crew. */
export const THE_BELLS_PLACE = 'the-bells'

/** The file in it, one line per flip. */
export const THE_BELLS_FILE = 'the_bells_of_a_member.jsonl'

/** What the owner can ask of one member's bells: the silence, or the bell again. */
export const BELLS_MUTED = 'muted'
export const BELLS_HEARD = 'heard'

/** The two words the owner's flip uses, so nothing spells either one a second way. */
export type TheFlip = typeof BELLS_MUTED | typeof BELLS_HEARD

/** The way the owner asked for, as one of the two words; undefined for any other, which the command refuses as usage. */
export const theFlipIn = (word: string | undefined): TheFlip | undefined =>
  word === BELLS_MUTED || word === BELLS_HEARD ? word : undefined

/** A flip as the owner typed it: the member, and the way they asked for it. */
export interface TheFlipAsked {
  readonly member: string
  readonly bells: TheFlip
}

/** The flip `member` and `way` name, or undefined when no member was named: the command reads its own words, not this. */
export const theFlipNamed = (member: string | undefined, way: string | undefined): TheFlipAsked | undefined => {
  const bells = theFlipIn(way)
  return member === undefined || bells === undefined ? undefined : { member, bells }
}

/** `bells [<member> muted|heard]` as its words read: the act, and the member and way the owner named, if any. */
export interface TheAskOfTheBells {
  readonly act: string
  readonly member?: string
  readonly args: readonly string[]
}

/**
 * `bells [<member> muted|heard]`: no words lists the crew; one member and one of the two ways flips that member.
 * Undefined for every other way the words could be read, which the command answers with its usage.
 */
export function bellsOf(act: string, argv: readonly string[]): TheAskOfTheBells | undefined {
  if (argv.length === 1) return { act, args: [] }
  const [, member, way] = argv
  const bells = theFlipIn(way)
  if (argv.length !== 3 || member === undefined || member === '' || member.startsWith('-') || bells === undefined) return undefined
  return { act, member, args: [bells] }
}

/** Why a mute is refused where no owner is at the keyboard. */
export const A_MUTE_NEEDS_THE_OWNERS_TERMINAL =
  'only the owner, at a terminal, mutes a member\'s bells, and this is no terminal.'

/**
 * The crew's own place, and how the host keeps and reads a file in it: the launcher and `martha bells` are given the
 * same two things, and the slice names its file inside the directory rather than a path on the machine.
 */
export interface TheBellsPlace {
  /** `<crew>/the-bells`, made 0700 with the crew's place. */
  readonly directory: string
  /** How the host keeps and reads a file in this place. */
  readonly lines: StateLines
}

/** One flip, as one line of the file: which member, which way, who, and when. */
export interface BellsFlipped {
  readonly member: string
  readonly bells: TheFlip
  readonly by: string
  readonly at: string
}

/** What one member's bells are, as the owner's flips leave them; and what is wrong with the file, when anything is. */
export interface TheMute {
  readonly muted: boolean
  /** Who made the flip in force, as the line kept them; '' when none is. */
  readonly by: string
  /** When, as an ISO moment; '' when no flip is in force. */
  readonly at: string
  /** Why the file could not be trusted, so no mute in it is in force; '' when it could. */
  readonly why: string
}

/** No mute, and nothing wrong with the file: the state of a crew no flip has been made in. */
export const NOTHING_IS_MUTED: TheMute = { muted: false, by: '', at: '', why: '' }

/** The way back to a member's bell, said the same everywhere the owner reads a mute. */
const theWayBackToTheBell = (member: string): string => `martha bells ${member} ${BELLS_HEARD} rings it again`

/**
 * The line the launcher tells the owner when a member starts with its bell muted (martha#371): the one place the owner
 * is told, on that member's own terminal, that a silence is in force and how to lift it.
 */
export const theMutedStartLine = (member: string): string => `${member}'s bell is muted (${theWayBackToTheBell(member)}).`

/** The file the flips are kept in, in the crew's own place. */
export const bellsFileIn = (place: TheBellsPlace): string => join(place.directory, THE_BELLS_FILE)

/**
 * What this member's bells are now, as every flip kept for it leaves them, or why the file cannot be trusted.
 *
 * The newest flip for the member wins, matched the way the rest of the command matches a typed name. A line that is not
 * a flip makes the newest one unknowable, so the whole file stops being honoured rather than the older mute standing.
 */
export function theMuteOf(place: TheBellsPlace, member: string): TheMute {
  const read = place.lines.read(bellsFileIn(place))
  if ('refusal' in read) return { ...NOTHING_IS_MUTED, why: read.refusal }
  const lines = read.text.split('\n').filter((line) => line !== '')
  const flips: BellsFlipped[] = []
  for (const [position, line] of lines.entries()) {
    const flip = aFlipIn(line)
    if (flip === undefined) {
      return { ...NOTHING_IS_MUTED, why: `${bellsFileIn(place)} holds a line that is not a flip, at line ${position + 1}, so no mute in it is in force` }
    }
    flips.push(flip)
  }
  const newest = flips.filter((flip) => sameMemberName(flip.member, member)).at(-1)
  if (newest === undefined) return NOTHING_IS_MUTED
  return { muted: newest.bells === BELLS_MUTED, by: newest.by, at: newest.at, why: '' }
}

/** One line as a flip, or undefined when it is not one: an object with the four fields this slice writes, and no other reading. */
function aFlipIn(line: string): BellsFlipped | undefined {
  let kept: unknown
  try {
    kept = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof kept !== 'object' || kept === null) return undefined
  const { member, bells, by, at } = kept as Readonly<Record<string, unknown>>
  if (!isText(member) || !isText(by) || !isText(at)) return undefined
  if (bells !== BELLS_MUTED && bells !== BELLS_HEARD) return undefined
  return { member, bells, by, at }
}

/** Whether a field of a kept line is the text this slice writes there: a string with something in it. */
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** One more flip kept, or why it could not be: a flip the file refused is a flip that did not happen. */
export function flipTheBellsOf(place: TheBellsPlace, flipped: BellsFlipped): { readonly flipped: true } | { readonly flipped: false; readonly refusal: string } {
  const refused = place.lines.append(bellsFileIn(place), JSON.stringify(flipped), 'the bells of a member')
  return refused === undefined ? { flipped: true } : { flipped: false, refusal: refused.refusal }
}

/** What the declaration's own switch turning every bell off reads as, said the same in the list and the flip's answer. */
const THE_DECLARATION_IS_OFF = 'the declaration turns owner_bell off'

/** One flip, as the owner reads it: when, who, and how to lift it. */
const theMuteShown = (member: string, mute: TheMute): string => `muted since ${mute.at} by ${mute.by} (${theWayBackToTheBell(member)})`

/**
 * One line of `martha bells` for a member: what its bells do now, and how to change it. A crew whose declaration turns
 * every bell off is said so, with a mute the owner has already made still named: it is in force the moment the
 * declaration's switch is turned back on, and hiding it would make the list read as though it never happened.
 */
function aLineOfTheBells(member: string, declared: boolean, mute: TheMute): string {
  if (declared) return mute.muted ? `${member}: ${theMuteShown(member, mute)}` : `${member}: rings`
  const off = `${member}: rings nothing (${THE_DECLARATION_IS_OFF})`
  return mute.muted ? `${off}; ${theMuteShown(member, mute)}` : off
}

/** What the owner asked `martha bells`: the whole crew, or one member's flip. */
export interface TheBellsAsked {
  /** The members the crew declares, in the declaration's order: a name the declaration does not know flips nothing. */
  readonly members: readonly string[]
  /** Whether the declaration's own switch rings any bells at all (`house_rules.owner_bell`). */
  readonly declared: boolean
  /** The crew's own place the flips are kept in. */
  readonly place: TheBellsPlace
  /** The owner's name, as the declaration names them, for the history line. */
  readonly owner: string
  /** Whether the act was typed on a terminal, the one thing that makes it the owner's. */
  readonly onATerminal: boolean
  /** The member the owner named and the way they asked for it; absent lists the crew. */
  readonly flip?: TheFlipAsked
  /** The moment the flip records; the system clock unless a test gives its own. */
  readonly now?: () => number
}

/** What to print, or why the act was refused; a refusal writes nothing. */
export type TheBells = { readonly shown: true; readonly lines: readonly string[] } | { readonly shown: false; readonly refusal: string }

/**
 * The owner's bells: one line per declared member, or one flip of one member's.
 *
 * Every refusal writes nothing: no terminal, a member the declaration does not know, a file that cannot be trusted, and
 * a flip to the state the member is already in — the last one says so rather than writing a line that would say the
 * owner changed something today that they did not.
 */
export function theBellsTheOwnerKeeps(asked: TheBellsAsked): TheBells {
  const { flip } = asked
  if (flip === undefined) return theCrewsBells(asked)
  if (!asked.onATerminal) return { shown: false, refusal: A_MUTE_NEEDS_THE_OWNERS_TERMINAL }
  const member = asked.members.find((name) => sameMemberName(name, flip.member))
  if (member === undefined) {
    return { shown: false, refusal: `the declaration does not know ${flip.member}, so nothing was changed (its members are ${asked.members.join(', ')}).` }
  }
  return theOneFlip(asked, member, flip.bells)
}

/** What the owner changed, if anything: the flip kept, or the line that says it was already what they asked for. */
function theOneFlip(asked: TheBellsAsked, member: string, way: TheFlip): TheBells {
  const now = theMuteOf(asked.place, member)
  if (now.why !== '') return { shown: false, refusal: now.why }
  const asked_for_muted = way === BELLS_MUTED
  if (now.muted === asked_for_muted) return { shown: true, lines: [theAlreadyLine(member, asked_for_muted)] }
  const flipped = flipTheBellsOf(asked.place, { member, bells: way, by: asked.owner, at: new Date((asked.now ?? Date.now)()).toISOString() })
  if (!flipped.flipped) return { shown: false, refusal: flipped.refusal }
  return { shown: true, lines: [asked_for_muted ? `${member}'s bell is muted (${theWayBackToTheBell(member)}).` : `${member}'s bell rings again.`] }
}

/** The line for a flip the member was already in: nothing was written, and the owner is told so. */
const theAlreadyLine = (member: string, muted: boolean): string =>
  muted ? `${member}'s bell is already muted, so nothing was written.` : `${member}'s bell already rings, so nothing was written.`

/** One line per declared member, or why the file cannot be read: a crew whose file is broken is never shown as a muted one. */
function theCrewsBells(asked: TheBellsAsked): TheBells {
  const lines: string[] = []
  for (const member of asked.members) {
    const mute = theMuteOf(asked.place, member)
    if (mute.why !== '') return { shown: false, refusal: mute.why }
    lines.push(aLineOfTheBells(member, asked.declared, mute))
  }
  return { shown: true, lines }
}
