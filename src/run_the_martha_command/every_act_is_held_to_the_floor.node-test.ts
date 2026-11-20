// Every act of the martha command is told what this machine's version floor says, in one line, and then goes ahead,
// but the two a release below it still answers (martha#426, martha#601, the wiring of martha#21's floor). The floor's
// own slice tests the decision; this holds the wiring act by act, so an act that skips the line fails here by its name.
//
// The tree as this checkout holds it now is placed where the launcher's locator reads a placed release,
// <data>/releases/<name>/<tree>, with the record above its version beside releases/, and its own bin/martha is run.
// The tree is staged into an index of its own, never the checkout's, so an uncommitted change is tested as it stands
// (CI's working tree is its committed one, so there it is the same tree). The acts are read from the command's own
// tables, so an act added to them is held without this test changing, and each is asked in words the command's own
// parser takes, so the line is the floor's and never the usage line.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { floorRecordOf, launchBelowTheFloor, RELEASES } from '../hold_the_launch_to_the_version_floor/hold_the_launch_to_the_version_floor.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { EXIT_DONE, SAID_BY } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import { ACTS_ALONE, ACTS_OF_ONE, ACTS_OF_THEIR_OWN, actOf, VERSION_WORDS } from './run_the_martha_command.ts'

const REPOSITORY = join(import.meta.dirname, '..', '..')

/** The two acts a release below the floor still answers: it says what it is, and it puts the highest release back. */
const ANSWERED_BELOW_THE_FLOOR: readonly string[] = [...VERSION_WORDS, 'install']

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

/** The tree as this checkout holds it now, placed as a release under `data` (its version is any: the locator reads only the shape). */
function placedCommittedTree(data: string): string {
  const release = join(data, RELEASES, `0.0.0-sha256-${'a'.repeat(64)}`)
  mkdirSync(release, { recursive: true })
  // An index of its own under the test's directory: the checkout's own index and its uncommitted state are left alone.
  const env = { ...process.env, GIT_INDEX_FILE: join(data, 'checkout.index') }
  execFileSync('git', ['add', '--all', '--', '.'], { cwd: REPOSITORY, env })
  const tree = execFileSync('git', ['write-tree'], { cwd: REPOSITORY, env, encoding: 'utf8' }).trim()
  const archive = join(data, 'tree.tar')
  execFileSync('git', ['archive', '--format=tar', `--prefix=${TREE}/`, `--output=${archive}`, tree], { cwd: REPOSITORY })
  execFileSync('tar', ['-x', '-f', archive], { cwd: release })
  return realpathSync(join(release, TREE))
}

test('below this machine\'s record every act but --version and install is told the floor in one line and goes ahead', (t) => {
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
  for (const word of VERSION_WORDS) assert.equal(run([word]).stdout, asked.stdout, `below the floor the release still says what it is to ${word}`)
  const said: string[] = []
  launchBelowTheFloor(record, { text: above }, version, (line) => said.push(line))
  const notice = `${SAID_BY} ${said[0] ?? ''}\n`
  assert.ok(said.length === 1, 'below the floor the launch is told once')

  const acts = [...ACTS_ALONE, ...ACTS_OF_ONE, ...Object.keys(ACTS_OF_THEIR_OWN)].filter((act) => !ANSWERED_BELOW_THE_FLOOR.includes(act))
  for (const act of acts) {
    const words = [[act], [act, 'someone']].find((tried) => actOf(tried) !== undefined)
    assert.ok(words !== undefined, `${act}: the command's parser takes it alone or with one name`)
    const launched = run(words)
    assert.ok(launched.stderr.includes(notice), `${act}: the floor's line was not said (${launched.stderr})`)
    assert.ok(!launched.stderr.includes('Put the highest signed release back with'), `${act}: the floor refused it (${launched.stderr})`)
  }

  // One act's own answer after the line proves it went on: `ls` reads the crew the workspace declares (#511 part B),
  // and its own line is one a floor refusal never reached.
  const listed = run(['ls'])
  assert.ok(listed.stderr.includes(notice), listed.stderr)
  assert.ok(!listed.stderr.includes('Put the highest signed release back with'), listed.stderr)
  assert.ok(listed.stderr.includes('declaration'), `ls went on past the floor (${listed.stderr})`)
})
