// `bin/martha`, run as a stranger runs it: a Node program with no dependency, in a checkout of theirs (martha#98).
//
// Each test runs the real bin/martha in a git checkout under a temporary home, with that home's own state, and
// reads what it says and how it ends. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { NOT_A_TERMINAL } from '../approve_a_checkouts_config/approve_a_checkouts_config.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { NOT_A_TERMINAL as START_NOT_ON_A_TERMINAL } from '../start_a_member/start_a_member.ts'
import { SOLO_MEMBERS } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { shortRelayRoot } from '../launch_a_claude_code_member/short_relay_root.ts'
import { EXIT_REFUSED, EXIT_USAGE, OWNERS_ACT_NEEDS_A_TERMINAL, SAID_BY, startedLine, USAGE } from './run_the_martha_command.ts'
import { NOT_IN_A_MEMBER } from '../run_an_owner_signed_command/ask_the_launcher_to_run.ts'
import { RELAY_SOCKET_VARIABLE, RUN_PATH } from '../claude_code_relay/hooks/relay_protocol.ts'
import { OWNER_KEYS_FILE } from '../keep_what_the_owner_signed/keep_what_the_owner_signed.ts'
import { hostAnswers } from '../launch_a_claude_code_member/host_stand_in.ts'
import { CLAUDE_CODE_SESSION_EVENTS, startSession } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { crewFilesDirectory, handoverStampsIn } from '../crew_files_directory/crew_files_directory.ts'
import { crewStateDirectory, openState, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { CREW_HANDOVER_WRITTEN, HANDOVERS_PLACE, theHandoverFile, writeMyHandover } from '../write_my_handover/write_my_handover.ts'
import { theResumePrompt } from '../wake_a_member/wake_a_member.ts'
import { STOP } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'

const MARTHA = join(import.meta.dirname, '..', '..', 'bin', 'martha')

interface Place {
  readonly home: string
  readonly root: string
}

function placeFor(t: TestContext, { checkout = true } = {}): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-command-')))
  t.after(() => removeTheTree(home))
  const root = join(home, 'project')
  mkdirSync(root)
  if (checkout) {
    execFileSync('git', ['init', '-q', '.'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Ada Owner'], { cwd: root })
  }
  return { home, root }
}

/** bin/martha run in the place's checkout, with its standard input a pipe, never a terminal. */
function martha(place: Place, ...args: string[]) {
  return marthaWith(place, {}, ...args)
}

function marthaWith(place: Place, env: Readonly<Record<string, string>>, ...args: string[]) {
  const run = spawnSync(process.execPath, [MARTHA, ...args], {
    cwd: place.root,
    encoding: 'utf8',
    input: '',
    env: { PATH: process.env.PATH, HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1', ...env },
  })
  return { status: run.status, out: run.stdout, err: run.stderr, said: `${run.stdout}${run.stderr}` }
}

/** Every line on stderr is Martha's, prefixed as martha-install prefixes its own. */
const allSaidByMartha = (err: string): void => {
  for (const line of err.split('\n').filter((said) => said !== '')) assert.ok(line.startsWith(`${SAID_BY} `), line)
}

test('bin/martha is in the tree, executable, and starts with a node line', () => {
  assert.ok(existsSync(MARTHA))
  assert.match(readFileSync(MARTHA, 'utf8'), /^#!\/usr\/bin\/env node\n/)
  execFileSync('test', ['-x', MARTHA])
})

test('martha with no act shows how it is used, and ends as a usage error', (t) => {
  const run = martha(placeFor(t))
  assert.equal(run.status, EXIT_USAGE)
  assert.ok(run.said.includes(USAGE), run.said)
})

test('martha outside any git checkout refuses, saying so', (t) => {
  const run = martha(placeFor(t, { checkout: false }), 'init')
  assert.equal(run.status, EXIT_REFUSED)
  assert.match(run.said, /git checkout/)
})

test('martha init writes the declaration once and refuses the second time', (t) => {
  const place = placeFor(t)
  const first = martha(place, 'init')
  assert.equal(first.status, 0, first.said)
  for (const member of SOLO_MEMBERS) assert.ok(first.out.includes(member.name), first.out)
  const file = join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const written = readFileSync(file, 'utf8')
  assert.match(written, /Ada Owner/)

  const second = martha(place, 'init')
  assert.equal(second.status, EXIT_REFUSED)
  assert.ok(second.err.includes(file), second.err)
  allSaidByMartha(second.err)
  assert.equal(readFileSync(file, 'utf8'), written)
})

test('martha start on a terminal with no declaration refuses, naming martha init', (t) => {
  const run = marthaOnATerminal(placeFor(t), {}, 'start', 'builder')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.match(run.said, /martha init/)
  allSaidByMartha(run.said)
})

test('martha start with no member named shows how it is used', (t) => {
  const run = martha(placeFor(t), 'start')
  assert.equal(run.status, EXIT_USAGE)
  assert.ok(run.said.includes(USAGE), run.said)
})

test('martha approve whose input is no terminal refuses, so a member\'s shell cannot approve', (t) => {
  const place = placeFor(t)
  writeFileSync(join(place.root, '.mcp.json'), '{"mcpServers":{}}')
  const run = martha(place, 'approve')
  assert.equal(run.status, EXIT_REFUSED)
  assert.ok(run.err.includes(NOT_A_TERMINAL), run.err)
  allSaidByMartha(run.err)
})

test('martha --version prints the version package.json carries, and nothing else', (t) => {
  const run = martha(placeFor(t, { checkout: false }), '--version')
  assert.equal(run.status, 0)
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }
  assert.equal(run.out, `${manifest.version}\n`)
})

/** bin/martha run on a terminal of its own, as the owner runs it: util-linux script gives it one. */
function marthaOnATerminal(place: Place, env: Readonly<Record<string, string>>, ...args: string[]) {
  const words = [process.execPath, MARTHA, ...args].map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(' ')
  const run = spawnSync('script', ['--quiet', '--return', '--command', words, '/dev/null'], {
    cwd: place.root,
    encoding: 'utf8',
    input: '',
    env: { PATH: process.env.PATH, HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1', ...env },
  })
  return { status: run.status, said: `${run.stdout}${run.stderr}`.replaceAll('\r\n', '\n') }
}

/**
 * A fake claude on the place's PATH that notes it ran, then ends with status 7 at once. The launcher holds a member
 * on a terminal until it has recorded its launch (martha#94), so ending at once is not a race.
 */
function claudeThatEnds(place: Place, t: TestContext): { readonly ran: string; readonly env: Readonly<Record<string, string>> } {
  const bin = join(place.home, 'bin')
  mkdirSync(bin)
  const ran = join(place.home, 'ran')
  writeFileSync(join(bin, 'claude'), ['#!/bin/sh', ...hostAnswers(), `: > '${ran}'`, 'exit 7', ''].join('\n'), { mode: 0o700 })
  return { ran, env: { PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: shortRelayRoot(t) } }
}

test('martha init then martha start on a terminal runs the owner\'s claude, names the member and its pid, and ends as it did', (t) => {
  const place = placeFor(t)
  const claude = claudeThatEnds(place, t)
  assert.equal(marthaWith(place, claude.env, 'init').status, 0)
  const [builder] = SOLO_MEMBERS
  const run = marthaOnATerminal(place, claude.env, 'start', builder!.name)
  assert.equal(run.status, 7, run.said)
  assert.match(run.said, new RegExp(`^${startedLine(builder!.name, '[0-9]+')}$`, 'm'))
  assert.ok(existsSync(claude.ran), 'the owner\'s claude ran')
})

test('martha start whose input is no terminal refuses, so a member\'s shell cannot start a sibling', (t) => {
  const place = placeFor(t)
  const claude = claudeThatEnds(place, t)
  assert.equal(marthaWith(place, claude.env, 'init').status, 0)
  const [builder] = SOLO_MEMBERS
  const run = marthaWith(place, claude.env, 'start', builder!.name)
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.err.includes(START_NOT_ON_A_TERMINAL), run.err)
  allSaidByMartha(run.err)
  assert.equal(existsSync(claude.ran), false)
})

test('what martha shows the owner carries no terminal control: it is written out as an escape', (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-command-')))
  t.after(() => removeTheTree(home))
  const root = join(home, EVERY_CONTROL_CLASS)
  mkdirSync(root)
  const run = martha({ home, root }, 'init')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.doesNotMatch(run.said, SHOWN_CONTROLS)
  assert.ok(run.err.includes(EVERY_CONTROL_CLASS_SHOWN), run.err)
  allSaidByMartha(run.err)
})

/**
 * A directory name holding one of every class a terminal acts on: a C0 control (ESC), a C1 control (CSI), DEL,
 * two bidirectional overrides, two isolates, the three direction marks, and the line and paragraph separators.
 */
const EVERY_CONTROL_CLASS = 'erase\u001b[2K\u009bline\u007fdel\u202a\u202eover\u2066\u2069iso\u200e\u200f\u061c\u2028\u2029'

/** That name as the owner must see it: each control written out as its escape, by hand rather than by the function under test. */
const EVERY_CONTROL_CLASS_SHOWN = 'erase\\x1b[2K\\x9bline\\x7fdel\\u202a\\u202eover\\u2066\\u2069iso\\u200e\\u200f\\u061c\\u2028\\u2029'

/** What no line Martha shows may carry: every control and direction mark a terminal acts on, the newline that ends a line aside. */
const SHOWN_CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u

test('an error nobody expected reaches the owner as one escaped martha: line, never as Node\'s own trace', (t) => {
  const place = placeFor(t)
  const closed = join(place.home, EVERY_CONTROL_CLASS)
  // Empty and closed to writing: the state root cannot be made in it, and the home's removal still takes it.
  mkdirSync(closed, { mode: 0o500 })
  const run = marthaWith(place, { XDG_STATE_HOME: closed }, 'init')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.doesNotMatch(run.said, SHOWN_CONTROLS)
  assert.doesNotMatch(run.err, /^\s+at /m, 'no stack trace')
  assert.ok(run.err.includes(EVERY_CONTROL_CLASS_SHOWN), run.err)
  allSaidByMartha(run.err)
})

// martha#129: martha run, martha pin-key and martha keep-shapes.

test('martha pin-key and keep-shapes off a terminal refuse, and pin nothing', (t) => {
  const place = placeFor(t)
  writeFileSync(join(place.root, 'owner.pub'), 'sk-ssh-ed25519@openssh.com AAAA owner\n')
  for (const act of ['pin-key', 'keep-shapes']) {
    const run = martha(place, act, 'owner.pub')
    assert.equal(run.status, EXIT_REFUSED)
    assert.ok(run.err.includes(OWNERS_ACT_NEEDS_A_TERMINAL), run.err)
  }
  assert.equal(execFileSync('find', [join(place.home, 'state'), '-name', OWNER_KEYS_FILE], { encoding: 'utf8' }), '')
})

test('martha run, pin-key and keep-shapes take exactly one argument', (t) => {
  const place = placeFor(t)
  for (const args of [['run'], ['run', 'a', 'b'], ['run', ''], ['pin-key'], ['keep-shapes', 'a', 'b']]) {
    assert.equal(martha(place, ...args).status, EXIT_USAGE, args.join(' '))
  }
})

test('martha run outside a member\'s shell refuses, naming why', (t) => {
  const run = martha(placeFor(t), 'run', 'test')
  assert.equal(run.status, EXIT_REFUSED)
  assert.ok(run.err.includes(NOT_IN_A_MEMBER), run.err)
  assert.equal(run.out, '')
})

/** bin/martha run against a stand-in launcher answering `answer`, while this process keeps serving it. */
async function runAgainst(t: TestContext, answer: unknown) {
  const place = placeFor(t)
  const socket_path = join(shortRelayRoot(t), 'launcher.sock')
  const asked: unknown[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      asked.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown })
      response.end(JSON.stringify(answer))
    })
  })
  await new Promise<void>((resolve) => server.listen(socket_path, resolve))
  t.after(() => server.close())
  const child = spawn(process.execPath, [MARTHA, 'run', 'test'], {
    cwd: place.root,
    env: { PATH: process.env.PATH, HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), [RELAY_SOCKET_VARIABLE]: socket_path },
  })
  const out: Buffer[] = []
  const err: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
  const status = await new Promise<number | null>((resolve) => child.on('close', resolve))
  return { status, out: Buffer.concat(out), err: Buffer.concat(err).toString('utf8'), asked }
}

test('martha run writes the run\'s bytes to stdout as they are, nothing to stderr, and ends with its status', async (t) => {
  // Terminal controls and a byte that is not text: the host must get exactly what the run gave.
  const bytes = Buffer.from('ok \u001b[2J\r\n\u0000 done\n', 'utf8')
  const run = await runAgainst(t, { ran: 1, status: 3, output: bytes.toString('base64') })
  assert.deepEqual(run.asked, [{ path: RUN_PATH, body: { name: 'test' } }])
  assert.equal(run.status, 3)
  assert.deepEqual(run.out, bytes)
  assert.equal(run.err, '')
})

test('martha run with a refusal from the launcher shows it, and writes nothing to stdout', async (t) => {
  const run = await runAgainst(t, { refused: 'nothing ran: planted.txt' })
  assert.equal(run.status, EXIT_REFUSED)
  assert.equal(run.out.length, 0)
  assert.match(run.err, /nothing ran: planted\.txt/)
})

test('martha run hears any other answer as a refusal', async (t) => {
  for (const answer of [{ ran: 1, status: 0, output: 'not base64!' }, { ran: 1, status: 0, output: '', extra: 1 }, { allow: 1 }]) {
    const run = await runAgainst(t, answer)
    assert.equal(run.status, EXIT_REFUSED, JSON.stringify(answer))
    assert.equal(run.out.length, 0)
  }
})

test('martha install runs outside a checkout, and refuses a release that carries no pin, naming it', (t) => {
  // The act is placed before the places are read: an installed machine with no checkout must still upgrade
  // (martha#84). This tree carries no installer.json, so the refusal is the pin's, never the checkout's.
  const run = martha(placeFor(t, { checkout: false }), 'install')
  assert.equal(run.status, EXIT_REFUSED)
  assert.match(run.said, /installer pin/)
  assert.doesNotMatch(run.said, /git checkout/)
  allSaidByMartha(run.err)
})

test('martha install with a switch it does not know is a usage error, and the usage names the act', (t) => {
  const run = martha(placeFor(t), 'install', '--bogus')
  assert.equal(run.status, EXIT_USAGE)
  assert.ok(USAGE.includes('martha install'), USAGE)
  assert.doesNotMatch(run.err, /installer pin/)
})

/**
 * A fake claude on the place's PATH that keeps every call's arguments, each call separated from the last, then ends at
 * once as the owner's host would end a session it finished with. The launcher asks its host several questions before
 * it starts a member, so what a test reads is the last call that carries the member's own switches.
 */
function claudeThatWritesItsArguments(place: Place, t: TestContext): { readonly args: string; readonly env: Readonly<Record<string, string>> } {
  const bin = join(place.home, 'wake-bin')
  mkdirSync(bin)
  const args = join(place.home, 'wake-args')
  writeFileSync(join(bin, 'claude'), ['#!/bin/sh', ...hostAnswers(), `{ printf '%s\\n' "$@"; echo '---'; } >> '${args}'`, 'exit 0', ''].join('\n'), { mode: 0o700 })
  return { args, env: { PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: shortRelayRoot(t) } }
}

// The verb's whole point (martha#255 part 2, R1): `martha wake <member>` really does start the member on the prompt
// the wake composed, and it starts it on the handover its stamp names. Measured at the host's own arguments, because
// a wake that starts a member with no prompt, or with someone else's words, still prints "woken".
test('martha wake starts the member on its newest handover, and the prompt it is started on names that file', (t) => {
  const place = placeFor(t)
  const claude = claudeThatWritesItsArguments(place, t)
  assert.equal(marthaWith(place, claude.env, 'init').status, 0, 'the test could not declare a crew')
  const [builder] = SOLO_MEMBERS
  const member = builder!.name
  const content = 'What stands: the package, its branch, its tip.\n'
  const at = new Date('2026-11-12T09:00:00Z')
  const state = openState(join(place.home, 'state', STATE_ROOT_NAME), place.root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const crew = crewStateDirectory(state.state_root, place.root)
  assert.ok(!('refusal' in crew), `the test could not reach the crew's store: ${'refusal' in crew ? crew.refusal : ''}`)
  const stamps = handoverStampsIn(crew.path)
  const session = startSession({ read: () => undefined, write: () => {} }, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'a-session' })
  const written = writeMyHandover({ stores: { crew: crewFilesDirectory(crew.path) } }, { member, content, at, stamps, session })
  assert.equal(written, CREW_HANDOVER_WRITTEN, `the host did not write the handover the test needed: ${JSON.stringify(written)}`)
  const handovers = crewFilesDirectory(crew.path).place(HANDOVERS_PLACE)
  assert.ok(!('refusal' in handovers), 'the crew store refused its handovers place')
  const file = join(handovers.path, theHandoverFile(member, at))

  const run = marthaOnATerminal(place, claude.env, 'wake', member)

  assert.equal(run.status, 0, run.said)
  assert.match(run.said, new RegExp(`^${member} woken from .*HANDOVER_2026-11-12_${member}\\.md$`, 'm'), 'the wake did not say which handover it woke the member from')
  const calls = readFileSync(claude.args, 'utf8')
    .split('---\n')
    .map((call) => call.split('\n').filter((line) => line !== ''))
    .filter((call) => call.length > 0)
  const started = calls.find((call) => call.includes('--plugin-dir'))
  assert.ok(started !== undefined, `the wake never started the member: ${JSON.stringify(calls)}`)
  assert.ok(started.includes(theResumePrompt({ file, content }, member)), `the member was not started on the prompt its wake composed: ${JSON.stringify(started)}`)
})

// --- martha ls and martha stop (martha#312) -------------------------------------------------------------------------

/** The relay root under the test's own home, so a verb that composes the launcher's places leaves nothing in /tmp. */
const runtimeOf = (place: Place): Readonly<Record<string, string>> => ({ XDG_RUNTIME_DIR: join(place.home, 'run') })

test('#312: martha ls takes no argument, and martha stop one member at most and no switch', (t) => {
  const place = placeFor(t)
  for (const args of [['ls', 'Terra'], [STOP, 'a', 'b'], [STOP, '--all'], [STOP, '']]) {
    assert.equal(marthaWith(place, runtimeOf(place), ...args).status, EXIT_USAGE, args.join(' '))
  }
  assert.ok(USAGE.includes('martha ls | martha stop [<member>]'), USAGE)
})

test('#312: martha ls shows every declared member, in the declaration order, stopped when none was started', (t) => {
  const place = placeFor(t)
  assert.equal(martha(place, 'init').status, 0)
  const listed = marthaWith(place, runtimeOf(place), 'ls')
  assert.equal(listed.status, 0, listed.said)
  const declaration = JSON.parse(readFileSync(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')) as { members: { name: string }[] }
  const names = declaration.members.map((member) => member.name)
  assert.ok(names.length > 1, 'a solo crew declares more than one member, so the order is a real check')
  assert.deepEqual(listed.out.trimEnd().split('\n').map((line) => line.split('  ').slice(0, 2)), names.map((name) => [name, 'stopped']), listed.out)
})

test('#312: martha stop with nothing running says so and ends done; a name the crew does not have is refused', (t) => {
  const place = placeFor(t)
  assert.equal(martha(place, 'init').status, 0)
  const none = marthaWith(place, runtimeOf(place), STOP)
  assert.equal(none.status, 0, none.said)
  assert.ok(none.err.includes('no member of this crew is running, so nothing was stopped.'), none.err)
  allSaidByMartha(none.err)
  const stranger = marthaWith(place, runtimeOf(place), STOP, 'nobody')
  assert.equal(stranger.status, EXIT_REFUSED)
  assert.match(stranger.err, /nobody is not on this crew \(its members are /)
})
