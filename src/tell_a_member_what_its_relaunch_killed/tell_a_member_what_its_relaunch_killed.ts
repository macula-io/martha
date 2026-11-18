// What a killed run left behind, and the words that stop it going out unseen (#693).
//
// A member's run can end while a background command is still writing: a mutant runner that edits source and restores it
// in a `finally` loses that `finally` to a kill, and the mutant stays in the tree. Nothing in the tree says so, so the
// next `git add -A` carries it, and the suite stays green whenever the mutant is one the tests do not catch.
//
// This slice holds the record the launcher keeps when it ends a launch, the paragraph the member reads on its next
// start, and the judgements that refuse a commit or a hand-off carrying what the record kept. It reads no disk and runs
// no git: the launcher gathers the commands and the digests, the host's stores keep the record, and this decides what
// they mean. Keeping it here rather than in the launcher is what makes it testable without a launch.
//
// Three rules are load-bearing.
//
//   1. A RECORD THAT CANNOT BE READ IS NOT AN EMPTY ONE. A file that will not parse, or one written by another shape,
//      answers `unreadable` with its reason; a caller then says so and judges nothing. Answering "nothing was left"
//      for a record nobody could read is the fail-open this exists to close.
//
//   2. THE JUDGEMENT IS THE CONTENT, NOT THE CLOCK. A refusal names a file whose bytes are still the bytes the record
//      kept. A file the member edited again after the kill has other bytes and goes through, so the rule can never
//      become a wall on ordinary work; and a commit that carries nothing recorded is not looked at.
//
//   3. THE RECORD IS CLEARED BY THE START THAT READ IT. Whoever reads a telling clears it, so a member that starts
//      twice is told once, and a record nobody read keeps its stamp so its age can be seen.

import { createHash } from 'node:crypto'

/** One command still running when the launch ended, as the command line the machine held. */
export interface IRunningCommand {
  /** The command line, joined the way the machine held it. Never the tool's own name: a member reads what ran. */
  readonly command_line: string
}

/** One file that differed from HEAD when the launch ended: the path, relative to its worktree, and a digest of its bytes. */
export interface ILeftover {
  /** Relative to the worktree it was found in, spelled as git spells it. */
  readonly path: string
  /** The worktree's place, when the record was made over more than one; absent when it has only one. */
  readonly worktree?: string
  /** A digest of the bytes the file held: the whole of what the refusal judges. */
  readonly digest: string
}

/** What a killed run left, kept by the launcher when it ended a launch. */
export interface WhatAKilledRunLeft {
  /** The member whose launch it was. */
  readonly member: string
  /** When the launch ended, on the machine's clock: what says how old the record is. */
  readonly at_ms: number
  readonly running: readonly IRunningCommand[]
  readonly leftovers: readonly ILeftover[]
  /** Why the commands could not be listed, when they could not: the host's processes are not always readable. */
  readonly running_unreadable?: string
  /** Why the leftovers could not be listed, when they could not. */
  readonly leftovers_unreadable?: string
}

/** What a kept record says about itself: the record, or why it cannot be trusted. */
export type AKeptRecord = { readonly record: WhatAKilledRunLeft } | { readonly unreadable: string }

/** The digest a file's bytes are recorded by. One function, so the launcher and the refusal cannot disagree. */
export const theDigestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** How many commands and files a telling names before it counts the rest: a prompt is read, not paged. */
export const NAMED_IN_A_TELLING = 5

/** Nothing at all was left: what a record is only for the telling, and for the refusals to have nothing to judge. */
export const nothingWasLeft = (record: WhatAKilledRunLeft): boolean =>
  record.running.length === 0 && record.leftovers.length === 0

/** Every command line the record kept, each once, in the order the machine listed them. */
export const theCommandsOf = (record: WhatAKilledRunLeft): readonly string[] => [
  ...new Set(record.running.map((one) => one.command_line))
]

/** The files the record kept, each once by its worktree and path, in the order they were found. */
export const theLeftoversOf = (record: WhatAKilledRunLeft): readonly ILeftover[] => {
  const seen = new Set<string>()
  return record.leftovers.filter((one) => {
    const key = `${one.worktree ?? ''}\u0000${one.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** `n` names of `all`, then how many the telling did not name, or none when it named them all. */
const namedThenTheRest = (all: readonly string[]): string => {
  const named = all.slice(0, NAMED_IN_A_TELLING)
  const rest = all.length - named.length
  return rest === 0 ? named.join(', ') : `${named.join(', ')}, and ${String(rest)} more`
}

/**
 * The paragraph a member reads on its next start, or undefined when the record holds nothing to say. It names the
 * commands and the files, and says plainly that it does not know whether the files are wrong: only the member does.
 */
export const theTellingOf = (record: WhatAKilledRunLeft): string | undefined => {
  const commands = theCommandsOf(record)
  const leftovers = theLeftoversOf(record)
  const nothingToSay =
    commands.length === 0 &&
    leftovers.length === 0 &&
    record.running_unreadable === undefined &&
    record.leftovers_unreadable === undefined
  if (nothingToSay) return undefined
  const said: string[] = []
  if (commands.length > 0) {
    said.push(`These commands were still running when it was killed: ${namedThenTheRest(commands)}.`)
  } else if (record.running_unreadable !== undefined) {
    said.push(`What was still running could not be read (${record.running_unreadable}).`)
  }
  if (leftovers.length > 0) {
    const paths = leftovers.map((one) => (one.worktree === undefined ? one.path : `${one.worktree}: ${one.path}`))
    said.push(`These files differed from HEAD: ${namedThenTheRest(paths)}.`)
  } else if (record.leftovers_unreadable !== undefined) {
    said.push(`Which files differed from HEAD could not be read (${record.leftovers_unreadable}).`)
  }
  if (said.length === 0) return undefined
  return (
    `The run before this one was cut short. ${said.join(' ')} ` +
    'A killed run leaves what it was writing in the tree, and nothing here knows whether those bytes are yours or its: ' +
    'look at them before you commit or hand off, and restore what is not.'
  )
}

/** A file a commit would carry: the path, and the digest of the bytes the index holds for it. */
export interface IWhatACommitWouldCarry {
  readonly path: string
  readonly worktree?: string
  readonly digest: string
}

/**
 * Why a commit would carry what a killed run left, or undefined when it would not. The words name the file and the
 * command that was running; never the file's content, which this never held.
 */
export const theRefusalOfACommit = (
  record: WhatAKilledRunLeft,
  carrying: readonly IWhatACommitWouldCarry[],
): string | undefined => {
  const left = theLeftoversOf(record)
  const caught = carrying.filter((one) =>
    left.some(
      (kept) =>
        kept.path === one.path &&
        (one.worktree === undefined || kept.worktree === undefined || kept.worktree === one.worktree) &&
        kept.digest === one.digest,
    ),
  )
  if (caught.length === 0) return undefined
  const names = caught.map((one) => (one.worktree === undefined ? one.path : `${one.worktree}: ${one.path}`))
  const commands = theCommandsOf(record)
  const wasRunning =
    commands.length === 0
      ? 'The run that ended before this one was cut short.'
      : `The run that ended before this one was cut short while running ${namedThenTheRest(commands)}.`
  return (
    `this commit carries what a killed run left: ${namedThenTheRest(names)} ` +
    `(the bytes are the same ones kept when the launch ended). ${wasRunning} ` +
    'Restore the file to what you meant, commit that, and the record stops applying to it.'
  )
}

/** The record as the one line the crew's store keeps, and the one shape this reads back. */
export const theKeptText = (record: WhatAKilledRunLeft): string =>
  JSON.stringify({
    member: record.member,
    at_ms: record.at_ms,
    running: record.running,
    leftovers: record.leftovers,
    ...(record.running_unreadable === undefined ? {} : { running_unreadable: record.running_unreadable }),
    ...(record.leftovers_unreadable === undefined ? {} : { leftovers_unreadable: record.leftovers_unreadable }),
  })

const isAString = (value: unknown): value is string => typeof value === 'string'

const aRunningCommand = (value: unknown): value is IRunningCommand =>
  typeof value === 'object' && value !== null && isAString((value as IRunningCommand).command_line)

const aLeftover = (value: unknown): value is ILeftover => {
  if (typeof value !== 'object' || value === null) return false
  const one = value as ILeftover
  return (
    isAString(one.path) &&
    isAString(one.digest) &&
    (one.worktree === undefined || isAString(one.worktree))
  )
}

/**
 * A kept record read back. A text that will not parse, or one whose fields are not what this wrote, answers
 * `unreadable` with its reason: a record nobody can read is never read as "nothing was left".
 */
export const theRecordIn = (text: string): AKeptRecord => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { unreadable: 'the kept record does not parse' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { unreadable: 'the kept record is not an object' }
  const one = parsed as WhatAKilledRunLeft
  if (!isAString(one.member)) return { unreadable: 'the kept record names no member' }
  if (typeof one.at_ms !== 'number' || !Number.isFinite(one.at_ms)) {
    return { unreadable: 'the kept record is stamped with no time' }
  }
  if (!Array.isArray(one.running) || !one.running.every(aRunningCommand)) {
    return { unreadable: 'the kept record lists commands it does not hold' }
  }
  if (!Array.isArray(one.leftovers) || !one.leftovers.every(aLeftover)) {
    return { unreadable: 'the kept record lists files it does not hold' }
  }
  if (one.running_unreadable !== undefined && !isAString(one.running_unreadable)) {
    return { unreadable: 'the kept record says its commands were unreadable in no words' }
  }
  if (one.leftovers_unreadable !== undefined && !isAString(one.leftovers_unreadable)) {
    return { unreadable: 'the kept record says its files were unreadable in no words' }
  }
  return { record: one }
}
