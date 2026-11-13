// A review the host reports as failed, named to the member and its row (martha#390).
//
// This exists because a review that dies at its reviewer model's limit left nothing behind: the host retries the model
// quietly and then gives up on the agent, and until this slice the member's row and its crew said nothing about it. The
// design's option (a) is what is built: nothing relaunches a review on another model, and no second model is chosen
// anywhere in this code — the stop is named, and the member decides.
//
// WHAT IS DECIDED ON, and nothing else (Mercurius's ruling on martha#390, comment 6862772905):
//
//   - the origin kind the host stamped on the turn, and inside its envelope two fixed fields: the status element, which
//     must be the host's own word for a failed agent, and the tool-use element, which must be an Agent call this
//     launcher allowed on the crew's reviewer model;
//   - the MODEL is that call's `resolvedModel`, as the host answered the call — never a name read out of the host's
//     prose, which is why the module below has no pattern for a status code, for "limit", or for any other word;
//   - the REASON is the envelope's summary element, repeated verbatim. Martha adds no reading of its own to it.
//
// WHICH NAMES those elements have is not this slice's to say: a host renames them, and a name typed here would go stale
// silently. The report the host writes is cut from the recorded host binary (../claude_code_host/
// the_hosts_failed_agents_report.ts) and handed in, the way the review-model rule is handed the host's spawn description
// (../run_reviews_on_the_review_model). This slice reads no disk and knows no host: it decides on what it is given.

/** The envelope one host writes when an agent it started fails: its own names for the turn, its fields and its failure. */
export interface TheReportTheHostWrites {
  /** The notification's own name, which the host stamps as the turn's origin kind as well as writing it as an element. */
  readonly notification: string
  /** The element the agent's status is reported in. */
  readonly status: string
  /** The element the Agent call is named in: the id this launcher kept when it allowed the call. */
  readonly tool_use: string
  /** The element the host's own words for the stop are carried in. */
  readonly summary: string
  /** The status that says the agent failed: anything else is a report this slice does not read. */
  readonly failed: string
}

/** One review the host reported as failed: the model the call resolved to, and the host's own words for the stop. */
export interface TheFailedReview {
  /** The Agent call the envelope names, by the host's own id for it. */
  readonly tool_use_id: string
  /** The model the host said the call resolved to, from its answer for the call. */
  readonly model: string
  /** The host's own words for the stop, exactly as it wrote them. */
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

/** What the launcher reads a turn of the host's with: the turn's own kind, the crew's reviewer model, and the report. */
export interface HowTheTurnIsRead {
  /** The origin kind the engine stamped on the turn, as the host contract hands it over. */
  readonly origin_kind: string
  /** The crew's reviewer model, as the declaration names it: what an allowed review's call named. */
  readonly review_model: string
  /** The envelope the host writes when an agent fails, as this host's own names say it. */
  readonly report: TheReportTheHostWrites
}

/**
 * The review the host reports failed in `text`, or undefined when the turn is not its failed envelope for one of this
 * launcher's reviews. The model is the one the allowed call resolved to, never one read here.
 */
export function theFailedReviewIn(spawns: TheReviewSpawns, text: string, reading: HowTheTurnIsRead): TheFailedReview | undefined {
  const failure = theFailureReported(text, reading)
  if (failure === undefined) return undefined
  const spawn = spawns.theSpawn(failure.tool_use_id)
  if (spawn === undefined || spawn.allowed_model !== reading.review_model || spawn.resolved_model === undefined) return undefined
  return { tool_use_id: failure.tool_use_id, model: spawn.resolved_model, reason: failure.reason }
}

/** What the host's envelope says failed: the call it names and its own words, or undefined when the turn is not one. */
function theFailureReported(text: string, { origin_kind, report }: HowTheTurnIsRead): { readonly tool_use_id: string; readonly reason: string } | undefined {
  if (origin_kind !== report.notification) return undefined
  if (theElementIn(text, report.status) !== report.failed) return undefined
  const tool_use_id = theElementIn(text, report.tool_use) ?? ''
  const reason = theElementIn(text, report.summary) ?? ''
  return tool_use_id === '' || reason === '' ? undefined : { tool_use_id, reason }
}

/**
 * Why a turn does not read as the host's report at all, or undefined when it does, so the launch can say that the report
 * it is pinned to is not the one this host writes rather than silently naming nothing (martha#390).
 */
export function whatTheEnvelopeNoLongerHolds(text: string, report: TheReportTheHostWrites): string | undefined {
  for (const element of [report.status, report.tool_use, report.summary]) {
    if (theElementIn(text, element) === undefined) {
      return `it holds no <${element}>: the host renamed an element, and a review that fails would read as one that did not`
    }
  }
  return theElementIn(text, report.status) === report.failed ? undefined : `its status is not ${report.failed}: this slice reads the host's own word for a failed agent, and it is not the one this host writes`
}

/** The sender a line Martha itself writes into the crew's channel carries (martha#390): never a member's own name. */
export const THE_CREWS_OWN_NAME = 'martha'

/** One line about a failed review: the model the call resolved to, and the host's own words for the stop. */
export const theLineAboutIt = (failed: TheFailedReview): string => `review on ${failed.model}: ${failed.reason}`

/** What one element of the host's envelope holds, or undefined when the text holds no such element. */
export function theElementIn(text: string, element: string): string | undefined {
  const opened = text.indexOf(`<${element}>`)
  if (opened === -1) return undefined
  const closed = text.indexOf(`</${element}>`, opened)
  if (closed === -1) return undefined
  return text.slice(opened + element.length + 2, closed)
}
