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
// silently. The report the host writes is cut from the recorded host binary (../read_a_failed_agents_report/
// read_a_failed_agents_report.ts) and handed in, the way the review-model rule is handed the host's spawn description
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
  /** Forgets one call: the line about it has been written, or the table had no room for it. */
  forget(tool_use_id: string): void
}

/**
 * How many of the launcher's allowed reviews are held: enough for the reviews one member can have open at once and the
 * last stop the host reported, few enough that a launch spawning reviews all day does not keep every one of them
 * (martha#430). What the bound costs is stated where it is spent: past this many, a failure the host reports for an
 * older call is not named in the row — the member still reads the host's own turn, which is the route this slice relies
 * on whenever no line can be written at all.
 */
export const REVIEWS_REMEMBERED = 32

/** A spawn table that starts empty: one per launch. */
export function reviewSpawnsRemembered(): TheReviewSpawns {
  const spawns = new Map<string, AnAllowedSpawn>()
  const forgetTheOldest = (): void => {
    const oldest = spawns.keys().next()
    if (!oldest.done) spawns.delete(oldest.value)
  }
  return {
    remember: (tool_use_id, allowed_model) => {
      // A call remembered again goes to the back of the table, so the oldest is the least recently allowed.
      spawns.delete(tool_use_id)
      spawns.set(tool_use_id, { allowed_model })
      if (spawns.size > REVIEWS_REMEMBERED) forgetTheOldest()
    },
    resolved: (tool_use_id, resolved_model) => {
      const held = spawns.get(tool_use_id)
      if (held !== undefined) spawns.set(tool_use_id, { ...held, resolved_model })
    },
    theSpawn: (tool_use_id) => spawns.get(tool_use_id),
    forget: (tool_use_id) => void spawns.delete(tool_use_id),
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

/** One line about a failed review: the model the call resolved to, and the host's own words for the stop. */
export const theLineAboutIt = (failed: TheFailedReview): string => `review on ${failed.model}: ${failed.reason}`

/** Where the line about a failed review goes: the owner's row, and the member's own session. */
export interface WhereTheFailedReviewIsTold {
  /** The row the owner reads, which says what needs them. */
  readonly theRow: (line: string) => void
  /** The member's own session, through the crew's channel; a store that refuses it is the telling's to write down. */
  readonly theMember: (line: string) => Promise<void>
}

/**
 * Names the review the host reports failed in `text` (martha#390): the row first, so the owner reads it whatever happens
 * to the member's half, then the member's session. The call is forgotten once the line is written (martha#430) — the
 * entry was kept for this one reading, and a second envelope naming the same call then names nothing rather than
 * putting the same stop in the row twice. A turn that is not that envelope, or not one of this launcher's reviews,
 * names nothing and forgets nothing.
 */
export async function nameTheFailedReviewIn(
  spawns: TheReviewSpawns,
  text: string,
  reading: HowTheTurnIsRead,
  where: WhereTheFailedReviewIsTold,
): Promise<void> {
  const failed = theFailedReviewIn(spawns, text, reading)
  if (failed === undefined) return
  const line = theLineAboutIt(failed)
  where.theRow(line)
  await where.theMember(line)
  spawns.forget(failed.tool_use_id)
}

/**
 * The model the host answered an agent's call with, or undefined when the answer carries none (martha#390): the agent's
 * own model, never one read out of the host's prose. The answer's own shape is the host's, which is why it is read here
 * and not in the launcher that only passes it on.
 */
export function resolvedModelIn(answer: unknown): string | undefined {
  const resolved = (answer as { readonly result?: { readonly resolvedModel?: unknown } } | null | undefined)?.result?.resolvedModel
  return typeof resolved === 'string' && resolved !== '' ? resolved : undefined
}

/** What one element of the host's envelope holds, or undefined when the text holds no such element. */
export function theElementIn(text: string, element: string): string | undefined {
  const opened = text.indexOf(`<${element}>`)
  if (opened === -1) return undefined
  const closed = text.indexOf(`</${element}>`, opened)
  if (closed === -1) return undefined
  return text.slice(opened + element.length + 2, closed)
}
