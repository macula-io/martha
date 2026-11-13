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
// that read its channel on a subagent's turn would take the message in there. The run MAKES that order rather than
// hoping for it (review r=1): the subagent's own answer is held until the crew's channel holds the builder's message, so
// the hand-off was said while the subagent ran, and the check compares the hand-off's sent time with the time that
// request was answered. What passes is that the reviewer took it in once, after its own turn, and that the verdict came
// back the same way.
//
//   ./watch_a_live_launch/watch_two_members_reach_each_other.sh

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { SOLO_MEMBERS } from '../src/declare_a_solo_crew/declare_a_solo_crew.ts'
import { FRAME_OPENING, framed } from '../src/hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import type { ModelRequest, ModelScript, ScriptedTurn } from '../src/launch_a_claude_code_member/drive_the_recorded_host.ts'
import { crewRowsDirectoryOf, driveTheRecordedHost, plainTextOf, stateHomeUnder } from '../src/launch_a_claude_code_member/drive_the_recorded_host.ts'
import { HOST_SILENCE_MS } from '../src/launch_a_claude_code_member/wait_while_the_host_keeps_showing.ts'
import { addressedTo, readTheChannel, tookInRowsOf, type ChannelHost, type PlacedMessage } from '../src/keep_the_crew_channel/crew_channel.ts'
import { CREW_LINES, VALUE_SHAPES } from '../src/read_a_crew_line/crew_lines.ts'
import { readACrewLine } from '../src/read_a_crew_line/read_a_crew_line.ts'
import { rowStreamsDirectory } from '../src/row_streams_directory/row_streams_directory.ts'
import { SAY_TO_THE_CREW } from '../src/send_a_crew_message/send_a_crew_message.ts'
import { READ_THE_RECEIPTS } from '../src/show_what_a_message_became/show_what_a_message_became.ts'
import {
  aCallAndItsResult,
  aCheckoutToWatch,
  aMemberRan,
  anObservationDirectory,
  aReport,
  keepTheRequests,
  keepTheTerminal,
  sweep,
  theRecordedHost,
  theResultOfTheLastCallTo,
  theStoppedLine,
  toolCallsIn,
  type MemberRan,
  type WatchedPlace,
} from './a_launch_to_watch.ts'

/** The words the reviewer's agent tool is called with: the whole of the transcript its subagent's request carries. */
const SUBAGENTS_PROMPT = 'Look one thing up for me, and say nothing else.'

/** The name the host gives the crew mod's tools, from the mod's own plugin manifest: `mcp__<name>__<tool>`. */
const THE_MODS_NAME = (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'claude_code_relay', '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string }).name

/** The call the host makes of one of the crew's tools. */
const called = (tool: string): string => `mcp__${THE_MODS_NAME}__${tool}`

/** The two crew tools this observation uses, by the names the crew registers. */
const SAY = called(SAY_TO_THE_CREW)
const RECEIPTS = called(READ_THE_RECEIPTS)

/** The host's own agent tool, as the adapter names it, and the kind of agent it starts: the host's own default one. */
const THE_HOSTS_AGENT_TOOL = 'Task'
const AGENTS_KIND = 'general-purpose'

/** The two members `martha init` declares: the one that hands a package over, and the one that answers it. */
const BUILDER = SOLO_MEMBERS[0].name
const REVIEWER = SOLO_MEMBERS[1].name

/** The package the two members talk about: this one, so the line they send is about real work. */
const PACKAGE = 'macula-io/martha#253'

/** How many model requests each launch may take at most: a ceiling, since the host sends requests of its own. */
const REVIEWERS_REQUESTS = 12
const BUILDERS_REQUESTS = 10

/** A range of forty hex digits each side, as the line's own shape demands. */
const A_RANGE = `${'a'.repeat(40)}..${'b'.repeat(40)}`

/**
 * One line of the crew's protocol, rendered from the shape its reader accepts (../src/read_a_crew_line), and put back
 * through that reader before it is used: a line the crew refuses would reach the member as an error and the
 * observation would observe nothing (a first run's VERDICT carried no PASS).
 */
function aLineOfItsOwn(verb: string, values: Readonly<Record<string, string>>): string {
  const shape = CREW_LINES.find((line) => line.verb === verb)
  if (shape === undefined) throw new Error(`the crew's protocol has no ${verb} line, so this observation cannot send one`)
  const words = shape.parts.map((part) => {
    if ('word' in part) return part.word
    // A part that is one of a few words: a verdict's PASS or FAIL, and this observation sends a passing one.
    if ('oneOf' in part) return part.oneOf[0] ?? ''
    const value = values[part.name]
    if (value === undefined || !VALUE_SHAPES[part.value].matches.test(value)) {
      throw new Error(`the ${verb} line this observation builds carries no ${part.name}, or one the reader refuses`)
    }
    return value
  })
  const carried = shape.shown.range.map((key) => {
    const value = values[key]
    if (value === undefined || !VALUE_SHAPES[shape.keys[key] ?? 'number'].matches.test(value)) {
      throw new Error(`the ${verb} line this observation builds carries no ${key}, or one the reader refuses`)
    }
    return `${key}=${value}`
  })
  const line = [shape.verb, ...words, ...carried].join(' ')
  const read = readACrewLine(line)
  if (!('line' in read) || read.line === null) throw new Error(`the crew's own reader did not take ${JSON.stringify(line)}`)
  return line
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

/**
 * Whether this request is the one the subagent's own model answers: its first turn. A conversation that has not spoken
 * yet carries no assistant message, and the whole of it is the prompt the reviewer's agent tool was called with. The
 * prompt is looked for at the END of a user message, and the number of messages is not counted: the host puts its own
 * `<system-reminder>` ahead of the prompt and sends a system message beside it, so a reading that required one message
 * whose whole text was the prompt matched no request the host ever sent — and the subagent was answered at once, before
 * the builder could speak (review r=1).
 */
const theSubagentsRequest = (request: ModelRequest): boolean => {
  const messages = messagesOf(request)
  if (messages.some((message) => message['role'] === 'assistant')) return false
  return messages.some((message) => message['role'] === 'user' && textOfContent(message['content']).trimEnd().endsWith(SUBAGENTS_PROMPT))
}

/** Everything the model has been shown by this request, as one text: where a raised crew turn is looked for. */
const transcriptOf = (request: ModelRequest): string => JSON.stringify(request.body['messages'] ?? null)

/** Whether the model has already made a call of `tool` by this request. */
const hasCalled = (request: ModelRequest, tool: string): boolean => toolCallsIn(request).some((call) => call.tool === tool)

/** How long the subagent's own answer may wait for the builder's hand-off before the run answers without it. */
const THE_BUILDERS_HAND_OFF_SECONDS = 90

/** How long one look at the channel waits before looking again: short next to the launch it waits for. */
const WAIT_POLL_MS = 500

/**
 * Waits until the crew's channel holds a message from the builder, or the deadline passes, and answers whether it did.
 * This is what makes the order this observation is about true rather than hoped for (review r=1): the subagent's own
 * answer is held until the hand-off exists, so "the hand-off arrived while the subagent was running" is a fact the
 * run made, not a race it got away with. Whether it arrived is not read from this answer — the check compares the two
 * times the record carries — so a deadline that passes only means the subagent answered anyway, and that check says so
 * by name.
 */
async function waitForTheBuildersMessage(channel: ChannelHost): Promise<boolean> {
  const deadline = Date.now() + THE_BUILDERS_HAND_OFF_SECONDS * 1000
  while (Date.now() < deadline) {
    if (await theChannelHoldsTheBuildersMessage(channel)) return true
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS))
  }
  return false
}

/** One look at the crew's channel for a message from the builder; one that cannot be read yet says not yet. */
async function theChannelHoldsTheBuildersMessage(channel: ChannelHost): Promise<boolean> {
  try {
    const placed = await readTheChannel(channel)
    return placed.some((message) => message.message.from === BUILDER)
  } catch {
    return false
  }
}

/** The builder's turns: its hand-off, then the receipts once the verdict is back. */
const theBuildersScript = (request: ModelRequest): ScriptedTurn => {
  if (transcriptOf(request).includes(FRAME_OPENING)) return hasCalled(request, RECEIPTS) ? { text: 'Read the receipts.' } : { tool: RECEIPTS, input: {} }
  return hasCalled(request, SAY) ? { text: 'Handed it over, and I am waiting for the verdict.' } : { tool: SAY, input: { to: [REVIEWER], text: HANDOFF } }
}

/** The reviewer's turns: its subagent first, then the verdict once the builder's hand-off reaches it. */
const theReviewersScript =
  (channel: ChannelHost, startTheBuilder: () => void) =>
  async (request: ModelRequest): Promise<ScriptedTurn> => {
    if (theSubagentsRequest(request)) {
      await waitForTheBuildersMessage(channel)
      return { text: 'I looked it up: nothing to report.' }
    }
    if (request.number === 1) {
      startTheBuilder()
      return { tool: THE_HOSTS_AGENT_TOOL, input: { description: 'look one thing up', prompt: SUBAGENTS_PROMPT, subagent_type: AGENTS_KIND } }
    }
    if (!transcriptOf(request).includes(FRAME_OPENING)) return { text: 'Reported.' }
    return hasCalled(request, SAY) ? { text: 'The verdict is in.' } : { tool: SAY, input: { to: [BUILDER], text: VERDICT } }
  }

/** One member's launch: the real launcher on the recorded host, its own stand-in model, on the crew's own checkout. */
function aMemberWasStarted(place: WatchedPlace, member: string, ceiling: number, script: ModelScript, done: (requests: readonly ModelRequest[]) => boolean): Promise<MemberRan> {
  return aMemberRan(() =>
    driveTheRecordedHost({
      claude: theRecordedHost(),
      home: place.home,
      checkout: place.checkout,
      member,
      owner_turn: 'Do what the crew needs.',
      requests: ceiling,
      completesWhen: done,
      silence_ms: HOST_SILENCE_MS,
      script,
    }),
  )
}

/** The first line of why a launch stopped waiting: the rest of its message is the terminal it last showed. */
const whyItStopped = (ran: MemberRan): string => (ran.stopped === undefined ? '' : `; its launch stopped waiting: ${ran.stopped.split('\n')[0] ?? ''}`)

/** The crew's own streams, read the way the crew's own slices read them. */
const theCrewsChannel = (place: WatchedPlace): ChannelHost => ({
  clock: { now: () => Date.now() },
  stores: { rows: rowStreamsDirectory(crewRowsDirectoryOf(stateHomeUnder(place.home), place.checkout)) },
})

/** The one message a member sent that this observation reads, with the row the channel placed it at; or undefined. */
const theMessageFrom = (messages: readonly PlacedMessage[], from: string): PlacedMessage | undefined => messages.find((placed) => placed.message.from === from)

/**
 * How many of one request's messages carry the given frame (martha#253). The transcript grows with every request, so a
 * turn is counted inside ONE request: a message taken in once appears in every request after it, which is the
 * transcript working, not the message arriving again.
 */
const carryingIn = (request: ModelRequest, frame: string): number =>
  messagesOf(request).filter((message) => JSON.stringify(message).includes(frame)).length

/**
 * Whether the text carries the frame, whole (martha#253). The position and the message's own text are part of the frame,
 * so a shorter frame is not this one; what follows it is the host's to decide — the recorded host puts a newline and a
 * sentence of its own around a prompt a plugin submits.
 */
const framedIn = (text: string, frame: string): boolean => frame !== '' && text.includes(frame)

/**
 * The index of the request that carries the subagent's own answer, as the host raises it: the background agent's
 * report arrives as a turn of the member's session (martha#253: a message must not be taken in during the subagent's
 * turn, and must be after it).
 */
function theSubagentsAnswerIn(requests: readonly ModelRequest[]): number {
  return requests.findIndex((request) => messagesOf(request).some((message) => JSON.stringify(message).includes('<task-notification>')))
}

const work = anObservationDirectory()
const report = aReport()
let keptForReading: readonly string[] = []
/** Why the run could not be set up, when it could not: the case that exits 2 rather than reporting a failed check. */
let couldNotBeSetUp: string | undefined
try {
  const crew = aCheckoutToWatch(work, theConfigToApprove())
  const channel = theCrewsChannel(crew)
  let builders: Promise<MemberRan> | undefined
  const startTheBuilder = (): void => {
    builders ??= aMemberWasStarted(crew, BUILDER, BUILDERS_REQUESTS, theBuildersScript, (requests) => aCallAndItsResult(requests, RECEIPTS))
  }
  const reviewers = await aMemberWasStarted(crew, REVIEWER, REVIEWERS_REQUESTS, theReviewersScript(channel, startTheBuilder), (requests) => aCallAndItsResult(requests, SAY))
  if (builders === undefined) throw new Error('the reviewer never started the builder, so there was nobody to say the hand-off')
  const buildersRan = await builders

  const messages = await readTheChannel(channel)
  const handoff = theMessageFrom(messages, BUILDER)
  const verdict = theMessageFrom(messages, REVIEWER)
  const handoffFrame = handoff === undefined ? '' : framed(handoff.position, BUILDER, HANDOFF)
  const verdictFrame = verdict === undefined ? '' : framed(verdict.position, REVIEWER, VERDICT)
  const answeredIn = theSubagentsAnswerIn(reviewers.requests)
  const handoffFirstIn = handoffFrame === '' ? -1 : reviewers.requests.findIndex((request) => framedIn(JSON.stringify(request.body['messages']), handoffFrame))
  const handoffAfterAnswer = handoffFirstIn > answeredIn && answeredIn !== -1 && reviewers.requests.slice(handoffFirstIn).every((request) => carryingIn(request, handoffFrame) === 1)
  // The order proved, not assumed (review r=1): the subagent's own answer was held until the hand-off existed, so the
  // hand-off was said before that request was answered. Both times are this machine's clock, read either side of it.
  const theSubagentsAnswerAt = answeredIn === -1 ? undefined : reviewers.requests[answeredIn]?.received_at
  const theHandOffCameFirst = handoff !== undefined && theSubagentsAnswerAt !== undefined && handoff.message.sent_at < theSubagentsAnswerAt
  const verdictFirstIn = verdictFrame === '' ? -1 : buildersRan.requests.findIndex((request) => framedIn(JSON.stringify(request.body['messages']), verdictFrame))
  // Rows, not positions: a message taken in twice is two rows, and the set a receipt reads would show one (review r=1).
  const theReviewersRows = await tookInRowsOf(channel, REVIEWER)
  const theBuildersRows = await tookInRowsOf(channel, BUILDER)
  const theHandOffTakenIn = handoff === undefined ? [] : theReviewersRows.filter((position) => position === handoff.position)
  // What each member was shown and drew, kept with the directory a failed run leaves: a red is read from them.
  keptForReading = [
    keepTheRequests(work, 'the-reviewer', reviewers.requests),
    keepTheTerminal(work, 'the-reviewer', reviewers.shown),
    keepTheRequests(work, 'the-builder', buildersRan.requests),
    keepTheTerminal(work, 'the-builder', buildersRan.shown),
  ]

  report.check(
    'the builder said its hand-off, and the channel holds it for the reviewer',
    handoff !== undefined && handoff.message.text === HANDOFF && addressedTo(handoff.message, REVIEWER),
    handoff === undefined ? `the channel holds ${JSON.stringify(messages.map((placed) => placed.message.from))}${whyItStopped(buildersRan)}` : String(handoff.message.text),
  )
  report.check(
    'the hand-off reached the reviewer as one turn, after its own subagent had answered',
    handoffAfterAnswer && theHandOffCameFirst,
    `the reviewer sent the model ${reviewers.requests.length} requests; its subagent's answer arrived in request ${answeredIn + 1}, the hand-off first appeared in request ${handoffFirstIn + 1}; ` +
      `the hand-off was said at ${String(handoff?.message.sent_at)} and that request was answered at ${String(theSubagentsAnswerAt)}, so the hand-off ${theHandOffCameFirst ? 'was' : 'was not'} said while the subagent ran${whyItStopped(reviewers)}`,
  )
  report.check(
    'the reviewer took the hand-off in, once',
    theHandOffTakenIn.length === 1,
    `the rows the reviewer took in: ${JSON.stringify(theReviewersRows)}${whyItStopped(reviewers)}`,
  )
  report.check(
    'the reviewer said its verdict, and the channel holds it for the builder',
    verdict !== undefined && verdict.message.text === VERDICT && addressedTo(verdict.message, BUILDER),
    verdict === undefined ? `the channel holds no message from the reviewer${whyItStopped(reviewers)}` : String(verdict.message.text),
  )
  report.check(
    'the verdict reached the builder as one turn',
    verdictFirstIn !== -1 && carryingIn(buildersRan.requests[verdictFirstIn]!, verdictFrame) === 1 && buildersRan.requests.slice(verdictFirstIn).every((request) => carryingIn(request, verdictFrame) === 1),
    `the builder sent the model ${buildersRan.requests.length} requests; the verdict first appeared in request ${verdictFirstIn + 1}${whyItStopped(buildersRan)}`,
  )
  report.check(
    'the builder took the verdict in',
    verdict !== undefined && theBuildersRows.includes(verdict.position),
    `the rows the builder took in: ${JSON.stringify(theBuildersRows)}${whyItStopped(buildersRan)}`,
  )
  // The builder's own last request carries its receipts read, or nothing does: reading another member's request instead
  // would answer a question this check never asked (review r=1).
  const theBuildersLastRequest = buildersRan.requests.at(-1)
  const theReceiptsRead = theBuildersLastRequest === undefined ? undefined : theResultOfTheLastCallTo(theBuildersLastRequest, RECEIPTS)
  report.check(
    'the builder read its receipts, and they say the reviewer took the hand-off in',
    // Said, not not-said: the launcher's own line is "written, not yet taken in by <member>" until it is.
    theReceiptsRead !== undefined && theReceiptsRead.includes(`taken in by ${REVIEWER}`) && !theReceiptsRead.includes('not yet taken in'),
    theReceiptsRead === undefined ? `the builder's last request carries no receipts read${whyItStopped(buildersRan)}` : theReceiptsRead.slice(0, 300),
  )
  const stoppedIn = (ran: MemberRan, member: string): string | undefined => (plainTextOf(ran.shown).includes(theStoppedLine(member)) ? `${member}'s terminal shows it stopped` : undefined)
  const stops = [stoppedIn(reviewers, REVIEWER), stoppedIn(buildersRan, BUILDER)].filter((stop): stop is string => stop !== undefined)
  report.check('neither member was stopped', stops.length === 0, stops.length === 0 ? 'no stop line' : stops.join('; '))
  // A launch ends where its flow ends (its own completion, or the ceiling a host that keeps sending requests reaches),
  // so what must hold is that it got as far as the call its flow is about: not that it took its whole ceiling.
  const howItEnded = (ran: MemberRan, tool: string, wanted: number): string => {
    if (ran.stopped !== undefined) return `its launch stopped waiting: ${ran.stopped.split('\n')[0] ?? ''}`
    if (!aCallAndItsResult(ran.requests, tool)) return `${tool} was never answered: martha start ended (code ${String(ran.exit_code)}) after ${ran.requests.length} of the ${wanted} requests this run waits for`
    return ''
  }
  const ends = [howItEnded(reviewers, SAY, REVIEWERS_REQUESTS), howItEnded(buildersRan, RECEIPTS, BUILDERS_REQUESTS)].filter((why) => why !== '')
  report.check('both launches reached the step their flow is about', ends.length === 0, ends.length === 0 ? 'both were answered where the flow ends' : ends.join('; '))
} catch (error) {
  // A member that goes silent is a check above, not this (`aMemberRan` keeps it a record): only a failure to set the
  // run up ends the observation here, and that is the exit 2 both .sh headers promise (review r=2).
  couldNotBeSetUp = error instanceof Error ? error.message : String(error)
  report.check('the observation could be set up', false, `it stopped before its checks could run: ${couldNotBeSetUp}`)
}
// Each launch ends its own member, so there is nothing to stop here. A run with a failure keeps its directory for reading.

const status = report.end()
if (status !== 0 || couldNotBeSetUp !== undefined) console.log(`kept for reading: ${work}${keptForReading.length === 0 ? '' : `; kept for reading it: ${keptForReading.join(' ')}`}`)
else sweep([work])
process.exit(couldNotBeSetUp === undefined ? status : 2)
