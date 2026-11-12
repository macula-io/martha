// The second observation the crew owes (martha#253): two members reach each other through Martha, with one of them
// inside a subagent's turn when the message arrives.
//
// This exists so a person can watch, on the landed tree, the one thing no unit test can say: two real members, started
// by the real launcher on the recorded host, exchange a HANDOFF and a VERDICT through the crew's channel, and each
// takes in what the other sent. The live observation the design promised was never made, and the subagent filter in the
// mod is right by the host's types while no test drives the hook that passes it, so this launch puts a message into a
// member's channel while that member's subagent is running.
//
// The launch is the real one: `martha init`, `martha approve` and `martha start`, twice, on one checkout where both
// members share one crew's streams. Only the models are stand-ins
// (../src/launch_a_claude_code_member/drive_the_recorded_host): the reviewer's first turn calls the host's own agent
// tool, and the stand-in answers that agent's request while the member's turn is still open.
//
// The order is what this observes: the builder says its hand-off while the reviewer is inside its subagent, so a member
// that read its channel on a subagent's turn would take the message in there. What passes is that the reviewer took it
// in once, after its own turn, and that the verdict came back the same way.
//
//   ./watch_a_live_launch/watch_two_members_reach_each_other.sh

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { SOLO_MEMBERS } from '../src/declare_a_solo_crew/declare_a_solo_crew.ts'
import { FRAME_OPENING, framed } from '../src/hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import type { ModelRequest, RecordedHostRan, ScriptedTurn } from '../src/launch_a_claude_code_member/drive_the_recorded_host.ts'
import { crewRowsDirectoryOf, driveTheRecordedHost, plainTextOf, stateHomeUnder } from '../src/launch_a_claude_code_member/drive_the_recorded_host.ts'
import { HOST_SILENCE_MS } from '../src/launch_a_claude_code_member/wait_while_the_host_keeps_showing.ts'
import { addressedTo, type ChannelHost, type PlacedMessage, readTheChannel, takenInBy } from '../src/keep_the_crew_channel/crew_channel.ts'
import { CREW_LINES, VALUE_SHAPES } from '../src/read_a_crew_line/crew_lines.ts'
import { rowStreamsDirectory } from '../src/row_streams_directory/row_streams_directory.ts'
import {
  aCheckoutToWatch,
  anObservationDirectory,
  aReport,
  sweep,
  theRecordedHost,
  theResultOfTheLastCallTo,
  toolCallsIn,
  toolResultsIn,
  type WatchedPlace,
} from './a_launch_to_watch.ts'

/** The words the reviewer's agent tool is called with: the whole of the transcript its subagent's request carries. */
const SUBAGENTS_PROMPT = 'Look one thing up for me, and say nothing else.'

/** The name the host gives the crew mod's tools, from the mod's own plugin manifest: `mcp__<name>__<tool>`. */
const THE_MODS_NAME = (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'claude_code_relay', '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string }).name

/** The call the host makes of one of the crew's tools. */
const called = (tool: string): string => `mcp__${THE_MODS_NAME}__${tool}`

/** The two crew tools this observation uses, by the names the crew registers. */
const SAY = called('crew_say')
const RECEIPTS = called('crew_receipts')

/** The host's own agent tool, as the adapter names it, and the kind of agent it starts: the host's own default one. */
const THE_HOSTS_AGENT_TOOL = 'Task'
const AGENTS_KIND = 'general-purpose'

/** The two members `martha init` declares: the one that hands a package over, and the one that answers it. */
const BUILDER = SOLO_MEMBERS[0].name
const REVIEWER = SOLO_MEMBERS[1].name

/** The package the two members talk about: this one, so the line they send is about real work. */
const PACKAGE = 'macula-io/martha#253'

/** A range of forty hex digits each side, as the line's own shape demands. */
const A_RANGE = `${'a'.repeat(40)}..${'b'.repeat(40)}`

/** One line of the crew's protocol, rendered from the shape its reader accepts (../src/read_a_crew_line). */
function aLineOfItsOwn(verb: string, values: Readonly<Record<string, string>>): string {
  const shape = CREW_LINES.find((line) => line.verb === verb)
  if (shape === undefined) throw new Error(`the crew's protocol has no ${verb} line, so this observation cannot send one`)
  const carried = shape.shown.range.map((key) => {
    const value = values[key]
    if (value === undefined || !VALUE_SHAPES[shape.keys[key] ?? 'number'].matches.test(value)) {
      throw new Error(`the ${verb} line this observation builds carries no ${key}, or one the reader refuses`)
    }
    return `${key}=${value}`
  })
  return [shape.verb, values['package'] ?? '', values['range'] ?? '', ...carried].join(' ')
}

const HANDOFF = aLineOfItsOwn('HANDOFF', { package: PACKAGE, range: A_RANGE, r: '1', ci: '1' })
const VERDICT = aLineOfItsOwn('VERDICT', { package: PACKAGE, range: A_RANGE, r: '1', ci: '1', req: '0' })

/** The approved config both members start on: the crew's tools and the host's own agent tool. */
const theConfigToApprove = (): { settings: unknown } => ({
  settings: { permissions: { defaultMode: 'default', allow: [SAY, RECEIPTS, THE_HOSTS_AGENT_TOOL] } },
})

const textOfContent = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((block) => (typeof block === 'object' && block !== null ? String((block as Record<string, unknown>)['text'] ?? '') : '')).join('\n')
      : ''

/** The messages one model request carries, as plain data. */
const messagesOf = (request: ModelRequest): readonly Record<string, unknown>[] =>
  (Array.isArray(request.body['messages']) ? (request.body['messages'] as unknown[]) : []).filter(
    (message): message is Record<string, unknown> => typeof message === 'object' && message !== null,
  )

/** Whether this request is the one the subagent's own model answers: its whole transcript is the prompt it was given. */
const theSubagentsRequest = (request: ModelRequest): boolean => {
  const messages = messagesOf(request)
  return messages.length === 1 && textOfContent(messages[0]?.['content']).trim() === SUBAGENTS_PROMPT
}

/** Everything the model has been shown by this request, as one text: where a raised crew turn is looked for. */
const transcriptOf = (request: ModelRequest): string => JSON.stringify(request.body['messages'] ?? null)

/** Whether the model has already made a call of `tool` by this request. */
const hasCalled = (request: ModelRequest, tool: string): boolean => toolCallsIn(request).some((call) => call.tool === tool)

/** The builder's turns: its hand-off, then the receipts once the verdict is back. */
const theBuildersScript = (request: ModelRequest): ScriptedTurn => {
  if (transcriptOf(request).includes(FRAME_OPENING)) return hasCalled(request, RECEIPTS) ? { text: 'Read the receipts.' } : { tool: RECEIPTS, input: {} }
  return hasCalled(request, SAY) ? { text: 'Handed it over, and I am waiting for the verdict.' } : { tool: SAY, input: { to: [REVIEWER], text: HANDOFF } }
}

/** The reviewer's turns: its subagent first, then the verdict once the builder's hand-off reaches it. */
const theReviewersScript =
  (startTheBuilder: () => void) =>
  (request: ModelRequest): ScriptedTurn => {
    if (theSubagentsRequest(request)) return { text: 'I looked it up: nothing to report.' }
    if (request.number === 1) {
      startTheBuilder()
      return { tool: THE_HOSTS_AGENT_TOOL, input: { description: 'look one thing up', prompt: SUBAGENTS_PROMPT, subagent_type: AGENTS_KIND } }
    }
    if (!transcriptOf(request).includes(FRAME_OPENING)) return { text: 'Reported.' }
    return hasCalled(request, SAY) ? { text: 'The verdict is in.' } : { tool: SAY, input: { to: [BUILDER], text: VERDICT } }
  }

/** One member's launch: the real launcher on the recorded host, its own stand-in model, on the crew's own checkout. */
async function aMemberWasStarted(place: WatchedPlace, member: string, requests: number, script: (request: ModelRequest) => ScriptedTurn): Promise<RecordedHostRan> {
  return driveTheRecordedHost({ claude: theRecordedHost(), home: place.home, checkout: place.checkout, member, owner_turn: 'Do what the crew needs.', requests, silence_ms: HOST_SILENCE_MS, script })
}

/** The crew's own streams, read the way the crew's own slices read them. */
const theCrewsChannel = (place: WatchedPlace): ChannelHost => ({
  clock: { now: () => Date.now() },
  stores: { rows: rowStreamsDirectory(crewRowsDirectoryOf(stateHomeUnder(place.home), place.checkout)) },
})

/** The one message a member sent that this observation reads, with the row the channel placed it at; or undefined. */
const theMessageFrom = (messages: readonly PlacedMessage[], from: string): PlacedMessage | undefined => messages.find((placed) => placed.message.from === from)

/** How many of a member's model requests carried the given frame: a message taken in is handed once. */
const turnsCarrying = (requests: readonly ModelRequest[], frame: string): readonly ModelRequest[] => requests.filter((request) => framedIn(transcriptOf(request), frame))

/** Whether the text carries the frame as the frame, not as part of a shorter one (a position ten is not one). */
const framedIn = (text: string, frame: string): boolean => text.includes(`${frame} `) || text.includes(`${frame}\\u0000`) || text.includes(`${frame}"`)

/** The index of the request the host sent after the agent tool's own answer: the member's turn, resumed. */
function afterTheAgentsAnswer(requests: readonly ModelRequest[], agentCall: string | undefined): number {
  if (agentCall === undefined) return -1
  return requests.findIndex((request) => toolResultsIn(request).has(agentCall))
}

const work = anObservationDirectory()
const report = aReport()
let place: WatchedPlace | undefined
try {
  const crew = aCheckoutToWatch(work, theConfigToApprove())
  place = crew
  const channel = theCrewsChannel(crew)
  let builders: Promise<RecordedHostRan> | undefined
  const startTheBuilder = (): void => {
    builders ??= aMemberWasStarted(crew, BUILDER, 4, theBuildersScript)
  }
  const reviewers = await aMemberWasStarted(crew, REVIEWER, 5, theReviewersScript(startTheBuilder))
  if (builders === undefined) throw new Error('the reviewer never started the builder, so there was nobody to say the hand-off')
  const buildersRan = await builders

  const messages = await readTheChannel(channel)
  const handoff = theMessageFrom(messages, BUILDER)
  const verdict = theMessageFrom(messages, REVIEWER)
  const handoffFrame = handoff === undefined ? '' : framed(handoff.position, BUILDER, HANDOFF)
  const verdictFrame = verdict === undefined ? '' : framed(verdict.position, REVIEWER, VERDICT)
  const agentCall = toolCallsIn(reviewers.requests[0] ?? { number: 0, body: {}, received_at: 0 }).find((call) => call.tool === THE_HOSTS_AGENT_TOOL)?.id
  const resumed = afterTheAgentsAnswer(reviewers.requests, agentCall)

  report.check(
    'the builder said its hand-off, and the channel holds it for the reviewer',
    handoff !== undefined && handoff.message.text === HANDOFF && addressedTo(handoff.message, REVIEWER),
    handoff === undefined ? `the channel holds ${JSON.stringify(messages.map((placed) => placed.message.from))}` : String(handoff.message.text),
  )
  report.check(
    'the hand-off reached the reviewer as one turn, after its own subagent had answered',
    turnsCarrying(reviewers.requests, handoffFrame).length === 1 && reviewers.requests.findIndex((request) => framedIn(transcriptOf(request), handoffFrame)) > resumed,
    `the reviewer sent the model ${reviewers.requests.length} requests; the agent answered in request ${resumed + 1}, the hand-off first appeared in request ${reviewers.requests.findIndex((request) => framedIn(transcriptOf(request), handoffFrame)) + 1}`,
  )
  report.check(
    'the reviewer took the hand-off in, once',
    (await takenInBy(channel, REVIEWER)).size === 1 && handoff !== undefined && (await takenInBy(channel, REVIEWER)).has(handoff.position),
    `the positions the reviewer took in: ${JSON.stringify([...(await takenInBy(channel, REVIEWER))])}`,
  )
  report.check(
    'the reviewer said its verdict, and the channel holds it for the builder',
    verdict !== undefined && verdict.message.text === VERDICT && addressedTo(verdict.message, BUILDER),
    verdict === undefined ? 'the channel holds no message from the reviewer' : String(verdict.message.text),
  )
  report.check(
    'the verdict reached the builder as one turn',
    turnsCarrying(buildersRan.requests, verdictFrame).length === 1,
    `the builder sent the model ${buildersRan.requests.length} requests`,
  )
  report.check(
    'the builder took the verdict in',
    verdict !== undefined && (await takenInBy(channel, BUILDER)).has(verdict.position),
    `the positions the builder took in: ${JSON.stringify([...(await takenInBy(channel, BUILDER))])}`,
  )
  report.check(
    'the builder read its receipts, and they say the reviewer took the hand-off in',
    String(theResultOfTheLastCallTo(buildersRan.requests.at(-1) ?? reviewers.requests[0]!, RECEIPTS)).includes(`taken in by ${REVIEWER}`),
    String(theResultOfTheLastCallTo(buildersRan.requests.at(-1) ?? reviewers.requests[0]!, RECEIPTS)).slice(0, 300),
  )
  report.check(
    'neither member was stopped',
    !plainTextOf(reviewers.shown).includes('is stopped') && !plainTextOf(buildersRan.shown).includes('is stopped'),
    'no stop line',
  )
} catch (error) {
  report.check(`the observation ran to its end (${error instanceof Error ? error.message : String(error)})`, false, 'the launch threw')
} finally {
  // Each launch ends its own member. A run with a failure keeps its directory for reading.
}

const status = report.end()
if (status !== 0) console.log(`kept for reading: ${place === undefined ? work : work}`)
else sweep([work])
process.exit(status)
