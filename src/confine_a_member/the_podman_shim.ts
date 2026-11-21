// The podman a member runs (martha#989, the port of crew-code's `bin/member/podman`): a container the member creates
// stays in the member's own scope in the crew's slice, under the crew's ceiling.
//
// Rootless podman otherwise puts every container in the user manager's own slice, outside any ceiling. Only `run` and
// `create` (also as `container run|create`) are touched, and only when the call makes no placement choice of its own: a
// call with `--cgroup-parent` (a gate's `ci-runners.slice`, say) or `--cgroups` goes through unchanged, since podman
// refuses `--cgroups=split` beside a parent. Everything else is handed to the real podman as it came.
//
// The real podman is resolved once, by the launcher, to the first program of that name on the member's inherited PATH
// after the shim's own directory, by real path, and its path is baked into the shim: a member that runs a different
// podman by full path, or that names its own `--cgroup-parent`, leaves the ceiling, which crew-code allows for the same
// reason. A launch that finds no podman at all still places the shim, which then says so and exits 127.

import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { realpathSync } from 'node:fs'

/** The folder the shim sits in, beside the git guard: first on the member's PATH. */
export const THE_SHIM_DIRECTORY_NAME = 'podman-shim'

/** The program's name: what a member's `podman` resolves to. */
export const THE_SHIM_NAME = 'podman'

/** The one word the shim adds to a call that places nothing: the container joins the caller's own scope. */
export const THE_CGROUP_FLAG = '--cgroups=split'

/** What the shim says when nothing on the member's PATH is a podman to hand a call to, exit 127 as a shell does. */
export const NO_PODMAN = 'martha podman: no podman on PATH after'

/** Reads and writes for the owner, and run for it: a shim no other member may change. */
const THE_SHIM_MODE = 0o555

const singleQuoted = (word: string): string => `'${word.replaceAll("'", `'\''`)}'`

/**
 * The first program named `podman` on this PATH, by real path, skipping every directory that leads to `the_shim_dir`
 * itself: the shim's own folder, or a link to it that a PATH held twice. Undefined when nothing on it is a program.
 */
export function theRealPodmanOnThisMachine(path: string | undefined, the_shim_dir: string): string | undefined {
  const the_shim = join(realpathOfDirectory(the_shim_dir), '')
  for (const directory of (path ?? '').split(delimiter)) {
    if (directory === '') continue
    const real = theProgramAt(join(directory, THE_SHIM_NAME))
    if (real === undefined || real.startsWith(the_shim)) continue
    return real
  }
  return undefined
}

/** The program a path names, by its real path, or undefined when nothing runnable is there. */
function theProgramAt(candidate: string): string | undefined {
  try {
    const real = realpathSync(candidate)
    const found = statSync(real)
    return found.isFile() && (found.mode & 0o111) !== 0 ? real : undefined
  } catch {
    return undefined
  }
}

/** A directory's real path, or the directory as it was given when it cannot be read (it is about to be made). */
const realpathOfDirectory = (directory: string): string => {
  try {
    return realpathSync(directory)
  } catch {
    return directory
  }
}

/**
 * The shim's own text, as the shell runs it: crew-code's `bin/member/podman` ported, with the real podman baked in and
 * no PATH scan at run time. `real` undefined writes the shim that names the shim's own directory and exits 127.
 */
export function thePodmanShimFor(real: string | undefined, the_shim_dir: string): string {
  if (real === undefined) {
    return [
      '#!/bin/sh',
      `# Martha's podman shim (martha#989): no podman was found on this member's PATH when it was placed.`,
      `printf '%s\n' ${singleQuoted(`${NO_PODMAN} ${the_shim_dir}`)} >&2`,
      'exit 127',
      '',
    ].join('\n')
  }
  const podman = singleQuoted(real)
  return [
    '#!/bin/bash',
    `# Martha's podman shim (martha#989, crew-code's bin/member/podman): a container a member creates stays in the`,
    `# member's own scope in the crew's slice, under the crew's CPU ceiling.`,
    'set -euo pipefail',
    `real=${podman}`,
    'args=("$@")',
    'for arg in "${args[@]}"; do',
    '    case "${arg}" in',
    `        --cgroup-parent | --cgroup-parent=* | --cgroups | --cgroups=*) exec "\${real}" "\${args[@]}" ;;`,
    '    esac',
    'done',
    '',
    '# The subcommand: the first argument that is not a global option, then `container`\'s own.',
    'i=0',
    'while ((i < ${#args[@]})) && [[ "${args[i]}" == -* ]]; do i=$((i + 1)); done',
    'if ((i < ${#args[@]})) && [[ "${args[i]}" == container ]]; then i=$((i + 1)); fi',
    `if ((i < \${#args[@]})) && [[ "\${args[i]}" == run || "\${args[i]}" == create ]]; then`,
    `    exec "\${real}" "\${args[@]:0:i+1}" ${THE_CGROUP_FLAG} "\${args[@]:i+1}"`,
    'fi',
    'exec "${real}" "${args[@]}"',
    '',
  ].join('\n')
}

/** Where a launch's shim directory is, under its relay directory. */
export const theShimDirectoryIn = (relayDirectory: string): string => join(relayDirectory, THE_SHIM_DIRECTORY_NAME)

/**
 * Places the shim in the launch's relay directory, for the real podman found on `path` (or for none): what the member's
 * `podman` is. A launch whose shim cannot be placed is refused by the caller, never started with a bare podman.
 */
export function putThePodmanShimIn(relayDirectory: string, path: string | undefined): string {
  const directory = theShimDirectoryIn(relayDirectory)
  mkdirSync(directory, { mode: 0o700 })
  const real = theRealPodmanOnThisMachine(path, directory)
  writeFileSync(join(directory, THE_SHIM_NAME), thePodmanShimFor(real, directory), { flag: 'wx', mode: THE_SHIM_MODE })
  chmodSync(join(directory, THE_SHIM_NAME), THE_SHIM_MODE)
  return directory
}
