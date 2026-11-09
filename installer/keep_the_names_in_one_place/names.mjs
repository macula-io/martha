// The public names, read from ONE place: the "martha" field of this package's package.json (martha#21). The npm
// name, the image, the repository a release must come from, the workflow that signs it, the command and both tag
// prefixes are written there and nowhere else; names.node-test.mjs fails when a workflow, the root package.json or
// the README drifts from them. The installer this one replaces was renamed twice in one evening; this is why.
import { createRequire } from 'node:module'

const manifest = createRequire(import.meta.url)('../package.json')

/**
 * @typedef {object} Names
 * @property {string} npmName           the installer's npm name, what a user types
 * @property {string} installerVersion  this installer's own version
 * @property {string} nodeRange         the Node versions it runs on, as engines.node says
 * @property {string} image             the release's OCI repository, no tag
 * @property {string} sourceRepository  the repository every release is built from
 * @property {string} signerWorkflow    the workflow that signs a release, without the commit it is pinned at
 * @property {string} issuer            the OIDC issuer of the signing certificate
 * @property {string} command           the command an installed release puts on PATH
 * @property {string} releaseFolder     the one top-level folder a release's layer holds
 * @property {string} releaseTagPrefix  what a release tag starts with
 * @property {string} installerTagPrefix what an installer tag starts with
 * @property {string} installerPublishWorkflow the workflow whose run publishes this installer, and signs that publish
 * @property {string} dryRunTagPrefix  what a dry run's image tag starts with: never a version, never a release tag
 */

/** @type {Readonly<Names>} */
export const NAMES = Object.freeze({
  npmName: manifest.name,
  installerVersion: manifest.version,
  nodeRange: manifest.engines.node,
  ...manifest.martha
})

/** @param {string} version */
export const releaseRef = (version) => `refs/tags/${NAMES.releaseTagPrefix}${version}`

/**
 * The git ref an installer version's publish ran at: what its provenance must name (martha#84).
 * @param {string} version
 */
export const installerRef = (version) => `refs/tags/${NAMES.installerTagPrefix}${version}`

/**
 * Who a Fulcio certificate must have been issued to, as the whole identity: the repository, the workflow and the
 * ref, exactly. Anchored and escaped, because sigstore-js tests a SAN policy as a JavaScript regular expression
 * (@sigstore/verify policy.js).
 * @param {string} identity
 */
export const anchoredIdentity = (identity) => `^${identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
