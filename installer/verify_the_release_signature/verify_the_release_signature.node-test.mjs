// Who must have signed a release, and what (martha#21, T1 to T3, T9, T10). sigstore's own bundle check is stood in
// for; the identity policy, the extensions and the subject are this module's, checked here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { TUFError } from 'sigstore'

import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { CouldNotCheck } from '../refuse_in_words/refuse_in_words.mjs'
import { PRE_GUARD_SIGNER, SIGNER, release, sigstoreStandIn } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { identityPattern, readSigners, signedBy } from './verify_the_release_signature.mjs'

const r = release({ version: '1.2.0' })
const tagRef = 'refs/tags/v1.2.0'

/** @param {Partial<{ ref: string, repository: string, signerSha: string }>} signed */
const signedAs = (signed) => sigstoreStandIn(new Map([[r.digest, { ref: tagRef, ...signed }]]))

test('a release signed by a listed signer, for this repository and its own tag, is signed by that signer', async () => {
  assert.deepEqual(await signedBy({ bundles: [r.bundle], digest: r.digest, version: '1.2.0', signers: [SIGNER], makeVerifier: signedAs({}) }), { sha: SIGNER })
})

test('refused: a signer not on the list', async () => {
  const verdict = await signedBy({ bundles: [r.bundle], digest: r.digest, version: '1.2.0', signers: ['0'.repeat(40)], makeVerifier: signedAs({}) })
  assert.ok('reasons' in verdict && verdict.reasons.some((why) => /certificate identity error/.test(why)), JSON.stringify(verdict))
})

test('refused: a signature by an attest-image.yml sha from before its guard', async () => {
  const verdict = await signedBy({ bundles: [r.bundle], digest: r.digest, version: '1.2.0', signers: [SIGNER], makeVerifier: signedAs({ signerSha: PRE_GUARD_SIGNER }) })
  assert.ok('reasons' in verdict && verdict.reasons.some((why) => new RegExp(`got ${NAMES.signerWorkflow}@${PRE_GUARD_SIGNER}`).test(why)), JSON.stringify(verdict))
})

test('the shipped signer list holds full shas only, and none from before the guard', () => {
  const listed = readSigners(readFileSync(new URL('../signers.txt', import.meta.url), 'utf8'))
  assert.ok(listed.length > 0)
  for (const early of ['b304162', '601c719', '56a597e', 'e8fe1a8']) assert.ok(!listed.some((sha) => sha.startsWith(early)), early)
})

test('the identity is matched whole: a sha that only starts with a listed one, or a fork path, does not match', () => {
  const pattern = new RegExp(identityPattern(SIGNER))
  assert.ok(pattern.test(`${NAMES.signerWorkflow}@${SIGNER}`))
  assert.ok(!pattern.test(`${NAMES.signerWorkflow}@${SIGNER}0`))
  assert.ok(!pattern.test(`${NAMES.signerWorkflow.replace('macula-io', 'someone-else')}@${SIGNER}`))
})

test('refused: a release signed in another repository, even one of ours', async () => {
  const verdict = await signedBy({ bundles: [r.bundle], digest: r.digest, version: '1.2.0', signers: [SIGNER], makeVerifier: signedAs({ repository: 'https://github.com/macula-io/macula' }) })
  assert.deepEqual(verdict, { reasons: [`signed for repository https://github.com/macula-io/macula, not ${NAMES.sourceRepository}`] })
})

test('refused: a release signed for another ref (an older release served as a newer one)', async () => {
  const verdict = await signedBy({ bundles: [r.bundle], digest: r.digest, version: '1.3.0', signers: [SIGNER], makeVerifier: signedAs({ ref: tagRef }) })
  assert.deepEqual(verdict, { reasons: [`signed for ${tagRef}, not refs/tags/v1.3.0`] })
})

test('refused: a bundle over another digest', async () => {
  const other = release({ version: '9.9.9' })
  const verdict = await signedBy({ bundles: [other.bundle], digest: r.digest, version: '1.2.0', signers: [SIGNER], makeVerifier: signedAs({}) })
  assert.deepEqual(verdict, { reasons: [`no cosign signature over ${r.digest}`] })
})

test('a trust root that does not arrive is "could not check", never "unsigned"', async () => {
  const noRoot = async () => { throw new TUFError({ code: 'TUF_REFRESH_METADATA_ERROR', message: 'error refreshing TUF metadata' }) }
  await assert.rejects(signedBy({ bundles: [r.bundle], digest: r.digest, version: '1.2.0', signers: [SIGNER], makeVerifier: noRoot }), (error) => {
    assert.ok(error instanceof CouldNotCheck, `expected CouldNotCheck, got ${error}`)
    assert.match(/** @type {Error} */ (error).message, /^could not check: the Sigstore trust root did not arrive \(error refreshing TUF metadata\)/)
    return true
  })
})

test('a verifier that breaks for any other reason is "could not check" too', async () => {
  const broken = async () => ({ verify: () => { throw new TypeError('cannot read properties of undefined') } })
  await assert.rejects(signedBy({ bundles: [r.bundle], digest: r.digest, version: '1.2.0', signers: [SIGNER], makeVerifier: broken }), CouldNotCheck)
})
