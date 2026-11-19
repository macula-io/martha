#!/usr/bin/env node
// Place main's layer as a dry release, inside the live run's container (martha#639, the dry step):
//
//   node main.mjs <layer .tar.gz> <version> <main's sha> --main-installer <sha256:…>
//   node main.mjs <layer .tar.gz> <version> <main's sha> --published-installer <name@version>
//
// The installer steps are the ones ./dry_release.mjs imports from ../../installer: in the run's container that is the
// installer package the dry step installed beside this harness -- main's own, packed from main and installed by its
// digest, or the published one (martha#695, option A). Which of the two it is comes in as an argument and is named on
// the result line, so a reader never has to guess which installer a dry pass proved; a run that names neither is
// refused here rather than reported.
//
// The layer is the one pack_main_as_a_dry_layer.sh packed from main. Every line it prints starts `dry:`, the result
// line last. Exit 0 placed, 1 a step refused (its own words), 2 it could not run. See ./dry_release.mjs for what runs
// and what does not.

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'

import { DRY, MAINS_OWN_INSTALLER, placeADryRelease, THE_INSTALLERS_STEPS, THE_PUBLISHED_INSTALLER } from './dry_release.mjs'

const [layerFile, version, sha, ...rest] = process.argv.slice(2)
const USAGE = `${DRY} usage: main.mjs <layer .tar.gz> <version> <main's 40-character sha> (--main-installer <sha256:…> | --published-installer <name@version>)`

/**
 * Which installer the dry step installed beside this harness, in the words the result line needs.
 * @param {string[]} words
 */
const provenFrom = (words) => {
  if (words.length === 2 && words[0] === '--main-installer') return { origin: MAINS_OWN_INSTALLER, digest: words[1] }
  if (words.length === 2 && words[0] === '--published-installer') return { origin: THE_PUBLISHED_INSTALLER, published: words[1] }
  return undefined
}

const proven = provenFrom(rest)
if (!layerFile || !version || sha === undefined || !/^[0-9a-f]{40}$/.test(sha) || proven === undefined) {
  console.error(USAGE)
  process.exit(2)
}

try {
  const placed = await placeADryRelease({
    steps: THE_INSTALLERS_STEPS,
    layer: await readFile(layerFile),
    version,
    sha,
    proven,
    home: homedir(),
    xdgDataHome: process.env.XDG_DATA_HOME
  })
  for (const line of placed.lines) console.log(line)
} catch (error) {
  console.error(`${DRY} not placed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
