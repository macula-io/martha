// Which conversions of a file a launch may pass (martha#167, design r=2 §3 and Saturnus's r=2 condition).
//
// git's attributes can rewrite a file's bytes on their way into a tree with no program at all: `ident` expands
// or collapses `$Id$`, `working-tree-encoding` re-encodes the whole file, and `text`/`eol` change its line ends.
// A member's hooks and servers run from the bytes on disk, not from the blob the gate judged, so a file whose
// bytes differ from the approved blob but which hashes to it only after a conversion is a file nobody approved
// being run: an `ident` marker in a script's first line swallows a line of planted code, and the tree still says
// "unchanged".
//
// THE OWNER'S RULING (Raf, 2026-11-09, "Yes, allow line endings only"): a file that differs from the approved
// blob only by a text/eol conversion passes, so a checkout with CRLF line ends keeps working (martha#132); a
// file under `ident`, `working-tree-encoding` or a `filter` that matches only after conversion is refused BY
// NAME, so the owner reads which attribute did it. A filter can start a program besides, which is #167's own
// finding (#129's r=4).//
// The attributes are read from the tree the owner approved, never from the checkout: `git check-attr` runs in
// the launcher's own git dir with GIT_ATTR_SOURCE naming that tree, so the checkout's own `.git/info/attributes`
// and `core.attributesFile` decide nothing here (§1 of the design).

import type { Processes } from '../host_contract/host_contract.ts'

/** The variables git would take a repository, an index or a config from; none is inherited. */
const GIT_VARIABLES = 'GIT_'
const NULL_CONFIG = '/dev/null'

/**
 * The one conversion a launch still passes, and the owner's ruling for it (Raf, 2026-11-09: "Yes, allow line
 * endings only"). Named once, so the gate has one place to change if the ruling does.
 */
export const CONVERSIONS_A_LAUNCH_PASSES: readonly string[] = ['text', 'eol']

/**
 * The conversions a launch refuses by name: each rewrites bytes the owner never approved, and a `filter` runs a
 * program besides (martha#167, design r=2, Saturnus's condition).
 */
export const CONVERSIONS_A_LAUNCH_REFUSES: readonly string[] = ['ident', 'working-tree-encoding', 'filter']

/** What `git check-attr` says about one attribute of one path. */
const UNSPECIFIED = 'unspecified'
const UNSET = 'unset'

/** Where the attributes are read: the launcher's own git dir, and the tree whose attributes apply. */
export interface ApprovedAttributes {
  /** The launcher's git dir, never the checkout's. */
  readonly repository: string
  /** The tree the owner approved: the only source of attributes a launch obeys. */
  readonly tree: string
  readonly processes: Pick<Processes, 'runNow'>
}

/**
 * Why a file that matches the approved blob only after a conversion may not run, naming the path and the
 * attribute that did it; `undefined` when nothing but a line-ending conversion is in force, or nothing at all.
 *
 * Asked only when the file's own bytes do not hash to the approved blob but git's answer does: a file whose raw
 * bytes are the approved object has had nothing done to it.
 */
export function whyAConvertedFileIsRefused(where: ApprovedAttributes, path: string): string | undefined {
  const inForce = attributesInForce(where, path)
  if (typeof inForce === 'string') return inForce
  const refused = CONVERSIONS_A_LAUNCH_REFUSES.filter((attribute) => inForce.has(attribute))
  if (refused.length === 0) return undefined
  return `${path} differs from the approved file only through ${refused.map((attribute) => `its ${attribute} attribute`).join(' and ')}, which rewrites the bytes a member's hooks and servers run from, so it is no longer the file the owner approved (martha#167); take the attribute off it in the approved tree, or approve the checkout again with the file as it is`
}

/**
 * The attributes in force for `path` under the approved tree, or why they cannot be told: git failing to answer
 * refuses rather than passes, since a conversion nobody could read is a conversion nobody ruled on.
 */
function attributesInForce(where: ApprovedAttributes, path: string): ReadonlySet<string> | string {
  const run = where.processes.runNow({
    command: 'git',
    args: ['--git-dir', where.repository, '-c', 'core.fsmonitor=false', 'check-attr', '-z', ...CONVERSIONS_A_LAUNCH_REFUSES, '--', path],
    cwd: where.repository,
    environment: {
      drop_prefixes: [GIT_VARIABLES],
      set: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_CONFIG, GIT_ATTR_SOURCE: where.tree, GIT_TERMINAL_PROMPT: '0' },
    },
  })
  if (run.exit_code === 0) return inForceIn(run.stdout)
  return `${path} differs from the approved file only after a conversion, and the attributes the approved tree sets for it cannot be read (git exit ${run.exit_code}), so whether the owner approved those bytes cannot be told (martha#167); approve the checkout again`
}

/** The attributes `git check-attr -z` reports as set: `<path>\0<attribute>\0<value>\0`, repeating. */
function inForceIn(output: string): ReadonlySet<string> {
  const fields = output.split('\u0000')
  const inForce = new Set<string>()
  for (let at = 0; at + 2 < fields.length; at += 3) {
    const attribute = fields[at + 1] ?? ''
    const value = fields[at + 2] ?? ''
    if (value !== UNSPECIFIED && value !== UNSET) inForce.add(attribute)
  }
  return inForce
}
