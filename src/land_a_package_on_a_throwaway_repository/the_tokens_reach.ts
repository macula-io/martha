// The nightly live run's GitHub calls reach only the throwaway owner (martha#639, R1).
//
// The run's host-side GitHub calls go through a config folder of its own, logged in with the throwaway token, under
// `env -i`. Who the token answers as cannot tell that token from the owner's own login: a fine-grained token made by the
// owner for an organisation answers `GET /user` as the owner, as the owner's full login does. What tells them apart is
// what each can reach. So before the run makes anything it lists every repository its calls can see (`GET /user/repos`,
// every page) and requires each one to belong to the throwaway owner, by the numeric id recorded at setup. The owner's
// full login sees the organisation's real repositories and fails here by name.

type Field = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is Field => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A repository's full name and its owner's numeric id, as GitHub's list gives them. */
const ownerOf = (repository: unknown): { readonly full_name: string; readonly owner_id: unknown } => {
  if (!isObject(repository)) return { full_name: '(an entry that is not a repository)', owner_id: undefined }
  const owner = isObject(repository['owner']) ? repository['owner']['id'] : undefined
  const full_name = typeof repository['full_name'] === 'string' ? repository['full_name'] : '(a repository with no name)'
  return { full_name, owner_id: owner }
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
