// The signed version floor, end to end against a local registry (martha#21, R9 of #84; design
// issuecomment-6753241669, build ruling issuecomment-6868833599). Once a machine runs a release that carries the
// floor, a release below it is installed and the floor is said in one line (martha#601); the record still never
// moves down without the owner's withdrawal, signed inside a release, for that exact version.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'

import { floorRecordOf } from '../hold_the_version_floor/hold_the_version_floor.mjs'
import { Refused } from '../refuse_in_words/refuse_in_words.mjs'
import { SIGNER, release, scratchMachine, serveRegistry, sigstoreStandIn } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { installRelease } from './install_a_release.mjs'

/** @typedef {import('../serve_a_release_locally/serve_a_release_locally.mjs').Release} Release */

/**
 * A machine and a registry serving `releases`, each signed for its own tag unless `signed` says otherwise.
 * @param {import('node:test').TestContext} t
 * @param {Release[]} releases
 * @param {Map<string, { ref: string, repository?: string, signerSha?: string }>} [signed]
 */
async function world (t, releases, signed) {
  const registry = await serveRegistry(releases)
  const machine = scratchMachine()
  t.after(async () => { await registry.close(); machine.close() })
  const refs = signed ?? new Map(releases.map((r) => [r.digest, { ref: `refs/tags/v${r.version}` }]))
  /** @type {string[]} */
  const lines = []
  /** @param {Partial<import('./install_a_release.mjs').InstallRequest>} [request] */
  const run = (request = {}) => installRelease({
    places: machine.places, base: registry.base, signers: [SIGNER], makeVerifier: sigstoreStandIn(refs), log: (line) => lines.push(line), ...request
  })
  const record = floorRecordOf(machine.places)
  return { ...machine, registry, run, record, lines, held: () => readFileSync(record, 'utf8') }
}

/**
 * @param {Promise<unknown>} promise
 * @param {RegExp} pattern
 */
const refusedWith = async (promise, pattern) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof Refused, `expected a refusal, got ${/** @type {Error} */ (error).stack}`)
    assert.match(/** @type {Error} */ (error).message, pattern)
    return true
  })
}

/** The version current points at. @param {{ places: { current: string } }} w */
const currentVersion = (w) => readlinkSync(w.places.current).split('/').at(-1)?.split('-sha256-')[0]

/** The versions placed on the machine. @param {{ places: { releases: string } }} w */
const placed = (w) => readdirSync(w.places.releases).filter((n) => !n.startsWith('.')).map((n) => n.split('-sha256-')[0]).sort()

test('an install keeps the floor the release declares as this machine\'s record, one X.Y.Z line', async (t) => {
  const w = await world(t, [release({ version: '1.2.0', floor: '1.1.0' })])
  await w.run({ version: '1.2.0' })
  assert.equal(w.held(), '1.1.0\n')
})

test('a release below the record is installed with one line, and the record does not move down', async (t) => {
  const w = await world(t, [release({ version: '1.1.0', floor: '1.0.0' }), release({ version: '1.2.0', floor: '1.2.0' })])
  await w.run({ version: '1.2.0' })
  const result = await w.run({ version: '1.1.0', downgrade: true })
  assert.equal(result.version, '1.1.0')
  assert.ok(w.lines.includes('martha: 1.1.0 is below 1.2.0, the version floor this machine holds; installing it'))
  assert.equal(currentVersion(w), '1.1.0', 'the older release is now the one in use')
  assert.deepEqual(placed(w), ['1.1.0', '1.2.0'])
  assert.equal(w.held(), '1.2.0\n', 'the record does not move down without a withdrawal')
})

test('a release at or above the record installs; an ordinary install never lowers the record', async (t) => {
  const w = await world(t, [release({ version: '1.2.0', floor: '1.2.0' }), release({ version: '1.3.0', floor: '1.0.0' }), release({ version: '1.10.0', floor: '1.9.0' })])
  await w.run({ version: '1.2.0' })
  await w.run({ version: '1.3.0' })
  assert.equal(currentVersion(w), '1.3.0')
  assert.equal(w.held(), '1.2.0\n', 'a release declaring a lower floor leaves the record where it was')
  await w.run({ version: '1.10.0' })
  assert.equal(w.held(), '1.9.0\n', 'a release declaring a higher floor raises it, compared as numbers')
})

test('a release with no floor.json, or a malformed one, is installed with one line and takes no floor', async (t) => {
  const w = await world(t, [
    release({ version: '1.2.0', floor: null }),
    release({ version: '1.3.0', floor: { raw: '{"floor":"1.x"}' } }),
    release({ version: '1.4.0', floor: { raw: '{"floor":"1.0.0","also":1}' } }),
    release({ version: '1.5.0', floor: { raw: 'not json' } })
  ])
  assert.equal((await w.run({ version: '1.2.0' })).version, '1.2.0')
  assert.ok(w.lines.includes('martha: this release carries no martha/floor.json, so it declares no version floor'))
  assert.equal((await w.run({ version: '1.3.0' })).version, '1.3.0')
  assert.ok(w.lines.includes('martha: martha/floor.json is not { "floor": "X.Y.Z" }; no floor is taken from it'))
  assert.equal((await w.run({ version: '1.4.0' })).version, '1.4.0')
  assert.ok(w.lines.includes('martha: martha/floor.json is not { "floor": "X.Y.Z" }; no floor is taken from it'))
  assert.equal((await w.run({ version: '1.5.0' })).version, '1.5.0')
  assert.ok(w.lines.includes('martha: martha/floor.json is not JSON'))
  assert.equal(currentVersion(w), '1.5.0')
  assert.deepEqual(placed(w), ['1.2.0', '1.3.0', '1.4.0', '1.5.0'], 'every release was placed')
  assert.ok(!existsSync(w.record), 'no record was written')
})

test('a release that declares a floor above its own version is installed with one line and takes no floor', async (t) => {
  const w = await world(t, [release({ version: '1.2.0', floor: '1.3.0' })])
  const result = await w.run({ version: '1.2.0' })
  assert.equal(result.version, '1.2.0')
  assert.ok(w.lines.includes('martha: 1.2.0 declares the floor 1.3.0, above itself; no floor is taken from it'))
  assert.equal(currentVersion(w), '1.2.0')
  assert.deepEqual(placed(w), ['1.2.0'])
  assert.ok(!existsSync(w.record), 'no record was written')
})

test('a malformed or unreadable record is said in one line, read as no floor, and the install goes ahead', async (t) => {
  const w = await world(t, [release({ version: '1.2.0' })])
  mkdirSync(w.places.releases, { recursive: true })
  writeFileSync(w.record, '1.2.0')
  assert.equal((await w.run({ version: '1.2.0' })).version, '1.2.0')
  assert.ok(w.lines.includes(`martha: ${w.record}, this machine's version floor, is not one X.Y.Z line; no floor is held`))
  writeFileSync(w.record, 'none\n')
  assert.equal((await w.run({ version: '1.2.0' })).version, '1.2.0')
  assert.ok(w.lines.includes(`martha: ${w.record}, this machine's version floor, is not one X.Y.Z line; no floor is held`))
  const { rmSync, symlinkSync } = await import('node:fs')
  rmSync(w.record)
  symlinkSync(w.record, w.record)
  assert.equal((await w.run({ version: '1.2.0' })).version, '1.2.0')
  assert.ok(w.lines.includes(`martha: ${w.record}, this machine's version floor, could not be read (ELOOP); no floor is held`))
  assert.equal(currentVersion(w), '1.2.0')
  assert.deepEqual(placed(w), ['1.2.0'])
  assert.equal(w.held(), '0.0.0\n', 'the release\'s floor becomes the record, as from no floor')
})

/**
 * A machine at 2.0.0, and a registry that also serves 1.0.0 and 2.1.0, which carries the owner's withdrawal
 * { version: 1.0.0, from: 2.0.0 }. `withdrawal` replaces what 2.1.0 carries, `signed` what is signed.
 * @param {import('node:test').TestContext} t
 * @param {{ withdrawal?: any, signed?: (r: { old: Release, at: Release, carrier: Release }) => Map<string, any> }} [shape]
 */
async function aMachineAtTheFloor (t, { withdrawal = { version: '1.0.0', from: '2.0.0' }, signed } = {}) {
  const old = release({ version: '1.0.0', floor: '1.0.0' })
  const at = release({ version: '2.0.0', floor: '2.0.0' })
  const carrier = release({ version: '2.1.0', floor: '2.0.0', withdrawal })
  const raised = release({ version: '3.0.0', floor: '3.0.0' })
  const w = await world(t, [old, at, carrier, raised], signed?.({ old, at, carrier }))
  await w.run({ version: '2.0.0' })
  return w
}

test('a release below the floor is installed with one line, and a withdrawal lowers the record to it', async (t) => {
  const w = await aMachineAtTheFloor(t)
  const below = await w.run({ version: '1.0.0', downgrade: true })
  assert.equal(below.version, '1.0.0')
  assert.ok(w.lines.includes('martha: 1.0.0 is below 2.0.0, the version floor this machine holds; installing it'))
  assert.equal(currentVersion(w), '1.0.0', 'the older release is now the one in use')
  assert.equal(w.held(), '2.0.0\n', 'without a withdrawal the record stays where it was')
  const result = await w.run({ version: '1.0.0', downgrade: true, withdrawalIn: '2.1.0' })
  assert.equal(result.version, '1.0.0')
  assert.equal(currentVersion(w), '1.0.0')
  assert.equal(w.held(), '1.0.0\n')
  assert.deepEqual(placed(w), ['1.0.0', '2.0.0'], 'the release that carries the withdrawal is read, never placed')
})

test('a withdrawal lives while the floor is its from; once above it, the release is installed with one line and the record stays', async (t) => {
  const w = await aMachineAtTheFloor(t)
  await w.run({ version: '1.0.0', downgrade: true, withdrawalIn: '2.1.0' })
  await w.run({ version: '2.0.0' })
  assert.equal(w.held(), '2.0.0\n', 'a release declaring from raises the record back to from')
  await w.run({ version: '1.0.0', downgrade: true, withdrawalIn: '2.1.0' })
  assert.equal(currentVersion(w), '1.0.0', 'the owner\'s statement still stands, so the same file lowers the floor again')
  await w.run({ version: '3.0.0' })
  assert.equal(w.held(), '3.0.0\n')
  const result = await w.run({ version: '1.0.0', downgrade: true, withdrawalIn: '2.1.0' })
  assert.equal(result.version, '1.0.0')
  assert.ok(w.lines.includes('martha: the withdrawal in 2.1.0 lowers the floor from 2.0.0, and this machine\'s floor is 3.0.0; it is not honoured'))
  assert.equal(currentVersion(w), '1.0.0', 'the version named is installed anyway')
  assert.equal(w.held(), '3.0.0\n', 'the record does not move down')
})

test('a withdrawal for another version, or with another from, is said in one line and the named version is installed', async (t) => {
  const forOther = await aMachineAtTheFloor(t, { withdrawal: { version: '1.5.0', from: '2.0.0' } })
  const wrongVersion = await forOther.run({ version: '1.0.0', downgrade: true, withdrawalIn: '2.1.0' })
  assert.equal(wrongVersion.version, '1.0.0')
  assert.ok(forOther.lines.includes('martha: the withdrawal in 2.1.0 is for 1.5.0, not 1.0.0; the version you named is installed'))
  assert.equal(currentVersion(forOther), '1.0.0')
  assert.equal(forOther.held(), '2.0.0\n')
  const fromOther = await aMachineAtTheFloor(t, { withdrawal: { version: '1.0.0', from: '1.8.0' } })
  const wrongFrom = await fromOther.run({ version: '1.0.0', downgrade: true, withdrawalIn: '2.1.0' })
  assert.equal(wrongFrom.version, '1.0.0')
  assert.ok(fromOther.lines.includes('martha: the withdrawal in 2.1.0 lowers the floor from 1.8.0, and this machine\'s floor is 2.0.0; it is not honoured'))
  assert.equal(currentVersion(fromOther), '1.0.0')
  assert.equal(fromOther.held(), '2.0.0\n')
})

test('a release that carries no withdrawal, or a malformed one, withdraws no floor: one line, and the version is installed', async (t) => {
  const none = await aMachineAtTheFloor(t)
  const without = await none.run({ version: '1.0.0', downgrade: true, withdrawalIn: '3.0.0' })
  assert.equal(without.version, '1.0.0')
  assert.ok(none.lines.includes('martha: this release carries no martha/floor-withdrawal.json, so it withdraws no floor'))
  assert.ok(none.lines.includes('martha: 1.0.0 is below 2.0.0, the version floor this machine holds; installing it'))
  assert.equal(currentVersion(none), '1.0.0')
  assert.equal(none.held(), '2.0.0\n')
  const malformed = await aMachineAtTheFloor(t, { withdrawal: { raw: '{"version":"1.0.0"}' } })
  const bad = await malformed.run({ version: '1.0.0', downgrade: true, withdrawalIn: '2.1.0' })
  assert.equal(bad.version, '1.0.0')
  assert.ok(malformed.lines.includes('martha: martha/floor-withdrawal.json is not { "version": "X.Y.Z", "from": "X.Y.Z" }; no withdrawal is taken from it'))
  assert.ok(malformed.lines.includes('martha: 1.0.0 is below 2.0.0, the version floor this machine holds; installing it'))
  assert.equal(currentVersion(malformed), '1.0.0')
  assert.equal(malformed.held(), '2.0.0\n')
})

test('refused: a withdrawal whose release is unsigned, or signed for another repository, ref or an unlisted signer', async (t) => {
  /** @type {[string, (c: Release) => any, RegExp][]} */
  const cases = [
    ['unsigned', () => undefined, /martha:2\.1\.0 \(sha256:\S+\) carries no signature from Martha's release workflow for refs\/tags\/v2\.1\.0/],
    ['another repository', () => ({ ref: 'refs/tags/v2.1.0', repository: 'https://github.com/macula-io/macula' }), /carries no signature .*macula-io\/macula/],
    ['another ref', () => ({ ref: 'refs/heads/main' }), /signed for refs\/heads\/main, not refs\/tags\/v2\.1\.0/],
    ['an unlisted signer', () => ({ ref: 'refs/tags/v2.1.0', signerSha: 'f'.repeat(40) }), /carries no signature/]
  ]
  for (const [, sign, pattern] of cases) {
    const w = await aMachineAtTheFloor(t, {
      signed: ({ old, at, carrier }) => new Map(/** @type {[string, any][]} */ ([
        [old.digest, { ref: 'refs/tags/v1.0.0' }], [at.digest, { ref: 'refs/tags/v2.0.0' }],
        ...(sign(carrier) ? [[carrier.digest, sign(carrier)]] : [])
      ]))
    })
    await refusedWith(w.run({ version: '1.0.0', downgrade: true, withdrawalIn: '2.1.0' }), pattern)
    assert.equal(currentVersion(w), '2.0.0')
    assert.equal(w.held(), '2.0.0\n')
  }
})

test('a withdrawal when this machine holds no floor is said in one line, and the version is installed', async (t) => {
  const old = release({ version: '1.0.0', floor: '1.0.0' })
  const carrier = release({ version: '2.1.0', floor: '2.0.0', withdrawal: { version: '1.0.0', from: '2.0.0' } })
  const w = await world(t, [old, carrier])
  const result = await w.run({ version: '1.0.0', withdrawalIn: '2.1.0' })
  assert.equal(result.version, '1.0.0')
  assert.ok(w.lines.includes('martha: the withdrawal in 2.1.0 lowers the floor from 2.0.0, and this machine holds no floor'))
  assert.equal(currentVersion(w), '1.0.0')
  assert.equal(w.held(), '1.0.0\n')
  assert.deepEqual(placed(w), ['1.0.0'])
})

test('refused before anything is fetched: --withdrawal-in with no named target, naming the target itself, or not a version', async (t) => {
  const w = await world(t, [release({ version: '1.2.0' })])
  await refusedWith(w.run({ withdrawalIn: '2.1.0' }), /^--withdrawal-in needs the version it withdraws to; name it/)
  await refusedWith(w.run({ version: '2.1.0', withdrawalIn: '2.1.0' }), /^--withdrawal-in names 2\.1\.0 itself; a withdrawal is carried by another release, name that one/)
  await refusedWith(w.run({ version: '1.2.0', withdrawalIn: 'latest' }), /^--withdrawal-in is X\.Y\.Z, got 'latest'/)
  assert.deepEqual(w.registry.hits, [])
})

test('a withdrawn install that fails leaves the record where it was: the lowered floor is written only after the swap', async (t) => {
  const old = release({ version: '1.0.0', floor: '1.0.0' })
  const at = release({ version: '2.0.0', floor: '2.0.0' })
  const carrier = release({ version: '2.1.0', floor: '2.0.0', withdrawal: { version: '1.0.0', from: '2.0.0' } })
  const w = await world(t, [{ ...old, layer: Buffer.from(old.layer).fill(7, 40, 41) }, at, carrier])
  await w.run({ version: '2.0.0' })
  await refusedWith(w.run({ version: '1.0.0', downgrade: true, withdrawalIn: '2.1.0' }), /the layer sha256:\S+ hashes to/)
  assert.equal(w.held(), '2.0.0\n')
  assert.equal(currentVersion(w), '2.0.0')
})

/**
 * Makes the swap of current fail after the release is placed, and nothing else: a directory with a file in it at
 * the temporary link swapLink makes beside current, so its symlink call meets EEXIST. The record's directory stays
 * writable, so a floor written before the swap would land and be seen (martha#21 r=1, design section 6's mutant).
 * @param {{ places: { current: string } }} w
 */
const blockTheSwap = (w) => {
  const temporary = join(dirname(w.places.current), `.${basename(w.places.current)}.${process.pid}`)
  mkdirSync(temporary)
  writeFileSync(join(temporary, 'kept'), '')
}

test('a withdrawn install that fails at the swap of current leaves the record and current where they were', async (t) => {
  const w = await aMachineAtTheFloor(t)
  blockTheSwap(w)
  await assert.rejects(w.run({ version: '1.0.0', downgrade: true, withdrawalIn: '2.1.0' }), { code: 'EEXIST' })
  assert.equal(w.held(), '2.0.0\n')
  assert.equal(currentVersion(w), '2.0.0')
})

test('an install raising the floor that fails at the swap of current leaves the record and current where they were', async (t) => {
  const w = await aMachineAtTheFloor(t)
  blockTheSwap(w)
  await assert.rejects(w.run({ version: '3.0.0' }), { code: 'EEXIST' })
  assert.equal(w.held(), '2.0.0\n')
  assert.equal(currentVersion(w), '2.0.0')
})
