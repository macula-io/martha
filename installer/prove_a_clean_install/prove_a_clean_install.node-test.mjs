// The clean-install proof's install-and-tear-down half (martha#69), against a local release of the committed tree:
// it installs on a box that starts empty, checks what landed on disk, and leaves nothing behind, whether the install
// passed or was refused.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { removeEvenReadOnly } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { TOP } from '../unpack_the_release_layer/unpack_the_release_layer.mjs'
import { proveACleanInstall, startedLineSource, HELD, HOLD_VARIABLE, WORK_PREFIX } from './prove_a_clean_install.mjs'

const SCRIPT = fileURLToPath(new URL('./prove_a_clean_install.mjs', import.meta.url))
// The solo crew as the committed tree declares it; computed, so the installer's typecheck does not follow it into src.
const SOLO_CREW = fileURLToPath(new URL('../../src/declare_a_solo_crew/declare_a_solo_crew.ts', import.meta.url))
const { SOLO_MEMBERS } = /** @type {{ SOLO_MEMBERS: ReadonlyArray<{ name: string }> }} */ (await import(SOLO_CREW))
// The line `martha start` prints once a member is up, as the committed tree makes it; computed for the same reason.
const COMMAND = fileURLToPath(new URL('../../src/run_the_martha_command/run_the_martha_command.ts', import.meta.url))
const { startedLine } = /** @type {{ startedLine: (member: string, pid: string) => string }} */ (await import(COMMAND))
// The relay's declared files and the name of a launch's copy of them (martha#117), computed for the same reason.
const RELAY_COPY = fileURLToPath(new URL('../../src/launch_a_claude_code_member/relay_copy.ts', import.meta.url))
const { RELAY_FILES, RELAY_COPY_NAME } = /** @type {{ RELAY_FILES: readonly string[], RELAY_COPY_NAME: string }} */ (await import(RELAY_COPY))
// A command run that hangs fails here instead of stalling the suite to its own timeout.
const COMMAND_TIMEOUT_MS = 50_000
// The mode a planted defect gives the release: writable by its owner, which a placed release never is.
const WRITABLE = 0o755

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
    chmodSync: (/** @type {string} */ dir, /** @type {number} */ mode) => { chmodSync(dir, mode); opened.add(dir) },
    readdirSync: (/** @type {string} */ dir, /** @type {object} */ options) => {
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
      readdirSync: (/** @type {string} */ dir, /** @type {object} */ options) => {
        if (dir === unreadable) throw denied
        return readdirSync(dir, options)
      },
      rmSync
    }),
    /EACCES: permission denied, scandir/
  )
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
