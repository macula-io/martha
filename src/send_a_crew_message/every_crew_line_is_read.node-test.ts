// Every crew line of a message is read, and BLOCKED, FILED and LIVE are crew lines too (martha#980 package 1, a port
// of crew-code's shorthand: every line whose first word is a verb is checked, and a longer message names the line that
// is wrong).
//
// Each case goes through say_to_the_crew's own send, so what is pinned is what a member's message comes to: the rows a
// line keeps in its package's ledger, and the one notice a line that does not read leaves beside the send.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { ChannelHost } from '../keep_the_crew_channel/crew_channel.ts'
import { readLedger } from '../log_ledger/log_ledger.ts'
import { packagesNamedIn } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { sendACrewMessage } from './send_a_crew_message.ts'

const BASE = 'a'.repeat(40)
const TIP = 'b'.repeat(40)
const PACKAGE = 'macula-io/martha#980'

const channelHost = (): ChannelHost & { readonly clock: { now(): number } } => {
  const { host } = hostForTests({ now: 9_800 })
  return { clock: host.clock, stores: { rows: host.stores.rows } }
}

const saying = (text: string): Parameters<typeof sendACrewMessage>[1] => ({
  member: 'Builder',
  roster: ['Builder', 'Reviewer', 'Supervisor'],
  receivers: ['Supervisor'],
  package: null,
  to: ['Reviewer'],
  text,
})

/** What a send told its member, or a failure naming what it answered instead. */
const toldBy = (sent: Awaited<ReturnType<typeof sendACrewMessage>>): string => ('told' in sent ? sent.told : assert.fail(`the send was refused: ${JSON.stringify(sent)}`))

test('#980: a HANDOFF on the second line of a message is read and kept, as one on the first line is', async () => {
  const channel = channelHost()
  await sendACrewMessage(channel, saying(`The work is ready.\nHANDOFF ${PACKAGE} ${BASE}..${TIP} r=1 ci=41700170944`))
  assert.deepEqual((await readLedger(channel, PACKAGE)).map((row) => row.kind), ['act_announced', 'act_concluded'])
})

test('#980: a LIVE line naming a package keeps the release in that package\'s ledger', async () => {
  const channel = channelHost()
  const told = toldBy(await sendACrewMessage(channel, saying(`LIVE ${PACKAGE} 0.9.1 run=39879491499`)))
  assert.doesNotMatch(told, /notice/, `a well-formed LIVE line was noticed: ${told}`)
  const rows = await readLedger(channel, PACKAGE)
  assert.deepEqual(rows.map((row) => (row.kind === 'release_shipped' ? `${row.kind} ${row.note}` : row.kind)), [`release_shipped LIVE ${PACKAGE} 0.9.1 run=39879491499`])
})

test('#980: a LIVE line naming a service, a BLOCKED line and a FILED line read, and keep no row', async () => {
  const channel = channelHost()
  const text = ['LIVE reckon_gater 3.14.0 run=39879491499', `BLOCKED ${PACKAGE} on=Venus | waiting for the design read`, `FILED ${PACKAGE}`].join('\n')
  const told = toldBy(await sendACrewMessage(channel, saying(text)))
  assert.doesNotMatch(told, /notice/, `well-formed lines were noticed: ${told}`)
  assert.deepEqual(await readLedger(channel, PACKAGE), [])
})

test('#980: a BLOCKED line with no on= goes as prose, its field named', async () => {
  const told = toldBy(await sendACrewMessage(channelHost(), saying(`BLOCKED ${PACKAGE}`)))
  assert.match(told, /notice: BLOCKED: on is missing, so the line was read as prose\./)
})

test('#980: a line that does not read below the first is named by its line number, and the lines that read are kept', async () => {
  const channel = channelHost()
  const text = [`HANDOFF ${PACKAGE} ${BASE}..${TIP} r=1 ci=41700170944`, 'and then', `LIVE ${PACKAGE} 0.9.1`].join('\n')
  const told = toldBy(await sendACrewMessage(channel, saying(text)))
  assert.match(told, /notice: line 3: LIVE: run is missing, so the line was read as prose\./)
  assert.deepEqual((await readLedger(channel, PACKAGE)).map((row) => row.kind), ['act_announced', 'act_concluded'])
})

test('#980: the packages the crew\'s lines name are packages only, never a service a LIVE line names', () => {
  const message = { from: 'Builder', to: ['Supervisor'], sent_at: 1, text: 'LIVE reckon_gater 3.14.0 run=39879491499' }
  assert.deepEqual(packagesNamedIn([message]), [])
})
