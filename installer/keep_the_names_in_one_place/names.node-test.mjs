// The public names drift from their one place nowhere (martha#21, design section 4, last row). Every name is read
// from the installer's package.json ("martha" field) and the workflows, the root package.json and the READMEs are
// held to it: the tag globs and guard inputs each job passes, the signer sha every signing job calls, the version
// files the guard reads, the installer's repository.url, and the install line a reader copies.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { readSigners } from '../verify_the_release_signature/verify_the_release_signature.mjs'
import { NAMES } from './names.mjs'

const INSTALLER = dirname(dirname(fileURLToPath(import.meta.url)))
const ROOT = dirname(INSTALLER)
const INSTALLER_DIR = relative(ROOT, INSTALLER)
/** @param {string} path */
const read = (path) => readFileSync(`${ROOT}/${path}`, 'utf8')
const rootManifest = JSON.parse(read('package.json'))
const installerManifest = JSON.parse(read(`${INSTALLER_DIR}/package.json`))
const signers = readSigners(read(`${INSTALLER_DIR}/signers.txt`))
const workflow = {
  release: read('.github/workflows/release.yml'),
  installer: read('.github/workflows/installer.yml'),
  dryRun: read('.github/workflows/release-dry-run.yml')
}

/**
 * The `with:` inputs of the job step that calls `workflowFile`, as key -> value (quotes dropped).
 * @param {string} text
 * @param {string} workflowFile
 */
export function callInputs (text, workflowFile) {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => new RegExp(`^\\s*uses: \\S+/${workflowFile.replace('.', '\\.')}@`).test(l))
  assert.ok(at >= 0, `no call to ${workflowFile}`)
  const indent = (/** @type {string} */ l) => (l.match(/^\s*/)?.[0] ?? '').length
  const withAt = lines.findIndex((l, i) => i > at && /^\s*with:\s*$/.test(l))
  assert.ok(withAt > at && indent(lines[withAt] ?? '') === indent(lines[at] ?? ''), `the call to ${workflowFile} has no with:`)
  /** @type {Record<string, string>} */
  const inputs = {}
  for (const line of lines.slice(withAt + 1)) {
    if (line.trim() === '') continue
    if (indent(line) <= indent(lines[withAt] ?? '')) break
    const m = line.match(/^\s*([\w-]+):\s*(.*?)\s*$/)
    if (m?.[1]) inputs[m[1]] = (m[2] ?? '').replace(/^['"]|['"]$/g, '')
  }
  return inputs
}

/** @param {string} text */
const tagGlobs = (text) => {
  const m = text.match(/^\s*tags:\s*\[([^\]]*)\]/m)
  return (m?.[1] ?? '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

/** @param {string} glob @param {string} tag */
const globMatches = (glob, tag) => new RegExp(`^${glob.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(tag)

/** @param {string} text */
const calledShas = (text, file = 'attest-image.yml') => [...text.matchAll(new RegExp(`${file.replace('.', '\\.')}@([0-9a-f]{40})`, 'g'))].map((m) => m[1])

test('the root package.json is the release: private, its version the release version, no runtime dependency', () => {
  assert.equal(rootManifest.private, true, 'the root is never published to npm')
  assert.notEqual(rootManifest.name, NAMES.npmName, 'the npm name belongs to the installer alone')
  assert.deepEqual(Object.keys(rootManifest.dependencies ?? {}), [], 'a release runs on Node alone')
  assert.match(rootManifest.version, /^\d+\.\d+\.\d+$/)
})

test('the installer package.json is published, from this repository, with the command-install bin', () => {
  assert.equal(installerManifest.private, undefined, 'the installer is published')
  assert.deepEqual(installerManifest.repository, { type: 'git', url: `git+${NAMES.sourceRepository}.git`, directory: INSTALLER_DIR })
  assert.deepEqual(Object.keys(installerManifest.bin), [`${NAMES.command}-install`], 'the bin never shadows the installed command')
  assert.equal(installerManifest.engines.node, rootManifest.engines.node, 'the installer checks the Node the release runs on')
})

test('each release job passes its own tag prefix, its version root and versions: check to the guard and the signer', () => {
  const expected = { release: { 'tag-prefix': NAMES.releaseTagPrefix, 'version-root': '.' }, installer: { 'tag-prefix': NAMES.installerTagPrefix, 'version-root': INSTALLER_DIR } }
  for (const [job, want] of Object.entries(expected)) {
    const guard = callInputs(workflow[/** @type {'release' | 'installer'} */ (job)], 'release-guard.yml')
    assert.deepEqual({ 'tag-prefix': guard['tag-prefix'], 'version-root': guard['version-root'], versions: guard['versions'] }, { ...want, versions: 'check' }, `${job}.yml guard`)
  }
  const attest = callInputs(workflow.release, 'attest-image.yml')
  assert.deepEqual({ 'tag-prefix': attest['tag-prefix'], 'version-root': attest['version-root'], versions: attest['versions'] }, { ...expected.release, versions: 'check' }, 'release.yml attest')
})

test('each workflow triggers on its own tags only, and neither glob matches the other\'s tag', () => {
  const releaseTag = `${NAMES.releaseTagPrefix}1.0.0`
  const installerTag = `${NAMES.installerTagPrefix}1.0.0`
  assert.deepEqual(tagGlobs(workflow.release), [`${NAMES.releaseTagPrefix}*`])
  assert.deepEqual(tagGlobs(workflow.installer), [`${NAMES.installerTagPrefix}*`])
  assert.ok(globMatches(`${NAMES.releaseTagPrefix}*`, releaseTag) && !globMatches(`${NAMES.releaseTagPrefix}*`, installerTag))
  assert.ok(globMatches(`${NAMES.installerTagPrefix}*`, installerTag) && !globMatches(`${NAMES.installerTagPrefix}*`, releaseTag))
  assert.deepEqual(tagGlobs(workflow.dryRun), [], 'the dry run is started by hand, never by a tag')
})

test('every signing call is to a sha the installer lists', () => {
  for (const [name, text] of Object.entries(workflow)) {
    const shas = calledShas(text)
    if (name === 'installer') { assert.deepEqual(shas, []); continue }
    assert.ok(shas.length > 0, `${name} signs`)
    for (const sha of shas) assert.ok(signers.includes(sha ?? ''), `${name} signs with attest-image.yml@${sha}, which signers.txt does not list`)
  }
})

/** @param {string} text */
const holdsWrite = (text) => /^\s*(packages|id-token):\s*write\b/m.test(text)
/** @param {string} text */
const unpinned = (text) => [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1] ?? '').filter((ref) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(ref))

test('every action in a workflow that can publish or sign is pinned by a full commit sha', () => {
  // A job holding packages:write or id-token:write runs its actions with that power: a moved tag would too. The
  // workflows are found by what they hold, so a new release workflow is held to this without being named here.
  const found = readdirSync(`${ROOT}/.github/workflows`).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`)
  const writers = found.filter((f) => holdsWrite(read(f)))
  for (const known of ['release.yml', 'installer.yml', 'release-dry-run.yml']) assert.ok(writers.includes(`.github/workflows/${known}`), `${known} is found by what it holds`)
  for (const file of writers) assert.deepEqual(unpinned(read(file)), [], `${file} runs actions not pinned by sha`)
  const planted = 'permissions:\n  id-token: write\nsteps:\n  - uses: actions/checkout@v7\n'
  assert.ok(holdsWrite(planted) && unpinned(planted).length === 1, 'the scan bites on a planted workflow')
})

/**
 * The echo lines of the dry run's names step that reach $GITHUB_OUTPUT: one grouped block, or lines that each
 * redirect there.
 * @param {string} text
 */
function dryRunOutputs (text) {
  const grouped = text.match(/\{\n((?:\s*echo [^\n]*\n)+)\s*\} >> "\$GITHUB_OUTPUT"/)
  const lines = grouped?.[1]?.split('\n') ?? [...text.matchAll(/^(\s*echo [^\n]*) >> "\$GITHUB_OUTPUT"$/gm)].map((m) => m[1] ?? '')
  return lines.map((l) => l.trim()).filter(Boolean)
}

const OCI_FLAGS = ['--provenance=false', '--sbom=false', 'type=oci,', 'tar=false', 'oci-mediatypes=true']
const PUSH = 'skopeo copy --preserve-digests'

/**
 * Why a workflow could put anything but one checked OCI image manifest on the registry, or [] when none. Each
 * `docker buildx build` (continuation lines joined) writes a local OCI layout with no buildx attestations and OCI
 * media types; the layout's manifest is checked before anything is pushed (Raf, 2026-11-06: "a check should run
 * locally before any push"); the same layout is pushed unchanged, and the pushed digest compared with the checked.
 * @param {string} text
 */
function ociFlaws (text) {
  const builds = [...text.replace(/\\\n\s*/g, ' ').matchAll(/docker buildx build [^\n]*/g)].map((m) => m[0])
  const flaws = builds.length ? [] : ['no build']
  for (const build of builds) for (const flag of OCI_FLAGS) if (!build.includes(flag)) flaws.push(`a build without ${flag}`)
  if (/push=true|docker push/.test(text)) flaws.push('a push that is not the checked layout')
  const checked = text.indexOf('application/vnd.oci.image.manifest.v1+json')
  const pushed = text.indexOf(PUSH)
  if (checked < 0 || pushed < 0 || pushed < checked) flaws.push('a push before the media-type check')
  if (!text.includes(`${PUSH} --digestfile`) || !/\[ "\$\(cat "[^"]+"\)" = "\$checked" \]/.test(text)) flaws.push('no proof the pushed digest is the checked one')
  return flaws
}

test('nothing reaches the registry until its manifest is checked locally, and what is pushed is what was checked', () => {
  for (const name of /** @type {const} */ (['release', 'dryRun'])) assert.deepEqual(ociFlaws(workflow[name]), [], name)
  // Each pin bites: dropped from a copy of release.yml, each is named.
  for (const flag of OCI_FLAGS) assert.ok(ociFlaws(workflow.release.replace(flag, '')).includes(`a build without ${flag}`), `the ${flag} pin bites`)
  const pushFirst = workflow.release.replace(PUSH, 'true').replace('docker buildx build', `${PUSH} x y; docker buildx build`)
  assert.ok(ociFlaws(pushFirst).includes('a push before the media-type check'), 'the order pin bites')
  assert.ok(ociFlaws(workflow.release.replace('--digestfile', '--quiet')).includes('no proof the pushed digest is the checked one'), 'the digest pin bites')
  assert.ok(ociFlaws(workflow.release.replace('type=oci,', 'type=image,push=true,')).includes('a push that is not the checked layout'), 'a direct push is named')
})

test('every image is built by a docker-container builder and checked to be one OCI manifest before it is signed', () => {
  // The default docker driver ignores oci-mediatypes and pushes a Docker v2 manifest, which every install refuses
  // (the first dry run, martha#21 r=4). Only a builder set up by setup-buildx-action honours it.
  for (const name of /** @type {const} */ (['release', 'dryRun'])) {
    const text = workflow[name]
    const setup = text.indexOf('uses: docker/setup-buildx-action@')
    const build = text.indexOf('docker buildx build')
    assert.ok(setup >= 0 && setup < build, `${name} sets up a buildx builder before it builds`)
    assert.ok(!/^\s*driver:\s*docker\s*$/m.test(text), `${name} keeps the docker-container driver`)
    assert.ok(text.includes('application/vnd.oci.image.manifest.v1+json'), `${name} checks each pushed digest is one OCI manifest`)
  }
})

test('no workflow spells the image out; each reads it from the installer package.json', () => {
  for (const [name, text] of Object.entries(workflow)) assert.ok(!text.includes(NAMES.image), `${name} names ${NAMES.image} as a literal`)
})

test('the dry run pushes into the release package itself, under a tag that is never a version', () => {
  // The package must exist, linked and public, before the first release tag; the dry run is what makes it
  // (design section 5). Its tags start with the dry-run prefix, which no version and no release tag starts with.
  assert.ok(dryRunOutputs(workflow.dryRun).includes('echo "image=$(jq -r .martha.image installer/package.json)"'), 'the dry run hands the release image, no suffix, to $GITHUB_OUTPUT')
  assert.ok(!dryRunOutputs(workflow.dryRun.replace('} >> "$GITHUB_OUTPUT"', '} >> /dev/null')).includes('echo "image=$(jq -r .martha.image installer/package.json)"'), 'the output check bites on a redirect elsewhere')
  assert.match(workflow.dryRun, /jq -r \.martha\.dryRunTagPrefix installer\/package\.json/, 'the dry run reads its tag prefix from the installer package.json')
  assert.match(NAMES.dryRunTagPrefix, /^[a-z][a-z-]*-$/, 'the prefix starts with a letter, so no tag it makes is a version')
  assert.ok(!NAMES.dryRunTagPrefix.startsWith(NAMES.releaseTagPrefix) && !NAMES.dryRunTagPrefix.startsWith(NAMES.installerTagPrefix))
  assert.ok(read(`${INSTALLER_DIR}/README.md`).includes(`\`${NAMES.dryRunTagPrefix}<run>-<attempt>\``), 'the README names the dry-run tag as the installer package.json does')
})

test('every install line names an exact installer version', () => {
  for (const readme of ['README.md', `${INSTALLER_DIR}/README.md`]) {
    const lines = read(readme).split('\n').filter((l) => /\bnpx\b/.test(l) && l.includes(NAMES.npmName))
    assert.ok(readme === 'README.md' || lines.length > 0, `${readme} shows the install line`)
    for (const line of lines) {
      assert.match(line, new RegExp(`${NAMES.npmName.replace(/[/.@-]/g, '\\$&')}@(\\d+\\.\\d+\\.\\d+|<exact version>)(\\s|$|\`)`), `${readme}: '${line.trim()}' names no exact version`)
      assert.match(line, /--ignore-scripts/, `${readme}: '${line.trim()}' runs install scripts`)
    }
  }
})

test('the guard-input reader bites: a planted prefix is read as planted', () => {
  const planted = workflow.release.replace(/tag-prefix: v\n/, 'tag-prefix: x\n')
  assert.equal(callInputs(planted, 'release-guard.yml')['tag-prefix'], 'x')
  assert.equal(basename(INSTALLER), INSTALLER_DIR)
})
