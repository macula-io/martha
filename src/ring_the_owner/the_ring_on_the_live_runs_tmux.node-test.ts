// The ring on the live run's own tmux, run for real (martha#843): a pane rings as a launcher inside tmux does, a client is
// attached the way the owner attaches, and what that client is sent is read byte for byte. The live run's bounds are read
// from the live run script itself (LIVE_RUN_TMUX_BOUNDS, LIVE_RUN_PASSTHROUGH_OFF, LIVE_RUN_WATCH_ATTACH), so a change there is a
// change here.
//
// Each case serves its own tmux server on a socket in a short directory of its own, and kills it when it ends. A case
// that shows something did NOT reach the client waits for a line the pane prints after it: tmux hands a client the
// pane's bytes in order, so once that line is drawn, anything sent before it would have arrived.
//
// A runner with no tmux or no `script` skips these, except where MARTHA_TESTS_TMUX_REQUIRED is set: there a missing
// tool fails by name, and MARTHA_TESTS_TMUX_VERSION, when set, must be the tmux that answers (the live run's pinned 3.3a,
// in CI's job for it).

import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { EDIT_TOOL } from '../claude_code_host/claude_code_file_tools.ts'
import { shortRelayRoot } from '../drive_the_recorded_host/short_relay_root.ts'
import { notificationIdOf, NOTIFICATION_ESCAPE } from './ring_the_owner.ts'

const REPO = join(import.meta.dirname, '..', '..')
const PROOF = join(REPO, 'prove_a_clean_install_in_a_throwaway_container', 'prove_a_clean_install_in_a_throwaway_container.sh')
const MEMBER = 'Venus'
/** What a client is sent when a pane sets the clipboard: the start of an OSC 52. */
const CLIPBOARD_ESCAPE = '\u001b]52;'
/** How long a case waits for a client, or for a byte, before it fails by name. */
const WAIT_MS = 15_000
const POLL_MS = 50
const SIZE = ['-x', '80', '-y', '24']

/** One array of the live run script, as the live run itself reads it. */
function theLiveRuns(name: string): string[] {
  const read = spawnSync('bash', ['-c', `. "$1" && printf '%s\\0' "\${${name}[@]}"`, 'read', PROOF], { encoding: 'utf8' })
  assert.equal(read.status, 0, `the live run script could not be read for ${name}: ${read.stderr}`)
  return read.stdout.split('\0').slice(0, -1)
}

/** Whether `tool` answers on this runner. */
const answers = (tool: string, ...args: string[]): boolean => spawnSync(tool, args, { stdio: 'ignore' }).status === 0

/** Skips the case on a runner without tmux or script, or fails it by name where they are required. */
function needsTmux(t: TestContext): boolean {
  const required = process.env.MARTHA_TESTS_TMUX_REQUIRED === '1'
  for (const [tool, args] of [['tmux', ['-V']], ['script', ['--version']]] as const) {
    if (answers(tool, ...args)) continue
    assert.ok(!required, `${tool} is required here (MARTHA_TESTS_TMUX_REQUIRED) and does not answer`)
    t.skip(`no ${tool} on this runner`)
    return false
  }
  const version = process.env.MARTHA_TESTS_TMUX_VERSION
  if (version !== undefined) assert.equal(spawnSync('tmux', ['-V'], { encoding: 'utf8' }).stdout.trim(), `tmux ${version}`, 'the tmux this job names')
  return true
}

/** The script a pane runs: it waits for its gate, sends `what`, prints `after`, then keeps every key it is sent. */
function thePane(place: string, what: 'ring' | 'clipboard', after: string): string {
  const ring = join(REPO, 'src', 'ring_the_owner', 'ring_the_owner.ts')
  const beat = join(REPO, 'src', 'show_dashboard_beat', 'show_dashboard_beat.ts')
  const dialog = join(REPO, 'src', 'tell_the_owner_a_session_waits', 'tell_the_owner_a_session_waits.ts')
  // A launcher's own decision: the bells for a row going into "needs you", wrapped or not as isInsideTmux reads this pane.
  const rings = `const r = await import(${JSON.stringify(ring)}); const b = await import(${JSON.stringify(beat)}); const d = await import(${JSON.stringify(dialog)});
const row = { ...b.theRowWithNothingSaid(), member: ${JSON.stringify(MEMBER)}, session: 's', at: 1 };
const asking = d.takeAnOwnerDialog(row, { change: 'opened', at: 2, raised: { kind: 'permission', agent: '', tool: ${JSON.stringify(EDIT_TOOL)}, input: { file_path: 'a' } } });
process.stdout.write(r.theBellsFor(row, asking, { bell: false, notify: true }, true, false, r.isInsideTmux(process.env)));`
  const send = what === 'ring' ? `node --no-warnings --input-type=module -e '${rings.replaceAll("'", `'\\''`)}'` : `printf '\\033]52;c;bWFydGhh\\007'`
  return `while [ ! -e ${place}/go ]; do sleep 0.05; done; ${send}; printf '\\n%s\\n' '${after}'; exec cat > ${place}/keys`
}

/** A tmux server on its own socket in `place`, with the live run's bounds, one session running `pane`. */
function aLiveRunServer(t: TestContext, place: string, pane: string): string[] {
  const tmux = ['-S', join(place, 's'), '-f', '/dev/null']
  const started = spawnSync('tmux', [...tmux, 'start-server', ';', ...theLiveRuns('LIVE_RUN_TMUX_BOUNDS'), ';', 'new-session', '-d', '-s', MEMBER, ...SIZE, pane], { encoding: 'utf8' })
  assert.equal(started.status, 0, `tmux would not start with the live run's bounds: ${started.stderr}`)
  const pid = Number(spawnSync('tmux', [...tmux, 'display-message', '-p', '#{pid}'], { encoding: 'utf8' }).stdout.trim())
  assert.ok(Number.isInteger(pid) && pid > 0, 'the live run server names its pid')
  // Stopped by its pid, not its socket: the case's place, socket and all, may already be removed by the time this
  // runs, and a server that daemonized is in no process group a test runner reaps.
  t.after(async () => {
    spawnSync('tmux', [...tmux, 'kill-server'], { stdio: 'ignore' })
    if (isAlive(pid)) process.kill(pid, 'SIGTERM')
    await until(() => !isAlive(pid), `the live run server ${pid} outlived its case`)
  })
  return tmux
}

/**
 * Whether `pid` is still a running process. A zombie is not: in a container whose first process reaps nothing, a stopped
 * server stays a zombie, which signal 0 still reaches.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  const stat = existsSync(`/proc/${String(pid)}/stat`) ? readFileSync(`/proc/${String(pid)}/stat`, 'utf8') : ''
  return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z'
}

/** A client attached with `attach`, recorded by `script` into `record`; its keyboard is its standard input. */
function aClient(t: TestContext, tmux: string[], attach: string[], record: string): ChildProcess {
  const words = ['tmux', ...tmux, ...attach, '-t', MEMBER].map((word) => `'${word}'`).join(' ')
  const client = spawn('script', ['-qfec', words, record], { env: { ...process.env, TERM: 'xterm-256color' }, stdio: ['pipe', 'ignore', 'ignore'] })
  // Its keyboard closed and its exit awaited, so neither the pipe nor `script` outlives the case.
  t.after(async () => {
    client.stdin?.end()
    if (client.exitCode !== null || client.signalCode !== null) return
    const gone = once(client, 'exit')
    client.kill()
    await gone
  })
  return client
}

/** Waits until `holds` is true, or fails with `why` once WAIT_MS has passed. */
async function until(holds: () => boolean, why: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!holds()) {
    assert.ok(Date.now() < deadline, why)
    await new Promise((done) => setTimeout(done, POLL_MS))
  }
}

const clientsOf = (tmux: string[]): number => spawnSync('tmux', [...tmux, 'list-clients', '-t', MEMBER], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line !== '').length
const bytesOf = (file: string): string => (existsSync(file) ? readFileSync(file, 'latin1') : '')

/** A server whose pane sends `what` once `clients` are attached, and the record of the first of them once `after` is drawn. */
async function aCase(t: TestContext, what: 'ring' | 'clipboard', clients: string[][], before: (tmux: string[]) => void = () => undefined): Promise<string> {
  const place = shortRelayRoot(t)
  const after = `after-${what}-${place.slice(-6)}`
  const tmux = aLiveRunServer(t, place, thePane(place, what, after))
  before(tmux)
  clients.forEach((attach, index) => aClient(t, tmux, attach, join(place, `client-${index}`)))
  await until(() => clientsOf(tmux) === clients.length, `${clients.length} client(s) never attached`)
  writeFileSync(join(place, 'go'), '')
  const record = join(place, 'client-0')
  await until(() => bytesOf(record).includes(after), `the pane's line after its ${what} never reached the client`)
  return bytesOf(record)
}

test('a pane of the live run rings, and the owner\'s read-only client is sent the notification (martha#843)', async (t) => {
  if (!needsTmux(t)) return
  const record = await aCase(t, 'ring', [theLiveRuns('LIVE_RUN_WATCH_ATTACH')])
  assert.ok(record.includes(`${NOTIFICATION_ESCAPE}i=${notificationIdOf(MEMBER)}`), 'the OSC 99 with the member\'s id, as a terminal reads it')
})

test('no pane of the live run sets the owner\'s clipboard with a bare OSC 52 (martha#843)', async (t) => {
  if (!needsTmux(t)) return
  const record = await aCase(t, 'clipboard', [['attach']])
  assert.equal(record.includes(CLIPBOARD_ESCAPE), false, 'no OSC 52 reached the client')
})

test('once the builder\'s pane is shut, a client attached writable is sent no notification (martha#843)', async (t) => {
  if (!needsTmux(t)) return
  const record = await aCase(t, 'ring', [['attach']], (tmux) => {
    const shut = spawnSync('tmux', [...tmux, 'set-option', '-p', '-t', MEMBER, ...theLiveRuns('LIVE_RUN_PASSTHROUGH_OFF')], { encoding: 'utf8' })
    assert.equal(shut.status, 0, `the pane could not be shut: ${shut.stderr}`)
  })
  assert.equal(record.includes(NOTIFICATION_ESCAPE), false, 'no OSC 99 reached the writable client')
})

test('what the owner types while watching read-only reaches no pane, and a writable client\'s keys do (martha#843)', async (t) => {
  if (!needsTmux(t)) return
  const place = shortRelayRoot(t)
  const tmux = aLiveRunServer(t, place, thePane(place, 'clipboard', 'ready'))
  const watching = aClient(t, tmux, theLiveRuns('LIVE_RUN_WATCH_ATTACH'), join(place, 'watching'))
  const writing = aClient(t, tmux, ['attach'], join(place, 'writing'))
  await until(() => clientsOf(tmux) === 2, 'the two clients never attached')
  writeFileSync(join(place, 'go'), '')
  await until(() => bytesOf(join(place, 'watching')).includes('ready'), 'the pane never got ready')
  watching.stdin?.write('typed-while-watching\r')
  writing.stdin?.write('typed-while-writing\r')
  await until(() => bytesOf(join(place, 'keys')).includes('typed-while-writing'), 'the writable client\'s keys never reached the pane')
  assert.equal(bytesOf(join(place, 'keys')).includes('typed-while-watching'), false, 'the read-only client\'s keys reached the pane')
})
