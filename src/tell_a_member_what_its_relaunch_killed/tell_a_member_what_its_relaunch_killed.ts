// What a killed run left behind, and the words that stop it going out unseen (#693).
//
// A member's run can end while a background command is still writing: a mutant runner that edits source and restores it
// in a `finally` loses that `finally` to a kill, and the mutant stays in the tree. Nothing in the tree says so, so the
// next `git add -A` carries it, and the suite stays green whenever the mutant is one the tests do not catch.
//
// This slice holds the record the launcher keeps when it ends a launch, the paragraph a member reads on its next start,
// and the judgements that print a notice for a commit or a hand-off carrying what the record kept (martha#601: the act
// goes ahead, and one line names the files). It reads no disk and runs no git: the launcher gathers the commands, the
// files and the digests, the host's stores keep the record, and this decides what they mean. Keeping it here rather than
// in the launcher is what makes it testable without a launch.
//
// Five rules are load-bearing, and the first four exist because the first design got them wrong.
//
//   1. ONLY WHAT A KILLED COMMAND CAN HAVE WRITTEN MAY BE REFUSED. At a kill the member's own uncommitted edits are
//      "still at their digest" too, so a refusal that judges every differing file refuses ordinary work. A file is a
//      leftover only when its mtime is at or after the start of a command that was still running at the end. Every
//      differing file is kept as `dirty` and is told; only `leftovers` are ever refused. Where the process list could
//      not be read, nothing is a leftover and nothing is refused.
//
//   2. THE TELLING AND THE LEFTOVERS HAVE SEPARATE LIFETIMES. The telling is marked told by the start that read it.
//      A leftover stands until its own bytes change, a release names it, or the record it belongs to is replaced by one
//      that carries it over (rule 5). Clearing the record to mark the telling told would empty both refusals.
//
//   3. A RECORD THAT CANNOT BE READ IS NOT AN EMPTY ONE. A text that will not parse, or one of another shape, answers
//      `unreadable` with its reason; a caller then says so and judges nothing. Answering "nothing was left" for a
//      record nobody could read is the fail-open this exists to close.
//
//   4. THE JUDGEMENT IS THE CONTENT, NOT THE CLOCK. A refusal names a file whose bytes are still the bytes the record
//      kept. Against rule 1, a file whose mtime made it a leftover but which the member then edited is no longer one.
//
//   5. A REPLACED RECORD CARRIES ITS UNRELEASED LEFTOVERS OVER. The next end's record replaces the last, with one
//      carry-over: every leftover whose file still holds its recorded digest, and which no release names, stays a
//      leftover in the new record with its original digest, mtime and command. The ordinary end is one with nothing
//      running, so without this a second stop would quietly downgrade a mutant to merely dirty.

import { createHash } from 'node:crypto'

import { shownSafely } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'

/** One command still running when the launch ended: the command line, and when the machine started it. */
export interface IRunningCommand {
  /** The command line, as the machine held it. Never the tool's own name: a member reads what ran. */
  readonly command_line: string
  /** Its start on the machine's clock, which is what a file's mtime is judged against (rule 1). */
  readonly started_at_ms: number
}

/** One file that differed from HEAD when the launch ended. Told, never refused (rule 1). */
export interface IDirtyFile {
  /** Relative to the worktree it was found in, spelled as git spells it. */
  readonly path: string
  /** The worktree's place, as the record was made over it (martha#719). Absent only in a record kept before every record named its tree. */
  readonly worktree?: string
  /** A digest of the bytes the file held at the end: what rule 4 and rule 5 are judged on. */
  readonly digest: string
}

/** A differing file a killed command can have written: the one shape that may be refused (rule 1). */
export interface ILeftover extends IDirtyFile {
  /** The mtime that made it a leftover, kept because a member reads why. */
  readonly mtime_ms: number
  /** The command line it was recorded against, and that command's start: what the refusal names. */
  readonly command_line: string
  readonly started_at_ms: number
}

/** A path a member has looked at and released (the named way out of a refusal, rule 1). */
export interface IReleasedPath {
  readonly path: string
  readonly worktree?: string
  /**
   * The digest of the bytes the member looked at and said are its own (martha#693 r=3 R5): a release answers those
   * bytes at that path, and never a later write of the path, so a second killed run's different mutant at a released
   * path is still refused.
   */
  readonly digest: string
}

/** When a file was last written, as the end read it from the tree: what rule 1 judges against a command's start. */
export interface IMtimeOfAFile {
  readonly path: string
  readonly worktree?: string
  readonly mtime_ms: number
}

/** How many commands, files and leftovers a record keeps before it drops the oldest, and so says how many it dropped. */
export interface IDroppedFromTheRecord {
  readonly commands: number
  readonly files: number
  readonly leftovers: number
}

/** What a killed run left, kept by the launcher when it ended a launch. */
export interface WhatAKilledRunLeft {
  /** The member whose launch it was. */
  readonly member: string
  /** When the launch ended, on the machine's clock: what says how old the record is. */
  readonly at_ms: number
  /** Every command still running at the end (rule 1). */
  readonly running: readonly IRunningCommand[]
  /** Every differing file, which is told and never refused (rule 1). */
  readonly dirty: readonly IDirtyFile[]
  /** The differing files a killed command can have written, which are the ones refused (rule 1). */
  readonly leftovers: readonly ILeftover[]
  /** How many of each were dropped to keep the record bounded (rule 2's record, R4's bounds). */
  readonly dropped: IDroppedFromTheRecord
  /** When a start read the telling, so the member is told once (rule 2). */
  readonly told_at_ms?: number
  /** Why the commands could not be listed, when they could not. */
  readonly running_unreadable?: string
  /** Why the differing files could not be listed, when they could not. */
  readonly dirty_unreadable?: string
}

/** What a kept record says about itself: the record, or why it cannot be trusted (rule 3). */
export type AKeptRecord = { readonly record: WhatAKilledRunLeft } | { readonly unreadable: string }

/** The digest a file's bytes are recorded by. One function, so the launcher and the refusal cannot disagree. */
export const theDigestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** How many commands and paths a telling names before it counts the rest: a prompt is read, not paged. */
export const NAMED_IN_A_TELLING = 5

/** How many commands, files and leftovers a record keeps at all, oldest first out, so a record cannot grow unbounded. */
export const KEPT_IN_A_RECORD = 40

/** How long one path or command line is shown before it is cut, with the cut said. */
export const SHOWN_AT_MOST = 200

/** The act a member takes to release what it has looked at: named in the refusal's own words. */
export const THE_RELEASE_ACT = 'release_the_files_a_killed_run_left'

const keyOf = (one: { readonly path: string; readonly worktree?: string }): string =>
  `${one.worktree ?? ''}\u0000${one.path}`

/**
 * The key a release is matched by: the file it answers, and the digest of the bytes it answered (r=3 R5). Matching a
 * release by its path alone would let a second killed run's different mutant at that path go through. One spelling,
 * so the store that keeps a release and the judgement that reads it cannot disagree about what a release answers.
 */
export const releaseKeyOf = (one: { readonly path: string; readonly worktree?: string; readonly digest: string }): string =>
  `${keyOf(one)}\u0000${one.digest}`

/** How one file is named to a member: its path, and the tree it stands in when the record names one (martha#719). */
export const theNameOf = (one: { readonly path: string; readonly worktree?: string }): string =>
  one.worktree === undefined ? one.path : `${one.worktree}: ${one.path}`

/** The files the record keeps as dirty, each once by its worktree and path, in the order they were found. */
export const theDirtyOf = (record: WhatAKilledRunLeft): readonly IDirtyFile[] => {
  const seen = new Set<string>()
  return record.dirty.filter((one) => {
    const key = keyOf(one)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * `all` without the files a member released, matched by worktree, path and digest (martha#693 r=3 R5): a release
 * answers the bytes it was taken for, and bytes written at that path since are judged afresh.
 */
const theReleasedOut = <One extends { readonly path: string; readonly worktree?: string; readonly digest: string }>(
  all: readonly One[],
  released: readonly IReleasedPath[] = [],
): readonly One[] => {
  const letGo = new Set(released.map(releaseKeyOf))
  return all.filter((one) => !letGo.has(releaseKeyOf(one)))
}

/** The leftovers that still stand, once the paths a member released are out of them (rule 2). */
export const theStandingLeftoversOf = (
  record: WhatAKilledRunLeft,
  released: readonly IReleasedPath[] = [],
): readonly ILeftover[] => theReleasedOut(record.leftovers, released)

/**
 * The leftovers of the tree an end found: a differing file whose mtime is at or after the start of a command that was
 * still running at that end, and the latest such command. Nothing is a leftover when no command was running (rule 1).
 */
export const theLeftoversAmong = (end: {
  readonly dirty: readonly IDirtyFile[]
  readonly running: readonly IRunningCommand[]
  readonly mtimes: readonly IMtimeOfAFile[]
}): readonly ILeftover[] =>
  end.dirty.flatMap((one) => {
    const written = end.mtimes.find((at) => keyOf(at) === keyOf(one))
    if (written === undefined) return []
    const killedIt = end.running
      .filter((command) => written.mtime_ms >= command.started_at_ms)
      .sort((a, b) => b.started_at_ms - a.started_at_ms)[0]
    if (killedIt === undefined) return []
    return [
      {
        ...one,
        mtime_ms: written.mtime_ms,
        command_line: killedIt.command_line,
        started_at_ms: killedIt.started_at_ms,
      },
    ]
  })

/** `all`, oldest first out, cut to `atMost`, with how many the cut dropped. */
const keptOldestFirstOut = <One>(
  all: readonly One[],
  atMost: number,
  ageOf: (one: One) => number,
): { readonly kept: readonly One[]; readonly dropped: number } => {
  const byAge = [...all].sort((a, b) => ageOf(a) - ageOf(b))
  const firstKept = Math.max(0, byAge.length - atMost)
  return { kept: byAge.slice(firstKept), dropped: firstKept }
}

/** When a file was written, as the end read it; a file whose write time was not read is kept as the newest. */
const theMtimeOf = (mtimes: readonly IMtimeOfAFile[], one: { readonly path: string; readonly worktree?: string }) =>
  mtimes.find((at) => keyOf(at) === keyOf(one))?.mtime_ms ?? Number.MAX_SAFE_INTEGER

/**
 * The record an end makes, carrying over what the record it replaces kept (rule 5): a previous leftover whose file is
 * still dirty at the same digest, and which no release names, stays a leftover with its original digest, mtime and
 * command. A previous leftover whose bytes changed, or that a release names, is gone. What the record cannot keep, it
 * counts in `dropped`, so a member is told that the list was longer than the record.
 */
export const theRecordAfter = (end: {
  readonly member: string
  readonly at_ms: number
  readonly running: readonly IRunningCommand[]
  readonly dirty: readonly IDirtyFile[]
  readonly mtimes: readonly IMtimeOfAFile[]
  readonly released?: readonly IReleasedPath[]
  readonly running_unreadable?: string
  readonly dirty_unreadable?: string
  readonly replaced?: WhatAKilledRunLeft
}): WhatAKilledRunLeft => {
  const fresh = theLeftoversAmong(end)
  const carried = (end.replaced?.leftovers ?? []).filter((old) => {
    const nowDirty = end.dirty.find((one) => keyOf(one) === keyOf(old))
    return nowDirty !== undefined && nowDirty.digest === old.digest
  })
  const byKey = new Map<string, ILeftover>()
  for (const one of [...carried, ...fresh]) byKey.set(keyOf(one), one)
  const standing = theReleasedOut([...byKey.values()], end.released)
  const commands = keptOldestFirstOut(end.running, KEPT_IN_A_RECORD, (one) => one.started_at_ms)
  const files = keptOldestFirstOut(end.dirty, KEPT_IN_A_RECORD, (one) => theMtimeOf(end.mtimes, one))
  const leftovers = keptOldestFirstOut(standing, KEPT_IN_A_RECORD, (one) => one.mtime_ms)
  return {
    member: end.member,
    at_ms: end.at_ms,
    running: commands.kept,
    dirty: files.kept,
    leftovers: leftovers.kept,
    dropped: { commands: commands.dropped, files: files.dropped, leftovers: leftovers.dropped },
    ...(end.running_unreadable === undefined ? {} : { running_unreadable: end.running_unreadable }),
    ...(end.dirty_unreadable === undefined ? {} : { dirty_unreadable: end.dirty_unreadable }),
  }
}

/** The record with its telling marked read, so the same member is not told again (rule 2). */
export const toldAt = (record: WhatAKilledRunLeft, at_ms: number): WhatAKilledRunLeft => ({ ...record, told_at_ms: at_ms })

/** One line shown whole, as one datum: terminal controls written out, cut at the bound with the cut said. */
export const shownAsData = (line: string): string => {
  const safe = shownSafely(line)
  return JSON.stringify(safe.length > SHOWN_AT_MOST ? `${safe.slice(0, SHOWN_AT_MOST)}…` : safe)
}

/** `n` data as one list, then how many the telling did not name and could not keep, or nothing when it named them all. */
export const namedThenTheRest = (all: readonly string[], alsoDropped = 0): string => {
  const data = all.map(shownAsData)
  const named = data.slice(0, NAMED_IN_A_TELLING)
  const rest = data.length - named.length + alsoDropped
  return rest === 0 ? named.join(', ') : `${named.join(', ')}, and ${String(rest)} more`
}

/** What the telling says about the commands, or nothing when it has nothing to say about them. */
const theRunningSaid = (record: WhatAKilledRunLeft): readonly string[] => {
  const commands = [...new Set(record.running.map((one) => one.command_line))]
  if (commands.length > 0) {
    const named = namedThenTheRest(commands, record.dropped.commands)
    return [`These commands were still running when it was killed: ${named}.`]
  }
  if (record.running_unreadable === undefined) return []
  return [`What was still running could not be read (${shownAsData(record.running_unreadable)}).`]
}

/** What the telling says about the files: the leftovers first, then the merely dirty, never one path twice. */
const theFilesSaid = (record: WhatAKilledRunLeft, released: readonly IReleasedPath[]): readonly string[] => {
  const leftovers = theStandingLeftoversOf(record, released)
  const standingKeys = new Set(leftovers.map(keyOf))
  // A released file is the member's own answer: the bytes it released are left out of both sentences, never moved back
  // into the wider one — and bytes written at that path since are told, because they are not what the member answered.
  const letGo = new Set(released.map(releaseKeyOf))
  const dirty = theDirtyOf(record).filter((one) => !standingKeys.has(keyOf(one)) && !letGo.has(releaseKeyOf(one)))
  const leftSaid =
    leftovers.length === 0
      ? []
      : [
          `These files still hold what it was writing: ${namedThenTheRest(
            leftovers.map(theNameOf),
            record.dropped.leftovers,
          )}.`,
        ]
  if (dirty.length > 0) {
    return [...leftSaid, `These files differed from HEAD: ${namedThenTheRest(dirty.map(theNameOf), record.dropped.files)}.`]
  }
  if (record.dirty_unreadable === undefined) return leftSaid
  return [...leftSaid, `Which files differed from HEAD could not be read (${shownAsData(record.dirty_unreadable)}).`]
}

/**
 * The paragraph a member reads on its next start, or undefined when there is nothing to say. Every path and command
 * line is one datum, never bare in a sentence: the tree and the processes chose that text, and it can say anything.
 * `goneWorktrees` are the worktrees the caller found gone since the end, told with their paths so a member does not
 * look for a tree that is not there.
 */
export const theTellingOf = (
  record: WhatAKilledRunLeft,
  released: readonly IReleasedPath[] = [],
  goneWorktrees: readonly string[] = [],
): string | undefined => {
  const said = [...theRunningSaid(record), ...theFilesSaid(record, released)]
  if (goneWorktrees.length > 0) {
    said.push(`These worktrees are gone, so what they held cannot be looked at: ${namedThenTheRest(goneWorktrees)}.`)
  }
  if (said.length === 0) return undefined
  return (
    `The run before this one was cut short. ${said.join(' ')} ` +
    'Nothing here knows whether those bytes are yours or the run\'s: look before you commit or hand off, restore what ' +
    `is not yours, and if a file is your own, say so with ${THE_RELEASE_ACT}.`
  )
}

/** A file a commit would carry: the path, and the digest of the bytes the index holds for it. */
export interface IWhatACommitWouldCarry {
  readonly path: string
  readonly worktree?: string
  readonly digest: string
}

/** Whether a file a commit would carry is the very one a leftover kept: its worktree, its path and its digest. */
const theSameFileAs = (kept: IDirtyFile, one: IWhatACommitWouldCarry): boolean =>
  kept.path === one.path &&
  (one.worktree === undefined || kept.worktree === undefined || kept.worktree === one.worktree) &&
  kept.digest === one.digest

/** How a refusal opens, and what the member does after restoring what is not theirs: the act the refusal is written for. */
export interface AWhatAKilledRunStandsIn {
  readonly opening: string
  readonly andThen: string
}

/** The act a commit's notice is written for: the commit carries what a killed run left, and then commits (martha#601). */
export const WHAT_A_COMMIT_CARRIES: AWhatAKilledRunStandsIn = { opening: 'this commit carries what a killed run left', andThen: 'commit' }

/** The act a hand-off's notice is written for: it comes while what a killed run left stands, and then hands off (martha#719, martha#601). */
export const WHAT_A_HAND_OFF_COMES_WHILE: AWhatAKilledRunStandsIn = { opening: 'this hand-off comes while what a killed run left stands', andThen: 'hand off' }

/**
 * What an act carries of what a killed run left, printed as one notice and answering nothing, so the act goes ahead
 * (martha#601). It judges the content (rule 4) on the leftovers that still stand (rule 2), and names the files and the
 * release act the member can still take. One builder, so a commit's notice and a hand-off's cannot drift apart in either
 * direction (martha#719, N3). Undefined, as it always allows: the answer is the notice it says through `note`, the sink
 * its composition root passed (martha#601).
 */
export const theRefusalOfWhatAKilledRunLeft = (
  record: WhatAKilledRunLeft,
  carrying: readonly IWhatACommitWouldCarry[],
  act: AWhatAKilledRunStandsIn,
  released: readonly IReleasedPath[] = [],
  note: (line: string) => void = () => {},
): string | undefined => {
  const standing = theStandingLeftoversOf(record, released)
  const standingFor = (one: IWhatACommitWouldCarry) => standing.find((kept) => theSameFileAs(kept, one))
  const caught = carrying.filter((one) => standingFor(one) !== undefined)
  if (caught.length === 0) return undefined
  const commands = [...new Set(caught.map((one) => standingFor(one)?.command_line ?? ''))].filter((one) => one !== '')
  const wasRunning = commands.length === 0 ? '' : `, and it was running when the launch ended: ${namedThenTheRest(commands)}`
  note(
    `notice: ${act.opening}: ${namedThenTheRest(caught.map(theNameOf))} ` +
      `(the bytes are the ones kept when the launch ended)${wasRunning}, and the ${act.andThen} went ahead, ` +
      `so restore what is not yours or take ${THE_RELEASE_ACT} for the paths that are.`,
  )
  return undefined
}

/** The notice a commit that would carry what a killed run left prints, or undefined when it would carry none (martha#601). */
export const theRefusalOfACommit = (
  record: WhatAKilledRunLeft,
  carrying: readonly IWhatACommitWouldCarry[],
  released: readonly IReleasedPath[] = [],
  note: (line: string) => void = () => {},
): string | undefined => theRefusalOfWhatAKilledRunLeft(record, carrying, WHAT_A_COMMIT_CARRIES, released, note)

/** The record as the one line the crew's store keeps, and the one shape this reads back. */
export const theKeptText = (record: WhatAKilledRunLeft): string => JSON.stringify(record)

const isAString = (value: unknown): value is string => typeof value === 'string'

const aNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const anOptionalString = (value: unknown): value is string | undefined => value === undefined || isAString(value)

const aDirty = (value: unknown): value is IDirtyFile => {
  if (typeof value !== 'object' || value === null) return false
  const one = value as IDirtyFile
  return isAString(one.path) && isAString(one.digest) && anOptionalString(one.worktree)
}

const aLeftover = (value: unknown): value is ILeftover => {
  if (!aDirty(value)) return false
  const one = value as ILeftover
  return aNumber(one.mtime_ms) && isAString(one.command_line) && aNumber(one.started_at_ms)
}

const aRunning = (value: unknown): value is IRunningCommand => {
  if (typeof value !== 'object' || value === null) return false
  const one = value as IRunningCommand
  return isAString(one.command_line) && aNumber(one.started_at_ms)
}

const aCount = (value: unknown): value is number =>
  aNumber(value) && Number.isInteger(value) && value >= 0

const aDropped = (value: unknown): value is IDroppedFromTheRecord => {
  if (typeof value !== 'object' || value === null) return false
  const one = value as IDroppedFromTheRecord
  return aCount(one.commands) && aCount(one.files) && aCount(one.leftovers)
}

/** Why one of the record's three lists is not the list this wrote, or nothing when they all are. */
const whyTheListsAreWrong = (one: WhatAKilledRunLeft): string | undefined => {
  if (!Array.isArray(one.running) || !one.running.every(aRunning)) return 'the kept record lists commands it does not hold'
  if (!Array.isArray(one.dirty) || !one.dirty.every(aDirty)) return 'the kept record lists files it does not hold'
  if (!Array.isArray(one.leftovers) || !one.leftovers.every(aLeftover)) return 'the kept record lists leftovers it does not hold'
  return undefined
}

/** Why the rest of the record is not what this wrote, or nothing when it is. */
const whyTheWordsAreWrong = (one: WhatAKilledRunLeft): string | undefined => {
  if (!aDropped(one.dropped)) return 'the kept record does not say what it dropped'
  if (one.told_at_ms !== undefined && !aNumber(one.told_at_ms)) {
    return 'the kept record says its telling was read in no time this reads'
  }
  if (!anOptionalString(one.running_unreadable)) return 'the kept record says its commands were unreadable in no words'
  if (!anOptionalString(one.dirty_unreadable)) return 'the kept record says its files were unreadable in no words'
  return undefined
}

/** Why what was kept is not a record this reads, or nothing when it is. */
const whyNotARecord = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null) return 'the kept record is not an object'
  const one = value as WhatAKilledRunLeft
  if (!isAString(one.member)) return 'the kept record names no member'
  if (!aNumber(one.at_ms)) return 'the kept record is stamped with no time'
  return whyTheListsAreWrong(one) ?? whyTheWordsAreWrong(one)
}

/** The kept text as the one value it holds, or why it holds none. */
const theParsedIn = (text: string): { readonly one: unknown } | { readonly unreadable: string } => {
  try {
    return { one: JSON.parse(text) }
  } catch {
    return { unreadable: 'the kept record does not parse' }
  }
}

/**
 * A kept record read back. A text that will not parse, or one whose fields are not what this wrote, answers
 * `unreadable` with its reason: a record nobody can read is never read as "nothing was left" (rule 3).
 */
export const theRecordIn = (text: string): AKeptRecord => {
  const parsed = theParsedIn(text)
  if ('unreadable' in parsed) return parsed
  const why = whyNotARecord(parsed.one)
  return why === undefined ? { record: parsed.one as WhatAKilledRunLeft } : { unreadable: why }
}
