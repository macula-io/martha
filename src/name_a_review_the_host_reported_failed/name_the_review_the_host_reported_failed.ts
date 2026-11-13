// A review the host reports as failed, named to the member and its row (martha#390).
//
// This exists because a review that dies at its reviewer model's limit left nothing behind: the host retries the model
// quietly and then gives up on the agent, and until this slice the member's row and its crew said nothing about it. The
// design's option (a) is what is built: nothing relaunches a review on another model, and no second model is chosen
// anywhere in this code — the stop is named, and the member decides.
//
// WHAT IS DECIDED ON, and nothing else (Mercurius's ruling on martha#390, comment 6862772905):
//
//   - the origin kind the host stamped, `task-notification`, and inside its envelope two fixed fields: `<status>`, which
//     must be the host's `failed`, and `<tool-use-id>`, which must be an Agent call this launcher allowed on the crew's
//     reviewer model;
//   - the MODEL is that call's `resolvedModel`, as the host answered the call — never a name read out of the host's
//     prose, which is why the module below has no pattern for a status code, for "limit", or for any other word;
//   - the REASON is the envelope's `<summary>`, repeated verbatim. Martha adds no reading of its own to it.
//
// The envelope is the HOST'S, and it is pinned: recorded_failed_review.json holds the text one run produced at a named
// host version, and `theEnvelopeIsStillTheOneRecorded` fails by name when the recording this tree reads has moved to
// another version, because a renamed element would otherwise read as "the host reported no failure". Recording it again
// is the fix, and the check says so.

import { readFileSync } from 'node:fs'

/** One review the host reported as failed: the model the call resolved to, and the host's own words for the stop. */
export interface TheFailedReview {
  /** The Agent call the envelope names, by the host's own id for it. */
  readonly tool_use_id: string
  /** The model the host said the call resolved to, from its answer for the call. */
  readonly model: string
  /** The host's `<summary>`, exactly as it wrote it. */
  readonly reason: string
}

/** What an Agent call this launcher allowed left behind: the model it named, and the model the host resolved it to. */
export interface AnAllowedSpawn {
  /** The model the call named, compared with the crew's reviewer model as the call wrote it. */
  readonly allowed_model: string
  /** What the host answered the call with, once it has answered: an agent's resolved model. */
  readonly resolved_model?: string
}

/** The Agent calls one launcher allowed, by the host's own id, for reading a failure the host reports later. */
export interface TheReviewSpawns {
  /** Keeps an Agent call this launcher allowed, and the model the call named. */
  remember(tool_use_id: string, allowed_model: string): void
  /** Keeps what the host answered the call with: the model the agent really ran on. */
  resolved(tool_use_id: string, resolved_model: string): void
  /** What this launcher knows of one call, or undefined for a call it never allowed. */
  theSpawn(tool_use_id: string): AnAllowedSpawn | undefined
}

/** A spawn table that starts empty: one per launch. */
export function reviewSpawnsRemembered(): TheReviewSpawns {
  const spawns = new Map<string, AnAllowedSpawn>()
  return {
    remember: (tool_use_id, allowed_model) => void spawns.set(tool_use_id, { allowed_model }),
    resolved: (tool_use_id, resolved_model) => {
      const held = spawns.get(tool_use_id)
      if (held !== undefined) spawns.set(tool_use_id, { ...held, resolved_model })
    },
    theSpawn: (tool_use_id) => spawns.get(tool_use_id),
  }
}

/** The envelope this tree carries, as it was recorded: the host's own text, and the version that wrote it. */
interface RecordedFailedReview {
  readonly host_version: string
  readonly origin_kind: string
  readonly text: string
}

/** The recording, read once. A recording this tree cannot read is a fault of the tree, not of a member's turn. */
export const THE_FAILED_REVIEW_RECORDING: RecordedFailedReview = JSON.parse(
  readFileSync(new URL('./recorded_failed_review.json', import.meta.url), 'utf8'),
) as RecordedFailedReview

/** The host's own element names in the envelope. Fixed fields, which is why they are read and the prose is not. */
export const THE_HOSTS_STATUS = 'status'
export const THE_HOSTS_TOOL_USE = 'tool-use-id'
export const THE_HOSTS_SUMMARY = 'summary'

/** The one status that says the agent failed: anything else is a report this slice does not read. */
export const THE_HOSTS_FAILED = 'failed'

/** The id of the Agent call the recording's envelope names: the review that failed in the run recorded. */
export const THE_RECORDED_CALLS_ID = theElementIn(THE_FAILED_REVIEW_RECORDING.text, THE_HOSTS_TOOL_USE) ?? ''

/**
 * Why this tree's envelope is not the one the recorded host writes, or undefined when it is. Two things move: the host
 * version the tree records, which says the envelope was never re-read for it, and an element or a status the recording
 * no longer holds, which says the host renamed one. Either way a review's failure could read as no failure at all.
 */
export function theEnvelopeIsStillTheOneRecorded(host_version: string): string | undefined {
  const { text } = THE_FAILED_REVIEW_RECORDING
  const recorded_on = THE_FAILED_REVIEW_RECORDING.host_version
  if (host_version !== recorded_on) {
    return `the host's failed-review envelope was recorded on ${recorded_on} and this tree reads ${host_version}: record it again (recorded_failed_review.json, beside this check) before a review that fails is read as one that did not`
  }
  for (const element of [THE_HOSTS_STATUS, THE_HOSTS_TOOL_USE, THE_HOSTS_SUMMARY]) {
    if (theElementIn(text, element) === undefined) {
      return `the recorded envelope holds no <${element}>: the host renamed an element, and a review that fails would read as one that did not`
    }
  }
  if (theElementIn(text, THE_HOSTS_STATUS) !== THE_HOSTS_FAILED) {
    return `the recorded envelope's status is not ${THE_HOSTS_FAILED}: this slice reads the host's own word for a failed agent, and it is not the one recorded`
  }
  return undefined
}

/**
 * The review the host reports failed in `text`, or undefined when the turn is not its failed envelope for one of this
 * launcher's reviews. `origin_kind` is the engine's own stamp on the turn, `review_model` the crew's reviewer model as
 * the declaration names it, and the model in the answer is the one the allowed call resolved to, never one read here.
 */
export function theFailedReviewIn(spawns: TheReviewSpawns, text: string, origin_kind: string, review_model: string): TheFailedReview | undefined {
  const failure = theFailuresReport(text, origin_kind)
  if (failure === undefined) return undefined
  const spawn = spawns.theSpawn(failure.tool_use_id)
  if (spawn === undefined || spawn.allowed_model !== review_model || spawn.resolved_model === undefined) return undefined
  return { tool_use_id: failure.tool_use_id, model: spawn.resolved_model, reason: failure.reason }
}

/** What the host's envelope says failed: the call it names and its own words, or undefined when the turn is not one. */
function theFailuresReport(text: string, origin_kind: string): { readonly tool_use_id: string; readonly reason: string } | undefined {
  if (origin_kind !== THE_FAILED_REVIEW_RECORDING.origin_kind) return undefined
  if (theElementIn(text, THE_HOSTS_STATUS) !== THE_HOSTS_FAILED) return undefined
  const tool_use_id = theElementIn(text, THE_HOSTS_TOOL_USE) ?? ''
  const reason = theElementIn(text, THE_HOSTS_SUMMARY) ?? ''
  return tool_use_id === '' || reason === '' ? undefined : { tool_use_id, reason }
}

/** The sender a line Martha itself writes into the crew's channel carries (martha#390): never a member's own name. */
export const THE_CREWS_OWN_NAME = 'martha'

/** One line about a failed review: the model the call resolved to, and the host's own words for the stop. */
export const theLineAboutIt = (failed: TheFailedReview): string => `review on ${failed.model}: ${failed.reason}`

/** What one element of the host's envelope holds, or undefined when the text holds no such element. */
function theElementIn(text: string, element: string): string | undefined {
  const opened = text.indexOf(`<${element}>`)
  if (opened === -1) return undefined
  const closed = text.indexOf(`</${element}>`, opened)
  if (closed === -1) return undefined
  return text.slice(opened + element.length + 2, closed)
}
