// The nightly driver, run for real (martha#696): each case copies run_the_night_on_main.sh into a throwaway repository
// of its own, at its real path, beside a stand-in packer and a stand-in proof, with an `origin` to fetch from. The
// stand-ins record what they were given and exit as the case asks, so what is proved is the driver's own order: what
// it refuses before anything is packed, which exit each outcome gets, what it hands the proof, and that one temp
// folder holds the run and goes with it, a signal included.
//
// No code is spelled here. The driver's codes and its night folder's name are read from the driver, the packer's
// NOT_PACKABLE from the packer and the proof's DRY_PASSED from the proof. The stand-in proof's DRY_PASSED is planted
// above every code the driver defines, so a driver that spells the real proof's value goes red. Each case removes
// everything it made.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { aScriptsConstant } from './read_a_scripts_constant.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const DRIVER = join(HERE, 'run_the_night_on_main.sh')
const PACKER = join(HERE, 'pack_main_as_a_dry_layer.sh')
const DRIVER_TEXT = readFileSync(DRIVER, 'utf8')

/** A word the driver defines on a line of its own, `NAME=<word>` or `NAME='<text>'`, read from the driver. @param {string} name */
const aDriversWord = (name) => {
  const found = new RegExp(`^${name}='?([^'\\n]+)'?$`, 'm').exec(DRIVER_TEXT)?.[1]
  if (found === undefined) throw new Error(`${DRIVER} defines no ${name}`)
  return found
}

const PROOF_REL = aDriversWord('PROOF_REL')
const NIGHT_FOLDER_NAME = aDriversWord('NIGHT_FOLDER_NAME')
const FAILED = aScriptsConstant(DRIVER, 'FAILED')
const REFUSED = aScriptsConstant(DRIVER, 'REFUSED')
const PACK_FAILED = aScriptsConstant(DRIVER, 'PACK_FAILED')
const NOT_PACKABLE_TONIGHT = aScriptsConstant(DRIVER, 'NOT_PACKABLE_TONIGHT')
const NOT_PACKABLE = aScriptsConstant(PACKER, 'NOT_PACKABLE')
const DRY_PASSED = aScriptsConstant(join(REPO, PROOF_REL), 'DRY_PASSED')
/** The stand-in proof's dry pass: above every code the driver defines, so it is never the real proof's own. */
const PLANTED_DRY_PASSED = Math.max(DRY_PASSED, FAILED, REFUSED, PACK_FAILED, NOT_PACKABLE_TONIGHT) + 2
/** A packer that refused, and one that could not run: neither is the driver's own PACK_FAILED. */
const PACKER_REFUSED = 1
const PACKER_COULD_NOT_RUN = 2
const A_HOST = 'a-host-of-the-test'
/** How long a held proof may take to say it is running before the case gives up. */
const READY_WITHIN_MS = 20_000
const READY_POLL_MS = 50
const STOPPED_WITHIN_MS = 10_000
const STILL_RUNNING = Symbol("the driver still runs")

/** git in `dir`, failing the test on a non-zero exit. @param {string} dir @param {...string} args */
const git = (dir, ...args) => {
  const run = spawnSync('git', ['-c', 'user.name=night', '-c', 'user.email=night@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' })
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout.trim()
}

/** The stand-in packer: records its arguments and TMPDIR, writes a layer when it exits 0. @param {string} constant */
const standInPacker = (constant) => `#!/usr/bin/env bash
${constant}=${NOT_PACKABLE}
printf '%s\\n' "$@" > "\${STAND_IN_RECORD}/packer.args"
printf '%s\\n' "\${TMPDIR}" > "\${STAND_IN_RECORD}/packer.tmpdir"
code="\${STAND_IN_PACK_EXIT:-0}"
if [ "\${code}" = 0 ]; then printf 'a layer of %s\\n' "$1" > "$2"; fi
exit "\${code}"
`

/**
 * The stand-in proof: records its arguments, its TMPDIR and whether the --night folder was there when it started.
 * Held, it leaves a file in its TMPDIR and waits to be stopped.
 * @param {{ constant: string, night: boolean }} options
 */
const standInProof = ({ constant, night }) => `#!/usr/bin/env bash
USAGE='usage: proof <ssh-host> [--log <file>]${night ? ' [--night <run folder>]' : ''} [--dry-layer <layer> <sha>]'
${constant}=${PLANTED_DRY_PASSED}
printf '%s\\n' "$@" > "\${STAND_IN_RECORD}/proof.args"
printf '%s\\n' "\${TMPDIR}" > "\${STAND_IN_RECORD}/proof.tmpdir"
previous=''
for word in "$@"; do
  if [ "\${previous}" = --night ]; then if [ -e "\${word}" ]; then echo there; else echo absent; fi > "\${STAND_IN_RECORD}/night.state"; fi
  previous="\${word}"
done
if [ -n "\${STAND_IN_HOLD:-}" ]; then
  : > "\${TMPDIR}/left-by-the-proof"
  echo "$$" > "\${STAND_IN_RECORD}/proof.pid"
  : > "\${STAND_IN_RECORD}/proof.ready"
  exec sleep 300
fi
exit "\${STAND_IN_PROOF_EXIT:-0}"
`

/** `text` written to `file` in `dir`, as an executable. @param {string} dir @param {string} file @param {string} text */
const placeAScript = (dir, file, text) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), text, { mode: 0o755 })
}

/**
 * A throwaway night: a repository holding the real driver at its real path and the two stand-ins, committed and
 * pushed to an `origin` beside it, an evidence root, a folder the stand-ins record into, and the TMPDIR the driver is
 * given. Removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {{ packerConstant?: string, proofConstant?: string, night?: boolean }} [options]
 */
function aNight (t, { packerConstant = 'NOT_PACKABLE', proofConstant = 'DRY_PASSED', night = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-night-')))
  t.after(() => removeTheTree(root))
  const [dir, origin, evidence, record, parentTmp] = ['repo', 'origin.git', 'evidence', 'record', 'tmp'].map((name) => join(root, name))
  for (const folder of [dir, evidence, record, parentTmp]) mkdirSync(folder)
  git(root, 'init', '--quiet', '--bare', '--initial-branch=main', origin)
  git(dir, 'init', '--quiet', '--initial-branch=main')
  mkdirSync(dirname(join(dir, relative(REPO, DRIVER))), { recursive: true })
  copyFileSync(DRIVER, join(dir, relative(REPO, DRIVER)))
  placeAScript(dir, relative(REPO, PACKER), standInPacker(packerConstant))
  placeAScript(dir, PROOF_REL, standInProof({ constant: proofConstant, night }))
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', 'the night')
  git(dir, 'remote', 'add', 'origin', origin)
  git(dir, 'push', '--quiet', 'origin', 'main')
  git(dir, 'fetch', '--quiet', 'origin')
  return { root, dir, origin, evidence, record, parentTmp, head: git(dir, 'rev-parse', 'HEAD') }
}

/** The driver's environment for one run: the case's own TMPDIR and stand-in settings, nothing inherited of them. */
const envFor = (night, settings = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('STAND_IN_')))
  return { ...env, TMPDIR: night.parentTmp, STAND_IN_RECORD: night.record, ...settings }
}

/** The copied driver in a night's repository. */
const driverIn = (night) => join(night.dir, relative(REPO, DRIVER))

/** The lines a stand-in recorded, or undefined when it never ran. @param {string} record @param {string} name */
const recorded = (record, name) => (existsSync(join(record, name)) ? readFileSync(join(record, name), 'utf8').split('\n').slice(0, -1) : undefined)

/** run.txt of a run folder as key=value pairs. @param {string} run */
const runTxt = (run) => new Map(readFileSync(join(run, 'run.txt'), 'utf8').split('\n').filter(Boolean).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))

/** The one run folder under the evidence root, or undefined. */
const runFolderOf = (night) => {
  const runs = readdirSync(night.evidence)
  assert.ok(runs.length <= 1, `one run folder at most: ${runs.join(', ')}`)
  return runs[0] === undefined ? undefined : join(night.evidence, runs[0])
}

/** The driver run to its end with `args`. */
function drive (night, args, settings = {}) {
  const run = spawnSync('bash', [driverIn(night), ...args], { encoding: 'utf8', env: envFor(night, settings), timeout: 60_000 })
  return { status: run.status, said: `${run.stdout}${run.stderr}`, run: runFolderOf(night) }
}

/** The driver given the night's evidence root, with `more` after it. */
const withEvidence = (night, ...more) => [A_HOST, '--evidence', night.evidence, ...more]

/** A run that was refused before anything was packed: REFUSED, no packer, no run folder. */
const assertRefusedBeforePacking = (night, outcome, said) => {
  assert.equal(outcome.status, REFUSED, outcome.said)
  assert.equal(recorded(night.record, 'packer.args'), undefined, 'the packer never ran')
  assert.equal(outcome.run, undefined, 'no run folder was made')
  if (said !== undefined) assert.match(outcome.said, said)
}

test('the codes the driver reads are defined in the real packer and the real proof, and none is a pass', () => {
  for (const code of [DRY_PASSED, NOT_PACKABLE, FAILED, REFUSED, PACK_FAILED, NOT_PACKABLE_TONIGHT]) {
    assert.ok(Number.isInteger(code) && code > 0, String(code))
  }
  assert.notEqual(PLANTED_DRY_PASSED, DRY_PASSED)
  assert.notEqual(PACK_FAILED, PACKER_REFUSED)
  assert.notEqual(PACK_FAILED, PACKER_COULD_NOT_RUN)
  assert.notEqual(NOT_PACKABLE_TONIGHT, NOT_PACKABLE)
})

test('1. bad arguments are refused before anything is fetched or packed (mutant: the sha check dropped)', (t) => {
  const night = aNight(t)
  assertRefusedBeforePacking(night, drive(night, []), /usage:/)
  assertRefusedBeforePacking(night, drive(night, [A_HOST]), /usage:/)
  assertRefusedBeforePacking(night, drive(night, withEvidence(night, '--sha', night.head.slice(0, 12))), /40-character sha/)
  assertRefusedBeforePacking(night, drive(night, withEvidence(night, '--sha', 'f'.repeat(night.head.length))), /is not a commit/)
  assertRefusedBeforePacking(night, drive(night, withEvidence(night, '--a-flag-nobody-knows')), /usage:/)
})

test('2. a dirty proof tree is refused, and so is a proof or a packer missing its constant (mutants: each read dropped)', (t) => {
  const dirty = aNight(t)
  writeFileSync(join(dirty.dir, 'left-behind.txt'), 'not committed\n')
  assertRefusedBeforePacking(dirty, drive(dirty, withEvidence(dirty)), /is not clean/)
  const noDryPass = aNight(t, { proofConstant: 'WAS_DRY_PASSED' })
  assertRefusedBeforePacking(noDryPass, drive(noDryPass, withEvidence(noDryPass)), /defines no DRY_PASSED/)
  const noNotPackable = aNight(t, { packerConstant: 'WAS_NOT_PACKABLE' })
  assertRefusedBeforePacking(noNotPackable, drive(noNotPackable, withEvidence(noNotPackable)), /defines no NOT_PACKABLE/)
})

test('3. a packer that refused or could not run is PACK_FAILED, and the proof never runs (mutant: the packer exit passed through)', (t) => {
  for (const code of [PACKER_REFUSED, PACKER_COULD_NOT_RUN]) {
    const night = aNight(t)
    const outcome = drive(night, withEvidence(night), { STAND_IN_PACK_EXIT: String(code) })
    assert.equal(outcome.status, PACK_FAILED, outcome.said)
    assert.equal(recorded(night.record, 'proof.args'), undefined, 'the proof never ran')
    assert.equal(runTxt(outcome.run).get('pack_exit'), String(code))
    assert.equal(runTxt(outcome.run).get('result'), `the packer exited ${code}`)
  }
})

test('4. an installer ahead of its tag is NOT_PACKABLE_TONIGHT, said as not packable, and the proof never runs (mutant: a plain refusal)', (t) => {
  const night = aNight(t)
  const outcome = drive(night, withEvidence(night), { STAND_IN_PACK_EXIT: String(NOT_PACKABLE) })
  assert.equal(outcome.status, NOT_PACKABLE_TONIGHT, outcome.said)
  assert.match(outcome.said, /not packable: installer ahead of its tag/)
  assert.equal(runTxt(outcome.run).get('result'), 'not packable: installer ahead of its tag')
  assert.equal(recorded(night.record, 'proof.args'), undefined, 'the proof never ran')
})

test('5. a dry pass is the proof\'s own DRY_PASSED, with the layer kept by its sha256 and the proof given what it needs (mutant: exit 0)', (t) => {
  const night = aNight(t)
  const outcome = drive(night, withEvidence(night, '--sha', night.head, '--', 'one more', '--two'), { STAND_IN_PROOF_EXIT: String(PLANTED_DRY_PASSED) })
  assert.equal(outcome.status, PLANTED_DRY_PASSED, outcome.said)
  const [packedSha, layer] = recorded(night.record, 'packer.args') ?? []
  assert.equal(packedSha, night.head)
  assert.equal(dirname(layer ?? ''), outcome.run)
  assert.ok(outcome.run?.endsWith(`_${night.head.slice(0, 7)}`), outcome.run)
  const kept = runTxt(outcome.run)
  assert.equal(kept.get('layer_sha256'), createHash('sha256').update(readFileSync(layer ?? '')).digest('hex'))
  assert.equal(kept.get('proof_exit'), String(PLANTED_DRY_PASSED))
  assert.equal(kept.get('sha'), night.head)
  assert.ok(kept.has('ended'))
  assert.deepEqual(recorded(night.record, 'proof.args'), [A_HOST, '--log', join(outcome.run ?? '', 'proof.log'), '--dry-layer', layer, night.head, 'one more', '--two'])
})

test('5b. the packer and the proof share one temp folder under the given TMPDIR, and it goes with the run', (t) => {
  const night = aNight(t)
  drive(night, withEvidence(night), { STAND_IN_PROOF_EXIT: String(PLANTED_DRY_PASSED) })
  const [packerTmp] = recorded(night.record, 'packer.tmpdir') ?? []
  assert.deepEqual(recorded(night.record, 'proof.tmpdir'), [packerTmp])
  assert.equal(dirname(packerTmp ?? ''), night.parentTmp)
  assert.equal(existsSync(packerTmp ?? ''), false, 'the run\'s temp folder is gone')
  assert.deepEqual(readdirSync(night.parentTmp), [])
})

test('6. a proof that exits 0 on a dry layer claims a release\'s pass, and the driver fails it (mutant: 0 passed through)', (t) => {
  const night = aNight(t)
  const outcome = drive(night, withEvidence(night), { STAND_IN_PROOF_EXIT: '0' })
  assert.equal(outcome.status, FAILED, outcome.said)
  assert.match(outcome.said, /claimed a release's pass on a dry layer/)
})

test('7. with no --sha, the packer gets origin/main after a fetch that moved it (mutant: the fetch dropped)', (t) => {
  const night = aNight(t)
  const other = join(night.root, 'other')
  git(night.root, 'clone', '--quiet', '--branch', 'main', night.origin, other)
  writeFileSync(join(other, 'moved.txt'), 'origin moved on\n')
  git(other, 'add', '-A')
  git(other, 'commit', '--quiet', '-m', 'origin moved on')
  git(other, 'push', '--quiet', 'origin', 'main')
  const moved = git(other, 'rev-parse', 'HEAD')
  assert.notEqual(moved, git(night.dir, 'rev-parse', 'origin/main'), 'the clone has not seen the move yet')
  drive(night, withEvidence(night), { STAND_IN_PROOF_EXIT: String(PLANTED_DRY_PASSED) })
  assert.equal(recorded(night.record, 'packer.args')?.[0], moved)
})

/** Waits until the held proof says it runs, or fails the case. @param {string} record */
async function untilTheProofRuns (record) {
  for (let waited = 0; waited < READY_WITHIN_MS; waited += READY_POLL_MS) {
    if (existsSync(join(record, 'proof.ready'))) return
    await sleep(READY_POLL_MS)
  }
  assert.fail('the held proof never said it runs')
}

/** Whether a process is still there. @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('8. a TERM stops the proof, removes the run\'s temp folder and leaves nothing in TMPDIR, and is never a pass (mutant: the trap\'s rm dropped)', async (t) => {
  const night = aNight(t)
  const driver = spawn('bash', [driverIn(night), ...withEvidence(night)], { env: envFor(night, { STAND_IN_HOLD: '1' }), stdio: 'ignore' })
  const ended = new Promise((resolve) => driver.on('close', (code) => resolve(code)))
  t.after(() => driver.kill('SIGKILL'))
  await untilTheProofRuns(night.record)
  const proofPid = Number(recorded(night.record, 'proof.pid')?.[0])
  t.after(() => alive(proofPid) && process.kill(proofPid, 'SIGKILL'))
  driver.kill('SIGTERM')
  const deadline = new AbortController()
  const code = await Promise.race([ended, sleep(STOPPED_WITHIN_MS, STILL_RUNNING, { signal: deadline.signal })])
  deadline.abort()
  assert.notEqual(code, STILL_RUNNING, 'the driver ended soon after a TERM, so it stopped the proof (mutant: the child not stopped)')
  assert.equal(code, FAILED)
  assert.notEqual(code, PLANTED_DRY_PASSED)
  assert.equal(alive(proofPid), false, 'the proof was stopped')
  assert.equal(existsSync(recorded(night.record, 'proof.tmpdir')?.[0] ?? ''), false, 'the run\'s temp folder is gone')
  assert.deepEqual(readdirSync(night.parentTmp), [])
  assert.ok(runTxt(runFolderOf(night) ?? '').has('interrupted'))
})

test('9. a proof that takes --night is given <run folder>/NIGHT_FOLDER_NAME, not made yet; one that does not is given none (mutants: made first, never passed)', (t) => {
  const withNight = aNight(t, { night: true })
  const outcome = drive(withNight, withEvidence(withNight), { STAND_IN_PROOF_EXIT: String(PLANTED_DRY_PASSED) })
  const nightFolder = join(outcome.run ?? '', NIGHT_FOLDER_NAME)
  const args = recorded(withNight.record, 'proof.args') ?? []
  assert.equal(args[args.indexOf('--night') + 1], nightFolder, args.join(' '))
  assert.deepEqual(recorded(withNight.record, 'night.state'), ['absent'])
  assert.equal(runTxt(outcome.run).get('night_folder'), nightFolder)
  const without = aNight(t)
  const plain = drive(without, withEvidence(without), { STAND_IN_PROOF_EXIT: String(PLANTED_DRY_PASSED) })
  assert.equal(recorded(without.record, 'proof.args')?.includes('--night'), false)
  assert.equal(runTxt(plain.run).has('night_folder'), false)
})

// The lab's host names are not checked here: check:private on the range holds them, against the names it is given.
test('10. the driver names no home and no token, nor a path to one', () => {
  for (const home of [/\$\{?HOME\b/, /~\//, /\/home\//, /\/Users\//, /\/root\//]) assert.doesNotMatch(DRIVER_TEXT, home)
  for (const token of [/github_pat_/, /\bghp_/, /\btoken[._-]?(file|path)\b/i, /\.token\b/, /\/tokens?\//, /\bGH_TOKEN\b|\bGITHUB_TOKEN\b/]) assert.doesNotMatch(DRIVER_TEXT, token)
})
