// A member's start, confined (martha#989, gap 21 of #957): the one seam both host adapters call before they spawn a
// member, Claude Code's and martha-engine's alike.
//
// With a confinement declared, the member starts in a scope of its own inside the crew's slice, under the declared CPU
// quota and weight (C1, C2); the slice unit is the declaration's, written by the launcher alone and only when it differs
// (C7); the member's podman is the shim, first on its PATH (C3); and its session bus is the systemd-only bus, or none at
// all (C4-C6), set last in its environment so nothing composed before it overrides it. A ceiling that cannot be applied
// refuses the launch, naming why: it fails closed (C1). With none declared, the member starts as it did before, and the
// owner is told in one line that there is no ceiling and that the member's bus is the owner's whole desktop bus.
//
// `systemd-run --scope` runs the member in place (C8): the pid the adapter records is the member's own, its process group
// is unchanged, and its identity (when it started) is the same across the exec, so every check Martha makes about a
// member holds as before. systemd-run reaches the user manager through its private socket under the runtime dir, so the
// environment it runs with needs XDG_RUNTIME_DIR and no session bus: a member's environment that holds none (an engine's,
// which is exactly what the launch composed) gets it for systemd-run alone, and `env -u` takes it out again before the
// member runs. Nothing of the member's environment is put on a command line, where any user could read it.
//
// The residuals are crew-code's own, and said on martha#989: a member that runs podman by full path, or names its own
// --cgroup-parent, leaves the scope; one that runs `systemd-run --user` through the bus starts a unit outside the slice
// with the user manager's environment. This guards against a member that runs away, never against a hostile one.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import type { AConfinement } from '../declare_crew/the_crews_confinement.ts'
import { openTheSystemdOnlyBus, type TheOpenersPlaces } from './open_the_systemd_only_bus.ts'
import { putThePodmanShimIn } from './the_podman_shim.ts'
import { SYSTEMD_RUN, theScopeWrapped, theSliceUnitOf } from './the_slice_and_the_scope.ts'
import { aUserManagerListensIn, BUS_KEY, onPathOf, RUNTIME_DIR_KEY, theMemberBusOf } from './the_systemd_only_bus.ts'

/** The line a launch with no confinement declared says, once, at the member's start. */
export const NO_CONFINEMENT_DECLARED =
  'no confinement is declared for this crew (martha#989): the member runs under no CPU ceiling, and its D-Bus is the owner\'s whole desktop session bus'

/** The program that runs a command with a variable taken out. */
const ENV = 'env'

/** What a confined start is asked: the member, its command and environment, and the places the launch read. */
export interface AConfinedStartAsked {
  /** The crew's confinement as the declaration names it, or null when it names none. */
  readonly confinement: AConfinement | null
  readonly member: string
  /** The launcher's own pid: a member's scope is named with it, so two launches never share one. */
  readonly launcher_pid: number
  /** The launcher's own environment: where the runtime dir, the user manager and the session bus are read, and systemd-run found. */
  readonly inherited: Readonly<Record<string, string | undefined>>
  /** The member's command, its words and its environment, as the adapter composed them. */
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  /** The launch's own directory, where the podman shim is placed. */
  readonly launch_directory: string
  /** The owner's systemd user unit folder; the launcher's own reading of the environment unless a test gives one. */
  readonly unit_directory?: string
  /** What the bus's opener reads; a test points it at stand-ins. */
  readonly opener?: Omit<TheOpenersPlaces, 'env'>
}

/** A start the adapter spawns as it is: the command, its words, its environment, and the lines to tell the owner. */
export interface AConfinedStart {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly told: readonly string[]
}

/** The member's start, confined as the declaration asks, or why it cannot be (the launch is then refused). */
export async function theConfinedStart(asked: AConfinedStartAsked): Promise<AConfinedStart | { readonly refusal: string }> {
  const confinement = asked.confinement
  if (confinement === null) return { command: asked.command, args: asked.args, env: asked.env, told: [NO_CONFINEMENT_DECLARED] }
  const placers = thePlacersFound(confinement, asked.inherited)
  if ('refusal' in placers) return placers
  const tool_env = theToolsEnvironment(asked.inherited)
  const installed = theSliceInstalled(confinement, asked.unit_directory ?? theUnitDirectoryOf(asked.inherited), tool_env)
  if (installed !== undefined) return { refusal: installed }
  const bus = await theBusOpened(confinement, asked, tool_env)
  if ('refusal' in bus) return bus
  const shim = theShimPlaced(asked.launch_directory, asked.env['PATH'])
  if (typeof shim !== 'string') return shim
  const member = theMembersEnvironment(asked, placers, shim, bus.address)
  const wrapped = theScopeWrapped(confinement, asked.member, asked.launcher_pid, member.command, member.args)
  return { command: placers.systemd_run, args: wrapped.args, env: member.env, told: bus.told }
}

/** What places a member: the runtime dir a user manager listens under, and the systemd-run and env found on PATH. */
interface ThePlacers {
  readonly runtime_dir: string
  readonly systemd_run: string
  readonly env_program: string
}

/** The placers, or the refusal naming the one missing: a declared ceiling that cannot be applied fails closed (C1). */
function thePlacersFound(confinement: AConfinement, inherited: AConfinedStartAsked['inherited']): ThePlacers | { readonly refusal: string } {
  const declared = 'the crew declares a confinement, and'
  const runtime_dir = inherited[RUNTIME_DIR_KEY]
  if (runtime_dir === undefined || runtime_dir === '' || !aUserManagerListensIn(runtime_dir)) {
    return { refusal: `${declared} no user manager listens under $${RUNTIME_DIR_KEY} to place the member in ${confinement.slice}` }
  }
  const systemd_run = onPathOf(SYSTEMD_RUN, inherited)
  if (systemd_run === undefined) return { refusal: `${declared} there is no ${SYSTEMD_RUN} on PATH to place the member in ${confinement.slice}` }
  const env_program = onPathOf(ENV, inherited)
  if (env_program === undefined) return { refusal: `${declared} there is no ${ENV} on PATH to start the member with` }
  return { runtime_dir, systemd_run, env_program }
}

/** The member's bus: the systemd-only one, opened, or the closed one with the line that says why; or the opener's refusal. */
async function theBusOpened(
  confinement: AConfinement,
  asked: AConfinedStartAsked,
  tool_env: Readonly<Record<string, string>>,
): Promise<{ readonly address: string; readonly told: readonly string[] } | { readonly refusal: string }> {
  const bus = theMemberBusOf(asked.inherited, confinement.systemd_only_bus)
  if ('closed' in bus) return { address: bus.address, told: [bus.closed] }
  const refused = await openTheSystemdOnlyBus(bus, { ...asked.opener, env: tool_env })
  return refused === undefined ? { address: bus.address, told: [] } : { refusal: refused }
}

/** A member's command, its words and its environment, inside its scope. */
interface TheMembersCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/**
 * The member's command and environment inside its scope: the shim first on PATH, and the bus set last. An environment
 * with no runtime dir is lent one for systemd-run alone, and `env -u` takes it out again before the member runs.
 */
function theMembersEnvironment(asked: AConfinedStartAsked, placers: ThePlacers, shim: string, address: string): TheMembersCommand {
  const lent = asked.env[RUNTIME_DIR_KEY] === undefined
  const env = {
    ...Object.fromEntries(Object.entries(asked.env).filter(([key]) => key !== BUS_KEY)),
    PATH: [shim, asked.env['PATH'] ?? ''].filter((part) => part !== '').join(delimiter),
    ...(lent ? { [RUNTIME_DIR_KEY]: placers.runtime_dir } : {}),
    [BUS_KEY]: address,
  }
  return lent ? { command: placers.env_program, args: ['-u', RUNTIME_DIR_KEY, asked.command, ...asked.args], env } : { command: asked.command, args: asked.args, env }
}

/** The shim's folder, or the refusal: a member is never started with a bare podman (C3). */
function theShimPlaced(launch_directory: string, path: string | undefined): string | { readonly refusal: string } {
  try {
    return putThePodmanShimIn(launch_directory, path)
  } catch (error) {
    return { refusal: `the member's podman shim could not be placed in ${launch_directory} (${(error as NodeJS.ErrnoException).code ?? String(error)})` }
  }
}

/** The environment the launcher's own systemctl, systemd-run and flock run with: its own, without what is unset. */
function theToolsEnvironment(inherited: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(inherited).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

/** The owner's systemd user unit folder, as systemd reads it: $XDG_CONFIG_HOME, else ~/.config. */
function theUnitDirectoryOf(inherited: Readonly<Record<string, string | undefined>>): string {
  const config = inherited['XDG_CONFIG_HOME']
  return join(config !== undefined && config !== '' ? config : join(inherited['HOME'] ?? '', '.config'), 'systemd', 'user')
}

/**
 * Writes the slice unit when its content differs from the one the declaration composes, then reloads the user manager
 * (C7): crew-code's install_crew_slice. A unit already the same is left as it is, and nothing is reloaded.
 */
function theSliceInstalled(confinement: AConfinement, unit_directory: string, env: Readonly<Record<string, string>>): string | undefined {
  const at = join(unit_directory, confinement.slice)
  const wanted = theSliceUnitOf(confinement)
  if (theTextAt(at) === wanted) return undefined
  try {
    mkdirSync(unit_directory, { recursive: true })
    writeFileSync(at, wanted)
  } catch (error) {
    return `the crew's slice could not be written at ${at} (${(error as NodeJS.ErrnoException).code ?? String(error)})`
  }
  const reloaded = spawnSync('systemctl', ['--user', 'daemon-reload'], { env, stdio: 'ignore' })
  return reloaded.status === 0 ? undefined : `systemctl --user daemon-reload failed: ${confinement.slice} is written but not loaded`
}

const theTextAt = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}
