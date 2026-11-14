// The installer links the command the committed tree carries (martha#98): the release layer here is the tree
// pack_a_release.sh packs, `git archive` of HEAD under martha/ with the floor.json pack_a_release/declare_the_floor.sh
// writes, so the command linked is the real bin/martha, and running it through the link answers with the version that
// tree's package.json carries.
//
// The launcher finds this machine's version floor from its own real path (martha#21, build ruling
// issuecomment-6868833599, question 1): the record the real installer wrote must be the one the launcher's locator
// finds from the placed tree's real path, whatever XDG_DATA_HOME was at install, and the launcher holds to it whatever
// XDG_DATA_HOME is at launch.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'

import { floorRecordOf as launchersRecordOf } from '../../src/hold_the_launch_to_the_version_floor/hold_the_launch_to_the_version_floor.ts'
import { removeTheTree } from '../../src/launch_a_claude_code_member/relay_copy.ts'
import { floorRecordOf } from '../hold_the_version_floor/hold_the_version_floor.mjs'
import { SIGNER, release, removeEvenReadOnly, serveRegistry, sigstoreStandIn } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { installRelease, placesOnThisMachine } from './install_a_release.mjs'

const REPOSITORY = join(import.meta.dirname, '..', '..')
const VERSION = '1.2.0'
const XDG = 'XDG_DATA_HOME'

/**
 * The committed tree as a release layer: what pack_a_release.sh copies into the image, export-ignore honoured, with
 * the floor.json it declares. It is unpacked and packed again because git archive opens with a pax global header,
 * which a COPY into an image never has.
 * @param {string} scratch
 */
const committedTree = (scratch) => {
  execFileSync('git', ['archive', '--format=tar', '--prefix=martha/', `--output=${join(scratch, 'tree.tar')}`, 'HEAD'], { cwd: REPOSITORY })
  execFileSync('tar', ['-x', '-f', 'tree.tar'], { cwd: scratch })
  execFileSync(join(REPOSITORY, 'pack_a_release', 'declare_the_floor.sh'), [VERSION, join(scratch, 'martha')])
  return gzipSync(execFileSync('tar', ['--format=gnu', '-c', '-f', '-', 'martha'], { cwd: scratch, maxBuffer: 1 << 28 }))
}

/** The committed floor.txt, as the record must hold it. */
const committedFloor = () => execFileSync('git', ['show', 'HEAD:floor.txt'], { cwd: REPOSITORY, encoding: 'utf8' })

/**
 * The committed tree served signed, and a fresh home for each machine a test installs on.
 * @param {import('node:test').TestContext} t
 */
async function theCommittedRelease (t) {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-committed-tree-'))
  t.after(() => removeTheTree(scratch))
  const r = release({ version: VERSION, gzipped: committedTree(scratch) })
  const registry = await serveRegistry([r])
  t.after(registry.close)
  const signed = new Map([[r.digest, { ref: `refs/tags/v${VERSION}` }]])
  /** @param {string | undefined} xdgDataHome */
  const installOn = async (xdgDataHome) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-install-home-')))
    t.after(() => removeEvenReadOnly(home))
    const places = placesOnThisMachine(home, xdgDataHome === undefined ? undefined : xdgDataHome.replace('<home>', home))
    await installRelease({ places, base: registry.base, signers: [SIGNER], makeVerifier: sigstoreStandIn(signed), log: () => {}, version: VERSION })
    return { home, places }
  }
  return { installOn }
}

test('the committed tree carries martha/bin/martha, and the command linked from it runs', async (t) => {
  const { installOn } = await theCommittedRelease(t)
  const { places } = await installOn(undefined)
  const command = join(places.binDir, 'martha')
  assert.equal(realpathSync(command), realpathSync(join(places.current, 'martha', 'bin', 'martha')))
  const committed = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { cwd: REPOSITORY, encoding: 'utf8' }))
  const run = spawnSync(process.execPath, [command, '--version'], { encoding: 'utf8', env: { PATH: process.env['PATH'] } })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, `${committed.version}\n`)
})

test('the launcher finds the record the real installer wrote, from its own real path, wherever XDG_DATA_HOME put it', async (t) => {
  const { installOn } = await theCommittedRelease(t)
  /** @type {[string, string | undefined][]} */
  const cases = [
    ['absolute', '<home>/data'],
    ['relative, so ~/.local/share', 'relative'],
    ['unset, so ~/.local/share', undefined]
  ]
  for (const [name, atInstall] of cases) {
    const { places } = await installOn(atInstall)
    const written = floorRecordOf(places)
    assert.equal(readFileSync(written, 'utf8'), committedFloor(), `${name}: the installer wrote the committed floor`)
    const found = launchersRecordOf(realpathSync(join(places.current, 'martha')))
    assert.equal(found, written, `${name}: the launcher finds the record the installer wrote`)
    assert.ok(existsSync(found ?? ''), `${name}: and it is there`)
  }
})

test('a placed release below this machine\'s record refuses to launch whatever XDG_DATA_HOME says, and still says its version', async (t) => {
  const { installOn } = await theCommittedRelease(t)
  const { home, places } = await installOn('<home>/data')
  const elsewhere = mkdtempSync(join(tmpdir(), 'martha-elsewhere-'))
  t.after(() => removeTheTree(elsewhere))
  const committed = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { cwd: REPOSITORY, encoding: 'utf8' }))
  const record = floorRecordOf(places)
  const above = `${Number(committed.version.split('.')[0]) + 1}.0.0`
  writeFileSync(record, `${above}\n`)
  const command = join(places.binDir, 'martha')
  /** @type {[string, Record<string, string>][]} */
  const atLaunch = [
    ['unset', {}],
    ['changed after the install', { [XDG]: elsewhere }],
    ['relative', { [XDG]: 'relative' }]
  ]
  for (const [name, xdg] of atLaunch) {
    const env = { PATH: process.env['PATH'] ?? '', HOME: home, ...xdg }
    const launched = spawnSync(process.execPath, [command, 'ls'], { encoding: 'utf8', env, cwd: home })
    assert.equal(launched.status, 1, `${name}: ${launched.stderr}`)
    assert.equal(launched.stderr, `martha: this is Martha ${committed.version}, below ${above}, the version floor this machine holds (${record}); refused. Put the highest signed release back with: martha install\n`, name)
    const asked = spawnSync(process.execPath, [command, '--version'], { encoding: 'utf8', env })
    assert.equal(asked.status, 0, `${name}: ${asked.stderr}`)
    assert.equal(asked.stdout, `${committed.version}\n`, name)
  }
})
