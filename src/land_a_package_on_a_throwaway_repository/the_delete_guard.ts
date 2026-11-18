// Whether the nightly live run may delete the throwaway repository it made (martha#639, R2).
//
// The run deletes one repository a night, with a token that reaches only the throwaway owner. A name is not enough to
// stand on: a repository can be renamed or moved, and an owner's login can change. So the run reads the repository by
// the numeric id it recorded when it made it, and deletes only when every field it reads then is the one this run
// made: the owner's numeric id recorded at setup, this run's stamp in the name, a creation after this run started, and
// the full name the delete is sent to. A field that differs is named, and the repository is left for the operator.

/** What the run recorded when it made the repository, and the setup recorded for its owner. */
export interface WhatTheRunMade {
  /** The repository's numeric id, from the create's own answer. */
  readonly id: number
  /** The throwaway owner's numeric id, recorded once at setup beside the token. */
  readonly owner_id: number
  /** This run's stamp, which the repository's name carries. */
  readonly stamp: string
  /** When this run started, as an ISO 8601 time. */
  readonly run_started_at: string
  /** The full name the delete will be sent to. */
  readonly full_name: string
}

type Field = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is Field => typeof value === 'object' && value !== null && !Array.isArray(value)

const aPositiveInteger = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const aWord = (value: unknown): boolean => typeof value === 'string' && value.trim() !== ''
const aTime = (value: unknown): boolean => typeof value === 'string' && !Number.isNaN(Date.parse(value))

/** What each field of the run's record must be, by its name. */
const RECORD_FIELDS: ReadonlyArray<readonly [keyof WhatTheRunMade, (value: unknown) => boolean]> = [
  ['id', aPositiveInteger],
  ['owner_id', aPositiveInteger],
  ['stamp', aWord],
  ['run_started_at', aTime],
  ['full_name', aWord],
]

/**
 * The run's record, read: what it made, or why it cannot be read, naming the first field that is missing or not what
 * it must be. A field the record leaves out would otherwise compare equal to the same field missing from GitHub's
 * answer, and a delete would hold on two records that name no repository at all (martha#639, r=1 item 1).
 */
export function whatTheRunMadeIn(record: unknown): WhatTheRunMade | string {
  if (!isObject(record)) return 'the run\'s record is not an object'
  const bad = RECORD_FIELDS.find(([field, holds]) => !holds(record[field]))
  return bad === undefined ? (record as unknown as WhatTheRunMade) : `the run's record has no readable ${bad[0]}`
}

/** The owner's numeric id in GitHub's answer for a repository, or undefined when the answer holds none. */
const ownerIdOf = (answer: Field): unknown => (isObject(answer['owner']) ? answer['owner']['id'] : undefined)

/** A time GitHub wrote, as milliseconds, or undefined when it is not one. */
const timeOf = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : at
}

/** Whether a repository created at `created_at` was made after this run started. */
const madeAfter = (created_at: unknown, run_started_at: string): boolean => {
  const made = timeOf(created_at)
  const started = timeOf(run_started_at)
  return made !== undefined && started !== undefined && made >= started
}

/**
 * Why the run may not delete the repository GitHub describes in `answer`, the reply to `GET /repositories/<id>` read
 * just before the delete, naming the first field that is not what this run made; or undefined when it may.
 */
export function whyNotDelete(made: WhatTheRunMade, answer: unknown): string | undefined {
  if (!isObject(answer)) return 'GitHub gave no repository for the recorded id'
  const checks: ReadonlyArray<readonly [string, boolean]> = [
    ['id', answer['id'] === made.id],
    ['owner.id', ownerIdOf(answer) === made.owner_id],
    ['name', typeof answer['name'] === 'string' && made.stamp !== '' && answer['name'].includes(made.stamp)],
    ['created_at', madeAfter(answer['created_at'], made.run_started_at)],
    ['full_name', answer['full_name'] === made.full_name],
  ]
  const failed = checks.find(([, holds]) => !holds)
  return failed === undefined ? undefined : `${failed[0]} is not the one this run made, so the repository is left for the operator`
}
