// `martha week [<YYYY-Www>]` (martha#308): one ISO week of the crew's ledger, read and printed on the owner's terminal.
//
// The figures are ../a_week_of_the_ledger's; this is the reading they are handed — every ledger stream under the crew's
// own rows directory and the ask queue beside them — and the lines the owner reads. A stream that is no package's
// ledger is named as skipped, never guessed at. Nothing is written, and the week nobody names is the one the clock
// says: that is the only clock read here.

import { readdirSync } from 'node:fs'

import { aWeekOfTheLedger, theBoundsOfTheWeek, theLinesOf, theWeekOf } from '../a_week_of_the_ledger/a_week_of_the_ledger.ts'
import { crewRowsDirectory } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import {
  LEDGER_STREAM_PREFIX,
  readLedger,
  thePackageOfLedgerStream,
  type LedgerHost,
  type LedgerRow,
} from '../log_ledger/log_ledger.ts'
import { OWNER_ASKS_STREAM } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { rowStreamsDirectory, streamOfDirectoryName } from '../row_streams_directory/row_streams_directory.ts'
import { EXIT_DONE, refused, type LinesShownToTheOwner } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import type { StoredRow } from '../host_contract/host_contract.ts'

/** A terminal the week prints on: the owner's own lines, and the last line it reads. */
export type AWeekOnATerminal = LinesShownToTheOwner & { readonly out: (line: string) => void }

/** The place the week is read in: the checkout the command runs in and its own crew's state root. */
export interface APlaceOfTheWeek {
  readonly root: string
  readonly state: { readonly state_root: string }
}

/** What the command parsed for the act: the week's own word, when one was named. */
export interface AWeekAsked {
  readonly args: readonly string[]
}

/** One package's ledger as the week reads it: the package's name and every row it kept. */
interface AReadLedger {
  readonly package: string
  readonly rows: readonly LedgerRow[]
}

/** The streams a crew's rows directory keeps, by the name each is a stream of. */
function streamsUnder(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((name) => {
    const stream = streamOfDirectoryName(name)
    return stream === undefined ? [] : [stream]
  })
}

/** Every package's ledger under a crew's rows directory, and the streams that are no package's ledger, named. */
async function theLedgersUnder(
  directory: string,
  host: LedgerHost,
): Promise<{ readonly ledgers: readonly AReadLedger[]; readonly skipped: readonly string[] }> {
  const ledgers: AReadLedger[] = []
  const skipped: string[] = []
  for (const stream of streamsUnder(directory)) {
    if (!stream.startsWith(LEDGER_STREAM_PREFIX)) continue
    const package_name = thePackageOfLedgerStream(stream)
    if (package_name === undefined) {
      skipped.push(`${stream} (not a package name)`)
      continue
    }
    try {
      ledgers.push({ package: package_name, rows: await readLedger(host, package_name) })
    } catch (error) {
      skipped.push(`${stream} (could not be read: ${error instanceof Error ? error.message : String(error)})`)
    }
  }
  return { ledgers, skipped }
}

/** `week [YYYY-Www]`: no week, or one named, and no switch. */
export function weekOf(act: string, argv: readonly string[]): { readonly act: string; readonly args: readonly string[] } | undefined {
  const [, named] = argv
  if (argv.length === 1) return { act, args: [] }
  return argv.length === 2 && named !== undefined && named !== '' && !named.startsWith('-') ? { act, args: [named] } : undefined
}

/** `martha week [YYYY-Www]`: the lines the owner reads, or the refusal that ends the command. */
export async function showTheWeek(io: AWeekOnATerminal, places: APlaceOfTheWeek, asked: AWeekAsked): Promise<number> {
  const week = asked.args[0] ?? theWeekOf(Date.now())
  // The word is judged before any stream is read (r=2): a week that is not one is not answered from an empty directory.
  const bounds = theBoundsOfTheWeek(week)
  if ('refused' in bounds) return refused(io, bounds.refused)
  const rows = crewRowsDirectory(places.state.state_root, places.root)
  if ('refusal' in rows) return refused(io, rows.refusal)
  const host: LedgerHost = { clock: { now: () => Date.now() }, stores: { rows: rowStreamsDirectory(rows.path) } }
  const { ledgers, skipped: theStreamsSkipped } = await theLedgersUnder(rows.path, host)
  const skipped = [...theStreamsSkipped]
  // A store that refuses the ask stream leaves the week without its owner-wait line, and the stream is named (r=2).
  let asks: readonly StoredRow[] | undefined
  try {
    asks = await host.stores.rows.read(OWNER_ASKS_STREAM)
  } catch (error) {
    skipped.push(`${OWNER_ASKS_STREAM} (could not be read: ${error instanceof Error ? error.message : String(error)})`)
  }
  const answer = aWeekOfTheLedger({ week, ledgers, asks, skipped })
  if ('refused' in answer) return refused(io, answer.refused)
  for (const line of theLinesOf(answer.week)) io.out(line)
  return EXIT_DONE
}
