// The way out of a leftover refusal, as the member takes it (#693): `release_the_files_a_killed_run_left`.
//
// A member whose own edit sits inside the window a killed run was running in is told as a leftover, and refused at the
// commit. That is right — nothing knows whether those bytes are the run's or the member's — but it must not be a wall:
// the member looks at the file, says it is its own, and the act keeps that path as released. The refusals then leave it
// out, and the telling leaves it out too, so the member is not told again what it has already answered.
//
// The act releases only paths the member's record really holds as leftovers. A path no record names is answered as such,
// never as released: saying "released" about a path nothing refuses would be an answer to a question nobody asked, and a
// member that mistypes a path learns the difference at once.

import type { CrewStore } from '../host_contract/host_contract.ts'
import { namedThenTheRest, THE_RELEASE_ACT, type IReleasedPath } from '../tell_a_member_what_its_relaunch_killed/tell_a_member_what_its_relaunch_killed.ts'
import { keepTheReleaseOf, theLeftoverRecordOf, theReleasedPathsOf } from '../tell_a_member_what_its_relaunch_killed/the_telling_on_every_start.ts'

/** What the act takes, as the mod registers it: under the name the refusals' own text tells the member to take. */
export const RELEASE_THE_FILES_TOOL = {
  name: THE_RELEASE_ACT,
  description:
    'Say that paths a killed run left in your trees are your own edits, after looking at them. A released path is not ' +
    'refused at the next commit or hand-off, and the telling leaves it out. Name each path as the telling named it.',
  inputSchema: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'The paths you looked at and say are yours, each as the telling named it',
      },
    },
    required: ['paths'],
  },
} as const

/** The paths an argument names: every string in the list, and nothing from a value that is not one. */
export const thePathsOf = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : []

/** The member making the act, the crew's store, the paths it names, and the place its trees live when it says. */
export interface AReleaseAsked {
  readonly crew: CrewStore
  readonly member: string
  readonly paths: readonly string[]
  /** The trees a bare path belongs to, when the caller knows where the member works: one path may stand in each. */
  readonly trees?: readonly string[]
}

/** The paths that really stand as this member's leftovers, from those the member named: the act's own judgement. */
const theStandingOnes = (crew: CrewStore, member: string, named: readonly string[]): readonly IReleasedPath[] => {
  const kept = theLeftoverRecordOf(crew, member)
  if (kept === undefined || 'refusal' in kept || 'unreadable' in kept) return []
  const standing = kept.record.leftovers
  return named.flatMap((path) => standing.filter((one) => one.path === path).map((one) => ({ path: one.path, ...(one.worktree === undefined ? {} : { worktree: one.worktree }) })))
}

/** Why nothing was released, when none of the names is a path the member's record holds. */
const nothingStandsSaid = (crew: CrewStore, member: string, named: readonly string[]): string => {
  const kept = theLeftoverRecordOf(crew, member)
  if (kept === undefined || 'unreadable' in kept) return 'Not released: no record of a killed run stands for you, so nothing refuses those paths.'
  if ('refusal' in kept) return `Not released: ${kept.refusal}`
  return `Not released: nothing a killed run left is at ${namedThenTheRest(named)} in your trees.`
}

/** What a kept release is told as: the paths it kept, the ones already released, and the ones no leftover holds. */
const theReleasedSaid = (standing: readonly IReleasedPath[], before: ReadonlySet<string>, named: readonly string[]): string => {
  const keptNow = standing.filter((one) => !before.has(one.path)).map((one) => one.path)
  const wasAlready = standing.filter((one) => before.has(one.path)).map((one) => one.path)
  const namedNotKept = named.filter((path) => !standing.some((one) => one.path === path))
  const said = keptNow.length === 0 ? `Already released: ${namedThenTheRest(wasAlready)}` : `Released: ${namedThenTheRest(keptNow)}`
  const rest = [
    ...(wasAlready.length === 0 || keptNow.length === 0 ? [] : [`Already released: ${namedThenTheRest(wasAlready)}.`]),
    ...(namedNotKept.length === 0 ? [] : [`Not a leftover, so not released: ${namedThenTheRest(namedNotKept)}.`]),
  ]
  return `${said}. It is not refused again, and the telling leaves it out.${rest.length === 0 ? '' : ` ${rest.join(' ')}`}`
}

/**
 * What the member is told: the paths kept as released, the ones no record holds, and why when nothing could be kept.
 * A path already released is said as already released rather than kept twice.
 */
export function releaseTheFilesAKilledRunLeft(asked: AReleaseAsked): { readonly answer: string } | { readonly refused: string } {
  const named = [...new Set(asked.paths.filter((path) => path !== ''))]
  if (named.length === 0) return { refused: 'Not released: name at least one path, as the telling named it.' }
  const standing = theStandingOnes(asked.crew, asked.member, named)
  if (standing.length === 0) return { refused: nothingStandsSaid(asked.crew, asked.member, named) }
  const before = new Set(theReleasedPathsOf(asked.crew, asked.member).map((one) => one.path))
  const refused = keepTheReleaseOf(asked.crew, asked.member, standing)
  return refused === undefined ? { answer: theReleasedSaid(standing, before, named) } : { refused: `Not released: ${refused}` }
}
