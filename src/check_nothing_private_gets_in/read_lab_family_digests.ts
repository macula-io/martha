// Where a member's machine keeps the lab families' digests, and reading them
// (martha#731). The file and what it is for: ./lab_family_digests.ts.
//
// The place is resolved from the environment the caller hands in, and only from
// it: `$XDG_CONFIG_HOME/martha/lab_families.json` when XDG_CONFIG_HOME is set and
// absolute, else `$HOME/.config/martha/lab_families.json`. Nothing else is read:
// not this process's own environment, and not the password database a home could
// also be looked up in. That is why this module imports no node:os, and a test
// fails by name if it ever does (design r=3).
//
// Who finds the file:
// - the owner, in their own shell, and a Claude Code member, which keeps the owner's
//   HOME and XDG_CONFIG_HOME: yes;
// - a Goose member: no, on purpose. Its launch hands it a fresh HOME and nothing
//   inherited (theEnvironmentOfALaunch), and a copy of the key in every launch home
//   would multiply it. Its check runs every other rule, prints their hits, and exits
//   2 with "the lab machine families could not be checked"; CI judges the families.
// - CI: never; it reads MARTHA_LAB_HOSTS.

import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { labFamilyDigestsOf, type LabFamilyDigests } from './lab_family_digests.ts'

export type AnEnvironment = Readonly<Record<string, string | undefined>>

/** The file, under a config folder. */
const UNDER_A_CONFIG_FOLDER = join('martha', 'lab_families.json')

const absolute = (path: string | undefined): string | undefined => (path !== undefined && isAbsolute(path) ? path : undefined)

/** Where this environment keeps the file, or undefined when it names no config folder. */
export const labFamiliesFileIn = (env: AnEnvironment): string | undefined => {
  const home = absolute(env['HOME'])
  const config = absolute(env['XDG_CONFIG_HOME']) ?? (home === undefined ? undefined : join(home, '.config'))
  return config === undefined ? undefined : join(config, UNDER_A_CONFIG_FOLDER)
}

/** The digests this environment's file holds; undefined when there is no file. A file that is there and wrong throws, by name. */
export const labFamilyDigestsFrom = (env: AnEnvironment): LabFamilyDigests | undefined => {
  const file = labFamiliesFileIn(env)
  if (file === undefined) return undefined
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return undefined
    throw new Error(`the lab families file could not be read (${code ?? 'unknown'})`)
  }
  return labFamilyDigestsOf(text)
}
