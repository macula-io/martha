// martha-install end to end against a local registry (martha#21): what is installed, and everything that must be
// refused with nothing linked. sigstore's own bundle check is stood in for (serve_a_release_locally.mjs); the
// identity, the ref, the repository and the subject are checked as they would be on a real certificate.
import assert from 'node:assert/strict'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { Refused } from '../refuse_in_words/refuse_in_words.mjs'
import { SIGNER, goodEntries, release, scratchMachine, serveRegistry, sigstoreStandIn } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { installRelease, placesOnThisMachine } from './install_a_release.mjs'

/**
 * A machine and a registry serving `releases`; every one signed for its own tag unless `signed` says otherwise.
 * @param {import('node:test').TestContext} t
 * @param {import('../serve_a_release_locally/serve_a_release_locally.mjs').Release[]} releases
 * @param {{ signed?: Map<string, { ref: string }>, serve?: Parameters<typeof serveRegistry>[1] }} [options]
 */
async function world (t, releases, { signed, serve } = {}) {
  const registry = await serveRegistry(releases, serve)
  const machine = scratchMachine()
  t.after(async () => { await registry.close(); machine.close() })
  const signedRefs = signed ?? new Map(releases.map((r) => [r.digest, { ref: `refs/tags/v${r.version}` }]))
  /** @type {string[]} */
  const lines = []
  /** @param {Partial<import('./install_a_release.mjs').InstallRequest>} [request] */
  const run = (request = {}) => installRelease({
    places: machine.places, base: registry.base, signers: [SIGNER], makeVerifier: sigstoreStandIn(signedRefs),
    log: (line) => lines.push(line), ...request
  })
  return { ...machine, registry, run, lines }
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

/** @param {{ places: import('../place_the_release/place_the_release.mjs').Places }} w */
const nothingLinked = (w) => {
  assert.ok(!existsSync(w.places.current), 'current is not linked')
  assert.ok(!existsSync(join(w.places.binDir, 'martha')), 'the command is not linked')
  assert.deepEqual(readdirSync(w.places.releases).filter((n) => !n.startsWith('.')), [], 'no release was placed')
}

/** @param {{ places: import('../place_the_release/place_the_release.mjs').Places }} w */
const nothingAtAll = (w) => assert.ok(!existsSync(w.places.releases) || readdirSync(w.places.releases).length === 0, 'nothing was written')

test('installs the signed release: its own read-only directory, current, and the command through current', async (t) => {
  const r = release({ version: '1.2.0' })
  const w = await world(t, [r])
  const result = await w.run({ version: '1.2.0' })
  assert.equal(result.digest, r.digest)
  assert.equal(result.signer, SIGNER)
  const placed = join(w.places.releases, `1.2.0-${r.digest.replace(':', '-')}`)
  assert.equal(readlinkSync(w.places.current), placed)
  assert.equal(readFileSync(join(w.places.current, 'martha', 'README.md'), 'utf8'), '# Martha\n')
  assert.equal(lstatSync(placed).mode & 0o222, 0)
  const command = join(w.places.binDir, 'martha')
  assert.equal(readlinkSync(command), join(w.places.current, 'martha', 'bin', 'martha'))
  assert.equal(realpathSync(command), join(placed, 'martha', 'bin', 'martha'))
  assert.match(w.lines.join('\n'), /signed by attest-image\.yml@b4c41ab\S+ for https:\/\/github\.com\/macula-io\/martha refs\/tags\/v1\.2\.0/)
})

test('a release that carries no bin/martha links no command, and says so', async (t) => {
  const r = release({ version: '1.2.0', entries: goodEntries({ command: false }) })
  const w = await world(t, [r])
  const result = await w.run({ version: '1.2.0' })
  assert.equal(result.command, 'this release carries no martha/bin/martha, so there is no command to link')
  assert.ok(w.lines.includes(`martha: ${result.command}`))
  assert.ok(!existsSync(join(w.places.binDir, 'martha')))
  assert.ok(existsSync(join(w.places.current, 'martha', 'README.md')), 'the release itself is installed')
})

test('without a version it takes the highest X.Y.Z, never :latest', async (t) => {
  const w = await world(t, [release({ version: '1.2.0' }), release({ version: '1.10.0' }), release({ version: '1.9.1' })], { serve: { extraTags: ['latest'] } })
  assert.equal((await w.run()).version, '1.10.0')
  assert.ok(!w.registry.hits.some((h) => h.includes('/manifests/latest')))
})

test('refused: a tampered layer', async (t) => {
  const r = release({ version: '1.2.0' })
  const w = await world(t, [{ ...r, layer: Buffer.from(r.layer).fill(7, 40, 41) }])
  await refusedWith(w.run({ version: '1.2.0' }), /the layer sha256:\S+ hashes to sha256:\S+, not sha256:/)
  nothingLinked(w)
})

test('refused: a tampered manifest (its digest is not the one signed)', async (t) => {
  const r = release({ version: '1.2.0' })
  const tampered = { ...r, manifest: Buffer.from(r.manifest.toString().replace('"schemaVersion":2', '"schemaVersion":2 ')) }
  const w = await world(t, [tampered], { signed: new Map([[r.digest, { ref: 'refs/tags/v1.2.0' }]]) })
  await refusedWith(w.run({ version: '1.2.0' }), /martha:1\.2\.0 \(sha256:\S+\) carries no signature from Martha's release workflow/)
  nothingAtAll(w)
})

test('refused: a moved tag (1.3.0 names the signed 1.2.0)', async (t) => {
  const old = release({ version: '1.2.0' })
  const w = await world(t, [old], { serve: { tags: { '1.3.0': old } } })
  await refusedWith(w.run({ version: '1.3.0' }), /signed for refs\/tags\/v1\.2\.0, not refs\/tags\/v1\.3\.0/)
  nothingAtAll(w)
})

test('refused: an unsigned digest; with no version named the refusal says to name one', async (t) => {
  const r = release({ version: '1.2.0' })
  const w = await world(t, [r], { serve: { unsigned: [r.digest] } })
  await refusedWith(w.run({ version: '1.2.0' }), /carries no signature/)
  await refusedWith(w.run(), /the highest version on \S+, 1\.2\.0 .* carries no signature .* Name a version: martha-install <version>/)
  nothingAtAll(w)
})

test('refused: a second digest for a version this machine holds', async (t) => {
  const first = release({ version: '1.2.0' })
  const w = await world(t, [first])
  await w.run({ version: '1.2.0' })
  const second = release({ version: '1.2.0', entries: [...goodEntries(), { name: 'martha/extra', body: 'x' }] })
  const w2 = await serveRegistry([second])
  t.after(w2.close)
  await refusedWith(w.run({ version: '1.2.0', base: w2.base, makeVerifier: sigstoreStandIn(new Map([[second.digest, { ref: 'refs/tags/v1.2.0' }]])) }),
    /1\.2\.0 is installed as sha256-\S+ and the package now names sha256:\S+ for it; a version is published once/)
  assert.equal(readlinkSync(w.places.current), join(w.places.releases, `1.2.0-${first.digest.replace(':', '-')}`))
})

test('the one downgrade rule: lower is refused, --downgrade needs the version named, and then installs it', async (t) => {
  const w = await world(t, [release({ version: '1.2.0' }), release({ version: '1.3.0' })])
  await w.run({ version: '1.3.0' })
  await refusedWith(w.run({ version: '1.2.0' }), /1\.2\.0 is lower than the installed 1\.3\.0; refused\. To go back on purpose: martha-install 1\.2\.0 --downgrade/)
  await refusedWith(w.run({ downgrade: true }), /--downgrade installs only the version you name/)
  assert.match(readlinkSync(w.places.current), /1\.3\.0-sha256-/)
  assert.equal((await w.run({ version: '1.2.0', downgrade: true })).version, '1.2.0')
  assert.match(readlinkSync(w.places.current), /1\.2\.0-sha256-/)
})

test('refused: a --digest that is not the one the tag names now', async (t) => {
  const w = await world(t, [release({ version: '1.2.0' })])
  await refusedWith(w.run({ version: '1.2.0', digest: `sha256:${'0'.repeat(64)}` }), /is sha256:\S+ now, not the sha256:0+ you verified/)
})

test('refused before anything is fetched: a Node older than the one Martha runs on', async (t) => {
  const w = await world(t, [release({ version: '1.2.0' })])
  await refusedWith(w.run({ version: '1.2.0', nodeVersion: '22.0.0' }), /Martha needs Node >=\d+\.\d+\.\d+; this is Node 22\.0\.0/)
  assert.deepEqual(w.registry.hits, [])
})

test('a hostile layer that is signed is still refused, with nothing placed', async (t) => {
  const w = await world(t, [release({ version: '1.2.0', entries: [{ name: 'martha/../../escape', body: 'x' }] })])
  await refusedWith(w.run({ version: '1.2.0' }), /through '\.\.'/)
  nothingLinked(w)
})

test('a file where current or the command should be is named, never replaced', async (t) => {
  const w = await world(t, [release({ version: '1.2.0' })])
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(w.places.binDir, { recursive: true })
  writeFileSync(join(w.places.binDir, 'martha'), 'mine')
  const result = await w.run({ version: '1.2.0' })
  assert.match(result.command, /martha is not a link, so it was left alone/)
  assert.equal(readFileSync(join(w.places.binDir, 'martha'), 'utf8'), 'mine')
})

test('the places come from XDG_DATA_HOME when it is absolute, else ~/.local/share', () => {
  assert.deepEqual(placesOnThisMachine('/h', '/x/data'), { releases: '/x/data/martha/releases', current: '/x/data/martha/current', binDir: '/h/.local/bin' })
  assert.deepEqual(placesOnThisMachine('/h', 'relative'), { releases: '/h/.local/share/martha/releases', current: '/h/.local/share/martha/current', binDir: '/h/.local/bin' })
  assert.deepEqual(placesOnThisMachine('/h', undefined).releases, '/h/.local/share/martha/releases')
})
