#!/usr/bin/env node
// martha-install: install Martha from its signed public package, with nothing but Node (martha#21).
//
//   npx -y --ignore-scripts @macula-io/martha@<exact version> [<martha version>] [--downgrade] [--digest sha256:<hex>]
//
// The line that names this installer's exact version is the trust anchor: npm never lets anyone replace a
// published version. Everything after it is checked here; see install_a_release/install_a_release.mjs for the steps.
import { homedir } from 'node:os'

import { installRelease, placesOnThisMachine } from '../install_a_release/install_a_release.mjs'
import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { Refused } from '../refuse_in_words/refuse_in_words.mjs'

const USAGE = `usage: ${NAMES.command}-install [<version>] [--downgrade] [--digest sha256:<hex>]`

/**
 * @param {string[]} argv
 * @returns {{ version?: string, digest?: string, downgrade: boolean, help: boolean }}
 */
export function parseArguments (argv) {
  /** @type {{ version?: string, digest?: string, downgrade: boolean, help: boolean }} */
  const options = { downgrade: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--downgrade') options.downgrade = true
    else if (arg === '--digest') options.digest = argv[++i] ?? ''
    else if (arg === '-h' || arg === '--help') options.help = true
    else if (arg.startsWith('-')) throw new Refused(`unknown option '${arg}' (${USAGE})`)
    else if (options.version !== undefined) throw new Refused('one version at a time')
    else options.version = arg
  }
  return options
}

async function main () {
  const { help, ...options } = parseArguments(process.argv.slice(2))
  if (help) { console.log(USAGE); return }
  await installRelease({ ...options, places: placesOnThisMachine(homedir(), process.env['XDG_DATA_HOME']) })
}

main().catch((error) => {
  // A refusal is the installer saying no, in words; anything else is a fault, and says so.
  console.error(error instanceof Refused ? `${NAMES.command}-install: ${error.message}` : `${NAMES.command}-install: failed: ${error?.stack ?? error}`)
  process.exitCode = 1
})
