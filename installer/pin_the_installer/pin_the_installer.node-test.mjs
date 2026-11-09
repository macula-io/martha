// The pin is made from npm's provenance, and refused by name when anything about that provenance is not this
// repository's installer publish (martha#84, design section 1).
//
// A stand-in verifier stands in for sigstore's, as the rest of the installer suite does: what is under test here is
// which identity the check is asked for, and what the attestation must then state. One test, last, runs the real
// trust root over a real published attestation, so the verification path is proved to run against Sigstore itself
// and not only against a stand-in.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { CouldNotCheck, Refused } from '../refuse_in_words/refuse_in_words.mjs'
import { pinTheInstaller } from './pin_the_installer.mjs'

const NAME = '@martha-pin/fixture'
const VERSION = '1.0.0'
const SOURCE = 'https://github.com/martha-pin/fixture'
const WORKFLOW = '.github/workflows/installer.yml'
const ISSUER = 'https://token.actions.githubusercontent.com'
const REF = `refs/tags/${NAMES.installerTagPrefix}${VERSION}`
const PROVENANCE = 'https://slsa.dev/provenance/v1'
const TARBALL = 'the bytes npm serves for the pinned installer\n'
const REAL_ATTESTATIONS = JSON.parse(readFileSync(join(import.meta.dirname, 'a_real_published_packages_attestations.json'), 'utf8'))
const OID_REPOSITORY = '1.3.6.1.4.1.57264.1.12'
const OID_REF = '1.3.6.1.4.1.57264.1.14'

/**
 * @typedef {{ repo: string, commit: string }} World
 *   A repository the pin is made from: its path, and the commit its installer tag names.
 * @typedef {{ world?: World, attestations?: any, documentChange?: (document: any) => void, makeVerifier?: any }} Attempt
 */

/** @param {string} text */
const sha512Hex = (text) => createHash('sha512').update(text).digest('hex')
/** @param {string} text */
const sri = (text) => `sha512-${Buffer.from(sha512Hex(text), 'hex').toString('base64')}`

/** @param {string} what */
const scratch = (what) => mkdtempSync(join(tmpdir(), `martha-pin-${what}-`))
/** @param {string} repo @param {...string} args */
const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

/**
 * A repository whose installer carries a version, committed and tagged the way installer.yml tags a publish.
 * @param {import('node:test').TestContext} t
 * @param {{ drift?: boolean }} [options]
 * @returns {World}
 */
function repoOf (t, { drift = false } = {}) {
  const repo = scratch('repo')
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  mkdirSync(join(repo, 'installer'))
  writeFileSync(join(repo, 'installer', 'package.json'), JSON.stringify({ name: NAME, version: VERSION, martha: { sourceRepository: SOURCE, installerPublishWorkflow: WORKFLOW, issuer: ISSUER } }, null, 2))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'martha', version: VERSION }))
  git(repo, 'init', '-q', '.')
  git(repo, 'config', 'user.name', 'Ada Owner')
  git(repo, 'config', 'user.email', 'ada@example.invalid')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'the installer')
  const commit = git(repo, 'rev-parse', 'HEAD')
  // An annotated tag, as installer.yml cuts one: the pin must peel it to the commit the attestation names.
  git(repo, 'tag', '-m', `the ${VERSION} installer publish`, `${NAMES.installerTagPrefix}${VERSION}`)
  if (drift) {
    writeFileSync(join(repo, 'installer', 'moved.js'), 'export const moved = 1\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'a fix without a version bump')
  }
  return { repo, commit }
}

/**
 * The SLSA statement npm's provenance carries, with `change` applied before it is signed.
 * @param {string} commit
 * @param {(statement: any) => void} [change]
 * @returns {any}
 */
function statementFor (commit, change = () => {}) {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    predicateType: PROVENANCE,
    subject: [{ name: `pkg:npm/${NAME}@${VERSION}`, digest: { sha512: sha512Hex(TARBALL) } }],
    predicate: {
      buildDefinition: {
        externalParameters: { workflow: { repository: SOURCE, path: WORKFLOW, ref: REF } },
        resolvedDependencies: [{ uri: `git+${SOURCE}@${REF}`, digest: { gitCommit: commit } }]
      }
    }
  }
  change(statement)
  return statement
}

/**
 * A sigstore bundle over a statement: the shape npm publishes, without a signature a stand-in must check.
 * @param {any} statement
 * @returns {any}
 */
const bundleOf = (statement) => ({
  mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
  dsseEnvelope: { payloadType: 'application/vnd.in-toto+json', payload: Buffer.from(JSON.stringify(statement)).toString('base64'), signatures: [] }
})

/** The attestations document one publish leaves, over `statement`. @param {any} statement */
const attestationsOver = (statement) => ({ attestations: [{ predicateType: PROVENANCE, bundle: bundleOf(statement) }] })

/** A DER UTF8String, as Fulcio's GitHub extensions hold their value. @param {string} text */
const utf8Extension = (text) => Buffer.concat([Buffer.from([0x0c, Buffer.byteLength(text)]), Buffer.from(text)])
/** @param {string} oid */
const oidOf = (oid) => ({ oid: { id: oid.split('.').map(Number) } })

/**
 * sigstore's verifier stood in for: it records the options it was asked for, and answers with the certificate
 * extensions a repository's workflow run carries.
 * @param {Record<string, any>} [record]
 * @param {{ repository?: string, ref?: string }} [named]
 */
function sigstoreStandIn (record = {}, { repository = SOURCE, ref = REF } = {}) {
  return async (/** @type {any} */ options) => {
    record.options = options
    return { verify: () => ({ identity: { oids: [{ ...oidOf(OID_REPOSITORY), value: utf8Extension(repository) }, { ...oidOf(OID_REF), value: utf8Extension(ref) }] } }) }
  }
}

/**
 * A registry on the loopback serving one version's document, its attestations and its tarball.
 * @param {import('node:test').TestContext} t
 * @param {(base: string) => Record<string, string>} makeRoutes
 * @returns {Promise<string>}
 */
async function registryServing (t, makeRoutes) {
  /** @type {Record<string, string>} */
  let routes = {}
  const server = createServer((request, response) => {
    const body = routes[request.url ?? '']
    if (body === undefined) { response.writeHead(404); response.end(); return }
    response.writeHead(200)
    response.end(body)
  })
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', () => { resolve(undefined) }) })
  t.after(() => new Promise((resolve) => { server.close(() => { resolve(undefined) }) }))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const base = `http://127.0.0.1:${port}/`
  routes = makeRoutes(base)
  return base
}

/**
 * The routes one version's publish leaves on a registry, with `options` applied to the document and the attestations.
 * @param {string} base
 * @param {{ documentChange?: (document: any) => void, attestations?: any }} [options]
 * @returns {Record<string, string>}
 */
function servedFrom (base, { documentChange = () => {}, attestations } = {}) {
  const document = {
    name: NAME,
    version: VERSION,
    dist: { tarball: `${base}tarball.tgz`, integrity: sri(TARBALL), attestations: { url: `${base}attestations` } }
  }
  documentChange(document)
  return {
    [`/${NAME}/${VERSION}`]: JSON.stringify(document),
    '/attestations': JSON.stringify(attestations ?? {}),
    '/tarball.tgz': TARBALL
  }
}

/**
 * One attempt to pin: a world (a fresh repository, or the one given), a context, and the registry serving the
 * attestations. `pinning` is the promise the test asserts on.
 * @param {import('node:test').TestContext} t
 * @param {Attempt} [options]
 * @returns {Promise<{ context: string, world: World, pinning: Promise<any> }>}
 */
async function attempt (t, { world, attestations, documentChange, makeVerifier = sigstoreStandIn() } = {}) {
  const made = world ?? repoOf(t)
  const context = scratch('context')
  t.after(() => rmSync(context, { recursive: true, force: true }))
  const base = await registryServing(t, (url) => servedFrom(url, { documentChange: documentChange ?? (() => {}), attestations: attestations ?? attestationsOver(statementFor(made.commit)) }))
  return { context, world: made, pinning: pinTheInstaller({ context, repo: made.repo, registry: base, makeVerifier }) }
}

/**
 * @param {Promise<unknown>} promise @param {RegExp} pattern
 * @returns {Promise<void>}
 */
const refusedWith = async (promise, pattern) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof Refused, `expected a refusal, got ${String(error)}`)
    assert.match(/** @type {Error} */ (error).message, pattern)
    return true
  })
}

/** @param {string} context */
const pinFile = (context) => join(context, NAMES.releaseFolder, 'installer.json')

test('the pin is exactly the three fields, named by the tree and covered by the bytes npm serves', async (t) => {
  const { pinning } = await attempt(t)
  const { file, pin } = await pinning
  assert.deepEqual(pin, { name: NAME, version: VERSION, integrity: sri(TARBALL) })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { name: NAME, version: VERSION, integrity: sri(TARBALL) })
})

test('the certificate the pin demands is exactly this repository, this workflow and this ref', async (t) => {
  /** @type {Record<string, any>} */
  const record = {}
  const { pinning } = await attempt(t, { makeVerifier: sigstoreStandIn(record) })
  await pinning
  assert.equal(record.options.certificateIssuer, ISSUER)
  assert.equal(record.options.certificateIdentityURI, `^${`${SOURCE}/${WORKFLOW}@${REF}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
})

test('a version npm holds no attestation for is refused, naming what is missing', async (t) => {
  await refusedWith((await attempt(t, { attestations: { attestations: [] } })).pinning, new RegExp(`no ${PROVENANCE} attestation`))
  const noUrl = (/** @type {any} */ document) => { delete document.dist.attestations }
  await refusedWith((await attempt(t, { documentChange: noUrl })).pinning, /carries no attestation at all/)
})

test('an attestation that names another repository, workflow or ref is refused, naming both, and nothing is pinned', async (t) => {
  /** @type {((statement: any) => void)[]} */
  const changes = [
    (statement) => { statement.predicate.buildDefinition.externalParameters.workflow.repository = 'https://github.com/attacker/fork' },
    (statement) => { statement.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/other.yml' },
    (statement) => { statement.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/main' }
  ]
  for (const change of changes) {
    const world = repoOf(t)
    const { context, pinning } = await attempt(t, { world, attestations: attestationsOver(statementFor(world.commit, change)) })
    await refusedWith(pinning, /the attestation names/)
    assert.equal(existsSync(pinFile(context)), false, 'nothing was pinned')
  }
})

test('a certificate issued for another repository or ref is refused, naming both', async (t) => {
  for (const other of [{ repository: 'https://github.com/attacker/fork' }, { ref: 'refs/heads/main' }]) {
    await refusedWith((await attempt(t, { makeVerifier: sigstoreStandIn({}, other) })).pinning, /the certificate names/)
  }
})

test('an attestation over other bytes is refused, naming the digest it covers', async (t) => {
  const world = repoOf(t)
  const change = (/** @type {any} */ statement) => { statement.subject[0].digest.sha512 = 'f'.repeat(128) }
  await refusedWith((await attempt(t, { world, attestations: attestationsOver(statementFor(world.commit, change)) })).pinning, /the attestation is over f{128}/)
})

test('an attestation built from another commit than the installer tag names is refused', async (t) => {
  const world = repoOf(t)
  const change = (/** @type {any} */ statement) => { statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'a'.repeat(40) }
  await refusedWith((await attempt(t, { world, attestations: attestationsOver(statementFor(world.commit, change)) })).pinning, new RegExp(`built from a{40}, not ${world.commit}`))
})

test('the commit is read from the entry whose uri names this repository and ref, never from the first', async (t) => {
  const world = repoOf(t)
  const decoy = { uri: 'git+https://github.com/attacker/fork@refs/heads/main', digest: { gitCommit: 'b'.repeat(40) } }
  const change = (/** @type {any} */ statement) => { statement.predicate.buildDefinition.resolvedDependencies = [decoy, ...statement.predicate.buildDefinition.resolvedDependencies] }
  const { pinning } = await attempt(t, { world, attestations: attestationsOver(statementFor(world.commit, change)) })
  assert.deepEqual((await pinning).pin.version, VERSION, 'a decoy first in the list does not decide the commit')
})

test('a tarball that does not hash to the integrity its document names is refused', async (t) => {
  const documentChange = (/** @type {any} */ document) => { document.dist.integrity = sri('other bytes') }
  const { context, pinning } = await attempt(t, { documentChange })
  await refusedWith(pinning, /does not hash to the integrity/)
  assert.equal(existsSync(pinFile(context)), false)
})

test('a tree with no installer tag, or an installer/ that moved after its tag, is refused by name', async (t) => {
  const untagged = repoOf(t)
  git(untagged.repo, 'tag', '-d', `${NAMES.installerTagPrefix}${VERSION}`)
  await refusedWith((await attempt(t, { world: untagged })).pinning, new RegExp(`there is no ${NAMES.installerTagPrefix}${VERSION} tag`))
  const drifted = repoOf(t, { drift: true })
  await refusedWith((await attempt(t, { world: drifted })).pinning, /installer\/ is not what .* published \(installer\/moved\.js\)/)
})

test('a context that already carries a pin is refused, and the pin it holds is left as it was', async (t) => {
  const world = repoOf(t)
  const context = scratch('written')
  t.after(() => rmSync(context, { recursive: true, force: true }))
  mkdirSync(join(context, NAMES.releaseFolder))
  writeFileSync(pinFile(context), 'the pin a release was packed with\n')
  const base = await registryServing(t, (url) => servedFrom(url, { attestations: attestationsOver(statementFor(world.commit)) }))
  await refusedWith(pinTheInstaller({ context, repo: world.repo, registry: base, makeVerifier: sigstoreStandIn() }), /already holds a pin/)
  assert.equal(readFileSync(pinFile(context), 'utf8'), 'the pin a release was packed with\n')
})

test('a real published attestation is refused under the real trust root: another repository published it', async (t) => {
  // One fixture off npm, verified against Sigstore itself: the path under test runs, and the exact-identity policy
  // is what refuses it. A trust root that cannot be reached is no verdict, and skips rather than fails.
  const world = repoOf(t)
  const context = scratch('real')
  t.after(() => rmSync(context, { recursive: true, force: true }))
  const base = await registryServing(t, (url) => servedFrom(url, { attestations: REAL_ATTESTATIONS }))
  try {
    await pinTheInstaller({ context, repo: world.repo, registry: base })
    assert.fail('a package published by another repository was pinned')
  } catch (error) {
    if (error instanceof CouldNotCheck) return t.skip(`the Sigstore trust root could not be reached: ${error.message}`)
    assert.ok(error instanceof Refused, String(error))
    assert.match(error.message, /not this repository's installer publish/)
    assert.equal(existsSync(pinFile(context)), false, 'nothing was pinned')
  }
})
