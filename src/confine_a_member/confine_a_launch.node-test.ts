// A member's start, confined (martha#989): with a confinement declared, the member's command is wrapped in its scope,
// its PATH starts with the podman shim and its bus is the systemd-only bus (or the closed one, said why), set last; the
// slice unit is written only when it differs; and a ceiling that cannot be applied refuses the launch. With none
// declared, the start is the adapter's own and the owner is told in one line.

import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { AConfinement } from '../declare_crew/the_crews_confinement.ts'
import { NO_CONFINEMENT_DECLARED, theConfinedStart, type AConfinedStart, type AConfinedStartAsked } from './confine_a_launch.ts'
import { THE_SHIM_DIRECTORY_NAME } from './the_podman_shim.ts'
import { SYSTEMD_RUN, theSliceUnitOf } from './the_slice_and_the_scope.ts'
import { BUS_KEY, NO_DESKTOP_BUS, PROXY, RUNTIME_DIR_KEY } from './the_systemd_only_bus.ts'

/** A confinement none of whose values is the one `martha init` writes, so a default read would show. */
const DECLARED: AConfinement = {
  slice: 'tests.slice',
  slice_cpu_quota: '1234%',
  slice_cpu_weight: 21,
  member_cpu_quota: '321%',
  member_cpu_weight: 77,
  systemd_only_bus: { unit: 'tests-only-bus', socket: 'tests-only-bus-socket' },
}

/** The stand-in systemctl: daemon-reload counted, and the bus already running the command the test plants in /proc. */
const SYSTEMCTL = `#!/bin/sh
printf 'systemctl %s\\n' "$*" >>"$STANDIN_STATE/calls"
shift
case "$1" in
  daemon-reload) [ -e "$STANDIN_STATE/reload-fails" ] && exit 1; exit 0 ;;
  is-active) exit 0 ;;
  show) echo 4242; exit 0 ;;
esac
exit 2
`

interface APlace {
  readonly root: string
  readonly runtime: string
  readonly units: string
  readonly state: string
  readonly asked: (more?: Partial<AConfinedStartAsked>) => AConfinedStartAsked
  readonly calls: () => readonly string[]
}

function aProgram(at: string, text: string): string {
  writeFileSync(at, text)
  chmodSync(at, 0o755)
  return at
}

/** A place with a user manager and (unless asked otherwise) a session bus listening, a proxy, and the bus unit already running its command. */
async function aPlace(t: { after(fn: () => void): void }, { session = true } = {}): Promise<APlace> {
  const root = mkdtempSync(join(tmpdir(), 'martha-989-confine-'))
  const servers: ReturnType<typeof createServer>[] = []
  t.after(() => {
    for (const server of servers) server.close()
    rmSync(root, { recursive: true, force: true })
  })
  const [bin, state, proc, runtime, units, launch] = ['bin', 'state', 'proc', 'run', 'units', 'launch'].map((name) => join(root, name)) as [string, string, string, string, string, string]
  for (const dir of [bin, state, proc, join(runtime, 'systemd'), launch]) mkdirSync(dir, { recursive: true })
  for (const socket of [join(runtime, 'systemd', 'private'), ...(session ? [join(runtime, 'bus')] : []), join(runtime, DECLARED.systemd_only_bus.socket)]) {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(socket, resolve))
    servers.push(server)
  }
  aProgram(join(bin, 'systemctl'), SYSTEMCTL)
  aProgram(join(bin, SYSTEMD_RUN), '#!/bin/sh\nexit 0\n')
  {
    const program = aProgram(join(bin, PROXY), '#!/bin/sh\nexit 0\n')
    const argv = [program, `unix:path=${join(runtime, 'bus')}`, join(runtime, DECLARED.systemd_only_bus.socket), '--filter', '--talk=org.freedesktop.systemd1']
    mkdirSync(join(proc, '4242'))
    const { symlinkSync } = await import('node:fs')
    symlinkSync(program, join(proc, '4242', 'exe'))
    writeFileSync(join(proc, '4242', 'cmdline'), `${argv.join('\0')}\0`)
  }
  const inherited = { PATH: `${bin}:/usr/bin:/bin`, [RUNTIME_DIR_KEY]: runtime, STANDIN_STATE: state, [BUS_KEY]: 'unix:path=/the/owners/desktop/bus' }
  return {
    root,
    runtime,
    units,
    state,
    asked: (more = {}) => ({
      confinement: DECLARED,
      member: 'Vesta',
      launcher_pid: 4321,
      inherited,
      command: '/opt/the/member',
      args: ['--a-switch', '$NOT_EXPANDED'],
      env: { PATH: '/the/guard:/usr/bin', [RUNTIME_DIR_KEY]: runtime, [BUS_KEY]: 'unix:path=/the/owners/desktop/bus', A_MEMBERS_OWN: 'kept' },
      launch_directory: mkdtempSync(join(launch, 'one-launch-')),
      unit_directory: units,
      opener: { proc_root: proc, lock_wait_s: 2, socket_pause_ms: 20 },
      ...more,
    }),
    calls: () => (existsSync(join(state, 'calls')) ? readFileSync(join(state, 'calls'), 'utf8').trim().split('\n') : []),
  }
}

const started = (start: AConfinedStart | { readonly refusal: string }): AConfinedStart => {
  assert.ok(!('refusal' in start), `the start was refused: ${JSON.stringify(start)}`)
  return start
}

test('#989: with no confinement declared, the start is the adapter\'s own, and the owner is told of both the ceiling and the bus', async (t) => {
  const place = await aPlace(t)
  const asked = place.asked({ confinement: null })
  const start = started(await theConfinedStart(asked))

  assert.deepEqual(start, { command: asked.command, args: asked.args, env: asked.env, told: [NO_CONFINEMENT_DECLARED] })
  assert.match(NO_CONFINEMENT_DECLARED, /no CPU ceiling/)
  assert.match(NO_CONFINEMENT_DECLARED, /whole desktop session bus/)
})

test('#989 C1, C2, C8: a declared confinement wraps the member in its scope, with its own command and words last', async (t) => {
  const place = await aPlace(t)
  const start = started(await theConfinedStart(place.asked()))

  assert.equal(start.command, join(place.root, 'bin', SYSTEMD_RUN))
  const end = start.args.indexOf('--')
  assert.deepEqual(start.args.slice(0, end), ['--user', '--scope', '--quiet', '--collect', '--expand-environment=no', '--slice=tests.slice', '--unit=martha-Vesta-4321', '-p', 'CPUQuota=321%', '-p', 'CPUWeight=77'])
  assert.deepEqual(start.args.slice(end + 1), ['/opt/the/member', '--a-switch', '$NOT_EXPANDED'])
})

test('#989 C3, C4: the member\'s PATH starts with the shim, and its bus is the systemd-only one, set last; nothing else of its own changes', async (t) => {
  const place = await aPlace(t)
  const start = started(await theConfinedStart(place.asked()))

  assert.match(start.env['PATH'] ?? '', new RegExp(`^${join(place.root, 'launch')}/one-launch-[^/:]+/${THE_SHIM_DIRECTORY_NAME}:/the/guard:/usr/bin$`))
  assert.equal(start.env[BUS_KEY], `unix:path=${join(place.runtime, DECLARED.systemd_only_bus.socket)}`)
  assert.equal(Object.keys(start.env).at(-1), BUS_KEY, 'the bus is not the last thing the environment sets')
  assert.equal(start.env['A_MEMBERS_OWN'], 'kept')
  assert.deepEqual(start.told, [])
})

test('#989 C4: with no session bus to narrow, the member\'s bus is closed, and the owner is told why', async (t) => {
  const place = await aPlace(t, { session: false })
  const start = started(await theConfinedStart(place.asked()))

  assert.equal(start.env[BUS_KEY], NO_DESKTOP_BUS)
  assert.equal(start.told.length, 1)
  assert.match(start.told[0] ?? '', /no session bus listens at/)
})

test('#989: a member environment with no runtime dir gets one for systemd-run alone, taken out again before the member runs', async (t) => {
  const place = await aPlace(t)
  const start = started(await theConfinedStart(place.asked({ env: { PATH: '/usr/bin', HOME: '/the/engines/home' } })))

  assert.equal(start.env[RUNTIME_DIR_KEY], place.runtime)
  const end = start.args.indexOf('--')
  assert.deepEqual(start.args.slice(end + 2), ['-u', RUNTIME_DIR_KEY, '/opt/the/member', '--a-switch', '$NOT_EXPANDED'])
  assert.match(start.args[end + 1] ?? '', /\/env$/)
  assert.ok(!start.args.some((word) => word.includes('/the/engines/home')), 'the member\'s environment was put on a command line')
})

test('#989 C7: the slice unit is written with the declaration\'s values, and only when it differs; a failed reload refuses the launch', async (t) => {
  const place = await aPlace(t)
  started(await theConfinedStart(place.asked()))
  assert.equal(readFileSync(join(place.units, DECLARED.slice), 'utf8'), theSliceUnitOf(DECLARED))
  started(await theConfinedStart(place.asked({ launcher_pid: 4322 })))
  assert.equal(place.calls().filter((call) => call.includes('daemon-reload')).length, 1, 'the same unit was written and reloaded twice')

  writeFileSync(join(place.units, DECLARED.slice), 'an older copy\n')
  writeFileSync(join(place.state, 'reload-fails'), '')
  const refused = await theConfinedStart(place.asked({ launcher_pid: 4323 }))
  assert.ok('refusal' in refused)
  assert.match(refused.refusal, /daemon-reload failed: tests\.slice is written but not loaded/)
})

test('#989 C1: a declared confinement with no user manager to place the member refuses the launch, by name', async (t) => {
  const place = await aPlace(t)
  const refused = await theConfinedStart(place.asked({ inherited: { PATH: '/usr/bin', [RUNTIME_DIR_KEY]: join(place.root, 'nowhere') } }))
  assert.ok('refusal' in refused)
  assert.match(refused.refusal, /no user manager listens .* tests\.slice/)
})

test('#989 C5: a bus unit running another command refuses the launch, naming it', async (t) => {
  const place = await aPlace(t)
  writeFileSync(join(place.root, 'proc', '4242', 'cmdline'), 'xdg-dbus-proxy\0--talk=org.freedesktop.secrets\0')
  const refused = await theConfinedStart(place.asked())
  assert.ok('refusal' in refused)
  assert.match(refused.refusal, /^tests-only-bus\.service runs `/)
})
