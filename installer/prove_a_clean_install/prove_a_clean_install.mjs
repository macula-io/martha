#!/usr/bin/env node
// The clean-install proof (martha#69), its install-and-tear-down half, against a local release: the committed tree,
// packed from what the release job packs (git archive of HEAD), served by a local registry, installed by the installer's
// own steps onto a box that starts empty, checked on disk, and then the box and the registry are removed, whether
// the install passed or was refused. Every step is one log line, "ok <step>: ..." or "FAIL <step>: ...", and the run
// ends with "passed" (repeating that the signature check was stood in) or "failed". The tear-down's own result counts:
// a run whose registry would not stop or whose box stayed behind has failed.
//
// A local release is signed by nobody, so sigstore's bundle check is stood in for, as the installer's own tests do
// (serve_a_release_locally.mjs); the signer, the repository and the ref are still checked. The log says so.
//
// Then the installed command brings up the solo crew as an owner would, in a fresh git checkout on the box:
// `martha init`, `martha approve` (nothing to approve in a fresh checkout, and the log says so) and `martha start`
// for every member, each on a terminal of its own (util-linux script), as start and approve run only on one. The
// host is a stand-in `claude` written from the installed tree's own host_stand_in.ts: it answers the launcher's
// questions, notes the arguments it was started with, and stays up. A member is up when `martha start` names it and
// its pid, that pid is alive, and its host was started with the launch's own copy of the installed release's relay
// (martha#117), byte for byte its declared files. Each member is
// then stopped, and its pid must end. Members never hand text to each other: the owner relays every hand-off
// (martha#51), so there is nothing between them to check here. A cloud box is never started from here.
//
// SIGINT or SIGTERM fails the run: the step in progress finishes or gives up, no further step starts, and the
// tear-down still runs, stopping every member and removing the box, so an interrupted run leaves nothing behind.
//
//   node installer/prove_a_clean_install/prove_a_clean_install.mjs [--log <file>]
//
// Exit: 0 passed, 1 a step failed, the run was interrupted, or anything else went wrong once the run began; 2 the
// arguments were refused (an unknown option, or a log it cannot write) and nothing ran.
// Not shipped (package.json "files" leaves it out).
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { gzipSync } from 'node:zlib'

import { installRelease, placesOnThisMachine } from '../install_a_release/install_a_release.mjs'
import { NAMES, releaseRef } from '../keep_the_names_in_one_place/names.mjs'
import { SIGNER, release, removeEvenReadOnly, serveRegistry, sigstoreStandIn, treeOf } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { TOP } from '../unpack_the_release_layer/unpack_the_release_layer.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// A release mode: read-only, as place_the_release leaves it.
const READ_ONLY = 0o555
// What an install may write under the box's home, and the folders on the way to them.
const INSTALLED_UNDER = [join('.local', 'share', NAMES.releaseFolder), join('.local', 'bin')]
const ON_THE_WAY = ['.local', join('.local', 'share')]
// Said by the serve step and again by the final line of a passed run: nothing signed this release.
const STOOD_IN = 'the sigstore bundle check is stood in, a local release is signed by nobody'
// The signals that interrupt a run; it then tears down before it ends.
const INTERRUPTS = /** @type {const} */ (['SIGINT', 'SIGTERM'])
// How long a member has to come up, and then to end once it is stopped.
const MEMBER_WAIT_MS = 30_000
// How often a wait for a member looks again.
const POLL_MS = 50
// How long the stand-in host stays up unless it is stopped: far longer than any run. The stand-in never reports its
// session's start, so on a terminal the launcher's backstop would stop it after TRUST_ANSWER_DEADLINE_MS (ten minutes,
// host_runs_the_relay.ts); a run stops every member long before, so the backstop never fires here and is no part of it.
const HOST_HOLDS_SECONDS = 600
// The stand-in host's mode: its owner may run it.
const RUNNABLE = 0o700
// The fresh checkout's committer, whom `martha init` declares the solo crew for.
const OWNER = 'clean install'
// util-linux script, giving a command a terminal of its own and ending with its status.
const ON_A_TERMINAL = ['--quiet', '--return', '--command']
// What script writes as a terminal's line end.
const TERMINAL_LINE_END = /\r\n/g
// Where the pid goes when the release's own started line is turned into a pattern.
const PID_AT = '\u0000'

/** What the run's work folder under TMPDIR is named after. */
export const WORK_PREFIX = 'martha-clean-install-'

/**
 * The variable a test sets to park the run at one named step, so the interrupt it sends lands at the state the test
 * asserts instead of wherever the run had got to when the signal arrived (martha#189).
 */
export const HOLD_VARIABLE = 'MARTHA_CLEAN_INSTALL_HOLD'

/** What a parked run writes before it waits: the line a test waits for, so it never sleeps and never retries (martha#189). */
export const HELD = 'held'

class StepFailed extends Error {}

/**
 * Defects a test plants, to see the proof catch them; a real run plants nothing.
 * @typedef {{ box: string, expected: string, installed: Awaited<ReturnType<typeof installRelease>>, places: import('../place_the_release/place_the_release.mjs').Places }} OnDisk
 * @typedef {{
 *   onDisk?: (on: OnDisk) => void,
 *   atTearDown?: (registry: Awaited<ReturnType<typeof serveRegistry>>) => void,
 *   host?: (script: string[]) => string[],
 *   relay?: (dir: string) => string,
 *   hostArgs?: (args: string[]) => string[],
 *   answersFor?: (pid: number, alive: boolean) => boolean
 * }} Plant
 * answersFor: whether a pid still answers, given whether it does; a test plants a late reap with it.
 */

/**
 * The run's log and what interrupts it.
 * @typedef {{ log: (line: string) => void, signal?: AbortSignal }} Run
 */

/** @param {unknown} error */
const reason = (error) => error instanceof Error ? error.message : String(error)

/** @param {AbortSignal | undefined} signal */
const interruptedBy = (signal) => `interrupted by ${String(signal?.reason)}`

/**
 * Parks the run at `step` when a test named it with HOLD_VARIABLE: it says so in the log, then waits for the
 * interrupt, which is the only thing that ends the wait. A run nobody parked for returns at once, and so does a run
 * already interrupted. This is what makes an interrupt land at the state a test names rather than at whatever the run
 * had reached when the signal arrived (martha#189). Exported so a test can pin the wait itself, which no run-level test
 * can: a hold that logged and returned at once still leaves an interrupted run failing a step later (martha#189 r=2).
 * @param {(line: string) => void} log
 * @param {string} step
 * @param {AbortSignal | undefined} signal
 */
export async function heldAt (log, step, signal) {
  if ((process.env[HOLD_VARIABLE] ?? '').trim() !== step) return
  log(`${HELD}: ${step}, waiting to be interrupted`)
  if (signal === undefined) return
  await new Promise((resolve) => {
    if (signal.aborted) resolve(undefined)
    else signal.addEventListener('abort', resolve, { once: true })
  })
}

/**
 * Runs one step: its result is the line's detail; a throw is a FAIL line and stops the steps after it. A step does
 * not begin once the run is interrupted.
 * @template T
 * @param {Run} run
 * @param {string} name
 * @param {() => Promise<{ value: T, detail: string }> | { value: T, detail: string }} body
 * @returns {Promise<T>}
 */
async function step ({ log, signal }, name, body) {
  try {
    if (signal?.aborted) throw new Error(`${interruptedBy(signal)} before it began`)
    const { value, detail } = await body()
    log(`ok ${name}: ${detail}`)
    return value
  } catch (error) {
    log(`FAIL ${name}: ${reason(error)}`)
    throw new StepFailed(name)
  }
}

/**
 * The committed tree as the release job packs it, and its version, from the checkout this script sits in.
 * @param {string} expected where the same tree is unpacked, to compare the install against
 */
function packTheCommittedTree (expected) {
  const repo = execFileSync('git', ['-C', HERE, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const { version } = JSON.parse(execFileSync('git', ['-C', repo, 'show', 'HEAD:package.json'], { encoding: 'utf8' }))
  // The tree, not the commit: a commit's archive opens with a pax global header carrying its id, which the release's
  // layer (built from the unpacked files) never holds and the installer refuses.
  const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', `--prefix=${TOP}/`, 'HEAD^{tree}'], { maxBuffer: 1 << 28 })
  mkdirSync(expected)
  execFileSync('tar', ['-x', '-C', expected], { input: tar })
  return { value: { version: String(version), tar }, detail: `${head} as ${TOP} ${version}, ${tar.length} bytes of tar` }
}

/**
 * What the install left on the box: the read-only release, current linked to it, exactly the committed tree, the
 * command as the installer reports it, and nothing outside Martha's places.
 * @param {OnDisk} on
 */
function checkTheDisk ({ box, expected, installed, places }) {
  const mode = lstatSync(installed.release).mode & 0o777
  if (mode !== READ_ONLY) throw new Error(`${installed.release} is mode ${mode.toString(8)}, not ${READ_ONLY.toString(8)}`)
  if (readlinkSync(places.current) !== installed.release) throw new Error(`${places.current} does not point at ${installed.release}`)
  const got = treeOf(join(installed.release, TOP))
  const want = treeOf(join(expected, TOP))
  if (!isDeepStrictEqual(got, want)) throw new Error(`the installed tree is not the committed tree (${got.size} entries, ${want.size} committed)`)
  const stray = readdirSync(box, { recursive: true, encoding: 'utf8' })
    .filter((p) => !ON_THE_WAY.includes(p) && !INSTALLED_UNDER.some((place) => p === place || p.startsWith(`${place}/`)))
  if (stray.length) throw new Error(`the install wrote outside Martha's places: ${stray.slice(0, 5).join(', ')}`)
  return { value: undefined, detail: `${installed.release} read-only, current linked, ${got.size} entries match the commit; ${installed.command}` }
}

/**
 * A member as `martha start` runs it on its terminal: its pid once it is named, and how it ended once it has.
 * @typedef {{ name: string, child: import('node:child_process').ChildProcess, pid: number, said: string, ended: string, exited: Promise<string> }} Member
 */

/**
 * What the run has started so far, for the tear-down to remove.
 * @typedef {{ work?: string, registry?: Awaited<ReturnType<typeof serveRegistry>>, relayRoot?: string, members: Member[] }} Running
 */

/**
 * The run: pack, serve, install, check, start the crew, and always tear down. It resolves whatever goes wrong: an
 * error outside the steps is logged as "FAIL run: ..." and fails the run like a failed step, and so does an
 * interruption no step reported.
 * @param {{ log?: (line: string) => void, signedFor?: string, plant?: Plant, signal?: AbortSignal }} [options]
 *   signedFor: the ref the stood-in signature is for; the release's own tag unless a test names another.
 *   plant: defects a test plants; see Plant.
 *   signal: interrupts the run; see INTERRUPTS.
 */
export async function proveACleanInstall ({ log = console.log, signedFor, plant = {}, signal } = {}) {
  /** @type {Running} */
  const running = { members: [] }
  const stepsPassed = await runTheSteps({ run: { log, signal }, signedFor, plant, running })
  const passed = await tearDown(log, running, plant) && stepsPassed
  log(passed ? `passed; ${STOOD_IN}` : 'failed')
  return { passed, ...whereTheyWere(running), members: running.members.map(({ name, pid }) => ({ name, pid })) }
}

/**
 * Every step before the tear-down; true when each passed and nothing interrupted the run.
 * @param {{ run: Run, signedFor?: string, plant: Plant, running: Running }} steps
 */
async function runTheSteps ({ run, signedFor, plant, running }) {
  try {
    running.work = mkdtempSync(join(tmpdir(), WORK_PREFIX))
    await installAndStart({ run, signedFor, plant, work: running.work, running })
  } catch (error) {
    if (!(error instanceof StepFailed)) run.log(`FAIL run: ${reason(error)}`)
    return false
  }
  if (!run.signal?.aborted) return true
  run.log(`FAIL run: ${interruptedBy(run.signal)}`)
  return false
}

/**
 * Where the box, the registry and the relay root were, for a caller to check they are gone; empty when the run never
 * made them.
 * @param {Running} running
 */
function whereTheyWere ({ work, registry, relayRoot }) {
  return { box: work ? join(work, 'box') : '', registry: registry?.base ?? '', relayRoot: relayRoot ?? '' }
}

/**
 * The steps before the tear-down; whatever starts is kept in `running` the moment it does, so the tear-down finds it.
 * @param {{ run: Run, signedFor?: string, plant: Plant, work: string, running: Running }} run
 */
async function installAndStart ({ run, signedFor, plant, work, running }) {
  const box = join(work, 'box')
  const { version, tar } = await step(run, 'pack', () => packTheCommittedTree(join(work, 'expected')))
  const r = release({ version, gzipped: gzipSync(tar) })
  const registry = await step(run, 'serve', async () => {
    running.registry = await serveRegistry([r])
    return { value: running.registry, detail: `${running.registry.base} serves ${version} at ${r.digest}; ${STOOD_IN}` }
  })
  mkdirSync(box)
  const places = placesOnThisMachine(box, undefined)
  const verifier = sigstoreStandIn(new Map([[r.digest, { ref: signedFor ?? releaseRef(version) }]]))
  const installed = await step(run, 'install', async () => {
    const done = await installRelease({ places, version, base: registry.base, signers: [SIGNER], makeVerifier: verifier, log: () => {} })
    return { value: done, detail: `${done.version} ${done.digest} onto a box that started empty` }
  })
  const onDisk = { box, expected: join(work, 'expected'), installed, places }
  plant.onDisk?.(onDisk)
  await step(run, 'on disk', () => checkTheDisk(onDisk))
  await startTheCrew({ run, work, box, places, installed, plant, running })
}

/**
 * The installed tree's own module at `path` under its src: the proof stands in for the host and names the crew the
 * way the release it installed does.
 * @param {{ release: string }} installed
 * @param {string[]} path
 */
const fromTheRelease = ({ release }, ...path) => import(join(release, TOP, 'src', ...path))

/**
 * `martha init`, `martha approve`, then every member of the solo crew started and stopped again, each a step.
 * @param {{ run: Run, work: string, box: string, places: import('../place_the_release/place_the_release.mjs').Places, installed: { release: string }, plant: Plant, running: Running }} on
 */
async function startTheCrew ({ run, work, box, places, installed, plant, running }) {
  const { hostAnswers } = await fromTheRelease(installed, 'launch_a_claude_code_member', 'host_stand_in.ts')
  const { newShortRelayRoot } = await fromTheRelease(installed, 'launch_a_claude_code_member', 'short_relay_root.ts')
  const { RELAY_PLUGIN_DIR } = await fromTheRelease(installed, 'launch_a_claude_code_member', 'launch_a_claude_code_member.ts')
  const { startedLine } = await fromTheRelease(installed, 'run_the_martha_command', 'run_the_martha_command.ts')
  const { RELAY_FILES, RELAY_COPY_NAME } = await fromTheRelease(installed, 'launch_a_claude_code_member', 'relay_copy.ts')
  const { SOLO_MEMBERS } = /** @type {{ SOLO_MEMBERS: ReadonlyArray<{ name: string }> }} */ (await fromTheRelease(installed, 'declare_a_solo_crew', 'declare_a_solo_crew.ts'))
  running.relayRoot = newShortRelayRoot()
  const host = standInHost(join(work, 'host'), hostAnswers(), plant)
  const owner = theOwner({ martha: join(places.binDir, NAMES.command), project: freshCheckout(box), env: ownersEnvironment(box, host.dir, running.relayRoot ?? '') })
  await step(run, 'init', () => said(owner.run('init')))
  await step(run, 'approve', () => said(owner.onATerminal('approve')))
  for (const { name } of SOLO_MEMBERS) {
    await step(run, `start ${name}`, () => startMember({ owner, name, startedLine, host, plant, log: run.log, relay: { installed: plant.relay?.(RELAY_PLUGIN_DIR) ?? RELAY_PLUGIN_DIR, files: RELAY_FILES, copyName: RELAY_COPY_NAME, root: running.relayRoot ?? '' }, running, signal: run.signal }))
  }
  for (const member of running.members) await step(run, `stop ${member.name}`, () => stopMember(member, plant))
}

/** @param {string} word */
const quoted = (word) => `'${word.replaceAll("'", `'\\''`)}'`

/**
 * A stand-in `claude`: the installed tree's answers to the launcher, then it notes its arguments by its pid and
 * stays up until it is stopped.
 * @param {string} dir
 * @param {string[]} answers
 * @param {Plant} plant
 */
function standInHost (dir, answers, plant) {
  mkdirSync(dir)
  const script = ['#!/bin/sh', ...answers, `printf '%s\\n' "$@" > ${quoted(dir)}/args-$$`, `exec sleep ${HOST_HOLDS_SECONDS}`]
  writeFileSync(join(dir, 'claude'), [...(plant.host?.(script) ?? script), ''].join('\n'), { mode: RUNNABLE })
  return { dir, argsOf: (/** @type {number} */ pid) => join(dir, `args-${pid}`) }
}

/**
 * An empty git checkout on the box, committed to by OWNER, where the crew is declared.
 * @param {string} box
 */
function freshCheckout (box) {
  const project = join(box, 'project')
  mkdirSync(project)
  execFileSync('git', ['init', '--quiet', project])
  execFileSync('git', ['-C', project, 'config', 'user.name', OWNER])
  return project
}

/**
 * The owner's environment on the box: its home, the stand-in host first on the PATH, and a relay root short enough
 * for a socket. Nothing else of this machine's environment is passed.
 * @param {string} box
 * @param {string} hostDir
 * @param {string} relayRoot
 */
const ownersEnvironment = (box, hostDir, relayRoot) => ({
  PATH: `${hostDir}:${process.env.PATH ?? ''}`,
  HOME: box,
  XDG_RUNTIME_DIR: relayRoot,
  GIT_CONFIG_NOSYSTEM: '1'
})

/**
 * The installed command as the owner runs it in `project`: plainly, or on a terminal of its own.
 * @param {{ martha: string, project: string, env: NodeJS.ProcessEnv }} at
 */
function theOwner ({ martha, project, env }) {
  const words = (/** @type {string[]} */ args) => [process.execPath, martha, ...args].map(quoted).join(' ')
  const options = { cwd: project, env }
  return {
    run: (/** @type {string[]} */ ...args) => spawnSync(process.execPath, [martha, ...args], { ...options, encoding: 'utf8', input: '', timeout: MEMBER_WAIT_MS }),
    onATerminal: (/** @type {string[]} */ ...args) => spawnSync('script', [...ON_A_TERMINAL, words(args), '/dev/null'], { ...options, encoding: 'utf8', input: '', timeout: MEMBER_WAIT_MS }),
    startOnATerminal: (/** @type {string[]} */ ...args) => spawn('script', [...ON_A_TERMINAL, words(args), '/dev/null'], { ...options, stdio: 'pipe' })
  }
}

/**
 * A command that ended 0, with its last line as the step's detail; any other end is the step's failure.
 * @param {import('node:child_process').SpawnSyncReturns<string>} ran
 */
function said (ran) {
  const text = `${ran.stdout ?? ''}${ran.stderr ?? ''}`.replace(TERMINAL_LINE_END, '\n').trim()
  if (ran.error) throw ran.error
  if (ran.status !== 0) throw new Error(`ended ${ran.status ?? ran.signal}: ${text}`)
  return { value: undefined, detail: text.split('\n').at(-1) ?? '' }
}

/**
 * Whether a member's `pid` still answers kill(pid, 0); an unreaped one still does. Every look at a member's pid goes
 * through here, so a test's planted late reap (Plant.answersFor) is seen by each of them.
 * @param {number} pid
 * @param {Plant} plant
 */
function answers (pid, plant) {
  let signalled = true
  try {
    process.kill(pid, 0)
  } catch {
    signalled = false
  }
  return plant.answersFor?.(pid, signalled) ?? signalled
}

/** @param {string} text */
const literally = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The release's own started line for `name` as a pattern's source, unanchored, whose one group is the pid; a test
 * reads the line back out of the log with it.
 * @param {(member: string, pid: string) => string} startedLine
 * @param {string} name
 */
export function startedLineSource (startedLine, name) {
  const [before, after] = startedLine(name, PID_AT).split(PID_AT)
  return `${literally(before ?? '')}([0-9]+)${literally(after ?? '')}`
}

/**
 * The started line as `martha start` prints it on a line of its own.
 * @param {(member: string, pid: string) => string} startedLine
 * @param {string} name
 */
const startedPattern = (startedLine, name) => new RegExp(`^${startedLineSource(startedLine, name)}$`, 'm')

/**
 * The installed relay and how a launch copies it (martha#117): the host is given the launch's own read-only copy,
 * `copyName` in a launch's folder under the run's relay `root`, holding the relay's declared `files`.
 * @typedef {{ installed: string, files: readonly string[], copyName: string, root: string }} Relay
 */

/**
 * Why `copy` is not a copy of the installed relay, or '' when it is: a launch's copy under the run's relay root,
 * each declared file byte for byte the installed one.
 * @param {string | undefined} copy
 * @param {Relay} relay
 */
function notACopyOf (copy, { installed, files, copyName, root }) {
  if (!copy) return `no argument names a copy ${copyName} under ${root}`
  try {
    const differs = files.filter((file) => !readFileSync(join(copy, file)).equals(readFileSync(join(installed, file))))
    return differs.length ? `${copy} differs from it in ${differs.join(', ')}` : ''
  } catch (error) {
    return reason(error)
  }
}

/**
 * `martha start <name>` on its terminal, kept in `running` at once; up once it names the member's pid, the pid is
 * alive and its host was started with a copy of the release's relay.
 * @param {{ owner: ReturnType<typeof theOwner>, name: string, startedLine: (member: string, pid: number | string) => string, host: ReturnType<typeof standInHost>, plant: Plant, log: (line: string) => void, relay: Relay, running: Running, signal?: AbortSignal }} start
 */
async function startMember ({ owner, name, startedLine, host, plant, log, relay, running, signal }) {
  const member = runningMember(name, owner.startOnATerminal('start', name))
  running.members.push(member)
  // The start is in flight and nothing of it is named yet: a test that names this step interrupts here, so the state
  // it asserts is the state the run is in (martha#189).
  await heldAt(log, `start ${name}`, signal)
  const started = startedPattern(startedLine, name)
  const named = await waitFor(`${name} to be named started`, () => member.said.replace(TERMINAL_LINE_END, '\n').match(started), member, signal)
  member.pid = Number(named[1])
  const noted = await waitFor(`${name}'s host to note its arguments`, () => existsSync(host.argsOf(member.pid)) && readFileSync(host.argsOf(member.pid), 'utf8').split('\n'), member, signal)
  const args = plant.hostArgs?.(noted) ?? noted
  if (!answers(member.pid, plant)) throw new Error(`${name}, pid ${member.pid}, is not alive`)
  const at = args.findIndex((arg) => arg.startsWith(`${relay.root}${sep}`) && basename(arg) === relay.copyName)
  const why = notACopyOf(args[at], relay)
  if (at < 1 || why) throw new Error(`${name}'s host was not started with Martha's relay ${relay.installed}: ${why || 'it is its first argument'}; ${args.join(' ')}`)
  return { value: undefined, detail: `${startedLine(name, member.pid)}, alive; its host was started with ${args[at - 1]} ${args[at]}, a copy of ${relay.installed}` }
}

/**
 * @param {string} name
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Member}
 */
function runningMember (name, child) {
  /** @type {Member} */
  const member = { name, child, pid: 0, said: '', ended: '', exited: Promise.resolve('') }
  const hear = (/** @type {Buffer} */ chunk) => { member.said += chunk.toString('utf8') }
  child.stdout?.on('data', hear)
  child.stderr?.on('data', hear)
  member.exited = new Promise((resolve) => child.once('close', (code, sig) => {
    member.ended = code === null ? String(sig) : `exit ${code}`
    resolve(member.ended)
  }))
  return member
}

/**
 * What `found` finds, looked for until MEMBER_WAIT_MS; the member ending, or the run being interrupted, ends the wait.
 * @template T
 * @param {string} what
 * @param {() => T | false | null | undefined} found
 * @param {Member} member
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<T>}
 */
async function waitFor (what, found, member, signal) {
  const deadline = Date.now() + MEMBER_WAIT_MS
  for (;;) {
    const got = found()
    if (got) return got
    if (signal?.aborted) throw new Error(`${interruptedBy(signal)} while waiting for ${what}`)
    if (member.ended) throw new Error(`martha start ended (${member.ended}) before ${what}: ${member.said.trim()}`)
    if (Date.now() > deadline) throw new Error(`no sign of ${what} within ${MEMBER_WAIT_MS} ms: ${member.said.trim()}`)
    await delay(POLL_MS)
  }
}

/**
 * How the member's `martha start` ended, or '' when it did not within MEMBER_WAIT_MS.
 * @param {Member} member
 */
const endOf = (member) => Promise.race([member.exited, delay(MEMBER_WAIT_MS, '', { ref: false })])

/**
 * Whether `pid` has ended within MEMBER_WAIT_MS. A killed process still answers kill(pid, 0) until it is reaped, and
 * its `martha start` can end before that happens, so one look straight after it ended can find it still there.
 * @param {number} pid
 * @param {Plant} plant
 */
async function endsInTime (pid, plant) {
  const deadline = Date.now() + MEMBER_WAIT_MS
  while (answers(pid, plant)) {
    if (Date.now() > deadline) return false
    await delay(POLL_MS)
  }
  return true
}

/**
 * Stops a member as its owner would, by signalling its process group, and checks that it and its `martha start` end.
 * @param {Member} member
 * @param {Plant} plant
 */
async function stopMember (member, plant) {
  if (member.ended) throw new Error(`${member.name} had already ended (${member.ended})`)
  process.kill(-member.pid, 'SIGTERM')
  const ended = await endOf(member)
  if (!ended) throw new Error(`martha start for ${member.name} did not end within ${MEMBER_WAIT_MS} ms`)
  if (!await endsInTime(member.pid, plant)) throw new Error(`${member.name}, pid ${member.pid}, is still alive after ${MEMBER_WAIT_MS} ms`)
  return { value: undefined, detail: `pid ${member.pid} ended; martha start ended ${ended}` }
}

/**
 * The registry stopped and the box removed, read-only release and all; true when nothing is left. The box is removed
 * even when the registry refuses to stop, and either refusal fails the step.
 * @param {(line: string) => void} log
 * @param {Running} running
 * @param {Plant} plant
 */
async function tearDown (log, { work, registry, relayRoot, members }, plant) {
  try {
    await step({ log }, 'tear down', async () => {
      const refusals = [...await killEveryMember(members, plant), ...await stopTheRegistry(registry, plant), ...removeTheBox(work), ...removeTheBox(relayRoot)]
      const root = relayRoot ? `; relay root ${relayRoot}` : ''
      if (refusals.length) throw new Error(`${refusals.join('; ')}${root}`)
      const crew = members.length ? `${members.length} members ended, ` : ''
      const relay = relayRoot ? `, relay root ${relayRoot} removed` : ''
      return { value: undefined, detail: `${crew}${registry ? 'registry stopped, ' : ''}${work ? 'box removed' : 'no box was made'}${relay}` }
    })
    return true
  } catch {
    return false
  }
}

/**
 * Every member still running is killed with its process group, and its `martha start` with it.
 * @param {Member[]} members
 * @param {Plant} plant
 * @returns {Promise<string[]>} which did not end, if any
 */
async function killEveryMember (members, plant) {
  const refusals = []
  for (const member of members) {
    member.child.stdin?.end()
    if (!member.ended) killEvenIfGone(member)
    if (!member.ended && !await endOf(member)) refusals.push(`martha start for ${member.name} did not end`)
    if (member.pid && !await endsInTime(member.pid, plant)) refusals.push(`${member.name}, pid ${member.pid}, is still alive after ${MEMBER_WAIT_MS} ms`)
  }
  return refusals
}

/** @param {Member} member */
function killEvenIfGone (member) {
  try {
    if (member.pid) process.kill(-member.pid, 'SIGKILL')
  } catch {
    // Its group is already gone.
  }
  member.child.kill('SIGKILL')
}

/**
 * @param {Running['registry']} registry
 * @param {Plant} plant
 * @returns {Promise<string[]>} why it did not stop, if it did not
 */
async function stopTheRegistry (registry, plant) {
  if (!registry) return []
  plant.atTearDown?.(registry)
  try {
    await registry.close()
    return []
  } catch (error) {
    return [`the registry did not stop: ${reason(error)}`]
  }
}

/**
 * Removing either works or throws: its rmSync forgives only a box that is already gone.
 * @param {string | undefined} work
 * @returns {string[]} why it is still there, if it is
 */
function removeTheBox (work) {
  if (!work) return []
  try {
    removeEvenReadOnly(work)
    return []
  } catch (error) {
    return [`${work} was not removed: ${reason(error)}`]
  }
}

/** @param {string[]} argv @returns {{ logFile?: string }} */
function parseArguments (argv) {
  /** @type {{ logFile?: string }} */
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--log' && argv[i + 1]) options.logFile = argv[++i]
    else throw new Error(`unknown option '${argv[i]}' (usage: prove_a_clean_install [--log <file>])`)
  }
  return options
}

/**
 * Starts the log empty, so a log it cannot write is refused before anything runs.
 * @param {string | undefined} logFile
 */
function openTheLog (logFile) {
  if (!logFile) return
  try {
    writeFileSync(logFile, '')
  } catch (error) {
    throw new Error(`cannot write the log ${logFile}: ${reason(error)}`)
  }
}

async function main () {
  /** @type {{ logFile?: string }} */
  let options
  try {
    options = parseArguments(process.argv.slice(2))
    openTheLog(options.logFile)
  } catch (error) {
    console.error(`prove_a_clean_install: ${reason(error)}`)
    process.exitCode = 2
    return
  }
  const { logFile } = options
  const log = (/** @type {string} */ line) => { console.log(line); if (logFile) appendFileSync(logFile, `${line}\n`) }
  const interrupted = new AbortController()
  const interrupt = (/** @type {NodeJS.Signals} */ signal) => interrupted.abort(signal)
  for (const signal of INTERRUPTS) process.on(signal, interrupt)
  const { passed } = await proveACleanInstall({ log, signal: interrupted.signal })
  for (const signal of INTERRUPTS) process.off(signal, interrupt)
  process.exitCode = passed ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
