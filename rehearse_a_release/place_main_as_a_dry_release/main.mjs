#!/usr/bin/env node
// Place main's layer as a dry release, inside the live run's container (martha#639, the dry step):
//
//   node main.mjs <layer .tar.gz> <version> <main's sha>
//
// The installer steps are the ones ./dry_release.mjs imports from ../../installer: in the run's container that is a
// link to the published installer package, installed with npm and never run. The layer is the one
// pack_main_as_a_dry_layer.sh packed from main. Every line it prints starts `dry:`, the result line last. Exit 0
// placed, 1 a step refused (its own words), 2 it could not run. See ./dry_release.mjs for what runs and what does not.

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'

import { DRY, placeADryRelease, THE_INSTALLERS_STEPS } from './dry_release.mjs'

const [layerFile, version, sha] = process.argv.slice(2)
if (!layerFile || !version || sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) {
  console.error(`${DRY} usage: main.mjs <layer .tar.gz> <version> <main's 40-character sha>`)
  process.exit(2)
}

try {
  const placed = await placeADryRelease({
    steps: THE_INSTALLERS_STEPS,
    layer: await readFile(layerFile),
    version,
    sha,
    home: homedir(),
    xdgDataHome: process.env.XDG_DATA_HOME
  })
  for (const line of placed.lines) console.log(line)
} catch (error) {
  console.error(`${DRY} not placed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
