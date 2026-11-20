// Opening the systemd-only bus (martha#989, C5, C6), with a stand-in systemctl and systemd-run and a stand-in /proc,
// as crew-code's own tests of bin/open-systemd-only-bus do. The lock is the real flock.

import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { openTheSystemdOnlyBus } from './open_the_systemd_only_bus.ts'
import { PROXY, SYSTEMD_TALK, type ASystemdOnlyBus } from './the_systemd_only_bus.ts'
import { SYSTEMD_RUN as PLACER } from './the_slice_and_the_scope.ts'

/** The pid the stand-in systemctl says the unit runs as, and the stand-in /proc holds. */
const MAIN_PID = '4242'

/** The stand-in systemctl: is-active, cat, start and show, each answered from files in the test's state dir. */
const SYSTEMCTL = `#!/bin/sh
state="$STANDIN_STATE"
printf 'systemctl %s\\n' "$*" >>"$state/calls"
shift
case "$1" in
  is-active) [ -e "$state/active" ]; exit $? ;;
  cat) [ -e "$state/installed" ]; exit $? ;;
  start) [ -e "$state/start-fails" ] && exit 1; : >"$state/active"; : >"$state/want-socket"; exit 0 ;;
  show) cat "$state/mainpid"; exit 0 ;;
esac
exit 2
`

/** The stand-in systemd-run: records its call and starts the unit, whose socket the test then opens. */
const SYSTEMD_RUN = `#!/bin/sh
state="$STANDIN_STATE"
printf 'systemd-run %s\\n' "$*" >>"$state/calls"
: >"$state/active"
: >"$state/want-socket"
exit 0
`

interface APlace {
  readonly bus: ASystemdOnlyBus
  readonly state: string
  readonly proc: string
  readonly env: Readonly<Record<string, string>>
  readonly calls: () => readonly string[]
  /** The stand-in /proc's process for MainPID, running these words with this program. */
  readonly runs: (program: string, words: readonly string[]) => void
}

function aProgram(at: string, text: string): string {
  writeFileSync(at, text)
  chmodSync(at, 0o755)
  return at
}

/** A place of the test's own, with a socket the test opens whenever a stand-in start asks for one. */
function aPlace(t: { after(fn: () => void): void }): APlace {
  const root = mkdtempSync(join(tmpdir(), 'martha-989-open-'))
  const bin = join(root, 'bin')
  const state = join(root, 'state')
  const proc = join(root, 'proc')
  const runtime = join(root, 'run')
  for (const dir of [bin, state, proc, runtime]) mkdirSync(dir)
  aProgram(join(bin, 'systemctl'), SYSTEMCTL)
  aProgram(join(bin, PLACER), SYSTEMD_RUN)
  const proxy = aProgram(join(bin, PROXY), '#!/bin/sh\nexit 0\n')
  const socket = join(runtime, 'tests-only-bus-socket')
  const bus: ASystemdOnlyBus = {
    address: `unix:path=${socket}`,
    unit: 'tests-only-bus',
    socket,
    argv: [proxy, `unix:path=${join(runtime, 'bus')}`, socket, '--filter', `--talk=${SYSTEMD_TALK}`],
  }
  writeFileSync(join(state, 'mainpid'), `${MAIN_PID}\n`)
  const servers: Server[] = []
  const watching = setInterval(() => {
    if (!existsSync(join(state, 'want-socket'))) return
    rmSync(join(state, 'want-socket'))
    const server = createServer()
    server.listen(socket)
    servers.push(server)
  }, 10)
  t.after(() => {
    clearInterval(watching)
    for (const server of servers) server.close()
    rmSync(root, { recursive: true, force: true })
  })
  const runs = (program: string, words: readonly string[]): void => {
    const at = join(proc, MAIN_PID)
    rmSync(at, { recursive: true, force: true })
    mkdirSync(at)
    symlinkSync(program, join(at, 'exe'))
    writeFileSync(join(at, 'cmdline'), `${words.join('\0')}\0`)
  }
  runs(proxy, bus.argv)
  return {
    bus,
    state,
    proc,
    env: { PATH: `${bin}:/usr/bin:/bin`, STANDIN_STATE: state },
    calls: () => (existsSync(join(state, 'calls')) ? readFileSync(join(state, 'calls'), 'utf8').trim().split('\n') : []),
    runs,
  }
}

const opened = (place: APlace): Promise<string | undefined> =>
  openTheSystemdOnlyBus(place.bus, { env: place.env, proc_root: place.proc, lock_wait_s: 5, socket_pause_ms: 20 })

/** A socket the test listens on before the open, as an installed unit's own socket would be. */
async function aSocketAlreadyThere(t: { after(fn: () => void): void }, path: string): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(path, resolve))
  t.after(() => server.close())
  return statSync(path).ino
}

test('#989 C6: with no unit of the name installed, a stale socket is removed and the command starts as a transient unit, then is judged', async (t) => {
  const place = aPlace(t)
  writeFileSync(place.bus.socket, 'a stale socket file a stopped proxy left behind')

  assert.equal(await opened(place), undefined)
  const calls = place.calls()
  assert.ok(calls.includes(`systemd-run --user --quiet --collect --unit=tests-only-bus.service -- ${place.bus.argv.join(' ')}`), `the transient unit was not started with the bus's command: ${calls.join(' | ')}`)
  assert.ok(statSync(place.bus.socket).isSocket(), 'the stale file was not replaced by the new proxy\'s socket')
  assert.equal(calls.at(-1), 'systemctl --user show -p MainPID --value tests-only-bus.service', 'the started unit was not judged once its socket appeared')
})

test('#989 C6: with a unit of the name installed, Martha starts that unit and leaves its socket alone, then judges it', async (t) => {
  const place = aPlace(t)
  writeFileSync(join(place.state, 'installed'), '')
  const before = await aSocketAlreadyThere(t, place.bus.socket)

  assert.equal(await opened(place), undefined)
  const calls = place.calls()
  assert.ok(calls.includes('systemctl --user start tests-only-bus.service'), `the installed unit was not started: ${calls.join(' | ')}`)
  assert.ok(!calls.some((call) => call.startsWith(PLACER)), 'a transient unit was started beside the installed one')
  assert.equal(statSync(place.bus.socket).ino, before, 'the installed unit\'s socket was removed')
  assert.equal(calls.at(-1), 'systemctl --user show -p MainPID --value tests-only-bus.service')
})

test('#989 C6: an installed unit that does not start refuses the launch by name', async (t) => {
  const place = aPlace(t)
  writeFileSync(join(place.state, 'installed'), '')
  writeFileSync(join(place.state, 'start-fails'), '')
  assert.match((await opened(place)) ?? '', /^tests-only-bus\.service: the installed systemd-only bus did not start/)
})

test('#989 C5: a unit already running the bus\'s command is used as it is: nothing is started and nothing removed', async (t) => {
  const place = aPlace(t)
  writeFileSync(join(place.state, 'active'), '')
  const before = await aSocketAlreadyThere(t, place.bus.socket)

  assert.equal(await opened(place), undefined)
  assert.deepEqual(place.calls(), ['systemctl --user is-active --quiet tests-only-bus.service', 'systemctl --user show -p MainPID --value tests-only-bus.service'])
  assert.equal(statSync(place.bus.socket).ino, before)
})

test('#989 C5: a squatter unit running another command is refused by name, with the stop that clears it', async (t) => {
  const place = aPlace(t)
  writeFileSync(join(place.state, 'active'), '')
  place.runs(place.bus.argv[0] ?? '', [...place.bus.argv.slice(0, 4), '--talk=org.freedesktop.secrets'])

  const refused = (await opened(place)) ?? ''
  assert.match(refused, /^tests-only-bus\.service runs `/)
  assert.ok(refused.includes('systemctl --user stop tests-only-bus.service'), `the refusal does not say how to clear it: ${refused}`)
})

test('#989 C5: a unit whose process cannot be read is refused, never passed', async (t) => {
  const place = aPlace(t)
  writeFileSync(join(place.state, 'active'), '')
  writeFileSync(join(place.state, 'mainpid'), '0\n')
  assert.match((await opened(place)) ?? '', /runs no command that can be read/)
})

test('#989 C6: two launches at once open one proxy', async (t) => {
  const place = aPlace(t)
  const both = await Promise.all([opened(place), opened(place)])

  assert.deepEqual(both, [undefined, undefined])
  assert.equal(place.calls().filter((call) => call.startsWith(PLACER)).length, 1, `more than one proxy was started: ${place.calls().join(' | ')}`)
})

test('#989 C6: a lock another launch holds past the wait refuses the launch by name', async (t) => {
  const place = aPlace(t)
  const holder = await import('node:child_process').then(({ spawn }) =>
    spawn('flock', ['--exclusive', `${place.bus.socket}.lock`, 'sh', '-c', 'echo held; exec cat >/dev/null'], { stdio: ['pipe', 'pipe', 'ignore'] }),
  )
  t.after(() => holder.stdin.end())
  await new Promise((resolve) => holder.stdout.once('data', resolve))

  const refused = await openTheSystemdOnlyBus(place.bus, { env: place.env, proc_root: place.proc, lock_wait_s: 1, socket_pause_ms: 20 })
  assert.match(refused ?? '', /^tests-only-bus\.service: another launch held .*\.lock for 1 s/)
  assert.deepEqual(place.calls(), [], 'the open went ahead without the lock')
})
