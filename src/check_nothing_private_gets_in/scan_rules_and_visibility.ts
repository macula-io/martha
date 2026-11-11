// The two things a scan needs from outside the pure decision: the rule set it
// holds to, and the live lookup that says whether a repository is public. They
// live here, beside the decision, because main.ts runs its scan when it is
// imported (martha#265): a second check cannot import either one from there, and
// a copy of the rules would be a second definition of what a scan refuses.

import { familiesFrom, type Families, type Resolve, type Rules } from './check_nothing_private_gets_in.ts'
import { DECLARED } from './declared.ts'

// Asks GitHub whether a repository is public. The answer is the repository's own
// visibility, not whether this caller can see it: a token that reads private
// repositories still gets `private: true` back, and that is refused.
export const resolveOnGitHub = (token: string | undefined): Resolve => async (owner, repo) => {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'martha-check-nothing-private',
      ...(token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` }),
    },
  })
  if (response.status === 404) return 'not_public'
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${owner}/${repo}`)
  const body = (await response.json()) as { private?: unknown; visibility?: unknown }
  return body.private === false && body.visibility === 'public' ? 'public' : 'not_public'
}

// A scan's rules: the declared set, the lab's families when they can be read, and
// whether each class's synthetic form passes.
export const rulesOf = (families: Families, allowSynthetic: boolean): Rules => ({
  ...DECLARED,
  labHosts: families.kind === 'declared' ? families.labHosts : [],
  allowSynthetic,
})

// An error can name anything: a tracked path git could not read, a repository
// the lookup failed on. Its lab names are replaced before it is printed, with the
// declared families when they can be read and the generic classes when not. This
// reads the secret a second time because the failure it serves happens before or
// instead of the scan's own reading.
export const declaredOrNone = (): readonly string[] => {
  try {
    const families = familiesFrom(process.env['MARTHA_LAB_HOSTS'], true)
    return families.kind === 'declared' ? families.labHosts : []
  } catch {
    return []
  }
}
