// The live run's GitHub calls reach only the throwaway owner (martha#639, R1).
//
// The run's host-side GitHub calls go through a config folder of its own, logged in with the throwaway token, under
// `env -i`. Two checks run before the run makes anything, each against the bot's numeric id recorded at setup:
//
// - who: the throwaway owner is a separate bot account (DECIDED 2026-11-18, martha#639), and its token answers
//   `GET /user` as the bot itself, a User. The owner's own login answers as the owner, and fails here by name.
// - reach: every repository the calls can see (`GET /user/repos`, every page) belongs to the bot. A token that sees
//   anything else, whoever it answers as, fails by naming the first repository outside.

type Field = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is Field => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A repository's full name and its owner's numeric id, as GitHub's list gives them. */
const ownerOf = (repository: unknown): { readonly full_name: string; readonly owner_id: unknown } => {
  if (!isObject(repository)) return { full_name: '(an entry that is not a repository)', owner_id: undefined }
  const owner = isObject(repository['owner']) ? repository['owner']['id'] : undefined
  const full_name = typeof repository['full_name'] === 'string' ? repository['full_name'] : '(a repository with no name)'
  return { full_name, owner_id: owner }
}

/** The kind of account GitHub calls a person's or a bot's: not an organisation. */
export const A_USER_ACCOUNT = 'User'

/**
 * Why the run's calls are not the bot's, read from `GET /user`'s answer: another account, or not a user account; or
 * undefined when they answer as the bot.
 */
export function whyTheCallsAreNotTheBots(user: unknown, owner_id: number): string | undefined {
  if (!isObject(user) || typeof user['id'] !== 'number') return 'GitHub gave no account for the run\'s calls, so who they are was not read'
  const login = typeof user['login'] === 'string' ? user['login'] : '(no login)'
  if (user['id'] !== owner_id) return `the run's calls answer as ${login} (${user['id']}), not as the throwaway bot (${owner_id})`
  if (user['type'] !== A_USER_ACCOUNT) return `the run's calls answer as ${login}, of type ${String(user['type'])}, not a user account`
  return undefined
}

/**
 * Why the run's calls reach further than the throwaway owner, naming the first repository outside it; or undefined when
 * every repository in `pages` (each page an answer of `GET /user/repos`) is the throwaway owner's.
 */
export function whyTheCallsReachTooFar(pages: readonly unknown[], owner_id: number): string | undefined {
  if (pages.length === 0) return 'GitHub gave no page of repositories, so the reach was not read'
  const notAList = pages.findIndex((page) => !Array.isArray(page))
  if (notAList !== -1) return `page ${notAList + 1} of the repositories is not a list, so the reach was not read`
  const outside = pages.flatMap((page) => (page as readonly unknown[]).map(ownerOf)).find((one) => one.owner_id !== owner_id)
  return outside === undefined ? undefined : `the run's calls reach ${outside.full_name}, which is not the throwaway owner's`
}
