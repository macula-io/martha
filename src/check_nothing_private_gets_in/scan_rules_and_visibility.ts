// What a scan needs from outside the pure decision: the live lookup that says
// whether a repository is public. It lives here, beside the decision, because
// main.ts runs its scan when it is imported (martha#265): a second check cannot
// import it from there. The rule set a scan holds to is rulesOf, in
// ../know_what_text_is_private (martha#1016).

import type { Resolve } from './check_nothing_private_gets_in.ts'

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
