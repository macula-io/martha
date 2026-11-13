// One member saying something to another, or to all of them (martha#253, slice 1).
//
// These cases pin what a send writes and what it answers: one row addressed as the sender named it, a name off the
// roster answered with the roster and nothing written, and — when the member holds a package — the send announced
// and concluded in that package's ledger, so a member refreshed mid-send finds an act it never saw confirmed.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { crewToolsOver, CREW_TOOL_NAMES, THE_TOOLS_ASK } from '../a_crews_tools/a_crews_tools.ts'
import type { DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { ChannelHost } from '../keep_the_crew_channel/crew_channel.ts'
import { readTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { readLedger, ledgerStreamOf } from '../log_ledger/log_ledger.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { addresseesOf, CREW_SAY_DESCRIPTION, sendACrewMessage } from './send_a_crew_message.ts'
import { linesACardTeaches } from '../read_a_crew_line/crew_lines.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'

const ROSTER = ['Builder', 'Reviewer', 'Supervisor'] as const

/**
 * The server part of every tool the host names for this plugin, read from the manifest the host reads it from
 * (martha#343): `mcp__<the plugin's name>__<tool>`. It is read rather than written here, because a literal that
 * agrees with today's manifest and not with tomorrow's is exactly the failure this file's hook test exists to catch.
 */
const THE_PLUGINS_NAME = (JSON.parse(
  readFileSync(new URL('../claude_code_relay/.claude-plugin/plugin.json', import.meta.url), 'utf8'),
) as { name: string }).name

const channelHost = (): ChannelHost & { readonly clock: { now(): number } } => {
  const { host } = hostForTests({ now: 7_500 })
  return { clock: host.clock, stores: { rows: host.stores.rows } }
}

const sending = (more: Partial<Parameters<typeof sendACrewMessage>[1]> = {}): Parameters<typeof sendACrewMessage>[1] => ({
  member: 'Builder',
  roster: ROSTER,
  package: null,
  to: ['Reviewer'],
  text: 'a hand-off, in words',
  ...more,
})

test('#253: a message to one member is one row, addressed to that member only', async () => {
  const channel = channelHost()
  const sent = await sendACrewMessage(channel, sending())

  assert.ok('sent' in sent)
  assert.match(sent.told, /^sent as message 0 to Reviewer\./, 'the member was not told which message it sent')
  assert.deepEqual(await readTheChannel(channel), [{ position: 0, message: { from: 'Builder', to: ['Reviewer'], text: 'a hand-off, in words', sent_at: 7_500 } }])
})

test('#253: "crew" addresses every member, and is kept as the crew rather than as a list', async () => {
  const channel = channelHost()
  await sendACrewMessage(channel, sending({ to: 'crew', text: 'a remark to all' }))

  const [kept] = await readTheChannel(channel)
  assert.equal(kept?.message.to, 'crew')
})

test('#253: a name off the roster is answered with the roster, and nothing is written', async () => {
  const channel = channelHost()
  const sent = await sendACrewMessage(channel, sending({ to: ['Reviewer', 'Pluto'] }))

  assert.ok('refused' in sent)
  assert.match(sent.refused, /"Pluto"/)
  assert.match(sent.refused, /Builder, Reviewer, Supervisor/, 'the answer did not name the roster the sender can address')
  assert.deepEqual(await readTheChannel(channel), [], 'a message addressed to a stranger was written anyway')
})

test('#253: a to that is neither names nor "crew" is answered with the roster, and nothing is written', async () => {
  const channel = channelHost()
  for (const to of ['Reviewer', 42, null, []]) {
    const sent = await sendACrewMessage(channel, sending({ to }))
    assert.ok('refused' in sent, `"to": ${JSON.stringify(to)} was taken as an address`)
    assert.match(sent.refused, /Builder, Reviewer, Supervisor/)
  }
  assert.deepEqual(await readTheChannel(channel), [])
})

test('#253: a message with no text is answered, and nothing is written', async () => {
  const channel = channelHost()
  for (const text of ['', '   ', 7]) {
    const sent = await sendACrewMessage(channel, sending({ text }))
    assert.ok('refused' in sent)
  }
  assert.deepEqual(await readTheChannel(channel), [])
})

test('#253: a member holding a package has the send announced and concluded in that package\'s ledger', async () => {
  const channel = channelHost()
  const PACKAGE = 'macula-io/martha#253'
  const sent = await sendACrewMessage(channel, sending({ package: PACKAGE }))

  assert.ok('sent' in sent)
  const rows = await readLedger(channel, PACKAGE)
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['act_announced', 'act_concluded'],
    `the send was not announced and concluded in ${ledgerStreamOf(PACKAGE)}`,
  )
  const announced = rows[0]
  assert.ok(announced !== undefined && 'act' in announced)
  assert.equal(announced.act.kind, 'room_message')
  const concluded = rows[1]
  assert.ok(concluded !== undefined && 'outcome' in concluded)
  assert.deepEqual(concluded.outcome, { succeeded: true, detail: 'sent as message 0 to Reviewer.' })
})

test('#253: a member holding no package still sends, and says nothing was announced', async () => {
  const channel = channelHost()
  const sent = await sendACrewMessage(channel, sending({ package: null }))

  assert.ok('sent' in sent)
  assert.match(sent.told, /No package was held/)
  assert.equal((await readTheChannel(channel)).length, 1)
})

test('#253: addresses are read from the argument, and a name is never built from its text', () => {
  assert.deepEqual(addresseesOf(['Reviewer'], ROSTER), ['Reviewer'])
  assert.equal(addresseesOf('crew', ROSTER), 'crew')
  assert.deepEqual(addresseesOf(['Builder', 'Reviewer'], ROSTER), ['Builder', 'Reviewer'])
})

// --- the tool the mod registers and the launcher answers -------------------------------------

const DECLARATION = {
  version: 1,
  owner: 'Ann',
  members: [
    { name: 'Builder', role: 'builder' },
    { name: 'Reviewer', role: 'reviewer' },
  ],
  mode: { name: 'solo', roles: ['builder', 'reviewer'], may: { assign_work: ['owner'], approve_landing: ['owner'], resume_parked_work: ['owner'] } },
  channel_read_seconds: 30,
}

/** A dashboard store that holds no row: the member has reported nothing, so it holds no package. */
const NO_BEATS: DashboardStore = { read: () => null, keep: () => ({ kept: false, why: 'a test holds no rows' }), all: () => ({}) }

/** The crew's tools over a declaration of two members and a channel of the test's own. */
function crewOverAFreshPlace(t: { after(fn: () => void): void }): ReturnType<typeof crewToolsOver> {
  const home = mkdtempSync(join(tmpdir(), 'martha-253-say-'))
  t.after(() => removeTheTree(home))
  const { host } = hostForTests({ now: 1_000, documents: { [join(home, '.crew', 'crew.json')]: JSON.stringify(DECLARATION) } })
  return crewToolsOver({
    member: 'Builder',
    ledger: { clock: host.clock, stores: { rows: host.stores.rows } },
    beats: NO_BEATS,
    root: home,
    documents: host.stores.documents,
    stores: { crew: crewFilesDirectory(join(home, 'crew')) },
  })
}

test('#253: crew_say is a tool the launcher names, and answering it writes to the crew\'s channel', async (t) => {
  const crew = crewOverAFreshPlace(t)
  const named = await crew.answer(THE_TOOLS_ASK, {}, 'session-253')
  assert.ok('answer' in named)
  assert.ok(CREW_TOOL_NAMES.includes('crew_say'), 'the launcher does not name crew_say, so the mod never registers it')

  const answered = await crew.answer('crew_say', { to: ['Reviewer'], text: 'a hand-off, in words' }, 'session-253')
  assert.ok('answer' in answered, `crew_say was not answered: ${JSON.stringify(answered)}`)
  assert.match(answered.answer, /sent as message 0 to Reviewer/)
})

test('#253: a crew_say to a name the declaration does not hold is answered with its members', async (t) => {
  const crew = crewOverAFreshPlace(t)
  const answered = await crew.answer('crew_say', { to: ['Pluto'], text: 'a hand-off' }, 'session-253')

  assert.ok('refused' in answered)
  assert.match(answered.refused, /Builder, Reviewer/)
})

test('#253: every tool the launcher names has a hook in the mod that answers it', () => {
  // The mod registers a hook per tool by a literal name: a tool added to the launcher's list without a hook here is
  // registered in the session and never answered, and only a live run would notice. This reads the mod's own text,
  // and takes the server part from the plugin's manifest, so a renamed plugin fails here instead of in a session
  // (martha#343): every hook would miss and every crew tool would go unanswered.
  const mod = readFileSync(new URL('../claude_code_relay/hooks/crew.tsx', import.meta.url), 'utf8')
  const missing = CREW_TOOL_NAMES.filter((name) => !mod.includes(`'mcp__${THE_PLUGINS_NAME}__${name}'`))
  assert.deepEqual(missing, [], `the mod registers no hook for these tools, so their calls go unanswered: ${missing.join(', ')}`)
})

test('#253: a hand-off whose line does not read is answered with the field, before anything is sent', async () => {
  const channel = channelHost()
  const sent = await sendACrewMessage(channel, sending({ text: 'HANDOFF macula-io/martha#253 aaaa..bbbb r=1' }))

  assert.ok('refused' in sent)
  assert.match(sent.refused, /range/)
  assert.deepEqual(await readTheChannel(channel), [], 'a line that does not read was put in the channel anyway')
})

test('#253: a well-formed hand-off sent through the crew says its line reached the package\'s ledger', async () => {
  const channel = channelHost()
  const base = 'a'.repeat(40)
  const tip = 'b'.repeat(40)
  const sent = await sendACrewMessage(channel, sending({ text: `HANDOFF macula-io/martha#253 ${base}..${tip} r=1 ci=41700170944` }))

  assert.ok('sent' in sent)
  const rows = await readLedger(channel, 'macula-io/martha#253')
  assert.deepEqual(rows.map((row) => row.kind), ['act_announced', 'act_concluded'], `the hand-off added no row of its own: ${JSON.stringify(rows)}`)
  const announced = rows[0]
  assert.ok(announced !== undefined && 'act' in announced)
  assert.equal(announced.act.kind, 'handoff')
})

test('#253: the description a member reads teaches every line a card teaches', () => {
  const taught = linesACardTeaches()
  assert.equal(taught.length, 4, 'the cards teach two verbs, each on a range and on a design')
  for (const { line } of taught) {
    assert.ok(CREW_SAY_DESCRIPTION.includes(line), `the description a member reads does not teach ${line}`)
  }
})
