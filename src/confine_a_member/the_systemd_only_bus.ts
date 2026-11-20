// The session bus a member is given (martha#989, C4, C5): one that reaches systemd and nothing else, or none at all.
//
// This exists so a member does not reach the owner's desktop through the session bus (KDE Wallet, the Secret Service,
// any service there), while its podman can still ask systemd to place a container in a slice: a bus closed outright
// closes podman's systemd cgroup manager too. It is a port of crew-code's memberBusOf and busUnitUnlike
// (tests/away_from_the_desktop.mjs, THE SYSTEMD-ONLY BUS, macula-sponsors 6f353d51).
//
// The bus is xdg-dbus-proxy in front of the user's session bus, with `--filter` and one `--talk` rule,
// org.freedesktop.systemd1. Those two words are this file's constants, never the declaration's: systemd and nothing
// else is the control. The declaration names only the unit the proxy runs under and the socket it serves, which the
// lab host's own ci-systemd-bus.service already runs with the same command, so members and CI runners share one proxy.
// Where the proxy cannot be had (no runtime dir, no user manager, no xdg-dbus-proxy, no session bus to narrow), a member
// gets NO_DESKTOP_BUS, and the launch says why.
//
// A unit of the bus's name that already runs is trusted only when its process runs that one command (busUnitUnlike):
// otherwise a unit with a wider --talk, no --filter or an older command would reach every member while their address
// looks narrowed. The process is judged, never systemctl's ExecStart, which shows an installed unit's variables
// unexpanded.
//
// What this does not guard against, as crew-code says too: a member is the owner's OS user. The user manager starts a
// transient unit with its own environment, so a member that runs `systemd-run --user` through the proxy reaches the whole
// session bus, outside the slice. This guards against accident, not against a hostile member.

import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import type { AConfinement } from '../declare_crew/the_crews_confinement.ts'

/** An address no D-Bus client can connect to: /dev/null is not a directory, so the socket path cannot exist. */
export const NO_DESKTOP_BUS = 'unix:path=/dev/null/no-desktop-session-bus'

/** The variable a D-Bus client reads its session bus from. */
export const BUS_KEY = 'DBUS_SESSION_BUS_ADDRESS'

/** The one name a client may talk to through the proxy: the control itself, never a setting. */
export const SYSTEMD_TALK = 'org.freedesktop.systemd1'

/** The program that narrows the session bus to that name. */
export const PROXY = 'xdg-dbus-proxy'

/** The runtime dir's variable, and the two sockets under it a member's bus depends on. */
export const RUNTIME_DIR_KEY = 'XDG_RUNTIME_DIR'
export const USER_MANAGER_SOCKET = ['systemd', 'private'] as const
const SESSION_BUS_SOCKET = 'bus'

/** The systemd-only bus a member gets: its address, and the unit, socket and command that serve it. */
export interface ASystemdOnlyBus {
  readonly address: string
  readonly unit: string
  readonly socket: string
  readonly argv: readonly string[]
}

/** A bus closed outright: the closed address, and the line that says why. */
export interface AClosedBus {
  readonly address: typeof NO_DESKTOP_BUS
  readonly closed: string
}

export type AMemberBus = ASystemdOnlyBus | AClosedBus

const runtimeDirOf = (env: Readonly<Record<string, string | undefined>>): string | undefined => {
  const dir = env[RUNTIME_DIR_KEY]
  return dir === undefined || dir === '' ? undefined : dir
}

/** Whether a path is a socket now; a path that cannot be read is not one. */
export const isSocket = (path: string): boolean => {
  try {
    return statSync(path).isSocket()
  } catch {
    return false
  }
}

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** The first program of this name on the environment's PATH, or undefined. */
export const onPathOf = (name: string, env: Readonly<Record<string, string | undefined>>): string | undefined =>
  (env['PATH'] ?? '')
    .split(delimiter)
    .filter((dir) => dir !== '')
    .map((dir) => join(dir, name))
    .find(isExecutable)

/** Whether the user manager listens under this runtime dir: what `systemd-run --user` connects to. */
export const aUserManagerListensIn = (runtime_dir: string): boolean => isSocket(join(runtime_dir, ...USER_MANAGER_SOCKET))

/**
 * The bus a member gets in this environment, for the bus the declaration names: the systemd-only bus where it can be
 * had, else the closed address and why. The session bus the proxy narrows is the user's bus under the runtime dir,
 * whatever this environment's own bus variable says, so the command is the same wherever a launch starts.
 */
export function theMemberBusOf(env: Readonly<Record<string, string | undefined>>, bus: AConfinement['systemd_only_bus']): AMemberBus {
  const closed = (why: string): AClosedBus => ({
    address: NO_DESKTOP_BUS,
    closed: `this member's D-Bus is closed outright, not narrowed to systemd, because ${why}; podman cannot place a container in a systemd slice from it (martha#989)`,
  })
  const dir = runtimeDirOf(env)
  if (dir === undefined) return closed(`${RUNTIME_DIR_KEY} is unset, so there is no user manager to run the proxy under`)
  if (!aUserManagerListensIn(dir)) return closed(`no user manager listens at $${RUNTIME_DIR_KEY}/${USER_MANAGER_SOCKET.join('/')}`)
  const proxy = onPathOf(PROXY, env)
  if (proxy === undefined) return closed(`there is no ${PROXY} on PATH`)
  const session = join(dir, SESSION_BUS_SOCKET)
  if (!isSocket(session)) return closed(`no session bus listens at ${session}`)
  const socket = join(dir, bus.socket)
  return { address: `unix:path=${socket}`, unit: bus.unit, socket, argv: [proxy, `unix:path=${session}`, socket, '--filter', `--talk=${SYSTEMD_TALK}`] }
}

/** The real path of a file, or undefined when there is none: gone, or a program replaced under its running process. */
const realPathOf = (path: string): string | undefined => {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/** A running process as /proc shows it: the real path of its exe link (undefined when unreadable), and its cmdline words. */
export interface ARunningProcess {
  readonly program: string | undefined
  readonly words: readonly string[]
}

/**
 * Why a process is not the bus `argv` starts, or undefined when it is. The program must be the very file argv[0] names,
 * real path for real path, so a look-alike elsewhere or another program started with `exec -a` is refused; cmdline's
 * first word is only the name a process gives itself, so it is not judged. Every other word must be the same, no more
 * and no fewer. A proxy upgraded under its running process is refused too: stopping it and launching again is the safe
 * side.
 */
export function busUnitUnlike(argv: readonly string[], running: ARunningProcess): string | undefined {
  const wanted = argv.join(' ')
  const { program, words } = running
  if (program === undefined) return `runs no command that can be read, not \`${wanted}\``
  if (program !== realPathOf(argv[0] ?? '')) return `runs \`${words.join(' ')}\` as the program ${program}, not ${argv[0] ?? ''}`
  const same = words.length === argv.length && words.slice(1).every((word, i) => word === argv[i + 1])
  return same ? undefined : `runs \`${words.join(' ')}\`, not \`${wanted}\``
}
