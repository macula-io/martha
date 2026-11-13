// A checkout cannot run code of its own through a member's ordinary commands
// (martha#24, option 3).
//
// This exists so a repository a member works in cannot get code run with the
// member's full rights just because the member committed, installed or changed
// directory there, past every gate Martha has.
//
// The launch gate (../refuse_launch_of_unapproved_config) keeps the host from
// starting what a checkout's own config names. This covers what the member's
// ordinary commands start afterwards, with no model in the loop:
//
//   - GIT HOOKS. Every git the member runs gets, at command scope (above every
//     config file, the checkout's own included): `core.hooksPath` set to an
//     empty directory this launch made, `hook.<event>.enabled=false` for every
//     event git knows (git 2.54 and later also run hooks named in config, which
//     `core.hooksPath` does not govern), and `core.fsmonitor=false`, a hook in
//     all but name. They are appended to GIT_CONFIG_PARAMETERS, which git reads
//     after GIT_CONFIG_COUNT and after every file, so the last word is ours and
//     the owner's own command-scope settings are kept.
//   - NPM INSTALL. `npm_config_ignore_scripts=true`, and `npm_config_git=git`
//     so a checkout's .npmrc cannot name the program npm runs as git when it
//     fetches a git dependency. npm ranks its environment above every .npmrc, a
//     checkout's included, and every inherited spelling of either setting is
//     dropped so none can come after ours.
//   - .ENVRC. `DIRENV_DISABLE=1` stops direnv 2.38 and later outright. Older
//     direnv does not know it, so `DIRENV_CONFIG` also points at the empty
//     directory: no `direnv.toml`, so no whitelist trusts a directory wholesale
//     and no `.env` is loaded. What is left on an old direnv is an `.envrc` the
//     owner allowed by its exact content.
//
// These are set for every member the launcher starts, whoever wrote the
// checkout: the launcher cannot tell a checkout the crew wrote from one it did
// not, because a crew checkout pulls other people's commits.
//
// This slice only computes the settings. The launcher makes the empty directory
// they name (../switch_a_checkouts_hooks_off/empty_directory.ts), since making
// one is machine work a slice does not do.
//
// This is a partial measure, not a boundary. It closes the common doors; it
// does not stop code the member runs on purpose (`npm test`, `make`, a test
// runner), other tools that load a directory's files, or anything that already
// ran as this user, which can undo every setting here (A13). The pull request
// for martha#24 has the threat model.

import type { HostSwitches } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** Every hook event git documents in githooks(5). A test reads the installed git's page and fails on one missing here. */
export const GIT_HOOK_EVENTS = [
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'pre-receive',
  'update',
  'proc-receive',
  'post-receive',
  'post-update',
  'reference-transaction',
  'push-to-checkout',
  'pre-auto-gc',
  'post-rewrite',
  'sendemail-validate',
  'fsmonitor-watchman',
  'p4-changelist',
  'p4-prepare-changelist',
  'p4-post-changelist',
  'p4-pre-submit',
  'post-index-change',
] as const

/** The variable git reads its command-scope settings from last. */
export const GIT_SETTINGS_VARIABLE = 'GIT_CONFIG_PARAMETERS'

/** npm's settings, as its environment spells them. */
export const NPM_SCRIPTS_OFF_VARIABLE = 'npm_config_ignore_scripts'
export const NPM_GIT_VARIABLE = 'npm_config_git'
const NPM_PREFIX = /^npm_config_/i

/** The program npm runs as git, found on the member's own PATH. */
const GIT_PROGRAM = 'git'

/** What the launcher sets, by the variable npm reads it from. */
const NPM_SETTINGS: Readonly<Record<string, string>> = {
  [NPM_SCRIPTS_OFF_VARIABLE]: 'true',
  [NPM_GIT_VARIABLE]: GIT_PROGRAM,
}

export const DIRENV_OFF_VARIABLE = 'DIRENV_DISABLE'
export const DIRENV_CONFIG_VARIABLE = 'DIRENV_CONFIG'

/** The git settings that run no hook, given the empty directory hooks are looked for in. */
export function gitSettingsThatRunNoHook(empty_directory: string): readonly (readonly [string, string])[] {
  return [
    ['core.hooksPath', empty_directory],
    ['core.fsmonitor', 'false'],
    ...GIT_HOOK_EVENTS.map((event) => [`hook.${event}.enabled`, 'false'] as const),
  ]
}

/** Quotes one word as git's sq_quote_buf does: `'` and `!` leave the quotes. */
export function gitQuoted(word: string): string {
  return `'${word.replaceAll("'", "'\\''").replaceAll('!', "'\\!'")}'`
}

/** The name npm reads an environment variable as, or `undefined` for one npm does not read. */
export function npmSettingOf(name: string): string | undefined {
  if (!NPM_PREFIX.test(name)) return undefined
  return name.slice('npm_config_'.length).replace(/(?!^)_/g, '-').toLowerCase()
}

/**
 * The environment that keeps a checkout from running code through a member's
 * ordinary commands, on top of `inherited`: for `launchEnvironment`.
 */
export function switchesThatRunNothingFromACheckout(
  inherited: Readonly<Record<string, string | undefined>>,
  empty_directory: string,
): HostSwitches {
  const ours = gitSettingsThatRunNoHook(empty_directory)
    .map(([key, value]) => `${gitQuoted(key)}=${gitQuoted(value)}`)
    .join(' ')
  const before = inherited[GIT_SETTINGS_VARIABLE]
  const forced = new Set(Object.keys(NPM_SETTINGS).map(npmSettingOf))
  return {
    args: [],
    env: {
      [GIT_SETTINGS_VARIABLE]: before === undefined || before === '' ? ours : `${before} ${ours}`,
      ...NPM_SETTINGS,
      [DIRENV_OFF_VARIABLE]: '1',
      [DIRENV_CONFIG_VARIABLE]: empty_directory,
    },
    env_dropped: Object.keys(inherited).filter((name) => forced.has(npmSettingOf(name))),
  }
}
