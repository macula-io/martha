// What a checkout's own path proves about its workspace (martha#611): the two places `martha init` declares for a solo
// crew, or why it declares none. This exists so the layout a path proves is read in one place, beside the declaration
// that names the same places, and reads nothing but the path itself.

import { basename, dirname, join } from 'node:path'

/** The two places a crew's workspace layout names (martha#256): where its clones sit, and where its worktrees are made. */
export interface WorkspaceLayout {
  readonly clones: string
  readonly worktrees: string
}

/** The place a crew's worktrees sit in, beside the place that holds its clones: `worktrees` next to `clones`. */
export const WORKTREES_BESIDE_CLONES = 'worktrees'

/** What a checkout that proves no layout is told to add, in the words of this declaration's own keys (martha#611). */
export const LAYOUT_TO_ADD = 'Add "workspace_layout": true with "clones" and "worktrees" to house_rules to declare one.'

/** What a checkout's own path proves about its workspace (martha#611): the layout to declare, and the line `martha init` says of it. */
export interface WhatACheckoutProves {
  /** The two places to declare, or null when the checkout proves none. */
  readonly layout: WorkspaceLayout | null
  /** The line init says after its first: the two places, or why there is none and what to add. */
  readonly said: string
}

/** A checkout that proves no layout: none to declare, and the line that says why and what to add instead. */
const noLayout = (why: string): WhatACheckoutProves => ({ layout: null, said: `No workspace layout: ${why}. ${LAYOUT_TO_ADD}` })

/**
 * The workspace layout a checkout's own path proves (martha#611): a checkout at `<clones>/<org>/<name>`, whose origin
 * names that same `org/name`, keeps its clones in `<clones>` and its worktrees in `worktrees` beside them. A checkout
 * the origin does not place there proves no layout — what would be written is a guess about places the owner never
 * named — so the reason is answered instead, and `martha init` reads it (../declare_a_solo_crew).
 */
export function workspaceLayoutOf(root: string, repo: string | undefined, origin: string | null): WhatACheckoutProves {
  if (repo === undefined) {
    // The origin is not quoted back: it can carry a token in its userinfo, and this line is printed.
    const why = origin === null ? `${root} names no origin remote` : `the origin of ${root} names no repository as org/name`
    return noLayout(why)
  }
  if (`${basename(dirname(root))}/${basename(root)}` !== repo) return noLayout(`${root} does not sit at <clones>/${repo}`)
  const clones = dirname(dirname(root))
  const layout = { clones, worktrees: join(dirname(clones), WORKTREES_BESIDE_CLONES) }
  return { layout, said: `Workspace layout declared: clones ${layout.clones}, worktrees ${layout.worktrees}.` }
}
