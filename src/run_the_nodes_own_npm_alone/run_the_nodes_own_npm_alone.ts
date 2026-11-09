// npm, run by the node that carries it, with nothing of the machine's own npm around it (martha#84).
//
// This exists so that whoever installed the bytes npm fetches cannot choose them by what they wrote into the
// machine: a user .npmrc, a project .npmrc above the directory, a registry variable, a preloaded module, an install
// script. It is one place, so the mesh server's install and the pinned installer's install cannot drift apart in
// what they isolate; SERVER_NEEDS and the installer's own allow-list stay with their callers, because which
// variables a *server* keeps is a different question from which ones npm is given.
//
// npm is given its own HOME (empty user and global config files, its own cache), the registry named explicitly,
// --ignore-scripts, at most no retry on a failed integrity, and an environment built from NPM_RUNS_WITH and
// nothing else: no npm_config_*, no NODE_*, no spread of the launcher's own environment.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

/** Where npm's own program sits beside the node that runs this: `<prefix>/bin/node` and `<prefix>/lib/node_modules/npm`. */
const NPM_CLI_FROM_PREFIX = ['lib', 'node_modules', 'npm', 'bin', 'npm-cli.js']

/**
 * The variables npm is given: HOME, where it keeps its config and cache, and PATH, which it looks for git and tar
 * on. Every other variable the launcher holds is left behind, so a name added to the machine's environment later
 * does not reach npm unreviewed.
 */
export const NPM_RUNS_WITH: readonly string[] = ['HOME', 'PATH']

/** The npm program that ships with this node. */
export function npmBesideNode(node: string = process.execPath): string {
  return join(dirname(dirname(node)), ...NPM_CLI_FROM_PREFIX)
}

export type Ran = { readonly ran: true } | { readonly ran: false; readonly why: string }

/** npm's own home for one run, made private: its empty config files and its cache live here, never under a user's. */
function freshNpmHome(npmHome: string): { readonly userConfig: string; readonly globalConfig: string } {
  mkdirSync(npmHome, { recursive: true, mode: 0o700 })
  // Two files: npm refuses to load one file as both.
  const [userConfig, globalConfig] = [join(npmHome, 'user-npmrc'), join(npmHome, 'global-npmrc')]
  for (const empty of [userConfig, globalConfig]) writeFileSync(empty, '')
  return { userConfig, globalConfig }
}

/** The settings that keep npm to the registry asked for, and to the bytes the lock names. */
function isolatedSettings(registry: string, dir: string, npmHome: string, configs: { readonly userConfig: string; readonly globalConfig: string }): string[] {
  return [
    `--userconfig=${configs.userConfig}`,
    `--globalconfig=${configs.globalConfig}`,
    `--registry=${registry}`,
    `--prefix=${dir}`,
    `--cache=${join(npmHome, 'cache')}`,
    // A tarball that fails its integrity is not fetched again: other bytes are refused at once.
    '--fetch-retries=0',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-update-notifier',
    '--loglevel=error',
  ]
}

/**
 * The environment npm is run with: a new object holding the names NPM_RUNS_WITH names, and nothing else. Never a
 * spread of the launcher's environment, which is what a planted NODE_OPTIONS or npm_config_* would ride in on.
 */
export function npmEnvironment(npmHome: string): Record<string, string> {
  const values: Record<string, string> = { HOME: npmHome, PATH: dirname(process.execPath) }
  return Object.fromEntries(NPM_RUNS_WITH.map((name) => [name, values[name] ?? '']))
}

/**
 * Runs npm in `dir` with no config, setting or install but the ones given here.
 * npm is given `dir`'s real path: it resolves its working directory through
 * links but not `--prefix`, and a prefix reached through a link (macOS's default
 * TMPDIR, /var -> /private/var) makes it key the lock by a path that climbs out
 * and back in (martha#79). `npm` is the program to run, the one beside this node
 * unless a test puts a stand-in in front of it.
 */
export function runIsolatedNpm(args: readonly string[], linkedDir: string, registry: string, npmHome: string, npm: string = npmBesideNode()): Ran {
  const dir = realpathSync(linkedDir)
  if (!existsSync(npm)) return { ran: false, why: `the npm of this node is not at ${npm}` }
  const configs = freshNpmHome(npmHome)
  const run = spawnSync(process.execPath, [npm, ...args, ...isolatedSettings(registry, dir, npmHome, configs)], {
    cwd: dir,
    env: npmEnvironment(npmHome),
    encoding: 'utf8',
  })
  if (run.status === 0) return { ran: true }
  return { ran: false, why: (run.stderr || run.error?.message || `npm ended with ${String(run.status)}`).trim() }
}
