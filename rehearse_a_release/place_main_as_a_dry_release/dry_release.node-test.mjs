// The dry release harness under the Supervisor's four conditions (martha#639, the dry step): it calls only the
// installer's own exported steps, it is proof code no command reaches, its result is never the clean-install proof's
// release result, and every layer entry is still checked by the installer's unpackLayer.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { goodEntries, scratchMachine, tarOf } from '../../installer/serve_a_release_locally/serve_a_release_locally.mjs'
import { DRY, dryResultLine, INSTALLER_STEPS, MAINS_OWN_INSTALLER, placeADryRelease, SKIPPED_STEPS, THE_INSTALLERS_STEPS, THE_PUBLISHED_INSTALLER, theInstallerThatRan } from './dry_release.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const INSTALLER = join(REPO, 'installer')
const SHA = 'a'.repeat(40)
const VERSION = '9.8.7'
/** Main's own installer, by the digest the packer wrote for it: what a dry run of a drifted main proves (martha#695). */
const MAINS = { origin: MAINS_OWN_INSTALLER, digest: `sha256:${'b'.repeat(64)}` }
/** The published installer, by its name and version: what a dry run whose installer/ is its tag's proves. */
const PUBLISHED = { origin: THE_PUBLISHED_INSTALLER, published: 'the-installer@1.2.3' }
/** The argument that says which installer ran, as the dry step hands it to the harness. @param {{ origin: string, digest?: string, published?: string }} proven */
const saidOf = (proven) => (proven === MAINS ? ['--main-installer', MAINS.digest] : ['--published-installer', PUBLISHED.published])
const PROOF = join(REPO, 'prove_a_clean_install_in_a_throwaway_container', 'prove_a_clean_install_in_a_throwaway_container.sh')

/** A layer the installer accepts, gzipped, as pack_main_as_a_dry_layer.sh writes one. */
const aGoodLayer = () => gzipSync(tarOf(goodEntries()))

/**
 * A machine of the test's own, removed when the test ends (read-only release folders included).
 * @param {import('node:test').TestContext} t
 */
const aMachine = (t) => {
  const machine = scratchMachine()
  t.after(() => machine.close())
  return machine
}

// --- what a dry release does ----------------------------------------------------------------------------------------

test('main\'s layer is placed by the installer\'s own steps: its own directory, current swapped, the command linked', async (t) => {
  const { home, places } = aMachine(t)
  const placed = await placeADryRelease({ steps: THE_INSTALLERS_STEPS, layer: aGoodLayer(), version: VERSION, sha: SHA, home, proven: MAINS })
  assert.equal(dirname(placed.release), places.releases)
  assert.ok(placed.release.endsWith(`/${VERSION}-sha256-${placed.release.split('-sha256-')[1]}`), placed.release)
  assert.equal(readlinkSync(places.current), placed.release)
  assert.ok(existsSync(join(places.binDir, 'martha')), 'the command is linked')
  assert.ok(placed.lines.every((line) => line.startsWith(`${DRY} `)), placed.lines.join('\n'))
  assert.equal(placed.lines.at(-1), dryResultLine(SHA, MAINS))
})

test('a Node Martha does not run on is refused by the installer\'s own step 1, before anything is placed', async (t) => {
  const { home, places } = aMachine(t)
  await assert.rejects(
    placeADryRelease({ steps: THE_INSTALLERS_STEPS, layer: aGoodLayer(), version: VERSION, sha: SHA, home, nodeVersion: '18.0.0', proven: MAINS }),
    /^Refused: Martha needs Node .*; this is Node 18\.0\.0\./,
  )
  assert.equal(existsSync(places.current), false, 'current was not swapped')
})

// --- condition 4: every layer entry is still checked by unpackLayer ----------------------------------------------------

test('a layer with an entry the installer refuses is refused in the installer\'s own words, and nothing is placed', async (t) => {
  const { home, places } = aMachine(t)
  const steps = THE_INSTALLERS_STEPS
  // The words are unpackLayer's own, so a harness that skipped it and failed later for another reason fails here.
  for (const [name, words] of /** @type {Array<[string, RegExp]>} */ ([
    ['martha/../escaped', /names a path through '\.\.' \(martha\/\.\.\/escaped\); refused$/],
    ['/etc/absolute', /names an absolute path \(\/etc\/absolute\); refused$/],
  ])) {
    const layer = gzipSync(tarOf([{ name: 'martha/', type: '5', mode: 0o755 }, { name, body: 'x' }]))
    await assert.rejects(placeADryRelease({ steps, layer, version: VERSION, sha: SHA, home, proven: MAINS }), words, name)
    /** @type {string[]} */
    let underReleases = []
    try { underReleases = readdirSync(places.releases).filter((name) => !name.startsWith('.')) } catch { /* never made */ }
    assert.deepEqual(underReleases, [], 'no release was placed')
    assert.equal(existsSync(places.current), false, 'current was not swapped')
    assert.equal(existsSync(join(places.binDir, 'martha')), false, 'no command was linked')
  }
})

// --- condition 3: a dry pass is never the clean-install proof's release result -------------------------------------------

/**
 * The words the clean-install proof logs when a release's run passes, read from the proof itself, never typed here.
 * The last line is either the words as a literal, or opens with the variable that holds them (then the members'
 * names follow, which differ run to run); the variable's value is read from its one definition in the proof.
 */
const theReleaseResult = () => {
  const proof = readFileSync(PROOF, 'utf8')
  const found = /log ('[^']+'|"[^"]+")\s*\n\s*exit 0\s*\n\}/.exec(proof)
  assert.ok(found, 'the clean-install proof\'s release result line was read')
  const said = found[1] ?? ''
  if (said.startsWith('\'')) return said.slice(1, -1)
  const name = /^"\$\{([A-Z_]+)\}/.exec(said)?.[1]
  assert.ok(name, `the release result line ${said} opens with the variable that holds its words`)
  const definitions = [...proof.matchAll(new RegExp(`^${name}='([^']+)'$`, 'gm'))]
  assert.equal(definitions.length, 1, `${name} is defined once in the proof`)
  return definitions[0]?.[1] ?? ''
}

test('the dry result line names every step it skipped and is never the release result', () => {
  const line = dryResultLine(SHA, MAINS)
  assert.ok(line.startsWith(`${DRY} main at ${SHA}, not a release,`), line)
  for (const step of SKIPPED_STEPS) assert.ok(line.includes(step), `${step} is named`)
  assert.equal(line.includes(theReleaseResult()), false)
})

test('the result line names which installer ran: main\'s own by its digest, the published one by its name and version', () => {
  const main = dryResultLine(SHA, MAINS)
  assert.ok(main.includes(`main's own installer (${MAINS.digest})`), main)
  assert.equal(main.includes(PUBLISHED.published), false, 'a run that proves the installer main holds does not name the published one')
  const published = dryResultLine(SHA, PUBLISHED)
  assert.ok(published.includes(`the published ${PUBLISHED.published}`), published)
  assert.equal(published.includes(MAINS.digest), false, 'a run that proves the published installer does not name a digest')
})

test('a run that cannot say which installer it proved is refused, never given a line that leaves it out', () => {
  assert.throws(() => theInstallerThatRan({ origin: MAINS_OWN_INSTALLER }), /digest/)
  assert.throws(() => theInstallerThatRan({ origin: THE_PUBLISHED_INSTALLER }), /name and version/)
  assert.throws(() => theInstallerThatRan({ origin: 'something else' }), /not an installer/)
})

test('the dry command prints only dry lines, the result last, and never the release result', (t) => {
  const { home } = aMachine(t)
  const layer = join(home, 'layer.tar.gz')
  writeFileSync(layer, aGoodLayer())
  const run = spawnSync(process.execPath, [join(HERE, 'main.mjs'), layer, VERSION, SHA, ...saidOf(MAINS)], {
    env: { PATH: process.env.PATH ?? '', HOME: home },
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  const lines = run.stdout.trim().split('\n')
  assert.ok(lines.every((line) => line.startsWith(`${DRY} `)), run.stdout)
  assert.equal(lines.at(-1), dryResultLine(SHA, MAINS))
  assert.equal(run.stdout.includes(theReleaseResult()), false)
})

test('the dry command refuses a sha that is not 40 characters, and a step\'s refusal is exit 1, never a pass', (t) => {
  const { home } = aMachine(t)
  const layer = join(home, 'bad.tar.gz')
  writeFileSync(layer, gzipSync(tarOf([{ name: 'martha/', type: '5', mode: 0o755 }, { name: 'martha/../x', body: 'x' }])))
  const env = { PATH: process.env.PATH ?? '', HOME: home }
  assert.equal(spawnSync(process.execPath, [join(HERE, 'main.mjs'), layer, VERSION, 'abc', ...saidOf(MAINS)], { env }).status, 2)
  assert.equal(spawnSync(process.execPath, [join(HERE, 'main.mjs'), layer, VERSION, SHA], { env }).status, 2, 'a run naming no installer is refused')
  const refused = spawnSync(process.execPath, [join(HERE, 'main.mjs'), layer, VERSION, SHA, ...saidOf(MAINS)], { env, encoding: 'utf8' })
  assert.equal(refused.status, 1)
  assert.equal(refused.stdout, '')
  assert.match(refused.stderr, /^dry: not placed: /)
})

// --- condition 1: only the installer's own exported steps --------------------------------------------------------------

test('every installer file the harness calls is a step the installer package publishes', () => {
  const published = JSON.parse(readFileSync(join(INSTALLER, 'package.json'), 'utf8')).files
  for (const file of Object.values(INSTALLER_STEPS)) assert.ok(published.includes(file), `${file} is in the installer's "files"`)
})

test('the harness imports nothing that unpacks, places or verifies on its own: node built-ins, itself, and the listed installer steps', () => {
  const steps = Object.values(INSTALLER_STEPS).map((file) => `../../installer/${file}`)
  for (const file of ['dry_release.mjs', 'main.mjs']) {
    const specifiers = [...readFileSync(join(HERE, file), 'utf8').matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1] ?? '')
    const own = specifiers.filter((s) => !s.startsWith('node:') && s !== './dry_release.mjs' && !steps.includes(s))
    assert.deepEqual(own, [], `${file} imports ${own.join(', ')}`)
    assert.equal(specifiers.includes('node:zlib'), false, `${file} unpacks nothing itself`)
  }
  const imported = [...readFileSync(join(HERE, 'dry_release.mjs'), 'utf8').matchAll(/^import .* from '(\.\.\/\.\.\/installer\/[^']+)'/gm)].map((m) => m[1])
  assert.deepEqual([...imported].sort(), [...steps].sort(), 'the harness imports exactly the listed installer steps')
})

// --- condition 2: proof code only, which no command reaches --------------------------------------------------------

test('the harness ships in no release layer and nothing the martha command or the installer runs refers to it', () => {
  assert.match(readFileSync(join(REPO, '.gitattributes'), 'utf8'), /^rehearse_a_release\/ export-ignore$/m)
  const name = relative(join(REPO, 'rehearse_a_release'), HERE)
  // git grep answers 1 when nothing matches, 0 with the files that do, and anything else when it could not look.
  const search = spawnSync('git', ['grep', '-l', '-F', name, '--', 'src', 'bin', 'installer', 'package.json'], { cwd: REPO, encoding: 'utf8' })
  assert.equal(search.status, 1, `referred to by: ${search.stdout}${search.stderr}`)
})
