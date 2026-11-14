// Every reader of a version floor agrees with the others (martha#433). This exists so an install and a launch on one
// machine never split over what its floor says: an install the installer allows is never refused at launch, and a
// launch is never let through below a floor the installer holds to.
//
// The floor is read by three programs that ship apart and so cannot import one another: the installer (an npm
// package), the launcher's slice (../../src/hold_the_launch_to_the_version_floor, which no installer carries) and the
// packer's declare_the_floor.sh (bash). Each reads one X.Y.Z line and orders two versions in its own code. This test
// runs all three on the same record texts and the same version pairs, and fails naming the reader that disagrees.
// install_the_committed_tree.node-test.mjs holds where the record is; this holds how it is read and ordered.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { below, readTheRecord, recordedFloor } from '../../src/hold_the_launch_to_the_version_floor/hold_the_launch_to_the_version_floor.ts'
import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { compareVersions } from '../read_the_release_registry/read_the_release_registry.mjs'
import { Refused } from '../refuse_in_words/refuse_in_words.mjs'
import { removeEvenReadOnly } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { FLOOR_RECORD, floorRecordOf, machineFloor } from './hold_the_version_floor.mjs'

const DECLARE = join(import.meta.dirname, '..', '..', 'pack_a_release', 'declare_the_floor.sh')
const PROJECT_FLOOR = 'floor.txt'
/** What the packer is asked to release when only its reading of floor.txt is wanted: above every floor read here. */
const ABOVE_EVERY_FLOOR = '99999999999999999999999.0.0'
/** The words the packer refuses a floor above the release with, which is how its ordering is read. */
const ABOVE_THE_RELEASE = 'above the release'

/**
 * Record texts each reader is given: what one X.Y.Z line ended by a newline is, and the near misses a reader that
 * started tolerating one would let through.
 */
const RECORD_TEXTS = [
  '0.2.0\n', '0.10.0\n', '00.2.0\n', '9007199254740993.0.0\n',
  '0.2.0', '0.2.0\n0.3.0\n', 'v0.2.0\n', '0.2.0 \n', ' 0.2.0\n', '0.2.0\r\n', '0.2.0\n\n', '0.2\n', '0.2.0-rc.1\n', '\n', ''
]

/**
 * Version pairs to order: each part deciding in turn, numbers that sort differently as text, leading zeros, and
 * parts past what a float or a 64-bit integer holds exactly.
 * @type {[string, string][]}
 */
const VERSION_PAIRS = [
  ['0.9.0', '0.10.0'], ['0.2.0', '0.2.0'], ['1.0.0', '0.9.9'], ['0.1.9', '0.2.0'], ['0.2.0', '0.2.1'], ['2.0.0', '10.0.0'],
  ['01.0.0', '1.0.0'], ['0.0.010', '0.0.9'],
  ['9007199254740993.0.0', '9007199254740992.0.0'], ['9223372036854775808.0.0', '1.0.0'], ['18446744073709551617.0.0', '1.0.0']
]

/** A scratch directory, removed after the test. @param {import('node:test').TestContext} t */
const scratchIn = (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-every-floor-reader-'))
  t.after(() => removeEvenReadOnly(scratch))
  return scratch
}

/**
 * A machine whose floor record holds `text`, or which has none when `text` is undefined, or whose record cannot be
 * read when `text` is null (a directory where the file should be).
 * @param {import('node:test').TestContext} t
 * @param {string | null | undefined} text
 */
function aMachineHolding (t, text) {
  const data = scratchIn(t)
  const places = /** @type {import('../place_the_release/place_the_release.mjs').Places} */ ({ releases: join(data, 'releases') })
  const record = floorRecordOf(places)
  if (text === null) mkdirSync(record)
  else if (text !== undefined) writeFileSync(record, text)
  return { places, record }
}

/**
 * What a reader made of a record: its floor, none, or its refusal in words.
 * @typedef {{ floor: string } | { none: true } | { refused: string }} AReading
 */

/** The launcher's reading of `record`. @param {string} record @returns {AReading} */
function theLaunchersReading (record) {
  const floor = recordedFloor(record, readTheRecord(record, (path) => readFileSync(path, 'utf8')))
  if (floor === undefined) return { none: true }
  return typeof floor === 'string' ? { floor } : { refused: floor.refusal }
}

/** The installer's reading of this machine's record. @param {import('../place_the_release/place_the_release.mjs').Places} places @returns {Promise<AReading>} */
async function theInstallersReading (places) {
  try {
    const floor = await machineFloor(places)
    return floor === undefined ? { none: true } : { floor }
  } catch (error) {
    if (error instanceof Refused) return { refused: error.message }
    throw error
  }
}

/**
 * The packer run on a release folder holding `files`, releasing `version`: how it ended, what it said, and the floor
 * it declared, if any.
 * @param {import('node:test').TestContext} t
 * @param {string} version
 * @param {Record<string, string>} files
 */
function thePackerOn (t, version, files) {
  const folder = join(scratchIn(t), NAMES.releaseFolder)
  mkdirSync(folder)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text)
  const run = spawnSync(DECLARE, [version, folder], { encoding: 'utf8' })
  const declared = join(folder, NAMES.floorFile)
  return { status: run.status, stderr: run.stderr, floor: existsSync(declared) ? JSON.parse(readFileSync(declared, 'utf8')).floor : undefined }
}

/** The packer's reading of a floor.txt holding `text`: its floor, or refused. @param {import('node:test').TestContext} t @param {string} text */
function thePackersReading (t, text) {
  const run = thePackerOn(t, ABOVE_EVERY_FLOOR, { [PROJECT_FLOOR]: text })
  if (run.status === 0) return { floor: run.floor }
  assert.equal(run.status, 1, `the packer could not be asked about ${JSON.stringify(text)}: ${run.stderr}`)
  return { refused: run.stderr }
}

/** Whether the packer orders `a` below `b`: it refuses a floor.txt of `b` above a release of `a` exactly then. @param {import('node:test').TestContext} t @param {string} a @param {string} b */
function thePackerHolds (t, a, b) {
  const run = thePackerOn(t, a, { [PROJECT_FLOOR]: `${b}\n` })
  if (run.status === 0) return false
  assert.ok(run.status === 1 && run.stderr.includes(ABOVE_THE_RELEASE), `the packer did not order ${a} and ${b}: ${run.stderr}`)
  return true
}

test('#433: the launcher and the installer read every record alike: the same floor, none, or the same refusal in the same words', async (t) => {
  for (const text of [...RECORD_TEXTS, undefined, null]) {
    const { places, record } = aMachineHolding(t, text)
    const said = text === null ? 'a record that cannot be read' : text === undefined ? 'no record' : JSON.stringify(text)
    assert.deepEqual(theLaunchersReading(record), await theInstallersReading(places), `the launcher and the installer read ${said} apart`)
  }
})

test('#433: the packer reads a floor.txt as the launcher reads the record: the same floor where one is read, and refused where the launcher refuses', (t) => {
  for (const text of RECORD_TEXTS) {
    const record = join(scratchIn(t), FLOOR_RECORD)
    writeFileSync(record, text)
    const launcher = theLaunchersReading(record)
    const packer = thePackersReading(t, text)
    assert.equal('floor' in packer ? packer.floor : undefined, 'floor' in launcher ? launcher.floor : undefined, `the packer and the launcher read ${JSON.stringify(text)} apart: ${JSON.stringify({ packer, launcher })}`)
  }
})

test('#433: the launcher, the installer and the packer order every pair of versions alike, each way round', (t) => {
  for (const [a, b] of VERSION_PAIRS) {
    for (const [x, y] of /** @type {[string, string][]} */ ([[a, b], [b, a]])) {
      const launcher = below(x, y)
      assert.equal(compareVersions(x, y) < 0, launcher, `the installer and the launcher order ${x} and ${y} apart`)
      assert.equal(thePackerHolds(t, x, y), launcher, `the packer and the launcher order ${x} and ${y} apart`)
    }
  }
})
