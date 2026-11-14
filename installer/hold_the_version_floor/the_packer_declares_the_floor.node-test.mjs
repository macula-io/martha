// The packer declares the floor a release carries, and refuses a release that would carry a wrong one (martha#21;
// build ruling issuecomment-6868833599, questions 2 and 5): pack_a_release/declare_the_floor.sh writes floor.json from
// the tree's floor.txt, refuses a floor.txt above the version being released, and refuses a floor-withdrawal.json
// whose `from` is already below that floor (a dead withdrawal never ships). Versions are compared as numbers. The
// release and the dry run both pack through pack_a_release.sh, which runs it, so a bad floor fails before any tag.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { removeEvenReadOnly } from '../serve_a_release_locally/serve_a_release_locally.mjs'

const ROOT = join(import.meta.dirname, '..', '..')
const DECLARE = join(ROOT, 'pack_a_release', 'declare_the_floor.sh')
const PROJECT_FLOOR = 'floor.txt'

/**
 * A packed release folder holding `files`, and declare_the_floor.sh run on it for `version`.
 * @param {import('node:test').TestContext} t
 * @param {string} version
 * @param {Record<string, string>} files
 */
function declare (t, version, files) {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-declare-floor-'))
  t.after(() => removeEvenReadOnly(scratch))
  const folder = join(scratch, NAMES.releaseFolder)
  mkdirSync(folder)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text)
  const run = spawnSync(DECLARE, [version, folder], { encoding: 'utf8' })
  const declared = join(folder, NAMES.floorFile)
  return { ...run, declared: existsSync(declared) ? JSON.parse(readFileSync(declared, 'utf8')) : undefined }
}

test('floor.json declares the tree\'s floor.txt, compared as numbers: 0.10.0 is above 0.9.0', (t) => {
  const run = declare(t, '0.10.0', { [PROJECT_FLOOR]: '0.9.0\n' })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.declared, { floor: '0.9.0' })
  const at = declare(t, '0.2.0', { [PROJECT_FLOOR]: '0.2.0\n' })
  assert.equal(at.status, 0, at.stderr)
  assert.deepEqual(at.declared, { floor: '0.2.0' })
})

test('refused: a floor.txt above the version being released, compared as numbers', (t) => {
  const run = declare(t, '0.9.0', { [PROJECT_FLOOR]: '0.10.0\n' })
  assert.equal(run.status, 1)
  assert.equal(run.stderr, 'declare_the_floor: floor.txt says 0.10.0, above the release 0.9.0; a release never declares a floor above itself\n')
  assert.equal(run.declared, undefined)
})

test('refused: no floor.txt, or one that is not one X.Y.Z line', (t) => {
  assert.match(declare(t, '0.2.0', {}).stderr, /^declare_the_floor: the tree carries no floor\.txt/)
  for (const text of ['0.2\n', '0.2.0', '0.2.0\n0.3.0\n', 'v0.2.0\n']) {
    const run = declare(t, '0.2.0', { [PROJECT_FLOOR]: text })
    assert.equal(run.status, 1, JSON.stringify(text))
    assert.match(run.stderr, /^declare_the_floor: floor\.txt is not one X\.Y\.Z line/, JSON.stringify(text))
  }
})

test('refused: a floor.json in the tree; it is generated, never committed', (t) => {
  const run = declare(t, '0.2.0', { [PROJECT_FLOOR]: '0.2.0\n', [NAMES.floorFile]: '{"floor":"0.0.0"}' })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /^declare_the_floor: floor\.json was packed; a release's floor is generated from floor\.txt, never committed/)
})

test('a withdrawal from this release\'s floor or above ships; a dead one, from below it, is refused', (t) => {
  const live = declare(t, '0.12.0', { [PROJECT_FLOOR]: '0.10.0\n', [NAMES.withdrawalFile]: '{"version":"0.9.0","from":"0.10.0"}' })
  assert.equal(live.status, 0, live.stderr)
  const dead = declare(t, '0.12.0', { [PROJECT_FLOOR]: '0.10.0\n', [NAMES.withdrawalFile]: '{"version":"0.8.0","from":"0.9.0"}' })
  assert.equal(dead.status, 1)
  assert.equal(dead.stderr, 'declare_the_floor: floor-withdrawal.json lowers from 0.9.0, below this release\'s floor 0.10.0; a dead withdrawal never ships, delete it\n')
})

test('refused: a withdrawal that is not { version, from }, or that does not lower', (t) => {
  for (const text of ['{"version":"0.9.0"}', '{"version":"0.9.0","from":"0.10.0","also":1}', 'not json', '{"version":"0.9","from":"0.10.0"}']) {
    const run = declare(t, '0.12.0', { [PROJECT_FLOOR]: '0.10.0\n', [NAMES.withdrawalFile]: text })
    assert.equal(run.status, 1, text)
    assert.match(run.stderr, /^declare_the_floor: floor-withdrawal\.json is not \{ "version": "X\.Y\.Z", "from": "X\.Y\.Z" \}/, text)
  }
  const up = declare(t, '0.12.0', { [PROJECT_FLOOR]: '0.10.0\n', [NAMES.withdrawalFile]: '{"version":"0.11.0","from":"0.10.0"}' })
  assert.equal(up.status, 1)
  assert.match(up.stderr, /^declare_the_floor: floor-withdrawal\.json goes to 0\.11\.0 from 0\.10\.0, which lowers nothing/)
})

test('the release and the dry run both pack through pack_a_release.sh, which declares the floor', () => {
  const pack = readFileSync(join(ROOT, 'pack_a_release', 'pack_a_release.sh'), 'utf8')
  assert.match(pack, /^"\$\{HERE\}\/declare_the_floor\.sh" "\$\{version\}" "\$\{context\}\/\$\{folder\}" \|\| exit 1$/m, 'pack_a_release.sh declares the floor and stops when it is refused')
  for (const workflow of ['release.yml', 'release-dry-run.yml']) {
    assert.match(readFileSync(join(ROOT, '.github', 'workflows', workflow), 'utf8'), /^\s*run: pack_a_release\/pack_a_release\.sh /m, `${workflow} packs through pack_a_release.sh`)
  }
})

test('the project\'s floor is committed as one X.Y.Z line; no floor.json is', () => {
  assert.match(readFileSync(join(ROOT, PROJECT_FLOOR), 'utf8'), /^\d+\.\d+\.\d+\n$/)
  const every = readdirSync(ROOT, { recursive: true, encoding: 'utf8' })
    .filter((path) => !path.split('/').some((part) => part === 'node_modules' || part === '.git'))
  assert.deepEqual(every.filter((path) => path.split('/').at(-1) === NAMES.floorFile), [], 'a release\'s floor.json is written by the packer, never committed')
})
