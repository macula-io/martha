// The order a tool answers in (martha#256, martha#443 part 5 r=2): a call's own arguments are read first, and this
// launch is asked for the place it would act in — and for the crew's declaration — only after them.
//
// The base (acb0895) answered every call below in its arguments' own words. The split's wrappers answered four of them
// as a place that cannot act, and three as a declaration that could not be read: a probe over every tool in a place
// with no processes and no declaration found fourteen calls that answered otherwise. This file holds the fourteen.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { theRangeACallNames, VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { NOTHING_STANDS, STANDING } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import {
  aDryRunIsAsked,
  A_DRY_RUN,
  FAST_FORWARD_AFTER_THE_OWNERS_YES,
  LAND_BATCH,
  theBatchACallNames,
  theFastForwardACallNames,
} from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { LIST_ASKS, QUEUE_ASK } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { WAIT_FOR_CI } from '../wait_for_ci/wait_for_ci.ts'
import { crewToolsOver, NO_ACTING_PLACE, type CoreToolAnswer, type CrewTools } from './a_crews_tools.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-the-arguments-first-'))
after(() => removeTheTree(home))
for (const made of ['row', 'crew-files', 'root', 'clone']) mkdirSync(join(home, made))
mkdirSync(join(home, CREW_ROWS_PLACE), { mode: STREAM_DIRECTORY_MODE })

const MEMBER = 'Pallas'
const SESSION = 'session-the-arguments-first'

/** A place that holds no processes and no declaration: every tool here is a launch that could not act or read the crew. */
const aPlaceThatCanDoNeither = (): CrewTools =>
  crewToolsOver({
    member: MEMBER,
    ledger: { clock: { now: () => 1_000 }, stores: { rows: rowStreamsDirectory(join(home, CREW_ROWS_PLACE)) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root: join(home, 'root'),
    documents: { read: (path: string) => readFile(path, 'utf8') },
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, 'crew-files')) },
  })

/** The refusal a slice's own argument reader gives a call, which is what the tool must answer with. */
const refusedFor = (asked: { readonly ok: unknown } | { readonly refused: string }): string =>
  'refused' in asked ? asked.refused : assert.fail('the slice read this call as naming something')

test('a tool reads its call\'s arguments before it asks for the place, or reads the crew\'s declaration', async () => {
  const tools = aPlaceThatCanDoNeither()
  const answerTo = (name: string, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> => tools.answer(name, args, SESSION)

  // The four that act on the host: each answers the argument it is missing, never the place (martha#256).
  for (const [name, asked] of [
    [VERIFY_RANGE, theRangeACallNames({})],
    [LAND_BATCH, theBatchACallNames({})],
    [FAST_FORWARD_AFTER_THE_OWNERS_YES, theFastForwardACallNames({})],
  ] as const) {
    assert.deepEqual(await answerTo(name, {}), { refused: refusedFor(asked) }, `${name} answers its arguments, not the place it holds none of`)
    assert.notEqual(refusedFor(asked), NO_ACTING_PLACE, `${name}'s own argument refusal is never the place's`)
  }

  // A wait's own reader is private to its slice, so its words are read here by the opening every call it refuses gets.
  const waited = await answerTo(WAIT_FOR_CI, {})
  assert.ok('refused' in waited && waited.refused.startsWith('a CI wait names its repository'), `wait_for_ci answers its arguments, not the place: ${JSON.stringify(waited)}`)

  // A landing reads its dry-run switch with its arguments, before the place too (martha#339).
  const aCall = { path: join(home, 'clone'), packages: ['macula-io/martha#443'], [A_DRY_RUN]: 2 }
  assert.deepEqual(await answerTo(LAND_BATCH, aCall), { refused: refusedFor(aDryRunIsAsked(aCall)) }, 'land_batch answers its dry-run switch, not the place')

  // The three that need no processes: the ask the call did not put is refused in its own words, before the declaration
  // that would say who may (an ask is queued in the caller's own name); and the two that only read answer at all.
  const queued = await answerTo(QUEUE_ASK, {})
  assert.ok('refused' in queued && queued.refused.startsWith('ask is missing:'), `ask_the_owner reads its question first: ${JSON.stringify(queued)}`)
  assert.deepEqual(await answerTo(LIST_ASKS, {}), { answer: 'No asks are waiting for the owner.' }, 'list_the_owners_asks reads the queue with no declaration')
  assert.deepEqual(await answerTo(STANDING, {}), { answer: NOTHING_STANDS }, 'standing reads the items with no declaration')
})
