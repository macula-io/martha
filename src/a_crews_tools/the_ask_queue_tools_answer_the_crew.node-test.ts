// The four ask-queue tools over a real crew store (martha#313, the queue half): a member queues, the session the
// table names takes one batch, and a settle stands on a menu its host closed.
//
// The decisions are the slice's (../queue_the_owners_asks); this file pins the wiring, so a tool that read the wrong
// asker, the wrong declaration or no menu at all fails here by name.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OFFER_OWNER_ASKS, OWNER } from '../declare_crew/declare_crew.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { LIST_ASKS, QUEUE_ASK, SETTLE_ASKS, TAKE_ASKS, menusTheLauncherKeeps } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { MENU_TOOL } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { crewToolsOver, type CrewTools } from './a_crews_tools.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-ask-queue-tools-'))
after(() => removeTheTree(home))
mkdirSync(join(home, 'row'))
// The row store writes into directories the launcher makes; it makes none itself.
mkdirSync(join(home, CREW_ROWS_PLACE), { mode: STREAM_DIRECTORY_MODE })
mkdirSync(join(home, 'rows-without-menus'), { mode: STREAM_DIRECTORY_MODE })

// A made-up project root: this repository is public, so no real path appears here.
const root = '/crew-project'
const LEAD = 'Lead'
const BUILDER = 'Builder1'
const team = {
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [
    { name: LEAD, role: SUPERVISOR },
    { name: BUILDER, role: 'builder' },
  ],
  mode: {
    name: 'team',
    roles: [SUPERVISOR, 'builder'],
    may: { ...Object.fromEntries(ACTS.map((act) => [act, [SUPERVISOR]])), [OFFER_OWNER_ASKS]: [SUPERVISOR], approve_landing: [OWNER] },
  },
  channel_read_seconds: 30,
}
const declaration = JSON.stringify(team)
const documents = {
  read: async (path: string): Promise<string> => {
    if (path === join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)) return declaration
    throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
  },
}

const clock = { at: 1_000 }
/** Each member's tools over one shared crew store, with the menus a launcher keeps over the same clock. */
function theToolsOf(member: string): CrewTools {
  return crewToolsOver({
    member,
    ledger: { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(home, CREW_ROWS_PLACE)) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew: crewFilesDirectory(join(home, 'the-crew-store')) },
    menus: menusTheLauncherKeeps({ now: () => clock.at }),
  })
}

const TOLD = (said: { readonly answer: string } | { readonly refused: string }): string => ('answer' in said ? said.answer : assert.fail(`refused: ${said.refused}`))
const REFUSED = (said: { readonly answer: string } | { readonly refused: string }): string => ('refused' in said ? said.refused : assert.fail(`answered: ${said.answer}`))

test('a member queues an ask the launcher stamps with its own member, never with a name the call carries', async () => {
  clock.at = 1_000
  const told = TOLD(await theToolsOf(BUILDER).answer(QUEUE_ASK, { ask: 'Delete the merged branch vesta/313-old?', asked_by: 'a name in the call' }, 'session-builder'))
  assert.equal(told, 'Queued for the owner; 1 ask waiting. Do not open a menu for it; carry on.')
  const listed = TOLD(await theToolsOf(LEAD).answer(LIST_ASKS, {}, 'session-lead'))
  assert.match(listed, /- 0 \(from Builder1\): Delete the merged branch vesta\/313-old\?$/, 'the asker is the member the launcher started')
})

test('the session the table does not name is refused, and the one it names takes one batch and settles it after a menu closes', async () => {
  const lead = theToolsOf(LEAD)
  assert.match(REFUSED(await theToolsOf(BUILDER).answer(TAKE_ASKS, {}, 'session-builder')), /Builder1 may not take or settle the owner's asks/)

  clock.at = 2_000
  const taken = TOLD(await lead.answer(TAKE_ASKS, {}, 'session-lead'))
  const batch = Number(/settle batch (\d+)/.exec(taken)?.[1])
  assert.match(taken, /1 queued ask, oldest first\./, `one batch of the waiting ask: ${taken}`)

  assert.match(REFUSED(await lead.answer(SETTLE_ASKS, { batch, yes: [0] }, 'session-lead')), /no menu has closed/)

  clock.at = 3_000
  lead.noteTheCallsAnswer({ tool: MENU_TOOL }, 'session-lead')
  assert.equal(TOLD(await lead.answer(SETTLE_ASKS, { batch, yes: [0] }, 'session-lead')), `Batch ${String(batch)} settled: 1 the owner ticked, 0 back in the queue.`)
  assert.equal(TOLD(await lead.answer(LIST_ASKS, {}, 'session-lead')), 'No asks are waiting for the owner.')
})

test('a place handed no menu record keeps its own over the crew clock, so a menu its host closed still settles', async () => {
  const place = crewToolsOver({
    member: LEAD,
    ledger: { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(home, 'rows-without-menus')) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew: crewFilesDirectory(join(home, 'the-crew-store')) },
  })
  clock.at = 4_000
  TOLD(await place.answer(QUEUE_ASK, { ask: 'Remove the stale worktree?' }, 'session-lead'))
  const batch = Number(/settle batch (\d+)/.exec(TOLD(await place.answer(TAKE_ASKS, {}, 'session-lead')))?.[1])
  clock.at = 5_000
  place.noteTheCallsAnswer({ tool: MENU_TOOL }, 'session-lead')
  assert.match(TOLD(await place.answer(SETTLE_ASKS, { batch, yes: [0] }, 'session-lead')), /^Batch \d+ settled: 1 the owner ticked, 0 back in the queue\.$/)
})
