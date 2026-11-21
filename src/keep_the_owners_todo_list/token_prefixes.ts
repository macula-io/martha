// The prefixes of the secrets Martha refuses wherever it reads text an owner wrote: a row of the owner's list, the
// private scan, the transcripts kept, and a provider's account in the declaration (martha#942). A leaf: it imports nothing.

/** A fine-grained GitHub token's prefix: one definition, which the live run's kept record builds its pattern from too. */
export const FINE_GRAINED_TOKEN_PREFIX = 'github_pat_'

/**
 * A GitHub token's prefixes: the classic personal, OAuth, user-to-server, server-to-server and refresh forms, and the
 * fine-grained one. The private scan refuses the same in any text it reads (martha#904).
 */
export const GITHUB_TOKEN_PREFIXES = ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', FINE_GRAINED_TOKEN_PREFIX] as const

/** The prefixes of the secrets a command may not hold: a row names a variable, never its value. */
export const TOKEN_PREFIXES = [...GITHUB_TOKEN_PREFIXES, 'glpat-', 'xoxb-', 'xoxp-', 'sk-ant-', 'AKIA', 'npm_', 'hf_'] as const

/** How many characters of a token's body follow its prefix before a word is read as a secret; the private scan's too. */
export const TOKEN_BODY = 16
