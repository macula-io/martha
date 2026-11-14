// Every act of the martha command is held to this machine's version floor but the two a release below it still
// answers (martha#426, the wiring of martha#21's floor). The floor's own slice tests the decision; this holds the
// wiring act by act, so a change that answers one act before the check fails here by that act's name.
//
// The committed tree is placed where the launcher's locator reads a placed release, <data>/releases/<name>/<tree>, with
// the record above its version beside releases/, and its own bin/martha is run. The acts are read from the
// command's own tables, so an act added to them is held without this test changing, and each is asked in words the
// command's own parser takes, so the refusal is the floor's and never the usage line.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { floorRecordOf, launchBelowTheFloor, RELEASES } from '../hold_the_launch_to_the_version_floor/hold_the_launch_to_the_version_floor.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { ACTS_ALONE, ACTS_OF_ONE, ACTS_OF_THEIR_OWN, actOf, EXIT_DONE, EXIT_REFUSED, SAID_BY } from './run_the_martha_command.ts'

const REPOSITORY = join(import.meta.dirname, '..', '..')

/** The two acts a release below the floor still answers: it says what it is, and it puts the highest release back. */
const ANSWERED_BELOW_THE_FLOOR: readonly string[] = ['--version', 'install']

/** How long one act may take; an act the floor does not hold may go on to start a member, and must still end. */
const ONE_ACT_MS = 30_000

/** The folder the committed tree is unpacked into inside its placed release; the locator takes any name. */
const TREE = 'committed-tree'

/** The committed tree's own command, as a path inside the tree: the one file its bin/ carries. */
function theCommand(): string {
  const carried = execFileSync('git', ['ls-files', 'bin'], { cwd: REPOSITORY, encoding: 'utf8' }).split('\n').filter((file) => file !== '')
  assert.equal(carried.length, 1, `bin/ carries one command: ${carried.join(' ')}`)
  return carried[0]!
}

/** The committed tree, placed as a release under `data` (its version is any: the locator reads only the shape). */
function placedCommittedTree(data: string): string {
  const release = join(data, RELEASES, `0.0.0-sha256-${'a'.repeat(64)}`)
  mkdirSync(release, { recursive: true })
  const archive = join(data, 'tree.tar')
  execFileSync('git', ['archive', '--format=tar', `--prefix=${TREE}/`, `--output=${archive}`, 'HEAD'], { cwd: REPOSITORY })
  execFileSync('tar', ['-x', '-f', archive], { cwd: release })
  return realpathSync(join(release, TREE))
}

test('below this machine\'s record every act but --version and install is refused with the floor\'s refusal', (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-below-the-floor-')))
  t.after(() => removeTheTree(home))
  const tree = placedCommittedTree(join(home, 'data'))
  const env = { PATH: process.env['PATH'] ?? '', HOME: home }
  const command = join(tree, theCommand())
  const run = (words: readonly string[]) => spawnSync(process.execPath, [command, ...words], { encoding: 'utf8', env, cwd: home, timeout: ONE_ACT_MS })
  const record = floorRecordOf(tree)
  assert.ok(record !== undefined, `the placed tree has a record: ${tree}`)
  const asked = run(['--version'])
  assert.equal(asked.status, EXIT_DONE, asked.stderr)
  const version = asked.stdout.trim()
  const above = `${Number(version.split('.')[0]) + 1}.0.0\n`
  writeFileSync(record, above)
  assert.equal(run(['--version']).stdout, asked.stdout, 'below the floor the release still says what it is')
  const refusal = `${SAID_BY} ${launchBelowTheFloor(record, { text: above }, version)}\n`

  const acts = [...ACTS_ALONE, ...ACTS_OF_ONE, ...Object.keys(ACTS_OF_THEIR_OWN)].filter((act) => !ANSWERED_BELOW_THE_FLOOR.includes(act))
  for (const act of acts) {
    const words = [[act], [act, 'someone']].find((tried) => actOf(tried) !== undefined)
    assert.ok(words !== undefined, `${act}: the command's parser takes it alone or with one name`)
    const launched = run(words)
    assert.equal(launched.stderr, refusal, act)
    assert.equal(launched.status, EXIT_REFUSED, act)
  }
})
