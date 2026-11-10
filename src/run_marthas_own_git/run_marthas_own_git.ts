// The settings every run of Martha's own git carries (martha#192).
//
// One list, spliced into the arguments at every place this repository starts git,
// so a setting added here reaches all of them and a call site cannot be written
// without them: `safe.bareRepository=explicit` refuses a directory a member planted
// a bare git directory in, and `core.fsmonitor=false` keeps fsmonitor from starting
// a program on a directory the member chose.
//
// It is deliberately not the member's environment. A bare checkout is a legitimate
// place for a member to work, so the launch's switches are the launch's business
// (../refuse_code_a_checkout_runs_itself); these are Martha's own runs alone.

/** The settings Martha's own git runs carry, as git names them. */
export const MARTHAS_OWN_GIT_SETTINGS: readonly (readonly [string, string])[] = [
  ['core.fsmonitor', 'false'],
  ['safe.bareRepository', 'explicit'],
]

/** The settings as the `-c <name>=<value>` words git takes them on its command line. */
export function marthasOwnGitSettingsArgs(): string[] {
  return MARTHAS_OWN_GIT_SETTINGS.flatMap(([name, value]) => ['-c', `${name}=${value}`])
}

/** git's arguments with Martha's own settings in front of them. */
export function marthasOwnGitArgs(args: readonly string[]): string[] {
  return [...marthasOwnGitSettingsArgs(), ...args]
}
