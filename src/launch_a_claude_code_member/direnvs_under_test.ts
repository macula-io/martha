// Which direnvs the tests prove the .envrc door against (martha#24).
//
// The .envrc door follows the tool, the way a config-named hook follows git
// 2.54: with no direnv there is no door to shut, and the tests say so by name.
// CI names the direnvs it installed in MARTHA_TESTS_DIRENV, so a missing one
// is a red test there, never a door dropped in silence.

import { execFileSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/** The direnvs to prove, as paths joined by the PATH delimiter. Set by CI. */
export const DIRENVS_VARIABLE = 'MARTHA_TESTS_DIRENV'

/** The first direnv that knows DIRENV_DISABLE. */
export const DIRENV_DISABLE_SINCE: readonly [number, number] = [2, 38]

export interface Direnv {
  readonly path: string
  readonly version: string
  /** It stops outright on DIRENV_DISABLE; an older one only has the DIRENV_CONFIG fallback. */
  readonly knows_disable: boolean
}

export interface DirenvsUnderTest {
  readonly direnvs: readonly Direnv[]
  /** Paths named in MARTHA_TESTS_DIRENV that are not a direnv that runs. */
  readonly missing: readonly string[]
  /** Whether CI named the direnvs, so that each one must be there. */
  readonly named: boolean
}

function direnvAt(path: string): Direnv | undefined {
  try {
    const version = execFileSync(path, ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const [major, minor] = (/^(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number)
    if (major === undefined || minor === undefined) return undefined
    const [since_major, since_minor] = DIRENV_DISABLE_SINCE
    return { path, version, knows_disable: major > since_major || (major === since_major && minor >= since_minor) }
  } catch {
    return undefined
  }
}

function direnvOnPath(path_variable: string): string | undefined {
  return path_variable
    .split(delimiter)
    .filter((dir) => dir !== '')
    .map((dir) => join(dir, 'direnv'))
    .find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK)
        return true
      } catch {
        return false
      }
    })
}

/** The direnvs named in MARTHA_TESTS_DIRENV, or else the one on PATH, if any. */
export function direnvsUnderTest(env: Readonly<Record<string, string | undefined>>): DirenvsUnderTest {
  const named = env[DIRENVS_VARIABLE]
  const paths =
    named === undefined || named === ''
      ? [direnvOnPath(env.PATH ?? '')].filter((path): path is string => path !== undefined)
      : named.split(delimiter).filter((path) => path !== '')
  const found = paths.map((path) => ({ path, direnv: direnvAt(path) }))
  return {
    direnvs: found.flatMap(({ direnv }) => (direnv === undefined ? [] : [direnv])),
    missing: found.filter(({ direnv }) => direnv === undefined).map(({ path }) => path),
    named: named !== undefined && named !== '',
  }
}
