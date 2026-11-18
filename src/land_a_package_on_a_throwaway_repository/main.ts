// The nightly live run's guards for its throwaway repository, as the run's bash calls them (martha#639):
//
//   node src/land_a_package_on_a_throwaway_repository/main.ts reach <owner id>       < every page of GET /user/repos, as one JSON list
//   node src/land_a_package_on_a_throwaway_repository/main.ts delete <made.json>      < GET /repositories/<id>'s answer
//   node src/land_a_package_on_a_throwaway_repository/main.ts clean-start <start.json> < every path under the home, one per line
//   node src/land_a_package_on_a_throwaway_repository/main.ts redact <token file>     < a text bound for the kept record
//
// Exit 0 the guard holds, 1 it refuses, naming why on standard error, 2 it could not look. `redact` writes the text,
// redacted, to standard output either way, and exits 1 when a token had reached it. The token is never an argument:
// `redact` reads it from the 0600 file the run keeps it in, so no process list or shell history shows it.
//
// Nothing here calls GitHub or the container. The run makes those calls and hands the answers in, so each guard is the
// same code the self-test runs.

import { readFileSync } from 'node:fs'

import { whatTheStartWouldLoad, type TheStart } from './a_clean_start.ts'
import { whyNotDelete, type WhatTheRunMade } from './the_delete_guard.ts'
import { redactTheToken, THE_TOKEN_REACHED_THE_RECORD } from './the_kept_record.ts'
import { whyTheCallsReachTooFar } from './the_tokens_reach.ts'

const NAME = 'land_a_package_on_a_throwaway_repository'

/** One guard's verdict: the exit code, and what it says on standard error and standard output. */
interface Said {
  readonly code: number
  readonly err?: string
  readonly out?: string
}

const holds: Said = { code: 0 }
const refuses = (why: string): Said => ({ code: 1, err: why })
const couldNotLook = (why: string): Said => ({ code: 2, err: `could not look: ${why}` })

const readJson = (text: string): unknown => JSON.parse(text) as unknown

const reach = (argument: string, input: string): Said => {
  const owner = Number(argument)
  if (!Number.isSafeInteger(owner) || owner <= 0) return couldNotLook(`'${argument}' is not an owner's numeric id`)
  const why = whyTheCallsReachTooFar(readJson(input) as readonly unknown[], owner)
  return why === undefined ? holds : refuses(why)
}

const deleteGuard = (argument: string, input: string): Said => {
  const made = readJson(readFileSync(argument, 'utf8')) as WhatTheRunMade
  const why = whyNotDelete(made, readJson(input))
  return why === undefined ? { code: 0, out: made.full_name } : refuses(why)
}

const cleanStart = (argument: string, input: string): Said => {
  const start = readJson(readFileSync(argument, 'utf8')) as TheStart
  const hits = whatTheStartWouldLoad(start, input.split('\n').filter((line) => line !== ''))
  return hits.length === 0 ? holds : refuses(hits.join('\n'))
}

const redact = (argument: string, input: string): Said => {
  const kept = redactTheToken(input, readFileSync(argument, 'utf8').trim())
  return kept.reached ? { code: 1, err: THE_TOKEN_REACHED_THE_RECORD, out: kept.text } : { code: 0, out: kept.text }
}

const GUARDS: Readonly<Record<string, (argument: string, input: string) => Said>> = { reach, delete: deleteGuard, 'clean-start': cleanStart, redact }

/** What the guard named by `args` says of `input`. Anything it cannot read is exit 2, never a pass. */
export function runTheGuard(args: readonly string[], input: string): Said {
  const [name, argument] = args
  const guard = name === undefined ? undefined : GUARDS[name]
  if (guard === undefined || argument === undefined || args.length !== 2) return couldNotLook(`usage: main.ts <${Object.keys(GUARDS).join('|')}> <argument>`)
  try {
    return guard(argument, input)
  } catch (error) {
    return couldNotLook(error instanceof Error ? error.message : String(error))
  }
}

if (import.meta.main) {
  const said = runTheGuard(process.argv.slice(2), readFileSync(0, 'utf8'))
  if (said.out !== undefined) process.stdout.write(said.out)
  if (said.err !== undefined) process.stderr.write(`${NAME}: ${said.err}\n`)
  process.exitCode = said.code
}
