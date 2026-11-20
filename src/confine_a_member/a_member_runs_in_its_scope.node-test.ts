// A member started through the confined start runs, live, in a scope of its own inside the declared slice, under the
// member's CPU ceiling, with its pid the member's own; killing its group ends the scope, and `--collect` takes the
// scope away (martha#989, C1, C2 and C8, on a real user manager).
//
// This needs what the owner's host has and a hosted runner may not: a user manager under the runtime dir systemd gives
// this user, and systemd-run, systemctl and env on PATH. Where any is missing the test is skipped by name, saying which.
// The runtime dir is read where systemd puts it, /run/user/<uid>, because the suite's runner points $XDG_RUNTIME_DIR at
// a root of the run's own (keep_a_test_run_in_one_temporary_root.ts).
//
// It touches nothing of the owner's: the slice unit the declaration composes is written beforehand, unchanged, in a
// unit folder of the test's own, so the confined start writes no unit and reloads no manager; systemd makes the
// test-named slice on demand and drops it once it is empty. The member's PATH holds no xdg-dbus-proxy, so its bus is the
// closed one and no bus unit is started. The test stops its own scope and slice, and removes its folder, whatever happens.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getuid } from 'node:process'
import { test } from 'node:test'

import type { AConfinement } from '../declare_crew/the_crews_confinement.ts'
import { theConfinedStart } from './confine_a_launch.ts'
import { SYSTEMD_RUN, theScopeUnitOf, theSliceUnitOf } from './the_slice_and_the_scope.ts'
import { aUserManagerListensIn, BUS_KEY, NO_DESKTOP_BUS, onPathOf, RUNTIME_DIR_KEY } from './the_systemd_only_bus.ts'

/** The programs the live run needs on PATH: the placer, the manager's own client, the env the start runs through, and the member. */
const THE_PROGRAMS = [SYSTEMD_RUN, 'systemctl', 'env', 'sleep'] as const

/** How long the test waits for the scope to appear, or to be gone. */
const THE_WAIT_MS = 5_000

/** A member's own name for the scope: the test's, so no real member's scope is ever named. */
const THE_MEMBER = 'live989'

/** The runtime dir systemd gives this user, where its user manager listens. */
const THE_USERS_RUNTIME_DIR = join('/run/user', String(getuid?.() ?? ''))

/** What this host lacks for a live run, or undefined when it has all of it. */
function whatThisHostLacks(): string | undefined {
  if (process.platform !== 'linux') return `this host is ${process.platform}, not linux`
  if (!aUserManagerListensIn(THE_USERS_RUNTIME_DIR)) return `no user manager listens under ${THE_USERS_RUNTIME_DIR}`
  const missing = THE_PROGRAMS.filter((program) => onPathOf(program, process.env) === undefined)
  return missing.length === 0 ? undefined : `there is no ${missing.join(', ')} on PATH`
}

const lacks = whatThisHostLacks()

/** The environment the test's own systemctl runs with: the user's runtime dir, where its manager listens. */
const THE_MANAGERS_ENV = { ...process.env, [RUNTIME_DIR_KEY]: THE_USERS_RUNTIME_DIR }

/** A unit's one property, as the user manager reports it. */
const propertyOf = (unit: string, property: string): string =>
  spawnSync('systemctl', ['--user', 'show', '--value', `--property=${property}`, unit], { encoding: 'utf8', env: THE_MANAGERS_ENV }).stdout.trim()

/** Waits until `holds` says yes, or the wait is over; says which. */
async function until(holds: () => boolean): Promise<boolean> {
  for (let waited = 0; waited < THE_WAIT_MS; waited += 50) {
    if (holds()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return holds()
}

/** The test's own place: its folder, the programs on its PATH (and no xdg-dbus-proxy), and its slice unit already written. */
function aLivePlace(): { readonly root: string; readonly bin: string; readonly units: string; readonly confinement: AConfinement } {
  const root = mkdtempSync(join(tmpdir(), 'martha-989-live-'))
  const confinement: AConfinement = {
    slice: `martha_989_live_${String(process.pid)}.slice`,
    slice_cpu_quota: '200%',
    slice_cpu_weight: 30,
    member_cpu_quota: '150%',
    member_cpu_weight: 40,
    systemd_only_bus: { unit: 'martha-989-live-bus', socket: 'martha-989-live-bus' },
  }
  const bin = join(root, 'bin')
  const units = join(root, 'units')
  mkdirSync(bin)
  mkdirSync(units)
  // The programs the run needs, and no xdg-dbus-proxy: the member's bus is the closed one, and nothing else is started.
  for (const program of THE_PROGRAMS) symlinkSync(onPathOf(program, process.env) ?? program, join(bin, program))
  writeFileSync(join(units, confinement.slice), theSliceUnitOf(confinement))
  return { root, bin, units, confinement }
}

test(`#989 live: a member runs in its own scope inside the declared slice, and its scope goes with its group${lacks === undefined ? '' : ` (skipped: ${lacks})`}`, { skip: lacks }, async (t) => {
  const { root, bin, units, confinement } = aLivePlace()
  const scope = `${theScopeUnitOf(THE_MEMBER, process.pid)}.scope`
  let group: number | undefined
  t.after(() => {
    if (group !== undefined) {
      try {
        process.kill(-group, 'SIGKILL')
      } catch {
        // already gone
      }
    }
    // One unit per stop: a stop naming a unit already gone (the collected scope) fails whole and would leave the slice.
    for (const unit of [scope, confinement.slice]) spawnSync('systemctl', ['--user', 'stop', unit], { stdio: 'ignore', env: THE_MANAGERS_ENV })
    rmSync(root, { recursive: true, force: true })
  })

  const inherited = { PATH: bin, [RUNTIME_DIR_KEY]: THE_USERS_RUNTIME_DIR, HOME: root }
  const start = await theConfinedStart({
    confinement,
    member: THE_MEMBER,
    launcher_pid: process.pid,
    inherited,
    command: join(bin, 'sleep'),
    args: ['300'],
    env: { PATH: bin },
    launch_directory: root,
    unit_directory: units,
  })
  assert.ok(!('refusal' in start), `the confined start was refused on a host that has all it needs: ${JSON.stringify(start)}`)
  assert.equal(start.env[BUS_KEY], NO_DESKTOP_BUS, 'the member was given a bus, with no proxy to narrow it')
  assert.equal(readFileSync(join(units, confinement.slice), 'utf8'), theSliceUnitOf(confinement), 'the slice unit the test wrote was changed')

  const member = spawn(start.command, start.args, { env: start.env, detached: true, stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    member.once('spawn', resolve)
    member.once('error', reject)
  })
  const pid = member.pid
  assert.ok(pid !== undefined, 'the member gave no pid')
  group = pid
  const exited = new Promise<void>((resolve) => member.once('exit', () => resolve()))

  assert.ok(await until(() => propertyOf(scope, 'ActiveState') === 'active'), `the scope ${scope} never became active`)
  assert.equal(propertyOf(scope, 'Slice'), confinement.slice, 'the scope is not in the declared slice')
  assert.equal(propertyOf(scope, 'CPUQuotaPerSecUSec'), '1.500000s', 'the scope does not hold the member\'s declared CPU quota')
  assert.equal(propertyOf(scope, 'CPUWeight'), String(confinement.member_cpu_weight), 'the scope does not hold the member\'s declared CPU weight')
  // systemd-run runs the member in place: the pid the launcher records is the member's own, in the scope's cgroup.
  assert.ok(readFileSync(`/proc/${String(pid)}/cgroup`, 'utf8').includes(`/${confinement.slice}/${scope}`), 'the member\'s own pid is not in its scope')
  assert.equal(readFileSync(`/proc/${String(pid)}/comm`, 'utf8').trim(), 'sleep', 'the recorded pid is not the member\'s own process')

  process.kill(-pid, 'SIGKILL')
  await exited
  group = undefined
  assert.ok(await until(() => propertyOf(scope, 'LoadState') === 'not-found'), `the scope ${scope} outlived its group: --collect did not take it away`)
})
