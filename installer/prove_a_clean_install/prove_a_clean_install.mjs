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
// Starting a member (`martha init`, `approve`, `start`) is added when martha#98 gives the tree its command; a cloud
// box is never started from here.
//
//   node installer/prove_a_clean_install/prove_a_clean_install.mjs [--log <file>]
//
// Exit: 0 passed, 1 a step failed (or anything else went wrong once the run began), 2 the arguments were refused
// (an unknown option, or a log it cannot write) and nothing ran.
// Not shipped (package.json "files" leaves it out).
import { execFileSync } from 'node:child_process'
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

class StepFailed extends Error {}

/**
 * Defects a test plants, to see the proof catch them; a real run plants nothing.
 * @typedef {{ box: string, expected: string, installed: Awaited<ReturnType<typeof installRelease>>, places: import('../place_the_release/place_the_release.mjs').Places }} OnDisk
 * @typedef {{
 *   onDisk?: (on: OnDisk) => void,
 *   atTearDown?: (registry: Awaited<ReturnType<typeof serveRegistry>>) => void
 * }} Plant
 */

/** @param {unknown} error */
const reason = (error) => error instanceof Error ? error.message : String(error)

/**
 * Runs one step: its result is the line's detail; a throw is a FAIL line and stops the steps after it.
 * @template T
 * @param {(line: string) => void} log
 * @param {string} name
 * @param {() => Promise<{ value: T, detail: string }> | { value: T, detail: string }} body
 * @returns {Promise<T>}
 */
async function step (log, name, body) {
  try {
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
 * What the run has started so far, for the tear-down to remove.
 * @typedef {{ work?: string, registry?: Awaited<ReturnType<typeof serveRegistry>> }} Running
 */

/**
 * The run: pack, serve, install, check, and always tear down. It resolves whatever goes wrong: an error outside the
 * steps is logged as "FAIL run: ..." and fails the run like a failed step.
 * @param {{ log?: (line: string) => void, signedFor?: string, plant?: Plant }} [options]
 *   signedFor: the ref the stood-in signature is for; the release's own tag unless a test names another.
 *   plant: defects a test plants; see Plant.
 */
export async function proveACleanInstall ({ log = console.log, signedFor, plant = {} } = {}) {
  /** @type {Running} */
  const running = {}
  let passed = true
  try {
    running.work = mkdtempSync(join(tmpdir(), 'martha-clean-install-'))
    await installAndCheck({ log, signedFor, plant, work: running.work, running })
  } catch (error) {
    if (!(error instanceof StepFailed)) log(`FAIL run: ${reason(error)}`)
    passed = false
  }
  passed = await tearDown(log, running, plant) && passed
  log(passed ? `passed; ${STOOD_IN}` : 'failed')
  return { passed, ...whereTheyWere(running) }
}

/**
 * Where the box and the registry were, for a caller to check they are gone; empty when the run never made them.
 * @param {Running} running
 */
function whereTheyWere ({ work, registry }) {
  return { box: work ? join(work, 'box') : '', registry: registry?.base ?? '' }
}

/**
 * The steps before the tear-down; the registry is kept in `running` the moment it serves, so the tear-down finds it.
 * @param {{ log: (line: string) => void, signedFor?: string, plant: Plant, work: string, running: Running }} run
 */
async function installAndCheck ({ log, signedFor, plant, work, running }) {
  const box = join(work, 'box')
  const { version, tar } = await step(log, 'pack', () => packTheCommittedTree(join(work, 'expected')))
  const r = release({ version, gzipped: gzipSync(tar) })
  const registry = await step(log, 'serve', async () => {
    running.registry = await serveRegistry([r])
    return { value: running.registry, detail: `${running.registry.base} serves ${version} at ${r.digest}; ${STOOD_IN}` }
  })
  mkdirSync(box)
  const places = placesOnThisMachine(box, undefined)
  const verifier = sigstoreStandIn(new Map([[r.digest, { ref: signedFor ?? releaseRef(version) }]]))
  const installed = await step(log, 'install', async () => {
    const done = await installRelease({ places, version, base: registry.base, signers: [SIGNER], makeVerifier: verifier, log: () => {} })
    return { value: done, detail: `${done.version} ${done.digest} onto a box that started empty` }
  })
  const onDisk = { box, expected: join(work, 'expected'), installed, places }
  plant.onDisk?.(onDisk)
  await step(log, 'on disk', () => checkTheDisk(onDisk))
}

/**
 * The registry stopped and the box removed, read-only release and all; true when nothing is left. The box is removed
 * even when the registry refuses to stop, and either refusal fails the step.
 * @param {(line: string) => void} log
 * @param {Running} running
 * @param {Plant} plant
 */
async function tearDown (log, { work, registry }, plant) {
  try {
    await step(log, 'tear down', async () => {
      const refusals = [...await stopTheRegistry(registry, plant), ...removeTheBox(work)]
      if (refusals.length) throw new Error(refusals.join('; '))
      return { value: undefined, detail: `${registry ? 'registry stopped, ' : ''}${work ? 'box removed' : 'no box was made'}` }
    })
    return true
  } catch {
    return false
  }
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
  const { passed } = await proveACleanInstall({ log })
  process.exitCode = passed ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
