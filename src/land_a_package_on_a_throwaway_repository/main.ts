// The nightly live run's guards for its throwaway repository, as the run's bash calls them (martha#639):
//
//   node src/land_a_package_on_a_throwaway_repository/main.ts expiry <now, ISO 8601>  < the expiry header's value, empty when GitHub sent none
//   node src/land_a_package_on_a_throwaway_repository/main.ts who <owner id>         < GET /user's answer
//   node src/land_a_package_on_a_throwaway_repository/main.ts reach <owner id>       < every page of GET /user/repos, as one JSON list
//   node src/land_a_package_on_a_throwaway_repository/main.ts delete <made.json>      < GET /repositories/<id>'s answer
//   node src/land_a_package_on_a_throwaway_repository/main.ts clean-start <start.json> < every path under the home, one per line
//   node src/land_a_package_on_a_throwaway_repository/main.ts redact <token file>     < a transcript bound for the kept record
//   node src/land_a_package_on_a_throwaway_repository/main.ts screen <placed|not-placed> < a member's screen bound for the kept record
//   node src/land_a_package_on_a_throwaway_repository/main.ts claims <night.json>     < nothing (the night file names both transcripts)
//
// `claims` reads the night's package, range, builder and reviewer, and the two members' transcript paths, from the
// night file (package, range, builder, reviewer, builder_transcript, reviewer_transcript), and exits 1 naming the first
// of section 6's four crew rows the transcripts do not show.
//
//   node src/land_a_package_on_a_throwaway_repository/main.ts landing <night.json>    < nothing
//
// `landing` reads the same four night fields, the builder's transcript and the crew's rows folder (builder_transcript,
// rows), and exits 1 naming the first of section 6's landing rows (5 to 7) they do not show.
//
// Exit 0 the guard holds, 1 it refuses, naming why on standard error, 2 it could not look. `redact` writes the text,
// redacted, to standard output either way, and exits 1 when a token had reached it. `expiry` exits 0 with a note on
// standard output for a token with no expiry, a warning when it is near its expiry, and 1 when it has expired. The token is never an argument:
// `redact` reads it from the 0600 file the run keeps it in, so no process list or shell history shows it.
//
// Nothing here calls GitHub or the container. The run makes those calls and hands the answers in, so each guard is the
// same code the self-test runs.

import { readFileSync } from 'node:fs'

import { whatTheStartWouldLoad, type TheStart } from './a_clean_start.ts'
import { whatTheRunMadeIn, whyNotDelete } from './the_delete_guard.ts'
import { keepAScreen, redactTheToken, THE_TOKEN_REACHED_THE_RECORD, TOKEN_NOT_PLACED, TOKEN_PLACED } from './the_kept_record.ts'
import { whichCrewClaimFails, type TheNight } from './the_nights_claims.ts'
import { whichLandingClaimFails } from './the_nights_landing.ts'
import { ledgerStreamOf, type LedgerRow } from '../log_ledger/log_ledger.ts'
import { OWNER_ASKS_STREAM } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { theTokensExpiry } from './the_tokens_expiry.ts'
import { whyTheCallsAreNotTheBots, whyTheCallsReachTooFar } from './the_tokens_reach.ts'

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

/** The owner's numeric id an argument names, or undefined when it names none. */
const ownerIdIn = (argument: string): number | undefined => {
  const owner = Number(argument)
  return Number.isSafeInteger(owner) && owner > 0 ? owner : undefined
}

const notAnId = (argument: string): Said => couldNotLook(`'${argument}' is not an owner's numeric id`)

const verdictOf = (why: string | undefined): Said => (why === undefined ? holds : refuses(why))

const who = (argument: string, input: string): Said => {
  const owner = ownerIdIn(argument)
  return owner === undefined ? notAnId(argument) : verdictOf(whyTheCallsAreNotTheBots(readJson(input), owner))
}

const reach = (argument: string, input: string): Said => {
  const owner = ownerIdIn(argument)
  return owner === undefined ? notAnId(argument) : verdictOf(whyTheCallsReachTooFar(readJson(input) as readonly unknown[], owner))
}

const deleteGuard = (argument: string, input: string): Said => {
  const made = whatTheRunMadeIn(readJson(readFileSync(argument, 'utf8')))
  if (typeof made === 'string') return couldNotLook(made)
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

const expiry = (argument: string, input: string): Said => {
  const now = new Date(argument)
  if (Number.isNaN(now.getTime())) return couldNotLook(`'${argument}' is not a time`)
  const said = theTokensExpiry(input, now)
  if (said.refuses) return refuses(said.why ?? 'the token cannot be used')
  if (said.warning !== undefined) return { code: 0, out: `warning: ${said.warning}\n` }
  return said.note === undefined ? holds : { code: 0, out: `note: ${said.note}\n` }
}

/** A member's screen for the kept record: none once the token is placed, as it was before (r=2 item 2). */
const screen = (argument: string, input: string): Said => {
  if (argument !== TOKEN_PLACED && argument !== TOKEN_NOT_PLACED) return couldNotLook(`'${argument}' is neither ${TOKEN_PLACED} nor ${TOKEN_NOT_PLACED}`)
  return { code: 0, out: keepAScreen(input, argument === TOKEN_PLACED).text }
}

/** The fields every night file carries, each a non-empty string. */
const NIGHT_FIELDS = ['package', 'range', 'builder', 'reviewer'] as const

/** A night file read: the night, and each further field the verb named, or the could-not-look that says why not. */
function theNightFile(argument: string, more: readonly string[]): { readonly night: TheNight; readonly field: (name: string) => string } | Said {
  const read = readJson(readFileSync(argument, 'utf8'))
  if (typeof read !== 'object' || read === null) return couldNotLook(`${argument} is not a night's JSON object`)
  const value = (name: string): unknown => (read as Record<string, unknown>)[name]
  const missing = [...NIGHT_FIELDS, ...more].filter((name) => typeof value(name) !== 'string' || value(name) === '')
  if (missing.length > 0) return couldNotLook(`${argument} names no ${missing.join(', ')}`)
  const field = (name: string): string => value(name) as string
  return { night: { package: field('package'), range: field('range'), builder: field('builder'), reviewer: field('reviewer') }, field }
}

/** Section 6's four crew rows, read from the two transcripts the night file names. Nothing on standard input is read. */
const claims = (argument: string): Said => {
  const file = theNightFile(argument, ['builder_transcript', 'reviewer_transcript'])
  if ('code' in file) return file
  return verdictOf(whichCrewClaimFails(file.night, readFileSync(file.field('builder_transcript'), 'utf8'), readFileSync(file.field('reviewer_transcript'), 'utf8')))
}

/**
 * Section 6's landing rows (5 to 7), read from the builder's transcript and the crew's rows folder the night file names,
 * through the rows store's own reader. Nothing on standard input is read.
 */
export async function landing(argument: string): Promise<Said> {
  try {
    const file = theNightFile(argument, ['builder_transcript', 'rows'])
    if ('code' in file) return file
    const rows = rowStreamsDirectory(file.field('rows'))
    const asks = await rows.read(OWNER_ASKS_STREAM)
    const ledger = (await rows.read(ledgerStreamOf(file.night.package))).map(({ row }) => row as unknown as LedgerRow)
    return verdictOf(whichLandingClaimFails(file.night, { builderTranscript: readFileSync(file.field('builder_transcript'), 'utf8'), asks, ledger }))
  } catch (error) {
    return couldNotLook(error instanceof Error ? error.message : String(error))
  }
}

const GUARDS: Readonly<Record<string, (argument: string, input: string) => Said>> = { expiry, who, reach, delete: deleteGuard, 'clean-start': cleanStart, redact, screen, claims }
/** The one guard that reads a store, and so answers later. */
const LANDING = 'landing'

/** What the guard named by `args` says of `input`. Anything it cannot read is exit 2, never a pass. */
export function runTheGuard(args: readonly string[], input: string): Said {
  const [name, argument] = args
  const guard = name === undefined ? undefined : GUARDS[name]
  if (guard === undefined || argument === undefined || args.length !== 2) return couldNotLook(`usage: main.ts <${[...Object.keys(GUARDS), LANDING].join('|')}> <argument>`)
  try {
    return guard(argument, input)
  } catch (error) {
    return couldNotLook(error instanceof Error ? error.message : String(error))
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const said = args[0] === LANDING && args.length === 2 && args[1] !== undefined ? await landing(args[1]) : runTheGuard(args, readFileSync(0, 'utf8'))
  if (said.out !== undefined) process.stdout.write(said.out)
  if (said.err !== undefined) process.stderr.write(`${NAME}: ${said.err}\n`)
  process.exitCode = said.code
}
