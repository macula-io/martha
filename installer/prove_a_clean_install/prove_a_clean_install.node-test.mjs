// The clean-install proof's install-and-tear-down half (martha#69), against a local release of the committed tree:
// it installs on a box that starts empty, checks what landed on disk, and leaves nothing behind, whether the install
// passed or was refused.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { removeEvenReadOnly } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { TOP } from '../unpack_the_release_layer/unpack_the_release_layer.mjs'
import { proveACleanInstall, WORK_PREFIX } from './prove_a_clean_install.mjs'

const SCRIPT = fileURLToPath(new URL('./prove_a_clean_install.mjs', import.meta.url))
// The solo crew as the committed tree declares it; computed, so the installer's typecheck does not follow it into src.
const SOLO_CREW = fileURLToPath(new URL('../../src/declare_a_solo_crew/declare_a_solo_crew.ts', import.meta.url))
/** @type {ReadonlyArray<{ name: string }>} */
const { SOLO_MEMBERS } = await import(SOLO_CREW)
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
  for (const { name, pid } of result.members) assert.equal(alive(pid), false, `${name}, pid ${pid}, has ended`)
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
  assert.equal(lines.at(-1), 'failed')
  assert.ok(!existsSync(result.box), 'the box is gone')
  assert.equal(await stillListening(result.registry), false, 'the registry no longer answers')
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
})

for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  test(`run as a command, ${signal} mid-run fails the run and still tears down: no work folder is left`, async (t) => {
    const tmp = scratch(t)
    const run = spawn(process.execPath, [SCRIPT], { env: { ...process.env, TMPDIR: tmp }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const served = new Promise((resolve) => run.stdout.on('data', (chunk) => { out += chunk; if (/^ok serve:/m.test(out)) resolve(undefined) }))
    const ended = new Promise((resolve) => run.once('exit', (code, sig) => resolve({ code, sig })))
    const timer = setTimeout(() => run.kill('SIGKILL'), COMMAND_TIMEOUT_MS)
    t.after(() => clearTimeout(timer))
    await Promise.race([served, ended])
    run.kill(signal)
    const { code, sig } = /** @type {{ code: number | null, sig: string | null }} */ (await ended)
    assert.equal(sig, null, `the run ended by itself, not by ${sig}\n${out}`)
    assert.equal(code, 1, out)
    assert.match(out, new RegExp(`^FAIL .*interrupted by ${signal}`, 'm'))
    assert.match(out, /^ok tear down:/m)
    assert.match(out, /failed\n$/)
    const left = readdirSync(tmp).filter((name) => name.startsWith(WORK_PREFIX))
    assert.deepEqual(left, [], 'no work folder is left behind')
  })
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
