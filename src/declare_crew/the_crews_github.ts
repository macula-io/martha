// The crew's GitHub block (martha#931 B): the calls GitHub says are left below which the crew spends no more. It was
// THE_FLOOR in ../spend_the_github_budget, crew-code's floor ported; the declaration's `github` block now names it, and a
// declaration that names none reads that value, so a file an earlier release wrote still declares and still spends as
// it did. The parse lives here, beside declare_crew, which hands it the block's raw value and its own refusal.

/** The declaration's key for the block. */
export const GITHUB = 'github'

/** The fields the block may name; each is optional. */
export const GITHUB_KEYS = ['budget_floor', 'author_probe_ms'] as const

/** The crew's GitHub settings. */
export interface CrewGithub {
  /** The calls GitHub says are left at or below which the crew spends nothing more, until the window resets. */
  readonly budget_floor: number
  /**
   * How long, in milliseconds, one gh call of the stranger-text gate's vouch may take (martha#987): the login, a
   * thread's authors, a fork listing. One that takes longer is no answer, and the call it judged stays a stranger's.
   */
  readonly author_probe_ms: number
}

/** What the crew reads when the declaration names no GitHub block: the floor crew-code spent by before #931, and crew-code's GH_AUTHORS_MS (martha#987). */
export const GITHUB_WHEN_UNNAMED: CrewGithub = Object.freeze({ budget_floor: 500, author_probe_ms: 20_000 })

/** How a field of the block is refused: the field, dotted under the block, and why. */
export type RefuseAGithubField = (field: string, why: string) => never

/**
 * The block as the declaration names it, over GITHUB_WHEN_UNNAMED. A floor of 0 is a number an owner may mean (spend
 * the whole window); a negative or fractional one is refused by name, never read as the default.
 */
export function githubOf(value: unknown, refuse: RefuseAGithubField): CrewGithub {
  if (value === undefined) return GITHUB_WHEN_UNNAMED
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return refuse(GITHUB, `is not an object of ${GITHUB_KEYS.join(', ')}`)
  const block = value as Readonly<Record<string, unknown>>
  const unknown = Object.keys(block).find((key) => !(GITHUB_KEYS as readonly string[]).includes(key))
  if (unknown !== undefined) return refuse(`${GITHUB}.${unknown}`, `is not a field here (they are ${GITHUB_KEYS.join(', ')})`)
  return Object.freeze({ budget_floor: floorOf(block['budget_floor'], refuse), author_probe_ms: probeOf(block['author_probe_ms'], refuse) })
}

/** The block's floor as named, or GITHUB_WHEN_UNNAMED's when it names none. */
function floorOf(floor: unknown, refuse: RefuseAGithubField): number {
  if (floor === undefined) return GITHUB_WHEN_UNNAMED.budget_floor
  if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor < 0) return refuse(`${GITHUB}.budget_floor`, 'is not a whole number of calls, 0 or more')
  return floor
}

/** The block's probe bound as named, or GITHUB_WHEN_UNNAMED's when it names none: a whole number of milliseconds, 1 or more. */
function probeOf(bound: unknown, refuse: RefuseAGithubField): number {
  if (bound === undefined) return GITHUB_WHEN_UNNAMED.author_probe_ms
  if (typeof bound !== 'number' || !Number.isSafeInteger(bound) || bound < 1) return refuse(`${GITHUB}.author_probe_ms`, 'is not a whole number of milliseconds, 1 or more')
  return bound
}
