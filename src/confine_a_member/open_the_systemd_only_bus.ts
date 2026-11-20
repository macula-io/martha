// Opens the systemd-only bus for a crew's members (martha#989, C5, C6): a port of crew-code's
// bin/open-systemd-only-bus (macula-sponsors 6f353d51).
//
// The bus runs once per user and every member shares it, so a unit of its name that already runs is used, but only when
// its process runs that one command (busUnitUnlike, ./the_systemd_only_bus.ts). Where none runs, the installed user unit
// is started if there is one: the lab host installs ci-systemd-bus.service for its CI runners, and its own ExecStartPre
// clears a stale socket, so Martha never touches that socket. Otherwise the same command starts as a transient unit of
// that name: a stopped proxy leaves its socket file behind, so it is removed first and the wait sees the new proxy's
// socket, never the old one (`--collect` lets a failed unit go, so its name is free). Both start paths judge the process
// again once the socket appears.
//
// All of it runs under one lock beside the socket: two launches that both found the unit inactive would otherwise both
// clear the socket, and the second would remove the one the first had just opened, which breaks podman for every member.
// Node has no flock of its own, so the lock is held by a `flock` child for as long as the open runs; it is released when
// that child's stdin closes, which a launcher that dies mid-open closes too.
//
// Every refusal names the unit and what to do: a launch with a declared confinement whose bus cannot be opened, or is
// held by another command, is refused, never started on a wider bus (fails closed).

import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { readFileSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { busUnitUnlike, isSocket, type ARunningProcess, type ASystemdOnlyBus } from './the_systemd_only_bus.ts'

/** How long a launch waits for another to finish opening the bus, in seconds (crew-code's LOCK_WAIT). */
export const LOCK_WAIT_S = 10

/** How many times, and how far apart, a launch looks for the proxy's socket (crew-code's SOCKET_TRIES and SOCKET_PAUSE). */
export const SOCKET_TRIES = 50
export const SOCKET_PAUSE_MS = 100

/** Where processes are read; a test points it at a stand-in /proc beside its stand-in systemctl, as crew-code's do. */
export const PROC_ROOT = '/proc'

/** The suffix of the lock file beside the socket. */
const LOCK_SUFFIX = '.lock'

/** The type systemd gives the bus's unit: the declaration names the unit alone. */
const SERVICE = '.service'

/** What the opener reads its programs and processes from: the environment that finds systemctl, and the /proc to read. */
export interface TheOpenersPlaces {
  readonly env: Readonly<Record<string, string>>
  readonly proc_root?: string
  /** Lock and socket waits, each the opener's own constant unless a test gives a shorter one. */
  readonly lock_wait_s?: number
  readonly socket_pause_ms?: number
}

/** Why the bus could not be opened for the members, or undefined when it is open and runs the one command. */
export async function openTheSystemdOnlyBus(bus: ASystemdOnlyBus, places: TheOpenersPlaces): Promise<string | undefined> {
  const unit = `${bus.unit}${SERVICE}`
  const lock = await theLockHeld(`${bus.socket}${LOCK_SUFFIX}`, places)
  if (typeof lock === 'string') return `${unit}: ${lock}`
  try {
    return await openedUnderTheLock(bus, unit, places)
  } finally {
    lock.release()
  }
}

/** The open itself, once the lock is held: judge a running unit, or start one and judge it once its socket appears. */
async function openedUnderTheLock(bus: ASystemdOnlyBus, unit: string, places: TheOpenersPlaces): Promise<string | undefined> {
  const systemctl = (...args: string[]): SpawnSyncReturns<string> => run(places, 'systemctl', ['--user', ...args])
  if (systemctl('is-active', '--quiet', unit).status === 0) return theOneCommandRefused(bus, unit, places)
  if (systemctl('cat', unit).status === 0) {
    if (systemctl('start', unit).status !== 0) return `${unit}: the installed systemd-only bus did not start for the members`
  } else {
    rmSync(bus.socket, { force: true })
    const started = run(places, 'systemd-run', ['--user', '--quiet', '--collect', `--unit=${unit}`, '--', ...bus.argv])
    if (started.status !== 0) return `${unit}: systemd-run could not start the systemd-only bus for the members`
  }
  const pause = places.socket_pause_ms ?? SOCKET_PAUSE_MS
  for (let tries = 0; tries < SOCKET_TRIES; tries++) {
    if (isSocket(bus.socket)) return theOneCommandRefused(bus, unit, places)
    await new Promise((resolve) => setTimeout(resolve, pause))
  }
  return `${unit}: the systemd-only bus did not open ${bus.socket} within ${String((SOCKET_TRIES * pause) / 1000)} s`
}

/**
 * Why the unit's process is not this bus's one command, with the command that clears it, or undefined when it is. No
 * process, or one gone before it was read, runs no words: the unit is refused, never passed.
 */
function theOneCommandRefused(bus: ASystemdOnlyBus, unit: string, places: TheOpenersPlaces): string | undefined {
  const shown = run(places, 'systemctl', ['--user', 'show', '-p', 'MainPID', '--value', unit])
  if (shown.status !== 0) return `${unit}: systemctl could not show its process`
  const why = busUnitUnlike(bus.argv, theProcessOf(shown.stdout.trim(), places.proc_root ?? PROC_ROOT))
  if (why === undefined) return undefined
  return `${unit} ${why}: members would reach more than systemd through it while their address looks narrowed. Stop it (systemctl --user stop ${unit}) and launch again (martha#989)`
}

/** The process a MainPID names, as /proc shows it; nothing readable when the pid is not one or the process is gone. */
function theProcessOf(pid: string, proc_root: string): ARunningProcess {
  if (!/^[1-9][0-9]*$/.test(pid)) return { program: undefined, words: [] }
  try {
    const program = realpathSync(join(proc_root, pid, 'exe'))
    const words = readFileSync(join(proc_root, pid, 'cmdline'), 'utf8').split('\0')
    if (words.at(-1) === '') words.pop()
    return { program, words }
  } catch {
    return { program: undefined, words: [] }
  }
}

/** One program, found on the opener's PATH, run to its end. */
const run = (places: TheOpenersPlaces, program: string, args: readonly string[]): SpawnSyncReturns<string> =>
  spawnSync(program, args, { env: places.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** A lock held by a `flock` child, released by ending it. */
interface AHeldLock {
  readonly release: () => void
}

/** The word the lock's child prints once it holds the lock. */
const HELD = 'held'

/** Holds the lock beside the socket, or says why it could not within the wait. */
async function theLockHeld(lock_path: string, places: TheOpenersPlaces): Promise<AHeldLock | string> {
  const wait = places.lock_wait_s ?? LOCK_WAIT_S
  const child = spawn('flock', ['--exclusive', '--wait', String(wait), lock_path, 'sh', '-c', `echo ${HELD}; exec cat >/dev/null`], {
    env: places.env,
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  const release = (): void => {
    child.stdin.end()
  }
  const held = await new Promise<boolean>((resolve) => {
    let said = ''
    child.stdout.on('data', (chunk: Buffer) => {
      said += chunk.toString()
      if (said.includes(HELD)) resolve(true)
    })
    child.once('error', () => resolve(false))
    child.once('exit', () => resolve(false))
  })
  if (held) return { release }
  release()
  return `another launch held ${lock_path} for ${String(wait)} s while opening the systemd-only bus, or flock could not be run`
}
