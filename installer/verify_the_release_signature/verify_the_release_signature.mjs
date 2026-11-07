// The release signature, checked exactly (martha#21). A Martha release is signed keyless by macula-ci-images'
// attest-image.yml, the release identity every image of ours carries, whose guard refuses to sign a tag that is not
// on main or whose version is not the one the tree publishes. cosign stores that signature as a sigstore bundle: a
// DSSE in-toto statement (predicateType cosign/sign/v1) whose subject is the image digest, with a Fulcio
// certificate and a Rekor entry. sigstore-js checks the bundle against the Sigstore trust root it gets through TUF;
// this module says WHO must have signed it, and WHAT:
//   SAN        <signer workflow>@<a sha in signers.txt>, exactly
//   issuer     https://token.actions.githubusercontent.com
//   .1.12      the source repository the release ran in
//   .1.14      refs/tags/v<version>: an older release served under a newer tag is refused
//   subject    exactly the one image digest being installed
// Never a pattern over the signer: one accepts the shas from before the guard and fork-only commits of that public
// repository, which sign a side-branch tag with no guard at all.
//
// A verify that could not run (the trust root did not arrive) is a CouldNotCheck, never "unsigned" and never fine.
import { PolicyError, ValidationError, VerificationError, createVerifier } from 'sigstore'

import { NAMES, releaseRef } from '../keep_the_names_in_one_place/names.mjs'
import { couldNotCheck } from '../refuse_in_words/refuse_in_words.mjs'

const OID_SOURCE_REPOSITORY = '1.3.6.1.4.1.57264.1.12'
const OID_SOURCE_REF = '1.3.6.1.4.1.57264.1.14'
const COSIGN_SIGN = 'https://sigstore.dev/cosign/sign/v1'
const IN_TOTO_STATEMENT = 'https://in-toto.io/Statement/v1'
const IN_TOTO_PAYLOAD = 'application/vnd.in-toto+json'

/**
 * The listed signer shas: one full 40-hex sha per line, comments and blanks passed over.
 * @param {string} text
 */
export const readSigners = (text) => text.split('\n').map((l) => l.trim()).filter((l) => /^[0-9a-f]{40}$/.test(l))

/**
 * sigstore-js tests a SAN policy as a JavaScript regular expression against the certificate's SAN
 * (@sigstore/verify policy.js), so the exact identity is passed anchored, with every metacharacter escaped.
 * @param {string} sha
 */
export const identityPattern = (sha) => `^${`${NAMES.signerWorkflow}@${sha}`.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`

/**
 * A DER length at offset 1: [length, where the content starts], or [] when it is not one.
 * @param {Uint8Array} der
 * @returns {[number, number] | []}
 */
function derLength (der) {
  const first = der[1]
  if (der.length < 2 || first === undefined) return []
  if (first < 0x80) return [first, 2]
  const count = first & 0x7f
  if (count < 1 || count > 2 || der.length < 2 + count) return []
  return [der.subarray(2, 2 + count).reduce((n, b) => n * 256 + b, 0), 2 + count]
}

/**
 * A Fulcio extension's value as text. @sigstore/verify hands each extension's raw content, which for these OIDs is
 * a DER UTF8String (tag 0x0c, then its length): compared as given it would never equal plain text.
 * @param {any[] | undefined} oids
 * @param {string} oid
 */
export function utf8Extension (oids, oid) {
  const id = oid.split('.').map(Number)
  const found = (oids ?? []).find((o) => o?.oid?.id?.length === id.length && o.oid.id.every((/** @type {number} */ n, /** @type {number} */ i) => n === id[i]))
  const der = found?.value
  if (!(der instanceof Uint8Array)) return undefined
  if (der[0] !== 0x0c) return undefined
  const [length, start] = derLength(der)
  if (length === undefined || start === undefined || start + length !== der.length) return undefined
  return Buffer.from(der.subarray(start, start + length)).toString('utf8')
}

/** @param {any} envelope */
function statementOf (envelope) {
  if (envelope?.payloadType !== IN_TOTO_PAYLOAD || typeof envelope.payload !== 'string') return undefined
  try { return JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')) } catch { return undefined }
}

/**
 * Whether a bundle is cosign's signature over exactly `digest` (the statement's one subject).
 * @param {any} bundle
 * @param {string} digest
 */
export function signsDigest (bundle, digest) {
  const statement = statementOf(bundle?.dsseEnvelope)
  if (statement?._type !== IN_TOTO_STATEMENT || statement.predicateType !== COSIGN_SIGN) return false
  const subjects = statement.subject
  return Array.isArray(subjects) && subjects.length === 1 && `sha256:${subjects[0]?.digest?.sha256}` === digest
}

/**
 * Whether sigstore said no to the bundle (a verdict), as against failing to make the check at all.
 * @param {unknown} error
 */
const isVerdict = (error) => error instanceof VerificationError || error instanceof PolicyError || error instanceof ValidationError

/**
 * @typedef {(options: object) => Promise<{ verify: (bundle: any) => any }>} MakeVerifier
 *   sigstore's createVerifier; a test passes its own.
 */

/** @param {unknown} error */
const wordsOf = (error) => error instanceof Error ? error.message : String(error)

/**
 * sigstore's verifier for signer `sha`; a trust root that did not arrive is no check at all (CouldNotCheck).
 * @param {string} sha
 * @param {MakeVerifier} makeVerifier
 * @param {string | undefined} tufCachePath
 */
async function verifierFor (sha, makeVerifier, tufCachePath) {
  try {
    return await makeVerifier({
      certificateIssuer: NAMES.issuer,
      certificateIdentityURI: identityPattern(sha),
      tlogThreshold: 1,
      ctLogThreshold: 1,
      ...(tufCachePath ? { tufCachePath } : {})
    })
  } catch (error) {
    return couldNotCheck(`the Sigstore trust root did not arrive (${wordsOf(error)}); nothing was installed`)
  }
}

/**
 * The signer the bundle verifies as, or sigstore's refusal in its words. A check that failed to run is no
 * verdict (CouldNotCheck).
 * @param {{ verify: (bundle: any) => any }} verifier
 * @param {any} bundle
 * @returns {{ signer: any } | { refused: string }}
 */
function verdictOf (verifier, bundle) {
  try {
    return { signer: verifier.verify(bundle) }
  } catch (error) {
    if (!isVerdict(error)) couldNotCheck(`the signature check failed to run (${wordsOf(error)}); nothing was installed`)
    return { refused: wordsOf(error) }
  }
}

/**
 * Why the bundle does not verify under signer `sha` for `ref`, or '' when it does.
 * @param {{ bundle: any, sha: string, ref: string, source: string, makeVerifier: MakeVerifier, tufCachePath?: string | undefined }} request
 */
async function failure ({ bundle, sha, ref, source, makeVerifier, tufCachePath }) {
  const verifier = await verifierFor(sha, makeVerifier, tufCachePath)
  const verified = verdictOf(verifier, bundle)
  if ('refused' in verified) return verified.refused
  const oids = verified.signer?.identity?.oids
  const repository = utf8Extension(oids, OID_SOURCE_REPOSITORY)
  const signedRef = utf8Extension(oids, OID_SOURCE_REF)
  if (repository !== source) return `signed for repository ${repository}, not ${source}`
  if (signedRef !== ref) return `signed for ${signedRef}, not ${ref}`
  return ''
}

/**
 * { sha } of the listed signer whose identity one of `bundles` verifies under, for `version` of `digest`; or
 * { reasons } saying why each try failed. A trust root that could not be fetched throws CouldNotCheck instead.
 * `ref` is refs/tags/v<version>; only the release dry run, from a test file, names its branch's ref.
 * @param {{ bundles: any[], digest: string, version: string, signers: string[], source?: string, ref?: string, makeVerifier?: MakeVerifier, tufCachePath?: string | undefined }} request
 * @returns {Promise<{ sha: string } | { reasons: string[] }>}
 */
export async function signedBy ({ bundles, digest, version, signers, source = NAMES.sourceRepository, ref = releaseRef(version), makeVerifier = createVerifier, tufCachePath }) {
  const reasons = new Set()
  const signing = bundles.filter((b) => signsDigest(b, digest))
  if (signing.length === 0) reasons.add(`no cosign signature over ${digest}`)
  if (signers.length === 0) reasons.add('this installer lists no signer')
  // Every bundle under every listed signer, bundle by bundle.
  for (const { bundle, sha } of signing.flatMap((b) => signers.map((s) => ({ bundle: b, sha: s })))) {
    const failed = await failure({ bundle, sha, ref, source, makeVerifier, tufCachePath })
    if (!failed) return { sha }
    reasons.add(failed)
  }
  return { reasons: [...reasons] }
}
