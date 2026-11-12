// The first observation the crew owes (martha#251): a member's first mesh answer does not cost it the shell it needs.
//
// This exists so a person can watch, on the landed tree, the one thing no unit test can say: a real member, started by
// the real launcher on the recorded host with the strict shell gate on, may say hello to the mesh and then either run
// a command of its own or place the ring it was about to make. Every link before that was proved at core level; what
// was never seen is the whole of it in one launch.
//
// The launch is the real one: `martha init`, `martha approve` and `martha start` on the checkout this makes, the mesh
// server its approved config pins, and a peer on the mesh that answers a hello. Only the model is a stand-in
// (../src/launch_a_claude_code_member/drive_the_recorded_host). The strict gate is on, because a gate that is off can
// never refuse and would make this observation say nothing.
//
// TWO LAUNCHES, because the gate refuses executable text after a ring's answer, by design (martha#51: no node id hands a
// member executable text, so an owner relays a hand-off). One launch says hello and runs a command; the other says hello
// and rings the peer. Mixed into one, the command's own result (A13) would close the shell before the ring and the ring's
// answer would close it before the command, and neither check would be about the hello at all.
//
// What it prints: PASS or FAIL by name, the launch's name first. Everything it makes is one directory, removed when
// every check passed, and a run with a failure says where it kept it.
//
//   ./watch_a_live_launch/watch_a_member_keep_its_shell.sh

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { STRICT_GATE } from '../src/declare_crew/declare_crew.ts'
import { SOLO_MEMBERS } from '../src/declare_a_solo_crew/declare_a_solo_crew.ts'
import { driveTheRecordedHost, plainTextOf, type ModelRequest, type ScriptedTurn } from '../src/launch_a_claude_code_member/drive_the_recorded_host.ts'
import { HOST_SILENCE_MS } from '../src/launch_a_claude_code_member/wait_while_the_host_keeps_showing.ts'
import { MESH_HELLO, RINGS_AND_RETURNS_THE_ANSWER } from '../src/read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { ANSWERS_THAT_ANSWERED } from '../src/read_a_ring_results_sender/read_a_ring_results_sender.ts'
import { PATH_OF_SOURCE } from '../src/take_in_a_turn/take_in_a_turn.ts'
import {
  aCheckoutToWatch,
  anObservationDirectory,
  APeerOnTheMesh,
  aReport,
  nodeIdIn,
  rowsTheLauncherKept,
  sweep,
  theMeshServersCommand,
  theRecordedHost,
  theResultOfTheLastCallTo,
  type WatchedPlace,
} from './a_launch_to_watch.ts'

/** The name the observation's own config gives the mesh server: the host spells a tool `mcp__<server>__<tool>`. */
const MESH_SERVER_IN_THE_CHECKOUT = 'macula'

/** The newest mesh server this tree recorded: the version a member's pin names, never one typed here. */
const THE_SERVERS_COMMAND = theMeshServersCommand()

/** The member `martha init` declares first, and the one both launches start. */
const BUILDER = SOLO_MEMBERS[0].name

/** What the member's own command leaves in its home when the shell kept. Never in the checkout it works in: a file the
 * owner did not approve is a change the launch refuses (martha#132). */
const THE_FILES_NAME = 'the-shell-kept.txt'

/** The keys the ring tool takes, as the pinned server's own input schema names them. */
const RINGS_INPUT = { to: 'to', purpose: 'purpose', wait_join_seconds: 'wait_join_seconds' } as const

/** How the launcher words a stop, where it tells the owner one: `launch_a_claude_code_member.ts`'s own line. */
const stoppedLine = (member: string): string => `${member} is stopped`

/** The call the host makes of one of the mesh's tools. */
const called = (tool: string): string => `mcp__${MESH_SERVER_IN_THE_CHECKOUT}__${tool}`

/** The approved config both launches start on. */
function theConfigToApprove(): { settings: unknown; servers: unknown; house_rules: Record<string, unknown> } {
  return {
    settings: { permissions: { defaultMode: 'default', allow: ['Bash', called(MESH_HELLO), called(RINGS_AND_RETURNS_THE_ANSWER)] } },
    servers: { mcpServers: { [MESH_SERVER_IN_THE_CHECKOUT]: { type: 'stdio', command: THE_SERVERS_COMMAND[0], args: THE_SERVERS_COMMAND.slice(1) } } },
    house_rules: { [STRICT_GATE]: true },
  }
}

/** The ring's own result as the model was shown it, read into the two keys this observation asks about. */
function aRingAnswer(text: string | undefined): { readonly answer?: unknown; readonly to?: unknown } {
  try {
    const parsed: unknown = JSON.parse(text ?? '')
    return typeof parsed === 'object' && parsed !== null ? (parsed as { answer?: unknown; to?: unknown }) : {}
  } catch {
    return {}
  }
}

/** The turn this launch's member makes at request `number`: a hello first, always. */
const helloThen = (after: (number: number) => ScriptedTurn) => (request: ModelRequest): ScriptedTurn =>
  request.number === 1 ? { tool: called(MESH_HELLO), input: {} } : after(request.number)

/** A command of the member's own, then text that ends the turn. */
const theCommandOfItsOwn = (number: number): ScriptedTurn =>
  number === 2 ? { tool: 'Bash', input: { command: `touch "$HOME/${THE_FILES_NAME}" && echo ran` } } : { text: 'Done.' }

/** The ring to the peer, then text that ends the turn. */
const theRing = (peer: string) => (number: number): ScriptedTurn =>
  number === 2
    ? { tool: called(RINGS_AND_RETURNS_THE_ANSWER), input: { [RINGS_INPUT.to]: peer, [RINGS_INPUT.purpose]: 'the martha#251 observation', [RINGS_INPUT.wait_join_seconds]: 0 } }
    : { text: 'Done.' }

/** What one launch leaves for the checks: the terminal, the record, and the last request the model was sent. */
interface Launched {
  readonly shown: string
  readonly kept: ReturnType<typeof rowsTheLauncherKept>
  readonly last: ModelRequest
}

/** One launch of the member, on its own fresh checkout. */
async function oneLaunch(work: string, script: (request: ModelRequest) => ScriptedTurn, requests: number): Promise<{ readonly place: WatchedPlace; readonly launched: Launched }> {
  const place = aCheckoutToWatch(work, theConfigToApprove())
  const ran = await driveTheRecordedHost({
    claude: theRecordedHost(),
    home: place.home,
    checkout: place.checkout,
    member: BUILDER,
    owner_turn: 'Say hello to the mesh, then do what I asked.',
    requests,
    silence_ms: HOST_SILENCE_MS,
    script,
  })
  const last = ran.requests[ran.requests.length - 1]
  if (last === undefined) throw new Error('the member sent the model no request, so there is nothing to read')
  return { place, launched: { shown: plainTextOf(ran.shown), kept: rowsTheLauncherKept(place), last } }
}

const work = anObservationDirectory()
const report = aReport()
let peer: APeerOnTheMesh | undefined
try {
  peer = await new APeerOnTheMesh(THE_SERVERS_COMMAND, join(work, 'peer'), 'martha-251-observation-peer').start()
  const peerId = nodeIdIn(await peer.tool(MESH_HELLO, {}))
  if (peerId === undefined) throw new Error('the peer on the mesh said no hello, so there is no crew mate to ring')

  const shell = await oneLaunch(join(work, 'shell'), helloThen(theCommandOfItsOwn), 3)
  const meaning = shell.launched.kept.filter((ingestion) => ingestion.path === PATH_OF_SOURCE.mcp_result)
  report.check(
    'shell: the first mesh answer takes nothing in',
    meaning.length === 0,
    meaning.length === 0 ? `no row on ${PATH_OF_SOURCE.mcp_result}; the launcher kept ${JSON.stringify(shell.launched.kept)}` : `the hello's answer was taken in as words: ${JSON.stringify(meaning)}`,
  )
  report.check(
    'shell: the member kept its shell after saying hello',
    existsSync(join(shell.place.home, THE_FILES_NAME)),
    `${THE_FILES_NAME} ${existsSync(join(shell.place.home, THE_FILES_NAME)) ? 'is' : 'is not'} in its home`,
  )
  report.check('shell: the member was not stopped', !shell.launched.shown.includes(stoppedLine(BUILDER)), shell.launched.shown.includes(stoppedLine(BUILDER)) ? 'the terminal shows a stop' : 'no stop line')

  const ring = await oneLaunch(join(work, 'ring'), helloThen(theRing(peerId)), 3)
  const answer = aRingAnswer(theResultOfTheLastCallTo(ring.launched.last, called(RINGS_AND_RETURNS_THE_ANSWER)))
  const onTheAnswerRow = ring.launched.kept.filter((ingestion) => ingestion.path === PATH_OF_SOURCE.ring_answer)
  report.check(
    'ring: the ring was placed, and the crew mate answered it',
    ANSWERS_THAT_ANSWERED.includes(Number(answer.answer)) && answer.to === peerId,
    `the ring's result: ${String(theResultOfTheLastCallTo(ring.launched.last, called(RINGS_AND_RETURNS_THE_ANSWER))).slice(0, 400)}`,
  )
  report.check(
    "ring: the ring's answer is recorded with the crew mate's node id",
    onTheAnswerRow.some((ingestion) => ingestion.from_node_id === peerId),
    onTheAnswerRow.length === 0 ? `no row on ${PATH_OF_SOURCE.ring_answer}` : JSON.stringify(onTheAnswerRow),
  )
  report.check('ring: the member was not stopped', !ring.launched.shown.includes(stoppedLine(BUILDER)), ring.launched.shown.includes(stoppedLine(BUILDER)) ? 'the terminal shows a stop' : 'no stop line')
} finally {
  peer?.stop()
}

const status = report.end()
if (status !== 0) console.log(`kept for reading: ${work}`)
else sweep([work])
process.exit(status)
