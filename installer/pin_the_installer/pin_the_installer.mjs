// The pin a release carries on its installer (martha#84, design section 1): made here, inside the signed layer,
// from npm's own provenance — never from npm agreeing with itself.
//
// This exists so that taking over the npm account cannot put a new installer in front of an installed user. The
// release says which installer version it pins, by npm integrity; this script refuses to make that pin unless the
// bytes npm serves for that version were published by THIS repository's installer workflow, at the tag that
// version's publish ran at, from this tree's own `installer/`.
//
// Run by pack_a_release/pack_a_release.sh after `git archive` and before the Containerfile is written, so a release
// that cannot be pinned is never built. Nothing here ships: installer/package.json's `files` is unchanged.
//
// Refused by name, and nothing pinned: npm does not serve the version; it holds no provenance attestation for it; the
// attestation names another repository, workflow, ref or commit; it is over other bytes; there is no installer-v tag
// here; `installer/` differs from that tag; the tarball does not hash to `dist.integrity`; the trust root did not
// arrive. A check that could not be made is never "unsigned" and never fine.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

import { createVerifier, PolicyError, ValidationError, VerificationError } from 'sigstore'

import { anchoredIdentity, installerRef, NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { couldNotCheck, refuse } from '../refuse_in_words/refuse_in_words.mjs'
import { OID_SOURCE_REF, OID_SOURCE_REPOSITORY, utf8Extension } from '../verify_the_release_signature/verify_the_release_signature.mjs'

const PROVENANCE = 'https://slsa.dev/provenance/v1'
const IN_TOTO_STATEMENT = 'https://in-toto.io/Statement/v1'
const IN_TOTO_PAYLOAD = 'application/vnd.in-toto+json'
const INSTALLER_DIRECTORY = 'installer'
const PIN_FILE = 'installer.json'
/** The registry a public npm name is published to. The release's own dry run names its local one instead. */
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/'
/** The repository this script lives in, which is the tree being released. */
const REPO = dirname(dirname(import.meta.dirname))

/** Every read is capped, whatever the server says its length is. */
export const LIMITS = Object.freeze({
  versionBytes: 64 * 1024,
  attestationsBytes: 1024 * 1024,
  tarballBytes: 64 * 1024 * 1024
})

/**
 * @typedef {(options: object) => Promise<{ verify: (bundle: any) => any }>} MakeVerifier
 *   sigstore's createVerifier; a test passes its own.
 * @typedef {{ name: string, version: string, sourceRepository: string, workflow: string, issuer: string }} Manifest
 *   The installer's own manifest: what the tree says about itself, before npm is asked anything.
 * @typedef {Manifest & { ref: string, digest: string, commit: string }} Expected
 *   What the attestation must be true of: the manifest, the ref, the bytes npm served, and the tag's commit.
 * @typedef {{ name: string, version: string, registry: string, fetch: typeof globalThis.fetch }} Asked
 */

/** @param {unknown} error */
const wordsOf = (error) => (error instanceof Error ? error.message : String(error))

/** The sha512 of some bytes, as hex: what an in-toto subject is written as. @param {Uint8Array} bytes */
const sha512Hex = (bytes) => createHash('sha512').update(bytes).digest('hex')

/** The same bytes as npm writes an integrity: `sha512-<base64>`. @param {Uint8Array} bytes */
const sha512Sri = (bytes) => `sha512-${Buffer.from(sha512Hex(bytes), 'hex').toString('base64')}`

/**
 * The JSON these bytes are, or a refusal naming what was not JSON.
 * @param {Uint8Array | string} bytes
 * @param {string} what
 * @returns {any}
 */
const jsonOf = (bytes, what) => {
  try { return JSON.parse(typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8')) } catch { return refuse(`${what} is not JSON; nothing was pinned`) }
}

/**
 * The body, refused past `limit` bytes whether or not the server said how long it is.
 * @param {Response} response
 * @param {number} limit
 * @param {string} what
 * @returns {Promise<Buffer>}
 */
async function readCapped (response, limit, what) {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > limit) { await response.body?.cancel(); refuse(`${what} is ${declared} bytes, over the ${limit} a pin may read; nothing was pinned`) }
  /** @type {Buffer[]} */
  const chunks = []
  let total = 0
  if (!response.body) return Buffer.concat(chunks)
  for await (const chunk of response.body) {
    total += chunk.length
    if (total > limit) refuse(`${what} is over the ${limit} bytes a pin may read; nothing was pinned`)
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * The answer at `url`; nothing answering at all is no check, never a refusal of the answer's content.
 * @param {string} url @param {string} what @param {typeof globalThis.fetch} fetch
 * @returns {Promise<Response>}
 */
async function askFor (url, what, fetch) {
  try { return await fetch(url) } catch (error) { return couldNotCheck(`${what}: ${url} did not answer (${wordsOf(error)}); nothing was pinned`) }
}

/**
 * The bytes at `url`; a refusal when the registry says no, and a could-not-check when nothing answered at all.
 * @param {string} url @param {number} limit @param {string} what @param {typeof globalThis.fetch} fetch
 * @returns {Promise<Buffer>}
 */
async function bytesAt (url, limit, what, fetch) {
  const response = await askFor(url, what, fetch)
  if (!response.ok) { await response.body?.cancel(); refuse(`${what} answered ${response.status}; nothing was pinned`) }
  return readCapped(response, limit, what)
}

/** Whether a registry document is the one version that was asked for. @param {any} document @param {string} name @param {string} version */
const isThatVersion = (document, name, version) => document?.name === name && document?.version === version

/** Whether a version document names the tarball npm serves and the integrity of those bytes. @param {any} document */
const hasDistribution = (document) => typeof document?.dist?.tarball === 'string' && typeof document?.dist?.integrity === 'string'

/**
 * The document npm serves for one version, refused when it is not the one asked for.
 * @param {Asked} asked
 * @returns {Promise<any>}
 */
async function versionDocument (asked) {
  const { name, version, registry, fetch } = asked
  const url = `${registry}${name}/${version}`
  const document = jsonOf(await bytesAt(url, LIMITS.versionBytes, `the registry's document for ${name}@${version}`, fetch), url)
  if (!isThatVersion(document, name, version)) refuse(`${url} holds ${document?.name}@${document?.version}, not ${name}@${version}; nothing was pinned`)
  if (!hasDistribution(document)) refuse(`${name}@${version} on npm names no tarball or no integrity; nothing was pinned`)
  return document
}

/**
 * The SLSA provenance bundle npm holds for this version, or a refusal naming what is missing.
 * @param {any} document
 * @param {typeof globalThis.fetch} fetch
 * @returns {Promise<any>}
 */
async function provenanceOf (document, fetch) {
  const named = `${document.name}@${document.version}`
  const url = document.dist?.attestations?.url
  if (typeof url !== 'string') refuse(`${named} on npm carries no attestation at all, so nothing says this repository published it; publish it with npm publish --provenance, and nothing was pinned`)
  const served = jsonOf(await bytesAt(url, LIMITS.attestationsBytes, `the attestations of ${named}`, fetch), url)
  const listed = Array.isArray(served?.attestations) ? served.attestations : []
  const provenance = listed.find((/** @type {any} */ attestation) => attestation?.predicateType === PROVENANCE)
  if (provenance === undefined) refuse(`${named} on npm carries no ${PROVENANCE} attestation, so nothing says which commit built it; nothing was pinned`)
  return provenance.bundle
}

/**
 * The bytes npm serves for this version, as the hex digest an attestation names; refused when they are not the pin's.
 * @param {any} document
 * @param {typeof globalThis.fetch} fetch
 * @returns {Promise<string>}
 */
async function tarballDigest (document, fetch) {
  const named = `${document.name}@${document.version}`
  const bytes = await bytesAt(document.dist.tarball, LIMITS.tarballBytes, `the tarball npm serves for ${named}`, fetch)
  if (sha512Sri(bytes) !== document.dist.integrity) refuse(`the tarball npm serves for ${named} does not hash to the integrity its document names; nothing was pinned`)
  return sha512Hex(bytes)
}

/** Whether sigstore said no to the bundle (a verdict), as against failing to make the check at all. @param {unknown} error */
const isVerdict = (error) => error instanceof VerificationError || error instanceof PolicyError || error instanceof ValidationError

/**
 * sigstore's verifier for the exact identity this release demands; a trust root that did not arrive is no check.
 * @param {{ identity: string, issuer: string, makeVerifier: MakeVerifier, tufCachePath?: string | undefined }} wanted
 */
async function verifierFor ({ identity, issuer, makeVerifier, tufCachePath }) {
  try {
    return await makeVerifier({
      certificateIssuer: issuer,
      certificateIdentityURI: anchoredIdentity(identity),
      tlogThreshold: 1,
      ctLogThreshold: 1,
      ...(tufCachePath ? { tufCachePath } : {})
    })
  } catch (error) {
    return couldNotCheck(`the Sigstore trust root did not arrive (${wordsOf(error)}); nothing was pinned`)
  }
}

/**
 * The bundle verified against the Sigstore trust root for exactly `identity`: who signed it, and over what.
 * @param {any} bundle
 * @param {{ identity: string, issuer: string, makeVerifier: MakeVerifier, tufCachePath?: string | undefined }} wanted
 * @returns {Promise<any>}
 */
async function verified (bundle, wanted) {
  const verifier = await verifierFor(wanted)
  try {
    return verifier.verify(bundle)
  } catch (error) {
    if (!isVerdict(error)) couldNotCheck(`the provenance check failed to run (${wordsOf(error)}); nothing was pinned`)
    return refuse(`the provenance of this installer is not this repository's installer publish, and it must be: ${wordsOf(error)}; nothing was pinned`)
  }
}

/**
 * The in-toto statement inside a sigstore bundle, or a refusal.
 * @param {any} bundle
 * @returns {any}
 */
function statementOf (bundle) {
  const envelope = bundle?.dsseEnvelope
  if (envelope?.payloadType !== IN_TOTO_PAYLOAD || typeof envelope.payload !== 'string') refuse('the attestation is no in-toto statement, so it says nothing about which bytes it covers; nothing was pinned')
  return jsonOf(Buffer.from(envelope.payload, 'base64'), 'the attestation statement')
}

/**
 * Whether a `resolvedDependencies` uri names this repository at this ref: `git+<repository>@<ref>`.
 * @param {any} uri @param {string} repository @param {string} ref
 */
function namesThisBuild (uri, repository, ref) {
  const named = /^git\+(.+?)(?:\.git)?@(.+)$/.exec(typeof uri === 'string' ? uri : '')
  return named !== null && named[1] === repository && named[2] === ref
}

/**
 * The one commit the attestation lists for this repository at this ref, chosen by uri; undefined when none or several.
 * @param {any} statement @param {string} repository @param {string} ref
 * @returns {string | undefined}
 */
function commitAt (statement, repository, ref) {
  const dependencies = statement?.predicate?.buildDefinition?.resolvedDependencies
  const listed = (Array.isArray(dependencies) ? dependencies : []).filter((/** @type {any} */ entry) => namesThisBuild(entry?.uri, repository, ref))
  const commits = [...new Set(listed.map((/** @type {any} */ entry) => entry?.digest?.gitCommit))]
  return commits.length === 1 && typeof commits[0] === 'string' ? commits[0] : undefined
}

/** The one digest a statement's single subject carries, or undefined when it names none or several. @param {any} statement */
function subjectDigestOf (statement) {
  const subject = statement?.subject
  return Array.isArray(subject) && subject.length === 1 ? subject[0]?.digest?.sha512 : undefined
}

/** The attestation is over exactly the bytes npm served for the version being pinned. @param {any} statement @param {Expected} expected */
function coveredBytes (statement, expected) {
  const over = subjectDigestOf(statement)
  if (over !== expected.digest) refuse(`the attestation is over ${over ?? 'no one subject'}, not the bytes of ${expected.name}@${expected.version}; nothing was pinned`)
}

/** The attestation names this repository, this workflow and this ref, all three. @param {any} statement @param {Expected} expected */
function builtBy (statement, expected) {
  const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow ?? {}
  const same = workflow.repository === expected.sourceRepository && workflow.path === expected.workflow && workflow.ref === expected.ref
  if (!same) refuse(`the attestation names ${workflow.repository} ${workflow.path}@${workflow.ref}, not ${expected.sourceRepository} ${expected.workflow}@${expected.ref}; nothing was pinned`)
}

/** The attestation was built from the commit the installer's own tag peels to. @param {any} statement @param {Expected} expected */
function builtFrom (statement, expected) {
  const commit = commitAt(statement, expected.sourceRepository, expected.ref)
  if (commit !== expected.commit) refuse(`the attestation was built from ${commit ?? `no commit listed for ${expected.sourceRepository} at ${expected.ref}`}, not ${expected.commit}, which ${expected.ref} names; nothing was pinned`)
}

/**
 * Every fact the attestation must state, refused by name when it states another (design section 1, step 5). Each
 * check is its own function, so a refusal names which one failed and nothing else has to be read to know it.
 * @param {any} statement @param {Expected} expected
 */
function attested (statement, expected) {
  if (statement?._type !== IN_TOTO_STATEMENT) refuse('the attestation is no in-toto statement; nothing was pinned')
  if (statement.predicateType !== PROVENANCE) refuse('the attestation is no SLSA provenance statement, so it says nothing about which commit built the installer; nothing was pinned')
  coveredBytes(statement, expected)
  builtBy(statement, expected)
  builtFrom(statement, expected)
}

/** The certificate's own GitHub extensions, refused when they name another repository or another ref. @param {any} signer @param {Expected} expected */
function certified (signer, expected) {
  const oids = signer?.identity?.oids
  const repository = utf8Extension(oids, OID_SOURCE_REPOSITORY)
  const ref = utf8Extension(oids, OID_SOURCE_REF)
  if (repository !== expected.sourceRepository || ref !== expected.ref) refuse(`the certificate names ${repository} at ${ref}, not ${expected.sourceRepository} at ${expected.ref}; nothing was pinned`)
}

/**
 * The installer's own manifest in the tree being released, or a refusal when it names no installer.
 * @param {string} repo
 * @returns {Manifest}
 */
function installerManifestOf (repo) {
  const path = join(repo, INSTALLER_DIRECTORY, 'package.json')
  const manifest = jsonOf(readFileSync(path), path)
  const martha = manifest?.martha ?? {}
  const named = {
    name: manifest?.name,
    version: manifest?.version,
    sourceRepository: martha.sourceRepository,
    workflow: martha.installerPublishWorkflow,
    issuer: martha.issuer
  }
  for (const [field, value] of Object.entries(named)) {
    if (typeof value !== 'string' || value === '') refuse(`${path} names no ${field}, so there is no installer to pin; nothing was pinned`)
  }
  return /** @type {Manifest} */ (named)
}

/** git's answer in `repo`. @param {string} repo @param {...string} args */
const git = (repo, ...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' })

/**
 * The commit the installer version's own tag peels to here, or a refusal naming the tag that is missing.
 * @param {string} repo @param {string} version
 * @returns {string}
 */
function tagCommitOf (repo, version) {
  const tag = `${NAMES.installerTagPrefix}${version}`
  // Peeled: the tag may be annotated, and the attestation names the commit, never the tag object.
  const run = git(repo, 'rev-parse', '--verify', `${installerRef(version)}^{commit}`)
  const commit = run.status === 0 ? run.stdout.trim() : ''
  if (!/^[0-9a-f]{40}$/.test(commit)) refuse(`there is no ${tag} tag here, so nothing says which commit published ${NAMES.npmName} ${version}; nothing was pinned`)
  return commit
}

/**
 * Nothing when this tree's `installer/` is the tagged tree's byte for byte; otherwise a refusal listing the paths.
 * @param {string} repo @param {string} version
 */
function installerDrift (repo, version) {
  const run = git(repo, 'diff', '--name-only', installerRef(version), 'HEAD', '--', INSTALLER_DIRECTORY)
  const paths = run.status === 0 ? run.stdout.trim() : run.stderr.trim()
  if (run.status === 0 && paths === '') return
  refuse(`${INSTALLER_DIRECTORY}/ is not what ${installerRef(version)} published (${paths === '' ? 'git could not say' : paths}); change it only with a version bump and an npm publish, and nothing was pinned`)
}

/**
 * Writes the three fields into the release folder of the packed context, and nothing else; a pin already there is refused.
 * @param {string} context @param {{ name: string, version: string }} manifest @param {string} integrity
 * @returns {{ file: string, pin: { name: string, version: string, integrity: string } }}
 */
function writePin (context, { name, version }, integrity) {
  const folder = join(context, NAMES.releaseFolder)
  const file = join(folder, PIN_FILE)
  if (existsSync(file)) refuse(`${file} already holds a pin: a release's pin is generated here, never packed with the tree; nothing was pinned`)
  mkdirSync(folder, { recursive: true })
  const pin = { name, version, integrity }
  writeFileSync(file, `${JSON.stringify(pin, null, 2)}\n`)
  return { file, pin }
}

/**
 * Pins `repo`'s installer into `context`: the three fields of `installer.json`, or a refusal saying why not.
 * @param {{ context: string, repo?: string, registry?: string, fetch?: typeof globalThis.fetch, makeVerifier?: MakeVerifier, tufCachePath?: string | undefined }} request
 * @returns {Promise<{ file: string, pin: { name: string, version: string, integrity: string } }>}
 */
export async function pinTheInstaller ({ context, repo = REPO, registry = PUBLIC_REGISTRY, fetch = globalThis.fetch, makeVerifier = createVerifier, tufCachePath }) {
  const manifest = installerManifestOf(repo)
  const ref = installerRef(manifest.version)
  const commit = tagCommitOf(repo, manifest.version)
  installerDrift(repo, manifest.version)
  const document = await versionDocument({ ...manifest, registry, fetch })
  const bundle = await provenanceOf(document, fetch)
  const digest = await tarballDigest(document, fetch)
  const identity = `${manifest.sourceRepository}/${manifest.workflow}@${ref}`
  const signer = await verified(bundle, { identity, issuer: manifest.issuer, makeVerifier, ...(tufCachePath ? { tufCachePath } : {}) })
  const expected = { ...manifest, ref, digest, commit }
  certified(signer, expected)
  attested(statementOf(bundle), expected)
  return writePin(context, manifest, document.dist.integrity)
}

if (import.meta.main) {
  const [context] = process.argv.slice(2)
  if (context === undefined || context === '') {
    process.stderr.write('usage: pin_the_installer.mjs <release context>\n')
    process.exitCode = 2
  } else {
    pinTheInstaller({ context }).then(
      ({ file, pin }) => process.stdout.write(`pin_the_installer: ${file} pins ${pin.name}@${pin.version}\n`),
      (error) => {
        process.stderr.write(`pin_the_installer: ${wordsOf(error)}\n`)
        process.exitCode = 1
      }
    )
  }
}
