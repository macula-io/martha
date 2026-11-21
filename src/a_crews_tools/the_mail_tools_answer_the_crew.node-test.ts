// Crew mail's two tools in the crew's table (martha#1016): registered under their own names, each answered with an order
// the relay carries when the launch hands a mail place, its step answered as the mod's ask and never as a model's tool,
// and a launch with no mail place told so in words.

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OWNER } from '../declare_crew/declare_crew.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { AT_REST } from '../exchange_crew_mail/exchange_crew_mail.ts'
import { READ_CREW_MAIL, SEND_CREW_MAIL, THE_MAIL_STEP_ASK, type AMailCarrier } from '../exchange_crew_mail/the_mail_tools.ts'
import { CREW_TOOL_NAMES, crewToolsOver, type CoreToolAnswer, type CrewTools } from './a_crews_tools.ts'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-mail-tools-'))
after(() => removeTheTree(homeOfAll))

const PALLAS = randomBytes(32).toString('hex')
/** The mail service as the declaration names it: not crew-code's spelling, so nothing leans on a default. */
const SERVICE = 'planted-mail'

const A_TEAM = {
  version: DECLARATION_VERSION,
  owner: 'an owner',
  members: [
    { name: 'Supervisor', role: 'lead' },
    { name: 'Pallas', role: 'builder' },
  ],
  mode: { name: 'team', roles: ['lead', 'builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER, 'lead']])) },
  mesh: { mail: { service: SERVICE } },
  channel_read_seconds: 30,
}

let placesSoFar = 0
/** The tools `member` calls in a fresh checkout declaring A_TEAM, with the mail place a launch would hand, or none. */
function toolsOf(mail: AMailCarrier | undefined): CrewTools {
  placesSoFar += 1
  const home = join(homeOfAll, `place-${placesSoFar}`)
  const root = join(home, 'checkout')
  const rows = join(home, CREW_ROWS_PLACE)
  mkdirSync(root, { recursive: true })
  mkdirSync(rows, { mode: STREAM_DIRECTORY_MODE })
  const declared = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  return crewToolsOver({
    member: 'Supervisor',
    ledger: { clock: { now: () => Date.UTC(2026, 10, 21) }, stores: { rows: rowStreamsDirectory(rows) } },
    beats: dashboardRowsIn(join(home, 'beats')),
    root,
    documents: {
      read: async (path) => {
        if (path === declared) return JSON.stringify(A_TEAM)
        throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
      },
    },
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, 'crew-store')) },
    ...(mail === undefined ? {} : { mail }),
  })
}

const answerOf = (said: CoreToolAnswer): string => {
  assert.ok('answer' in said, 'refused' in said ? said.refused : '')
  return said.answer
}

test('#1016 mail: both tools are the crew\'s, and the step they come back on is the mod\'s ask, never a model\'s tool', () => {
  assert.ok((CREW_TOOL_NAMES as readonly string[]).includes(SEND_CREW_MAIL))
  assert.ok((CREW_TOOL_NAMES as readonly string[]).includes(READ_CREW_MAIL))
  assert.equal((CREW_TOOL_NAMES as readonly string[]).includes(THE_MAIL_STEP_ASK), false)
})

test('#1016 mail: a send answers the order the relay carries, and its step answers the crew\'s words', async () => {
  const tools = toolsOf({ roster: () => ({ Pallas: PALLAS }) })
  const order = JSON.parse(answerOf(await tools.answer(SEND_CREW_MAIL, { to: 'Pallas', subject: 's', body: 'b' }, 'a-session'))) as { mesh_order: Record<string, unknown> }
  assert.equal(order.mesh_order['procedure'], `${SERVICE}/deposit_letter`)
  assert.deepEqual(order.mesh_order['args'], { to_citizen_did: PALLAS, subject: 's', body: 'b' })
  assert.equal(order.mesh_order['then'], THE_MAIL_STEP_ASK)
  const said = answerOf(await tools.answer(THE_MAIL_STEP_ASK, { keep: order.mesh_order['keep'], answer: { result: { letter_id: 'l-1' } } }, 'a-session'))
  assert.equal(said, `Sent, sealed: letter l-1 to Pallas. ${AT_REST}`)
})

test('#1016 mail: a launch that hands no mail place has no mailbox, and the tool says why', async () => {
  const said = answerOf(await toolsOf(undefined).answer(READ_CREW_MAIL, {}, 'a-session'))
  assert.ok(said.includes('this host cannot carry a mesh call'), said)
})
