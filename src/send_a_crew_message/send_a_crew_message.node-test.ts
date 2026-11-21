// One member saying something to another, or to all of them (martha#253, slice 1).
//
// These cases pin what a send writes and what it answers: one row addressed as the sender named it, a name off the
// roster answered with the roster and nothing written, and — when the member holds a package — the send announced
// and concluded in that package's ledger, so a member refreshed mid-send finds an act it never saw confirmed.

import { DECLARATION_DIRECTORY, DECLARATION_FILE, OFFER_OWNER_ASKS, OWNER, RESTART_MEMBER } from '../declare_crew/declare_crew.ts'
import { SOLO_MODE } from '../declare_crew/declare_crew.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { crewToolsOver, CREW_TOOL_NAMES, THE_TOOLS_ASK } from '../a_crews_tools/a_crews_tools.ts'
import type { DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { HostContract } from '../host_contract/host_contract.ts'
import type { ChannelHost } from '../keep_the_crew_channel/crew_channel.ts'
import { appendToTheChannel, readTheChannel, THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'
import { readLedger, ledgerStreamOf, noteRecovery } from '../log_ledger/log_ledger.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { RELAY_SOCKET_NAME } from '../serve_the_relay_to_a_launch/relay_directory.ts'
import { addresseesOf, CREW_SAY_DESCRIPTION, LONGEST_MESSAGE, SAY_TO_THE_CREW, sendACrewMessage } from './send_a_crew_message.ts'
import { linesACardTeaches } from '../read_a_crew_line/crew_lines.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'

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
  receivers: ['Supervisor'],
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
  await sendACrewMessage(channel, sending({ to: THE_WHOLE_CREW, text: 'a remark to all' }))

  const [kept] = await readTheChannel(channel)
  assert.equal(kept?.message.to, THE_WHOLE_CREW)
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
  assert.equal(addresseesOf(THE_WHOLE_CREW, ROSTER), THE_WHOLE_CREW)
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
  mode: { name: SOLO_MODE, roles: ['builder', 'reviewer'], may: { assign_work: [OWNER], approve_landing: [OWNER], resume_parked_work: [OWNER], [OFFER_OWNER_ASKS]: [OWNER], [RESTART_MEMBER]: [OWNER] } },
  channel_read_seconds: 30,
}

/** A dashboard store that holds no row: the member has reported nothing, so it holds no package. */
const NO_BEATS: DashboardStore = { read: () => null, change: () => ({ kept: false, why: 'a test holds no rows' }), all: () => ({}) }

/** The crew's tools over a declaration of two members and a channel of the test's own. */
function crewOverAFreshPlace(t: { after(fn: () => void): void }): ReturnType<typeof crewToolsOver> {
  const home = mkdtempSync(join(tmpdir(), 'martha-253-say-'))
  t.after(() => removeTheTree(home))
  const { host } = hostForTests({ now: 1_000, documents: { [join(home, DECLARATION_DIRECTORY, DECLARATION_FILE)]: JSON.stringify(DECLARATION) } })
  return crewToolsOver({
    member: 'Builder',
    ledger: { clock: host.clock, stores: { rows: host.stores.rows } },
    beats: NO_BEATS,
    root: home,
    documents: host.stores.documents,
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, 'crew-files')) },
  })
}

test('#253: say_to_the_crew is a tool the launcher names, and answering it writes to the crew\'s channel', async (t) => {
  const crew = crewOverAFreshPlace(t)
  const named = await crew.answer(THE_TOOLS_ASK, {}, 'session-253')
  assert.ok('answer' in named)
  assert.ok(CREW_TOOL_NAMES.includes(SAY_TO_THE_CREW), 'the launcher does not name say_to_the_crew, so the mod never registers it')

  const answered = await crew.answer(SAY_TO_THE_CREW, { to: ['Reviewer'], text: 'a hand-off, in words' }, 'session-253')
  assert.ok('answer' in answered, `say_to_the_crew was not answered: ${JSON.stringify(answered)}`)
  assert.match(answered.answer, /sent as message 0 to Reviewer/)
})

test('#253: a say_to_the_crew to a name the declaration does not hold is answered with its members', async (t) => {
  const crew = crewOverAFreshPlace(t)
  const answered = await crew.answer(SAY_TO_THE_CREW, { to: ['Pluto'], text: 'a hand-off' }, 'session-253')

  assert.ok('refused' in answered)
  assert.match(answered.refused, /Builder, Reviewer/)
})

/** A word as a regular expression reads it: every tool name here is a plain one, and this keeps it that way. */
const asAWord = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The function the mod's hook for one tool names, or null when the mod registers no such hook. */
function theHooksAnswerOf(mod: string, tool: string): string | null {
  const hook = new RegExp(`on\\('tool\\.call', \\{ tool: 'mcp__${asAWord(THE_PLUGINS_NAME)}__${asAWord(tool)}' \\}, (\\w+)\\)`).exec(mod)
  return hook === null ? null : (hook[1] ?? null)
}

/** The tool name one of the mod's answer functions forwards to the launcher, or null when it forwards none. */
function theForwardedToolOf(mod: string, answer: string): string | null {
  const forwarded = new RegExp(`const ${asAWord(answer)} = \\(\\$: CrewEngine, e: Record<string, unknown>\\): Promise<unknown> => (?:answerFromTheLauncher|answerWithAMeshOrder)\\(\\$, e, '([^']+)'\\)`).exec(mod)
  return forwarded === null ? null : (forwarded[1] ?? null)
}

test('#253: every tool the launcher names has a hook in the mod that answers it', () => {
  // The mod registers a hook per tool by a literal name: a tool added to the launcher's list without a hook here is
  // registered in the session and never answered, and only a live run would notice. This reads the mod's own text,
  // and takes the server part from the plugin's manifest, so a renamed plugin fails here instead of in a session
  // (martha#343): every hook would miss and every crew tool would go unanswered.
  const mod = readFileSync(new URL('../claude_code_relay/hooks/crew.tsx', import.meta.url), 'utf8')
  const missing = CREW_TOOL_NAMES.filter((name) => !mod.includes(`'mcp__${THE_PLUGINS_NAME}__${name}'`))
  assert.deepEqual(missing, [], `the mod registers no hook for these tools, so their calls go unanswered: ${missing.join(', ')}`)
})

test('#343: every hook forwards the tool it was called for, so a wake cannot be answered as a park', () => {
  // The two park tools are named alike and do opposite things, so the mod has two near-identical forwarders a
  // reviewer cannot tell apart by reading one line. A hook that forwards another tool's name, or a registration that
  // names the other tool's answer, turns a member's wake into a park without any test noticing (martha#343 r=1, P1
  // and P2). This pairs the two literals the call rests on, for every tool: the hook's registration, the function it
  // names, and the name that function forwards. Driving `register()` would be stronger, and a hooks module cannot be
  // imported here: it is `.tsx`, and node refuses the extension without a transform step.
  const mod = readFileSync(new URL('../claude_code_relay/hooks/crew.tsx', import.meta.url), 'utf8')
  const misdirected = CREW_TOOL_NAMES.flatMap((tool) => {
    const answer = theHooksAnswerOf(mod, tool)
    if (answer === null) return [] // the test above fails on it, by name
    const forwarded = theForwardedToolOf(mod, answer)
    if (forwarded === null) return [`the hook for ${tool} is ${answer}, which forwards no tool to the launcher`]
    return forwarded === tool ? [] : [`the hook for ${tool} is ${answer}, which forwards ${forwarded}`]
  })
  assert.deepEqual(misdirected, [], `these calls reach the launcher as another tool, so a member's act becomes a different one: ${misdirected.join('; ')}`)
})

test('#601: a hand-off whose line does not read is sent as prose, with the field named in one line', async () => {
  const channel = channelHost()
  const sent = await sendACrewMessage(channel, sending({ text: 'HANDOFF macula-io/martha#253 aaaa..bbbb r=1' }))

  assert.ok('sent' in sent, `a line that does not read was refused instead of sent as prose: ${JSON.stringify(sent)}`)
  assert.match(sent.told, /notice: HANDOFF: /, 'the sender was not told the line went as prose')
  assert.match(sent.told, /range/, 'the notice did not name the field that did not read')
  assert.equal((await readTheChannel(channel)).length, 1, 'a line that does not read was not put in the channel as prose')
})

test('#601: a message longer than the channel is meant for is sent as it is, with one line saying it is long', async () => {
  const channel = channelHost()
  const long = 'x'.repeat(LONGEST_MESSAGE + 1)
  const sent = await sendACrewMessage(channel, sending({ text: long }))

  assert.ok('sent' in sent, `an over-long message was refused instead of sent: ${JSON.stringify(sent)}`)
  assert.match(sent.told, new RegExp(`at most ${LONGEST_MESSAGE} characters`), 'the sender was not told the message is long')
  const [kept] = await readTheChannel(channel)
  assert.equal(kept?.message.text.length, long.length, 'the message was truncated instead of sent as it is')
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

// martha#512 slice 2: a crew message goes through the recovery. A message whose row was refused is sent once more; one
// whose outcome was not kept is read back from the channel and never sent twice. A pause no longer holds a message.

/** A row store over the in-memory one that refuses the append at `refused` (1-based), counting every stream. */
function aStoreThatRefusesTheAppendAt(refused: number): HostContract['stores']['rows'] {
  const { host } = hostForTests()
  let appends = 0
  return {
    append: async (stream, row) => {
      appends += 1
      if (appends === refused) throw new Error(`the store kept no row at append ${String(appends)}`)
      return host.stores.rows.append(stream, row)
    },
    read: (stream) => host.stores.rows.read(stream),
  }
}

const PAUSED = 'macula-io/martha#512'

test('#512 slice 2: a message whose row the store refused is sent once more, and reaches the channel once', async () => {
  // The announcement is the first append: refused, so nothing was sent and the one attempt sends it.
  const { host } = hostForTests({ now: 7_500, rows: aStoreThatRefusesTheAppendAt(1) })
  const sent = await sendACrewMessage(host, sending({ package: PAUSED }))
  assert.ok('sent' in sent, `the message was not sent: ${JSON.stringify(sent)}`)
  assert.equal((await readTheChannel(host)).length, 1, 'the message did not reach the channel exactly once')
  assert.deepEqual((await readLedger(host, PAUSED)).map((row) => row.kind), ['recovery_decided', 'act_announced', 'act_concluded'])
})

test('#512 slice 2: a message whose outcome was not kept is read back from the channel, and never sent twice', async () => {
  // The announcement is append 1, the message itself append 2, and its outcome append 3: refused.
  const { host } = hostForTests({ now: 7_500, rows: aStoreThatRefusesTheAppendAt(3) })
  const sent = await sendACrewMessage(host, sending({ package: PAUSED }))
  assert.ok('sent' in sent, `a message the channel holds was answered as not sent: ${JSON.stringify(sent)}`)
  assert.equal((await readTheChannel(host)).length, 1, 'the message was sent twice')
  const rows = await readLedger(host, PAUSED)
  assert.equal(rows.filter((row) => row.kind === 'act_announced').length, 1, 'the message was announced twice')
  assert.ok(rows.some((row) => row.kind === 'recovery_decided'), 'the recovery did not keep what it read in the channel')
})

/** A package paused by a recovery the failure could not be read for, as slice 1 records it. */
async function aPausedPackage(host: Parameters<typeof noteRecovery>[0]): Promise<void> {
  await noteRecovery(host, {
    package: PAUSED,
    member: 'Builder',
    act: { kind: 'push', what: 'origin Builder/512-a-branch' },
    failure: { class: 'unknown', evidence: 'the failure carried nothing to read it by' },
    inspection: { read: 'origin', found: 'the branch is still there' },
    decision: 'paused',
  })
}

test('#512 slice 2: a message only to those the nudges go to passes a pause, compared by member name, and still goes through the recovery', async () => {
  const { host } = hostForTests({ now: 7_500 })
  await aPausedPackage(host)
  // The declaration spells the receiver in capitals: the names are compared as member names, not as strings.
  const sent = await sendACrewMessage(host, sending({ package: PAUSED, to: ['Supervisor'], receivers: ['SUPERVISOR'] }))
  assert.ok('sent' in sent, `a report to the Supervisor was held by the pause: ${JSON.stringify(sent)}`)
  assert.equal((await readTheChannel(host)).length, 1, 'the report did not reach the channel exactly once')
  const kinds = (await readLedger(host, PAUSED)).map((row) => row.kind)
  assert.deepEqual(kinds.slice(-2), ['act_announced', 'act_concluded'], 'the report was not announced and concluded in the ledger')
})

test('#512 slice 2: the same words sent before the send began are not taken for this send, and the failure stands', async () => {
  // The same member said the same words to the same member earlier (append 1). This send's announcement is append 2,
  // and the message itself append 3: refused, so it did not reach the channel and the look must not find the old one.
  const { host } = hostForTests({ now: 7_500, rows: aStoreThatRefusesTheAppendAt(3) })
  const words = 'the same words, said twice'
  const earlier = sending({ package: PAUSED, text: words })
  await appendToTheChannel(host, { from: earlier.member, to: ['Reviewer'], text: words, sent_at: 1_000 })
  const sent = await sendACrewMessage(host, earlier)
  assert.ok('refused' in sent, `the earlier message was taken for this one: ${JSON.stringify(sent)}`)
  assert.ok(sent.refused.includes(`the crew channel found no message from ${earlier.member} with this text`), `the look did not say it found nothing: ${sent.refused}`)
  assert.equal((await readTheChannel(host)).length, 1, 'the channel holds more than the earlier message')
})

// --- a message that names a path a reboot deletes (martha#314) --------------------------------

/** A root this test declares, and a machine root it hands in: neither is a machine's own, so the case runs anywhere. */
const SCRATCH = '/var/scratch'
const RUNTIME = '/run/user/1000'

/** The crew's tools over a declaration of this test's, and the machine roots a launch would supply, if any. */
function crewOverADeclaration(t: { after(fn: () => void): void }, declaration: unknown, machineRoots?: readonly string[]) {
  const home = mkdtempSync(join(tmpdir(), 'martha-314-say-'))
  t.after(() => removeTheTree(home))
  const { host } = hostForTests({ now: 1_000, documents: { [join(home, DECLARATION_DIRECTORY, DECLARATION_FILE)]: JSON.stringify(declaration) } })
  return crewToolsOver({
    member: 'Builder',
    ledger: { clock: host.clock, stores: { rows: host.stores.rows } },
    beats: NO_BEATS,
    root: home,
    documents: host.stores.documents,
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, 'crew-files')) },
    ...(machineRoots === undefined ? {} : { volatile_roots: machineRoots }),
  })
}

test('#314: a message citing a path a reboot deletes is sent, and its sender is told so as it lands', async (t) => {
  const crew = crewOverADeclaration(t, { ...DECLARATION, volatile_paths: [SCRATCH] })
  const answered = await crew.answer(SAY_TO_THE_CREW, { to: ['Reviewer'], text: `the verdict is in ${SCRATCH}/v.md` }, 'session-314')

  assert.ok('answer' in answered, `the send citing a volatile path was not answered: ${JSON.stringify(answered)}`)
  assert.match(answered.answer, /^sent as message 0 to Reviewer\./, 'the send was not confirmed to the sender')
  assert.match(answered.answer, new RegExp(`${SCRATCH}/v\\.md does not survive a reboot`), `the sender was not told the path goes: ${answered.answer}`)
  assert.ok(answered.answer.includes(WRITE_MY_HANDOVER_TOOL), `the note does not send the sender to the handover tool: ${answered.answer}`)
})

test('#314: the roots a crew declares are the ones the note reads, and a root it leaves out is an ordinary path', async (t) => {
  const crew = crewOverADeclaration(t, { ...DECLARATION, volatile_paths: [SCRATCH] }, [RUNTIME])
  const cited = await crew.answer(SAY_TO_THE_CREW, { to: ['Reviewer'], text: `in ${RUNTIME}/s and ${SCRATCH}/v` }, 'session-314')
  assert.ok('answer' in cited, `the send was not answered: ${JSON.stringify(cited)}`)
  assert.match(cited.answer, new RegExp(`${SCRATCH}/v does not survive`), `the declared root was not read: ${cited.answer}`)
  assert.doesNotMatch(cited.answer, new RegExp(RUNTIME), 'a root the crew leaves out reached the note')
})

test('#314: a crew that declares no root is warned on the machine roots the launch hands in', async (t) => {
  const crew = crewOverADeclaration(t, DECLARATION, [RUNTIME])
  const answered = await crew.answer(SAY_TO_THE_CREW, { to: ['Reviewer'], text: `the log is at ${join(RUNTIME, RELAY_SOCKET_NAME)}` }, 'session-314')
  assert.ok('answer' in answered, `the send was not answered: ${JSON.stringify(answered)}`)
  assert.ok(
    answered.answer.includes(`${join(RUNTIME, RELAY_SOCKET_NAME)} does not survive`),
    `the machine root was not read: ${answered.answer}`,
  )
})

test('#314: a message that cites no path a reboot deletes is answered exactly as before', async (t) => {
  const crew = crewOverADeclaration(t, { ...DECLARATION, volatile_paths: [SCRATCH] }, [RUNTIME])
  const answered = await crew.answer(SAY_TO_THE_CREW, { to: ['Reviewer'], text: 'a hand-off, in words' }, 'session-314')
  assert.ok('answer' in answered, `the plain send was not answered: ${JSON.stringify(answered)}`)
  assert.doesNotMatch(answered.answer, /does not survive a reboot/, `a plain send carried a note: ${answered.answer}`)
})
