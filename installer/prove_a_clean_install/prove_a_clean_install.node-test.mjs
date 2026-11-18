// The clean-install proof's install-and-tear-down half (martha#69), against a local release of the committed tree:
// it installs on a box that starts empty, checks what landed on disk, and leaves nothing behind, whether the install
// passed or was refused.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { removeEvenReadOnly } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { TOP } from '../unpack_the_release_layer/unpack_the_release_layer.mjs'
import { proveACleanInstall, startedLineSource, HELD, heldAt, HOLD_VARIABLE, WORK_PREFIX, startOnATerminal, killEvenIfGone, killEveryMember, runningMember, stopMember, theProcessesOnThisMachine, MEMBER_WAIT_MS, NOTHING_MATCHED, POLL_MS, RUNNABLE, quoted } from './prove_a_clean_install.mjs'

const SCRIPT = fileURLToPath(new URL('./prove_a_clean_install.mjs', import.meta.url))
// The solo crew as the committed tree declares it; computed, so the installer's typecheck does not follow it into src.
const SOLO_CREW = fileURLToPath(new URL('../../src/declare_a_solo_crew/declare_a_solo_crew.ts', import.meta.url))
const { SOLO_MEMBERS } = /** @type {{ SOLO_MEMBERS: ReadonlyArray<{ name: string }> }} */ (await import(SOLO_CREW))
// The line `martha start` prints once a member is up, as the committed tree makes it; computed for the same reason.
const COMMAND = fileURLToPath(new URL('../../src/run_the_martha_command/run_the_martha_command.ts', import.meta.url))
const { startedLine } = /** @type {{ startedLine: (member: string, pid: string) => string }} */ (await import(COMMAND))
// The relay's declared files and the name of a launch's copy of them (martha#117), computed for the same reason.
const RELAY_COPY = fileURLToPath(new URL('../../src/serve_the_relay_to_a_launch/relay_copy.ts', import.meta.url))
const { RELAY_FILES, RELAY_COPY_NAME } = /** @type {{ RELAY_FILES: readonly string[], RELAY_COPY_NAME: string }} */ (await import(RELAY_COPY))
// A command run that hangs fails here instead of stalling the suite to its own timeout.
const COMMAND_TIMEOUT_MS = 50_000
// The mode a planted defect gives the release: writable by its owner, which a placed release never is.
const WRITABLE = 0o755
// This machine's processes, the same reader a run uses: the tear-down signals on a start time, never on a pid alone
// (martha#628).
const PROCESSES = await theProcessesOnThisMachine()

/**
 * Runs the script as a command, bounded by COMMAND_TIMEOUT_MS.
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
const runTheCommand = (args, env = process.env) => {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, env })
  assert.equal(run.error, undefined, 'the command ended within its time')
  return run
}

/** @param {string} base */
const stillListening = (base) => new Promise((resolve) => {
  const { hostname, port } = new URL(base)
  const socket = connect(Number(port), hostname)
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})

/** @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * A process's state, from /proc: `T` is stopped, which a signal of ours would have made it, so a case that must not
 * signal a pid asserts the state and not only that the process is alive (martha#628).
 * @param {number} pid
 */
const stateOf = (pid) => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  return stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[0]
}

/**
 * The state of a process that may already be gone: a killed process is `Z` until it is reaped, and an orphan is reaped
 * as soon as the kernel hands it on, so "gone" is a state of its own here (martha#628).
 * @param {number} pid
 */
const stateOrGone = (pid) => {
  try {
    return stateOf(pid)
  } catch {
    return 'gone'
  }
}

/**
 * A member as a run makes one, with its wrapper's start time held as the run holds it: what a test plants beyond that
 * is said in `overrides` (martha#628).
 * @param {string} name
 * @param {import('node:child_process').ChildProcess} child
 * @param {Record<string, unknown>} [overrides]
 */
const aMember = (name, child, overrides = {}) => /** @type {any} */ ({
  name,
  child,
  pid: 0,
  said: '',
  ended: '',
  exited: Promise.resolve(''),
  identity: null,
  childIdentity: PROCESSES.identityOf(Number(child.pid)),
  ...overrides
})

/**
 * The session a pid runs in, read from /proc: a run under `script` leads a session of its own, and an orphan keeps its
 * session id, so a process that escapes the wrapper is still counted in the session it was forked in (martha#590).
 * @param {number} pid
 */
const sessionOf = (pid) => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  // The fields are counted after the process name in parentheses, which can itself hold spaces and brackets: the
  // state, the parent, the group and the session follow the last ")".
  return Number(stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[3])
}

/**
 * Every process in `session`, as `pgrep` names it. An answer other than "some" or "none" fails the test instead of
 * reading as an empty session, which would pass the check by never making it.
 * @param {number} session
 * @returns {number[]}
 */
const inSession = (session) => {
  const ran = spawnSync('pgrep', ['-s', String(session)], { encoding: 'utf8' })
  assert.ok(ran.status === 0 || ran.status === NOTHING_MATCHED, `pgrep -s ${session} answered ${String(ran.status)}`)
  return ran.status === 0 ? ran.stdout.trim().split('\n').filter((line) => line !== '').map(Number) : []
}

/**
 * Every member the run named a pid for has ended, and the relay root it made is gone. `named`: at least this many
 * members must have been named, so a run that never got that far cannot pass the check by having nothing to check.
 * What is found left is killed or removed before the check fails, so a failing run leaves nothing behind either.
 * @param {{ members: ReadonlyArray<{ name: string, pid: number }>, relayRoot: string }} left
 * @param {number} named
 * @param {string} said what the run logged, shown when the check fails
 */
const nothingLeftOfTheCrew = ({ members, relayRoot }, named, said) => {
  const pids = members.filter(({ pid }) => pid > 0)
  const outlived = pids.filter(({ pid }) => alive(pid))
  for (const { pid } of outlived) killItsGroup(pid)
  const rootLeft = relayRoot !== '' && existsSync(relayRoot)
  if (rootLeft) removeEvenReadOnly(relayRoot)
  assert.ok(pids.length >= named, `at least ${named} members were named with a pid\n${said}`)
  assert.deepEqual(outlived.map(({ name, pid }) => `${name}, pid ${pid}`), [], `the tear-down ended every member\n${said}`)
  assert.notEqual(relayRoot, '', `the run made a relay root\n${said}`)
  assert.equal(rootLeft, false, `the tear-down removed the relay root ${relayRoot}\n${said}`)
}

/** @param {number} pid a member's, which leads its own process group */
const killItsGroup = (pid) => {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Its group has already ended.
  }
}

/**
 * The members and the relay root a run as a command logged: each passed start names its pid, and the tear-down names
 * the relay root it removed.
 * @param {string} said
 */
const leftAsLogged = (said) => ({
  members: SOLO_MEMBERS.flatMap(({ name }) => {
    const pid = said.match(new RegExp(`^ok start \\S+: ${startedLineSource(startedLine, name)},`, 'm'))?.[1]
    return pid === undefined ? [] : [{ name, pid: Number(pid) }]
  }),
  relayRoot: said.match(/^(?:ok|FAIL) tear down: .*relay root (\S+)/m)?.[1] ?? ''
})

/** @param {import('node:test').TestContext} t */
const scratch = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-clean-install-test-'))
  t.after(() => removeEvenReadOnly(dir))
  return dir
}

test('installs the committed tree on an empty box, checks the disk, then removes the box and stops the registry', async () => {
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({ log: (line) => lines.push(line) })
  assert.equal(result.passed, true, lines.join('\n'))
  assert.ok(!existsSync(result.box), 'the box is gone')
  assert.equal(await stillListening(result.registry), false, 'the registry no longer answers')
  const members = result.members.map((m) => m.name)
  assert.deepEqual(members, SOLO_MEMBERS.map((m) => m.name), 'every member of the solo crew was started')
  const memberSteps = members.flatMap((name) => [`start ${name}`, `stop ${name}`])
  for (const step of ['pack', 'serve', 'install', 'on disk', 'init', 'approve', ...memberSteps, 'tear down']) {
    assert.ok(lines.some((l) => l.includes(`ok ${step}:`)), `the log has a passed "${step}" step\n${lines.join('\n')}`)
  }
  nothingLeftOfTheCrew(result, SOLO_MEMBERS.length, lines.join('\n'))
  assert.match(lines.join('\n'), /--plugin-dir/, 'the log shows each member started with Martha\'s relay')
  assert.match(lines.join('\n'), /stood in/, 'the log says the signature check was stood in')
  assert.match(lines.at(-1) ?? '', /^passed; .*stood in/, 'the final line repeats that the signature check was stood in')
})

/** @typedef {{ box: string, expected: string, installed: { release: string }, places: { current: string } }} OnDisk */
/** @type {Array<[string, (on: OnDisk) => void, RegExp]>} */
const DEFECTS = [
  ['the installed tree differs from the commit', ({ expected }) => writeFileSync(join(expected, TOP, 'planted-in-the-commit'), ''), /not the committed tree/],
  ['a file is written outside Martha\'s places', ({ box }) => writeFileSync(join(box, 'planted-stray'), ''), /outside Martha's places: .*planted-stray/],
  ['the release is left writable', ({ installed }) => chmodSync(installed.release, WRITABLE), /mode 755/],
  ['current points somewhere else', ({ box, places }) => { rmSync(places.current); symlinkSync(box, places.current) }, /does not point at/]
]

for (const [defect, plant, says] of DEFECTS) {
  test(`a planted defect fails the disk check: ${defect}`, async () => {
    /** @type {string[]} */
    const lines = []
    const result = await proveACleanInstall({ log: (line) => lines.push(line), plant: { onDisk: plant } })
    assert.equal(result.passed, false, lines.join('\n'))
    assert.ok(lines.some((l) => l.startsWith('FAIL on disk:') && says.test(l)), lines.join('\n'))
    assert.ok(lines.some((l) => l.includes('ok tear down:')), lines.join('\n'))
    assert.equal(lines.at(-1), 'failed')
    assert.ok(!existsSync(result.box), 'the box is gone')
  })
}

test('a tear-down that fails fails the run, and the box is removed even when stopping the registry is refused', async () => {
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({
    log: (line) => lines.push(line),
    plant: {
      atTearDown: (registry) => {
        const close = registry.close
        registry.close = async () => { await close(); throw new Error('planted: the registry refused to stop') }
      }
    }
  })
  assert.equal(result.passed, false, lines.join('\n'))
  assert.ok(lines.some((l) => /^FAIL tear down: .*planted: the registry refused to stop/.test(l)), lines.join('\n'))
  assert.ok(lines.some((l) => l.startsWith('FAIL tear down:') && l.endsWith(`; relay root ${result.relayRoot}`)), `the failed tear-down names the relay root\n${lines.join('\n')}`)
  assert.equal(lines.at(-1), 'failed')
  assert.ok(!existsSync(result.box), 'the box is gone')
  assert.equal(await stillListening(result.registry), false, 'the registry no longer answers')
  nothingLeftOfTheCrew(result, SOLO_MEMBERS.length, lines.join('\n'))
})

test('an error outside the steps still tears down, logs a final failed line, and resolves', async () => {
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({ log: (line) => lines.push(line), plant: { onDisk: () => { throw new TypeError('planted: not a step failure') } } })
  assert.equal(result.passed, false, lines.join('\n'))
  assert.ok(lines.some((l) => /^FAIL .*planted: not a step failure/.test(l)), lines.join('\n'))
  assert.ok(lines.some((l) => l.includes('ok tear down:')), lines.join('\n'))
  assert.equal(lines.at(-1), 'failed')
  assert.ok(!existsSync(result.box), 'the box is gone')
})

test('a member that does not stay up fails its start step, and the run still tears down', async () => {
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({
    log: (line) => lines.push(line),
    plant: { host: (script) => script.map((line) => line.startsWith('exec ') ? 'exit 3' : line) }
  })
  assert.equal(result.passed, false, lines.join('\n'))
  assert.ok(lines.some((l) => /^FAIL start \S+:/.test(l)), lines.join('\n'))
  assert.ok(lines.some((l) => l.includes('ok tear down:')), lines.join('\n'))
  assert.equal(lines.at(-1), 'failed')
  assert.ok(!existsSync(result.box), 'the box is gone')
  nothingLeftOfTheCrew(result, 0, lines.join('\n'))
})

test('a member whose host was not started with the installed release\'s relay fails its start step', async () => {
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({ log: (line) => lines.push(line), plant: { relay: (dir) => `${dir}-elsewhere` } })
  assert.equal(result.passed, false, lines.join('\n'))
  assert.ok(lines.some((l) => /^FAIL start \S+: .*was not started with Martha's relay .*-elsewhere/.test(l)), lines.join('\n'))
  assert.ok(lines.some((l) => l.includes('ok tear down:')), lines.join('\n'))
  assert.ok(!existsSync(result.box), 'the box is gone')
  // The first member came up before its relay was found wrong, so only the tear-down can end it.
  nothingLeftOfTheCrew(result, 1, lines.join('\n'))
})

/**
 * The relay's declared files, copied from `from` into `to`, each written plainly so the copy is easy to remove.
 * @param {string} from
 * @param {string} to
 */
const copyTheRelayFiles = (from, to) => {
  for (const file of RELAY_FILES) {
    mkdirSync(dirname(join(to, file)), { recursive: true })
    writeFileSync(join(to, file), readFileSync(join(from, file)))
  }
}

// The relay file the one-byte plant changes: the last declared one.
const CHANGED_FILE = String(RELAY_FILES.at(-1))

test('a member whose host was given a relay that differs from the installed one by one byte fails its start step, naming the file', async (t) => {
  const elsewhere = join(scratch(t), 'installed-relay')
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({
    log: (line) => lines.push(line),
    plant: {
      relay: (dir) => {
        copyTheRelayFiles(dir, elsewhere)
        const bytes = readFileSync(join(elsewhere, CHANGED_FILE))
        bytes[0] = (bytes[0] ?? 0) ^ 1
        writeFileSync(join(elsewhere, CHANGED_FILE), bytes)
        return elsewhere
      }
    }
  })
  const differs = new RegExp(`^FAIL start \\S+: .*differs from it in ${CHANGED_FILE.replaceAll('.', '\\.')}(;|,)`)
  assert.ok(lines.some((l) => differs.test(l)), `the start step names ${CHANGED_FILE} as the file that differs\n${lines.join('\n')}`)
  assert.equal(result.passed, false, lines.join('\n'))
  nothingLeftOfTheCrew(result, 1, lines.join('\n'))
})

test('a member whose host was given a true copy of the relay outside the run\'s relay root fails its start step', async (t) => {
  const outside = join(scratch(t), RELAY_COPY_NAME)
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({
    log: (line) => lines.push(line),
    plant: {
      // The launch's own copy, swapped in the noted arguments for an identical one that is not under the relay root.
      hostArgs: (args) => args.map((arg) => {
        if (basename(arg) !== RELAY_COPY_NAME || !existsSync(arg)) return arg
        if (!existsSync(outside)) copyTheRelayFiles(arg, outside)
        return outside
      })
    }
  })
  assert.ok(lines.some((l) => /^FAIL start \S+: .*no argument names a copy /.test(l)), `the start step refuses a copy outside the run's relay root\n${lines.join('\n')}`)
  assert.equal(result.passed, false, lines.join('\n'))
  nothingLeftOfTheCrew(result, 1, lines.join('\n'))
})

// How many looks a planted late reap answers for a pid that has already ended.
const LATE_LOOKS = 3

/** A late reap: each ended pid still answers for its first LATE_LOOKS looks, as an unreaped one does. */
const aLateReap = () => {
  /** @type {Map<number, number>} */
  const looks = new Map()
  return (/** @type {number} */ pid, /** @type {boolean} */ answers) => {
    if (answers) return true
    const seen = looks.get(pid) ?? 0
    looks.set(pid, seen + 1)
    return seen < LATE_LOOKS
  }
}

test('a stopped member whose pid is reaped late is waited for, not refused', async () => {
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({ log: (line) => lines.push(line), plant: { answersFor: aLateReap() } })
  for (const { name } of SOLO_MEMBERS) {
    assert.ok(lines.some((l) => l.startsWith(`ok stop ${name}:`)), `the stop step waits for ${name}'s late reap\n${lines.join('\n')}`)
  }
  assert.equal(result.passed, true, lines.join('\n'))
  nothingLeftOfTheCrew(result, SOLO_MEMBERS.length, lines.join('\n'))
})

test('a member the tear-down kills whose pid is reaped late is waited for, and the tear-down passes', async () => {
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({ log: (line) => lines.push(line), plant: { relay: (dir) => `${dir}-elsewhere`, answersFor: aLateReap() } })
  assert.ok(lines.some((l) => l.startsWith('ok tear down:')), `the tear-down waits for the late reap\n${lines.join('\n')}`)
  assert.equal(result.passed, false, lines.join('\n'))
  nothingLeftOfTheCrew(result, 1, lines.join('\n'))
})

// martha#189: the walk demands no directory that is gone. An interrupted launch takes its own snapshot directory away
// while the tear-down walks the same tree, and the window that opens between the chmod that opens a directory and the
// read that lists it is where that lands. The reader below stands in for exactly that window, so no race is timed.
test('a removal survives a launch snapshot dir that is gone between the chmod that opens it and the read that lists it (martha#189)', (t) => {
  const root = scratch(t)
  const gone = join(root, 'state', 'martha', 'a project', 'snapshots', 'launch-Q0Ggs3')
  mkdirSync(gone, { recursive: true })
  writeFileSync(join(gone, 'a snapshot'), 'x')
  /** @type {Set<string>} */
  const opened = new Set()
  /** @param {string} dir */
  const vanishes = (dir) => Object.assign(new Error(`ENOENT: no such file or directory, scandir '${dir}'`), { code: 'ENOENT' })
  removeEvenReadOnly(root, {
    chmodSync: (dir, mode) => { chmodSync(dir, mode); opened.add(dir) },
    readdirSync: (dir, options) => {
      if (opened.has(dir) && dir === gone) throw vanishes(dir)
      return readdirSync(dir, options)
    },
    rmSync
  })
  assert.ok(opened.has(gone), 'the directory was opened before it was read, which is the window this stands in for')
  assert.equal(existsSync(root), false, 'the tree is gone, and the removal did not fail on the directory that went')
})

test('a removal that cannot read a directory that is there fails, so a tree left behind is named (martha#189)', (t) => {
  const root = scratch(t)
  const unreadable = join(root, 'unreadable')
  mkdirSync(unreadable)
  const denied = Object.assign(new Error(`EACCES: permission denied, scandir '${unreadable}'`), { code: 'EACCES' })
  assert.throws(
    () => removeEvenReadOnly(root, {
      chmodSync,
      readdirSync: (dir, options) => {
        if (dir === unreadable) throw denied
        return readdirSync(dir, options)
      },
      rmSync
    }),
    /EACCES: permission denied, scandir/
  )
})

// martha#137: the chmod half of the same walk, which #189 left unpinned. A directory can go between the read that
// lists its parent and the chmod that opens it, one call earlier than the window above, and a directory that is there
// but cannot be opened is named by the caller rather than reported as removed. Both stand in for the call, no race.
test('a removal whose chmod finds a directory gone skips it, and the tree is removed (martha#137)', (t) => {
  const root = scratch(t)
  const gone = join(root, 'state', 'martha', 'a project', 'snapshots', 'launch-Q0Ggs3')
  mkdirSync(gone, { recursive: true })
  writeFileSync(join(gone, 'a snapshot'), 'x')
  /** @param {string} dir */
  const vanishes = (dir) => Object.assign(new Error(`ENOENT: no such file or directory, chmod '${dir}'`), { code: 'ENOENT' })
  removeEvenReadOnly(root, {
    chmodSync: (dir, mode) => {
      if (dir === gone) throw vanishes(dir)
      chmodSync(dir, mode)
    },
    readdirSync,
    rmSync
  })
  assert.equal(existsSync(root), false, 'the tree is gone, and the removal did not fail on the directory that went')
})

test('a removal whose chmod is refused names the directory and the reason, and the tree is left (martha#137)', (t) => {
  const root = scratch(t)
  const locked = join(root, 'a release still read-only')
  mkdirSync(locked)
  const refused = Object.assign(new Error(`EPERM: operation not permitted, chmod '${locked}'`), { code: 'EPERM' })
  assert.throws(
    () => removeEvenReadOnly(root, {
      chmodSync: (dir, mode) => {
        if (dir === locked) throw refused
        chmodSync(dir, mode)
      },
      readdirSync,
      rmSync
    }),
    /EPERM: operation not permitted, chmod /
  )
  assert.equal(existsSync(root), true, 'the tree left behind is still there for the caller to name')
})

// Where a run as a command is interrupted: early, before anything of the crew exists, and while the second member's
// start is in flight — the run parks there until the signal arrives, so the interrupt lands at the state the test
// names rather than wherever the run had reached when the signal happened to arrive (martha#189); `named` is how many
// members must then have been named with a pid.
const SECOND = SOLO_MEMBERS[1]
/** @type {Array<{ at: string, reached: RegExp, named: number, hold?: string }>} */
const INTERRUPT_POINTS = [
  { at: 'once the registry serves', reached: /^ok serve:/m, named: 0 },
  {
    at: `while ${SECOND?.name}'s start is in flight`,
    reached: new RegExp(`^${HELD}: start ${SECOND?.name}, waiting to be interrupted`, 'm'),
    named: 1,
    hold: `start ${SECOND?.name}`
  }
]

for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  for (const { at, reached, named, hold } of INTERRUPT_POINTS) {
    test(`run as a command, ${signal} ${at} fails the run and still tears down: nothing is left`, async (t) => {
      const tmp = scratch(t)
      const env = { ...process.env, TMPDIR: tmp, [HOLD_VARIABLE]: hold ?? '' }
      const run = spawn(process.execPath, [SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      const there = new Promise((resolve) => run.stdout.on('data', (chunk) => { out += chunk; if (reached.test(out)) resolve(undefined) }))
      const ended = new Promise((resolve) => run.once('exit', (code, sig) => resolve({ code, sig })))
      const timer = setTimeout(() => run.kill('SIGKILL'), COMMAND_TIMEOUT_MS)
      t.after(() => clearTimeout(timer))
      await Promise.race([there, ended])
      assert.match(out, reached, `the run got there before it was interrupted\n${out}`)
      run.kill(signal)
      const { code, sig } = /** @type {{ code: number | null, sig: string | null }} */ (await ended)
      // First what the run left: a member it did not end also holds the run open until the timer kills it.
      if (named) nothingLeftOfTheCrew(leftAsLogged(out), named, out)
      assert.equal(sig, null, `the run ended by itself, not by ${sig}\n${out}`)
      assert.equal(code, 1, out)
      assert.match(out, new RegExp(`^FAIL .*interrupted by ${signal}`, 'm'))
      assert.match(out, /^ok tear down:/m)
      assert.match(out, /failed\n$/)
      const left = readdirSync(tmp).filter((name) => name.startsWith(WORK_PREFIX))
      assert.deepEqual(left, [], 'no work folder is left behind')
    })
  }
}

// martha#590: a start that is never named is killed with everything under it, not only the wrapper. `script` runs the
// run in a session of its own, so the run is not in the wrapper's process group; killed only with the wrapper it goes
// on writing under the relay root, and a tear-down then says it removed a root the run has made again — which is how
// the SIGINT-in-flight case above came back red once in a while with its own step logged as passed.
test('a start in flight is killed with everything under it, so nothing it began outlives the tear-down (martha#590)', async (t) => {
  const tree = scratch(t)
  const pidFile = join(tree, 'pid')
  const writer = join(tree, 'writer.sh')
  // The run a start holds does not end with its wrapper: it reads its own end when it next writes, and until then it
  // goes on writing where it was. It forks, as a run does, so what writes is a child of a child of the wrapper, and a
  // kill that reaches only one level under the wrapper leaves it writing.
  const writes = `printf '%s\\n' "$$" > ${quoted(pidFile)}; while :; do mkdir -p ${quoted(join(tree, 'relay'))}; date > ${quoted(join(tree, 'relay', 'wrote'))}; sleep ${POLL_MS / 1000}; done`
  writeFileSync(writer, [
    '#!/bin/sh',
    "trap '' HUP",
    `${quoted('sh')} -c ${quoted(writes)} &`,
    'wait',
    ''
  ].join('\n'), { mode: RUNNABLE })
  const member = aMember('in flight', startOnATerminal(quoted(writer), { cwd: tree, env: process.env }))
  /** @type {number} */
  let writerPid = 0
  t.after(() => {
    if (writerPid > 0) { try { process.kill(writerPid, 'SIGKILL') } catch { /* already gone */ } }
    member.child.kill('SIGKILL')
  })
  const began = Date.now() + MEMBER_WAIT_MS
  while (!existsSync(pidFile) && Date.now() < began) await delay(POLL_MS)
  writerPid = Number(readFileSync(pidFile, 'utf8').trim())
  assert.ok(writerPid > 0, 'the start said the pid of what it began')
  assert.equal(alive(writerPid), true, 'what the start began is alive before the tear-down')
  killEvenIfGone(member, PROCESSES)
  const ended = Date.now() + MEMBER_WAIT_MS
  while (alive(writerPid) && Date.now() < ended) await delay(POLL_MS)
  assert.equal(alive(writerPid), false, 'nothing the start began is alive after the tear-down')
})

// martha#590 r=1: a run that forks while the tree is walked cannot put a child out of reach, because each process is
// frozen before its own children are read. A walk that only collects first has a window per process, at one `pgrep`
// spawn each, and the kill then leaves every parent alive the longest: a child forked in the window is reparented out
// of the wrapper's tree when its parent dies, and no later walk finds it again.
test('a run that forks while it is walked is frozen, so nothing of it outlives the tear-down (martha#590 r=1)', async (t) => {
  const tree = scratch(t)
  const pidFile = join(tree, 'pid')
  const forker = join(tree, 'forker.sh')
  // Two long-lived children for every short sleep, as a start in flight spawning its host over and over would: the
  // run's own session is where they land, since a fork keeps its session and only setsid() leaves it.
  const forks = `printf '%s\\n' "$$" > ${quoted(pidFile)}; while :; do sleep 300 & sleep 300 & sleep 0.005; done`
  writeFileSync(forker, [
    '#!/bin/sh',
    "trap '' HUP",
    `${quoted('sh')} -c ${quoted(forks)} &`,
    'wait',
    ''
  ].join('\n'), { mode: RUNNABLE })
  const member = aMember('forking', startOnATerminal(quoted(forker), { cwd: tree, env: process.env }))
  /** @type {number} */
  let session = 0
  t.after(() => {
    // Everything still in the run's session goes, whatever the assertions said, so a failing case leaves nothing
    // running for the next one.
    for (const pid of session > 0 ? inSession(session) : []) { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
    member.child.kill('SIGKILL')
  })
  const began = Date.now() + MEMBER_WAIT_MS
  while (!existsSync(pidFile) && Date.now() < began) await delay(POLL_MS)
  const runPid = Number(readFileSync(pidFile, 'utf8').trim())
  assert.ok(runPid > 0, 'the run said its pid')
  session = sessionOf(runPid)
  assert.ok(session > 0 && session !== sessionOf(process.pid), `the run leads a session of its own, not the test's: ${session}`)
  const forking = Date.now() + MEMBER_WAIT_MS
  let walked = inSession(session)
  while (walked.length <= 1 && Date.now() < forking) {
    await delay(POLL_MS)
    walked = inSession(session)
  }
  assert.ok(walked.length > 1, `the run forked children before the tear-down: ${walked.length} in session ${session}`)
  assert.deepEqual(killEvenIfGone(member, PROCESSES), [], 'the walk asked every process it froze for its children')
  const ended = Date.now() + MEMBER_WAIT_MS
  let left = inSession(session)
  while (left.length > 0 && Date.now() < ended) {
    await delay(POLL_MS)
    left = inSession(session)
  }
  assert.deepEqual(left, [], `nothing in the run's session ${session} is alive after the tear-down`)
})

// martha#590 r=2: the walk asks `pgrep` for a process's children, and only its exit status 1 means the process has
// none. A `pgrep` that is missing, or that ends with 2 or 3 (a usage or a system error), read as "no children" turns
// the tear-down into a silent no-op over a run it never reached: the original bug with a green step over it.
test('a walk that could not be made fails the tear-down by name, and only status 1 reads as no children (martha#590 r=2)', async (t) => {
  const tree = scratch(t)
  const nowhere = join(tree, 'not-on-this-path')
  const usageError = join(tree, 'a-pgrep-that-errors')
  const nothingMatched = join(tree, 'a-pgrep-that-finds-nothing')
  for (const dir of [nowhere, usageError, nothingMatched]) mkdirSync(dir)
  writeFileSync(join(usageError, 'pgrep'), ['#!/bin/sh', 'exit 2', ''].join('\n'), { mode: RUNNABLE })
  writeFileSync(join(nothingMatched, 'pgrep'), ['#!/bin/sh', 'exit 1', ''].join('\n'), { mode: RUNNABLE })
  const path = process.env.PATH
  t.after(() => { process.env.PATH = path })
  /** @type {Array<[string, string, RegExp | undefined]>} */
  const cases = [
    ['pgrep is not there', nowhere, /could not be read: /],
    ['pgrep ends on a usage error', usageError, /could not be read: pgrep ended with status 2/],
    ['pgrep found no children', nothingMatched, undefined]
  ]
  for (const [what, onlyPath, says] of cases) {
    // A child with no children of its own: status 1 is believed here, so a real grandchild would be left running by
    // the one case that must not refuse anything.
    const child = spawn('sleep', ['300'], { stdio: 'ignore' })
    t.after(() => { try { process.kill(Number(child.pid), 'SIGKILL') } catch { /* already gone */ } })
    const member = aMember(what, child)
    process.env.PATH = onlyPath
    const refusals = killEvenIfGone(member, PROCESSES)
    process.env.PATH = path
    const ended = Date.now() + MEMBER_WAIT_MS
    while (alive(Number(child.pid)) && Date.now() < ended) await delay(POLL_MS)
    assert.equal(alive(Number(child.pid)), false, `${what}: what the walk froze is killed`)
    if (says === undefined) assert.deepEqual(refusals, [], `${what}: status 1 is an answer, so nothing is refused`)
    else {
      assert.equal(refusals.length, 1, `${what}: one refusal, never a silent no-op`)
      assert.match(refusals[0] ?? '', says, what)
    }
  }
})

// martha#590 r=2: the refusal is the tear-down's, not the walk's alone. A walk that could not be made must reach the
// list the tear-down fails on, or the tear-down reports a run it never reached as ended and the refusal is dropped on
// the floor: the same silent no-op one layer up from where the walk made it.
test('a walk the tear-down could not make is one of its refusals (martha#590 r=2)', async (t) => {
  const tree = scratch(t)
  const nowhere = join(tree, 'not-on-this-path')
  mkdirSync(nowhere)
  const child = spawn('sleep', ['300'], { stdio: 'ignore' })
  t.after(() => { try { process.kill(Number(child.pid), 'SIGKILL') } catch { /* already gone */ } })
  // A member the tear-down kills, whose own promise then says it ended: the only refusal left is the walk's.
  const member = aMember('walked', child, { exited: Promise.resolve('ended') })
  const path = process.env.PATH
  t.after(() => { process.env.PATH = path })
  process.env.PATH = nowhere
  const refusals = await killEveryMember([member], {}, PROCESSES)
  process.env.PATH = path
  assert.equal(refusals.length, 1, `one refusal, the walk's, held by the tear-down: ${JSON.stringify(refusals)}`)
  assert.match(refusals[0] ?? '', /the children of pid \d+ could not be read: /, 'and it names the walk that failed')
})

/**
 * The pids `pgrep` names as children of `pid`, asked the way the walk asks it. An answer other than "some" or "none"
 * fails the test instead of reading as no children, which would pass a check by never making it.
 * @param {number} pid
 * @returns {number[]}
 */
const childrenOfPid = (pid) => {
  const ran = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
  assert.ok(ran.status === 0 || ran.status === NOTHING_MATCHED, `pgrep -P ${pid} answered ${String(ran.status)}`)
  return ran.status === 0 ? ran.stdout.trim().split('\n').filter((line) => line !== '').map(Number) : []
}

/**
 * A wrapper with a child and a grandchild, each a real process, so a walk has two levels it must stop before reading
 * them (martha#590 r=3). Both shells wait beside the process they began: a shell left with one command could be
 * replaced by it, and the level would be gone.
 * @param {import('node:test').TestContext} t
 */
const aTreeTwoDeep = async (t) => {
  const inner = `${quoted('sh')} -c ${quoted(`${quoted('sleep')} 300 & wait`)}`
  const wrapper = spawn('sh', ['-c', `${inner} & wait`], { stdio: 'ignore' })
  const wrapperPid = Number(wrapper.pid)
  /** @type {number[]} */
  let pids = [wrapperPid]
  t.after(() => {
    // Whatever the assertions said, the tree goes, so a failing case leaves nothing running for the next one.
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
  })
  const began = Date.now() + MEMBER_WAIT_MS
  while (Date.now() < began) {
    const children = childrenOfPid(wrapperPid)
    const [onlyChild] = children
    const grandchildren = onlyChild === undefined ? [] : childrenOfPid(onlyChild)
    if (children.length === 1 && onlyChild !== undefined && grandchildren.length === 1) {
      pids = [wrapperPid, onlyChild, ...grandchildren]
      return { wrapper, pids }
    }
    await delay(POLL_MS)
  }
  assert.fail(`the tree never came to a wrapper, a child and a grandchild under pid ${wrapperPid}`)
}

/**
 * A `pgrep` first on PATH that writes down the state `/proc/<pid>/stat` holds for the pid it is asked about, then asks
 * the real `pgrep` the same question. What the walk stopped before reading is then on a record: a process frozen
 * before its children are read is `T`, and one whose children were read first is still running (martha#590 r=3).
 * @param {string} tree
 * @returns {{ stub: string, record: string }}
 */
const aPgrepThatRecordsTheState = (tree) => {
  const stub = join(tree, 'a-pgrep-that-records')
  mkdirSync(stub)
  const record = join(tree, 'the-states-the-walk-saw')
  // Written empty first: a walk that never asked leaves an empty record to read, not a missing file to guess at.
  writeFileSync(record, '')
  const real = spawnSync('sh', ['-c', 'command -v pgrep'], { encoding: 'utf8' }).stdout.trim()
  assert.notEqual(real, '', 'the real pgrep is on PATH, to pass the question on to')
  writeFileSync(join(stub, 'pgrep'), `#!/bin/sh
pid=''
previous=''
for word in "$@"; do
  if [ "$previous" = '-P' ]; then pid="$word"; fi
  previous="$word"
done
if [ -n "$pid" ] && [ -r "/proc/$pid/stat" ]; then
  state="$(sed -e 's/^.*) //' -e 's/ .*$//' "/proc/$pid/stat")"
  printf '%s %s\\n' "$pid" "$state" >> ${quoted(record)}
fi
exec ${quoted(real)} "$@"
`, { mode: RUNNABLE })
  return { stub, record }
}

// martha#590 r=3: the order the freeze-then-read rule rests on is pinned on a record, not on a race. The forking case
// above can tell freeze-then-read from read-then-freeze only by a fork landing inside one `pgrep` spawn, so a mutant
// that reads a process's children before stopping it survived most runs. The stub here writes the state /proc holds
// for every pid the walk asks about: freeze-then-read leaves every one `T`, and reading first leaves it `S`.
test('the walk freezes each process before it reads its children, and the record of the states says so (martha#590 r=3)', async (t) => {
  const tree = scratch(t)
  const { wrapper, pids } = await aTreeTwoDeep(t)
  const { stub, record } = aPgrepThatRecordsTheState(tree)
  const path = process.env.PATH
  t.after(() => { process.env.PATH = path })
  const member = aMember('walked', wrapper)
  process.env.PATH = [stub, path].join(delimiter)
  const refusals = killEvenIfGone(member, PROCESSES)
  process.env.PATH = path
  assert.deepEqual(refusals, [], 'the walk asked every process it froze for its children')
  const recorded = readFileSync(record, 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => line.split(' '))
  const asked = recorded.map(([pid]) => Number(pid))
  assert.deepEqual(asked.sort((one, other) => one - other), [...pids].sort((one, other) => one - other), `the walk asked about every process in the tree: ${JSON.stringify(recorded)}`)
  assert.deepEqual(recorded.filter(([, state]) => state !== 'T'), [], `every process was stopped before its children were read: ${JSON.stringify(recorded)}`)
})

/**
 * The same reader a run uses, except for one pid, whose start time is another live process's from the `after`-th read
 * on: the kernel handing that pid to another process between two of our reads (martha#628).
 * @param {number} about
 * @param {number} after
 * @param {string | null} then
 */
const aReaderThatChangesItsMind = (about, after, then) => /** @type {any} */ ({
  identityOf: (() => {
    let read = 0
    return (/** @type {number} */ pid) => {
      if (pid !== about) return PROCESSES.identityOf(pid)
      read += 1
      return read > after ? then : PROCESSES.identityOf(pid)
    }
  })(),
  signalGroup: PROCESSES.signalGroup
})

// martha#628: the tear-down signals the process it recorded, never the number. A pid the kernel has handed to another
// process answers kill() exactly as the one we started does, so what a signal is sent on is the start time held when
// the pid was named. The record here is this test's own start time, which is what a run holds after the wrapper it
// named has ended and its number has gone round again: nothing under that number is walked, because nothing under it
// is the run's.
test('a wrapper whose pid is no longer the process it was named as has nothing under it walked (martha#628)', async (t) => {
  const { wrapper, pids } = await aTreeTwoDeep(t)
  const [child, grandchild] = [pids[1], pids[2]]
  if (child === undefined || grandchild === undefined) assert.fail('the tree came to a child and a grandchild')
  const member = aMember('reused', wrapper, { childIdentity: PROCESSES.identityOf(process.pid) })
  assert.deepEqual(killEvenIfGone(member, PROCESSES), [], 'a pid that is not ours is a process already gone: nothing is refused')
  assert.equal(stateOf(child), 'S', 'the child of a pid that is not ours is not even stopped')
  assert.equal(alive(grandchild), true, 'and nothing under it is killed')
})

// martha#628: the walk holds each child's start time the moment `pgrep` names it, and the kill reads it again. A pid
// the kernel hands on between those two reads is another process's, and is left alone: the freeze was ours, the kill
// would not be.
test('a pid that changed hands between the freeze and the kill is not killed (martha#628)', async (t) => {
  const { wrapper, pids } = await aTreeTwoDeep(t)
  const grandchild = pids[2]
  if (grandchild === undefined) assert.fail('the tree came to a grandchild')
  // Read once when `pgrep` names it and once at the stop; the kill reads a third time, and by then it is another
  // live process's number: this test's own start time stands in for the one the kernel hands on.
  const member = aMember('changed', wrapper)
  killEvenIfGone(member, aReaderThatChangesItsMind(grandchild, 2, PROCESSES.identityOf(process.pid)))
  assert.equal(stateOrGone(grandchild), 'T', `the pid that changed hands was frozen and then left alone, not killed: ${stateOrGone(grandchild)}`)
})

// martha#628: a group is signalled only while its leader is still the process the run recorded. A pid handed on can
// lead a group of its own, and `kill(-pid)` would take every process in it.
test('a process group whose leader is no longer the process the run recorded is not signalled (martha#628)', (t) => {
  const wrapper = spawn('sleep', ['300'], { stdio: 'ignore' })
  const leader = spawn('sleep', ['300'], { stdio: 'ignore', detached: true })
  t.after(() => {
    for (const pid of [Number(wrapper.pid), Number(leader.pid)]) { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
  })
  const member = aMember('grouped', wrapper, { pid: Number(leader.pid), identity: PROCESSES.identityOf(process.pid) })
  killEvenIfGone(member, PROCESSES)
  assert.equal(alive(Number(leader.pid)), true, 'the group the member was named with killed nothing: its leader is another process now')
})

// martha#628: `kill(0, …)` reaches this run's own process group, and `kill(-0, …)` is the same call. A member whose
// start never named a pid is refused by name instead of being signalled with the number it does not have.
test('a stop is refused by name for a member that was never named with a pid (martha#628)', async (t) => {
  const child = spawn('sleep', ['300'], { stdio: 'ignore' })
  t.after(() => { try { process.kill(Number(child.pid), 'SIGKILL') } catch { /* already gone */ } })
  await assert.rejects(stopMember(aMember('unnamed', child), {}, PROCESSES), /unnamed was never named with a pid \(0\)/)
  assert.equal(alive(Number(child.pid)), true, 'and nothing was signalled: a signal to pid 0 would reach this run itself')
})

// martha#628: the two numbers a stop signals are a pid and the start time held for it; a stop whose recorded leader is
// gone, and whose number belongs to someone else now, is refused by name rather than sent.
test('a stop is refused by name for a member whose pid is no longer the process recorded (martha#628)', async (t) => {
  const wrapper = spawn('sleep', ['300'], { stdio: 'ignore' })
  const leader = spawn('sleep', ['300'], { stdio: 'ignore', detached: true })
  t.after(() => {
    for (const pid of [Number(wrapper.pid), Number(leader.pid)]) { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
  })
  const member = aMember('moved', wrapper, { pid: Number(leader.pid), identity: PROCESSES.identityOf(process.pid) })
  await assert.rejects(stopMember(member, {}, PROCESSES), /moved, pid \d+, is no longer the process this run recorded/)
  assert.equal(alive(Number(leader.pid)), true, 'no signal reached the group whose leader is another process now')
})

// martha#628 r=1: a member whose group leader has ended and been reaped leaves orphans in its group. They are no longer
// anyone's child, so the walk cannot reach them, and a tear-down that signals nothing and says nothing reports a run it
// never reached as ended, which #590 forbids. The group may now be a stranger's, so nothing is signalled; what is left
// in it is refused by name.
test('a group whose leader has ended is refused by name, and the orphans in it are not signalled (martha#628 r=1)', async (t) => {
  const wrapper = spawn('sleep', ['300'], { stdio: 'ignore' })
  // A detached shell leads a group of its own, starts a process in it and exits, so that process is orphaned but keeps
  // the group.
  const leader = spawn('sh', ['-c', `${quoted('sleep')} 300 & echo $!; ${quoted('sleep')} 1`], { stdio: ['ignore', 'pipe', 'ignore'], detached: true })
  const identity = PROCESSES.identityOf(Number(leader.pid))
  const [line] = await once(leader.stdout, 'data')
  const orphan = Number(String(line).trim())
  t.after(() => { for (const pid of [Number(wrapper.pid), orphan]) { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } } })
  await once(leader, 'exit')
  await delay(100)
  assert.notEqual(identity, null, "the leader's start time was held while it lived")
  assert.equal(alive(orphan), true, 'the orphan is in the group before the tear-down')
  const member = aMember('leader gone', wrapper, { pid: Number(leader.pid), identity })
  const refusals = killEvenIfGone(member, PROCESSES)
  assert.equal(refusals.length, 1, `one refusal, the group's: ${JSON.stringify(refusals)}`)
  assert.match(refusals[0] ?? '', new RegExp(`leader gone, pid ${String(leader.pid)}, was not signalled: its group still holds \\d+ process\\(es\\) \\(.*\\b${String(orphan)}\\b`), 'and it names the group and what is left in it')
  assert.equal(alive(orphan), true, 'nothing was signalled to that group: its number may lead another process\'s group now')
})

// martha#628 r=2: the run's own record of its wrapper's start time is what enters the walk. A member built by a copy of
// that line, as the cases above are, would stay green with the run's own line turned off, so this case drives the line
// itself.
test("the run holds its wrapper's start time when it makes a member (martha#628 r=2)", async (t) => {
  const child = spawn('sleep', ['300'], { stdio: 'ignore' })
  t.after(() => { try { process.kill(Number(child.pid), 'SIGKILL') } catch { /* already gone */ } })
  const member = runningMember('recorded', child, PROCESSES)
  assert.equal(member.childIdentity, PROCESSES.identityOf(Number(child.pid)), "the wrapper's start time is the one the kernel holds for its pid")
  assert.notEqual(member.childIdentity, null, 'a wrapper just spawned has a start time to hold')
})

// martha#628 r=2: the wrapper is this process's own child until it is reaped, so a run that holds no start time for it
// cannot vouch for anything under it. The walk is refused by name instead of skipped, which would report a run as ended
// that the tear-down never reached.
test('a wrapper the run holds no start time for is refused by name, and nothing under it is walked (martha#628 r=2)', async (t) => {
  const { wrapper, pids } = await aTreeTwoDeep(t)
  const child = pids[1]
  if (child === undefined) assert.fail('the tree came to a child')
  const refusals = killEvenIfGone(aMember('unheld', wrapper, { childIdentity: null }), PROCESSES)
  assert.equal(refusals.length, 1, `one refusal, the walk's: ${JSON.stringify(refusals)}`)
  assert.match(refusals[0] ?? '', /the wrapper, pid \d+, was never recorded with a start time/, 'and it names what the run never held')
  assert.equal(stateOf(child), 'S', 'nothing under a wrapper the run cannot vouch for is even stopped')
})

// martha#189 r=2: the hold's own promise. The interrupt tests above only show that a run which logs the held line is
// interrupted and fails; a hold that logged and returned at once would leave them green, because the signal still ends
// the run at the step after. This pins the wait itself, with no clock: after the line the promise has not settled, the
// abort settles it, and a run already interrupted returns at once.
test('the hold writes its line and then waits for the interrupt, and one already interrupted returns at once (martha#189 r=2)', async (t) => {
  const step = 'a step this test parks at'
  const before = process.env[HOLD_VARIABLE]
  t.after(() => {
    if (before === undefined) delete process.env[HOLD_VARIABLE]
    else process.env[HOLD_VARIABLE] = before
  })
  process.env[HOLD_VARIABLE] = step
  /** @type {string[]} */
  const lines = []
  const controller = new AbortController()
  let settled = false
  const held = heldAt((line) => lines.push(line), step, controller.signal).then(() => { settled = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(lines, [`${HELD}: ${step}, waiting to be interrupted`], 'the hold says where it parked')
  assert.equal(settled, false, 'the hold is still waiting after its line, and only the interrupt ends it')
  controller.abort()
  await held
  assert.equal(settled, true, 'the interrupt ends the wait')

  const alreadyAborted = new AbortController()
  alreadyAborted.abort()
  const atOnce = await Promise.race([
    heldAt((line) => lines.push(line), step, alreadyAborted.signal).then(() => 'returned'),
    new Promise((resolve) => setImmediate(() => resolve('still waiting')))
  ])
  assert.equal(atOnce, 'returned', 'a run already interrupted does not wait')
})

test('a refused install fails the run and still leaves nothing behind', async () => {
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({ log: (line) => lines.push(line), signedFor: 'refs/heads/main' })
  assert.equal(result.passed, false)
  assert.ok(lines.some((l) => /^FAIL install: .*refs\/heads\/main/.test(l)), lines.join('\n'))
  assert.ok(!lines.some((l) => l.includes('ok on disk:')), 'nothing is checked on disk after a refusal')
  assert.ok(lines.some((l) => l.includes('ok tear down:')), lines.join('\n'))
  assert.ok(!existsSync(result.box), 'the box is gone')
  assert.equal(await stillListening(result.registry), false, 'the registry no longer answers')
})

test('run as a command, it writes the log where it is told and exits 0 on a pass', (t) => {
  const log = join(scratch(t), 'clean-install.log')
  const run = runTheCommand(['--log', log])
  assert.equal(run.status, 0, run.stderr)
  const written = readFileSync(log, 'utf8')
  assert.match(written, /^ok tear down:/m)
  assert.match(written, /^passed; /m)
  nothingLeftOfTheCrew(leftAsLogged(written), SOLO_MEMBERS.length, written)
})

test('run as a command, a failing step exits 1 and the log ends failed', (t) => {
  const log = join(scratch(t), 'clean-install.log')
  // No repository to pack from: the pack step fails.
  const run = runTheCommand(['--log', log], { ...process.env, GIT_DIR: join(scratch(t), 'no-repository') })
  assert.equal(run.status, 1, run.stderr)
  const written = readFileSync(log, 'utf8')
  assert.match(written, /^FAIL pack:/m)
  assert.match(written, /^ok tear down:/m)
  assert.match(written, /failed\n$/)
})

test('run as a command, an error outside the steps exits 1 with a final failed line, not an unhandled rejection', (t) => {
  // No temporary folder to work in: the run cannot even start its steps.
  const run = runTheCommand([], { ...process.env, TMPDIR: join(scratch(t), 'no-such-folder') })
  assert.equal(run.status, 1, run.stderr)
  assert.match(run.stdout, /failed\n$/)
  assert.doesNotMatch(run.stderr, /Unhandled|node:internal|^\s+at /m)
})

test('run as a command, a log it cannot write is an argument refusal: exit 2, nothing runs', (t) => {
  const run = runTheCommand(['--log', join(scratch(t), 'no-such-folder', 'clean-install.log')])
  assert.equal(run.status, 2)
  assert.match(run.stderr, /^prove_a_clean_install: cannot write the log /)
  assert.equal(run.stdout, '', 'no step ran')
})

test('run as a command, it refuses an option it does not know with exit 2 and starts nothing', () => {
  const run = runTheCommand(['--cloud'])
  assert.equal(run.status, 2)
  assert.match(run.stderr, /^prove_a_clean_install: unknown option '--cloud'/)
})
