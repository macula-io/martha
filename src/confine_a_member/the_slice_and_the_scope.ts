// The slice a crew's members share, and the scope each member starts in (martha#989, C1, C2, C7, C8): the unit the
// launcher writes into the owner's user manager, and the `systemd-run --user --scope` words that place a member inside
// it with its own quota and weight.
//
// `--scope` runs its command in place: the pid the launcher records is the member's, and the process group the
// launcher ends is the member's own, so every check Martha already makes about a member's identity holds unchanged
// (C8). `--collect` collects the scope once the member ends, so a killed member leaves no unit behind.

import type { AConfinement } from '../declare_crew/the_crews_confinement.ts'

/** The program that places a member in its scope. */
export const SYSTEMD_RUN = 'systemd-run'

/** The unit every member's scope is named with, then the member's name and the launcher's pid. */
const THE_SCOPE_UNIT_PREFIX = 'martha-'

/** What the slice unit says it is, as the owner reads it in `systemctl --user status`. */
export const A_SLICE_UNIT_DESCRIPTION = 'Crew members and everything they start (Martha\'s own CPU ceiling)'

/**
 * The slice's unit, as the launcher writes it: one description, and the two values the declaration gave. Nothing here
 * is a number of its own, so the ceiling an owner reads in the unit is the one their declaration names.
 */
export function theSliceUnitOf(confinement: AConfinement): string {
  return [
    '[Unit]',
    `Description=${A_SLICE_UNIT_DESCRIPTION}`,
    '',
    '[Slice]',
    `CPUQuota=${confinement.slice_cpu_quota}`,
    `CPUWeight=${String(confinement.slice_cpu_weight)}`,
    '',
  ].join('\n')
}

/** The unit one member's scope is placed under: Martha's own prefix, the member, and the launcher's pid. */
export const theScopeUnitOf = (member: string, launcher_pid: number): string => `${THE_SCOPE_UNIT_PREFIX}${member}-${String(launcher_pid)}`

/** The words `systemd-run` places a command with: a scope of the member's own, in the declared slice. */
export interface AScope {
  readonly command: string
  readonly args: readonly string[]
  readonly unit: string
}

/**
 * The member's command, wrapped so it starts in a scope of its own inside the crew's slice: the scope is quiet and
 * collected, the environment is not expanded (a member's own `$` words reach it as written), and the two values are the
 * declaration's own. The command and its words come last, unchanged.
 */
export function theScopeWrapped(confinement: AConfinement, member: string, launcher_pid: number, command: string, args: readonly string[]): AScope {
  const unit = theScopeUnitOf(member, launcher_pid)
  return {
    command: SYSTEMD_RUN,
    args: [
      '--user',
      '--scope',
      '--quiet',
      '--collect',
      '--expand-environment=no',
      `--slice=${confinement.slice}`,
      `--unit=${unit}`,
      '-p',
      `CPUQuota=${confinement.member_cpu_quota}`,
      '-p',
      `CPUWeight=${String(confinement.member_cpu_weight)}`,
      command,
      ...args,
    ],
    unit,
  }
}
