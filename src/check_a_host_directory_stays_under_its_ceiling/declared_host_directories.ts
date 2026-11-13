// The host directories package.json declares, and the ceiling each one carries.
//
// Two lists name where a host's code lives: `martha.hostAdapters` (one directory
// per coding tool's adapter) and `martha.hostGlue` (the code that reaches the
// machine). Neither is read by a core check, so a decision can hide in either,
// which is why both carry a ceiling (martha#322). The lists are read here and
// nowhere else, and each directory is reported with the list that named it, so a
// failure can say which one to look at.

import type { Manifest } from '../../prove_the_core/declared_in_package_json.ts'

/** The lists a host directory is declared in, named as package.json names them. */
export const HOST_LISTS = ['hostAdapters', 'hostGlue'] as const

export type HostList = (typeof HOST_LISTS)[number]

/** Where a host directory was declared. */
export interface DeclaredDirectory {
  /** The manifest list that names it, such as `martha.hostGlue`. */
  readonly list: HostList
  /** The entry as declared, such as `src/launch_a_claude_code_member`. */
  readonly directory: string
}

/** Every host directory, in the order its list declares it: the adapters, then the glue. */
export function declaredDirectoriesOf(manifest: Manifest): DeclaredDirectory[] {
  return HOST_LISTS.flatMap((list) => (manifest.martha?.[list] ?? []).map((directory) => ({ list, directory })))
}

/** The ceiling each declared directory carries, as package.json holds it. */
export function ceilingsOf(manifest: Manifest): Readonly<Record<string, number>> {
  return manifest.martha?.hostCeilings ?? {}
}

/** Where the ceilings stand, as package.json names them: the words a landing's commit records of a ceiling it brought. */
export const CEILINGS_NAME = 'martha.hostCeilings'
