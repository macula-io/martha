import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ARGUMENT_GATES, ASK_GATES, DELIVERY_GATES, INBOUND_PATHS, LAUNCH_GATES, type InboundPath } from '../inbound_paths/inbound_paths.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import {
  admitsLaunch,
  fingerprintOf,
  LAUNCH_FILES_OF_HOST,
  type LaunchGate,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import {
  recordIngestion,
  refuseExecutionAfterUngatedText,
  startFreshSession,
  type Policy,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { CLAUDE_CODE_SESSION_EVENTS, CREW_REFRESH } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { CLAUDE_CODE_PROMPT_ORIGINS } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import { ARGUMENT_PROBES, claimsTheShellGate, CONFIG_PATH_PROBES, gapsInConfigPathCoverage, gapsInGateCoverage, gapsInMeshAnswerShapes, gapsInMeshTools, gapsInPromptOrigins, gapsInRingResultKeys, gapsInSessionEvents, LAUNCH_PROBES, PATH_PROBES, shellGateRowsNothingRecords, type ConfigPathProbe, type PathGate, type PathProbe } from './check_every_path_is_gated.ts'
import { PATH_OF_SOURCE, REGISTRY_ROWS_THAT_ARE_NOT_TURN_SOURCES } from '../take_in_a_turn/take_in_a_turn.ts'
import { RECORDED_MESH_SERVERS, type RecordedMeshServer } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { MESH_TOOLS_REFUSED, MESH_TOOLS_THAT_RUN, MESH_TOOL_PREFIX, sourceOfAMeshToolResult } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { RECORDED_RING_RESULT_KEYS, RING_RESULT_KEYS, type RecordedRingResultKeys } from '../read_a_ring_results_sender/read_a_ring_results_sender.ts'
import { ADMITS, MESH_GOODBYE, MESH_HELLO, RECORDED_MESH_ANSWER_SHAPES, type RecordedMeshAnswerShape } from '../prove_a_mesh_answer_is_wordless/prove_a_mesh_answer_is_wordless.ts'
import { admitsAWriteNoLaterGitRunReads } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'

const policy: Policy = { may_send_executable_text: [] }

// Synthetic, never a real node id: this repository is public.
const stranger = 'b'.repeat(64)

// The gate this check drives. If the gate stops refusing, the check goes red.
const gateRefuses = (path: string) =>
  refuseExecutionAfterUngatedText({
    tool: 'Bash',
    session: recordIngestion(startFreshSession(), [{ path, from_node_id: stranger }]),
    policy,
  }).allow === false

// The path gate this check drives, as the launcher holds it (martha#168). It is
// passed in, not defaulted: the gate reads the machine, and the register may not
// import the host adapter that holds it.
const PATH_GATES: Readonly<Record<string, PathGate>> = { 'nothing-a-later-git-run-reads': admitsAWriteNoLaterGitRunReads }

// The coverage check, driving the real path gate unless a test says otherwise.
const coverageOf = (
  paths: readonly InboundPath[],
  refuses: (path: string) => boolean,
  delivery: Parameters<typeof gapsInGateCoverage>[2] = DELIVERY_GATES,
  launch: Parameters<typeof gapsInGateCoverage>[3] = LAUNCH_GATES,
  argument: Parameters<typeof gapsInGateCoverage>[4] = ARGUMENT_GATES,
  path: Readonly<Record<string, PathGate>> = PATH_GATES,
  ask: Parameters<typeof gapsInGateCoverage>[7] = ASK_GATES,
) => gapsInGateCoverage(paths, refuses, delivery, launch, argument, path, undefined, ask)

test('every inbound path the table names is in the registry, exactly once', () => {
  const expected = [
    ...Array.from({ length: 21 }, (_, index) => `A${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `B${index + 1}`),
    ...Array.from({ length: 2 }, (_, index) => `C${index + 1}`),
  ]
  const seen = INBOUND_PATHS.map((path) => path.id).sort()
  assert.deepEqual(seen, [...expected].sort())
})

test('the registry as shipped has no path without a control', () => {
  assert.deepEqual(coverageOf(INBOUND_PATHS, gateRefuses), [])
})

test('a planted path with no control makes the check fail, and it names that path', () => {
  const planted: InboundPath = {
    id: 'A99',
    what: 'a planted path nobody gated',
    klass: 'delivered',
    control: { kind: 'none' },
    attestation: 'none',
  }
  const gaps = coverageOf([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A99'],
  )
})

test('a planted path whose control was left out altogether makes the check fail', () => {
  const planted = {
    id: 'B99',
    what: 'a planted path with the control field forgotten',
    klass: 'fetched',
  } as unknown as InboundPath
  const gaps = coverageOf([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['B99'],
  )
})

test('a path that claims the shell gate must really be refused by it', () => {
  const lying: InboundPath = {
    id: 'A98',
    what: 'a path claiming cover it does not have',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  }
  const gaps = coverageOf([...INBOUND_PATHS, lying], (path) => path !== 'A98')
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A98'],
  )
})

test('a delivery gate nobody has built is not a control', () => {
  const invented = {
    id: 'A97',
    what: 'a path naming a gate that does not exist',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'a-gate-someone-will-write-later' },
  } as unknown as InboundPath
  const gaps = coverageOf([...INBOUND_PATHS, invented], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A97'],
  )
})

test('a path excused from the model must say why in words', () => {
  const excused: InboundPath = {
    id: 'B98',
    what: 'a path excused without a reason',
    klass: 'fetched',
    control: { kind: 'no-text-reaches-the-model', why: '   ' },
    attestation: 'none',
  }
  const gaps = coverageOf([...INBOUND_PATHS, excused], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['B98'],
  )
})

test('a delivery gate that admits everyone is not a control either', () => {
  const gaps = coverageOf(INBOUND_PATHS, gateRefuses, {
    'crew-room-acceptance': () => true,
    'shared-room-acceptance': () => true,
  })
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A1', 'A2', 'A3'],
  )
  assert.match(gaps[0]?.why ?? '', /admits a message nobody attested/)
})

test('a delivery gate that refuses everyone is caught too', () => {
  const gaps = coverageOf(INBOUND_PATHS, gateRefuses, {
    'crew-room-acceptance': () => false,
    'shared-room-acceptance': () => false,
  })
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A1', 'A2', 'A3'],
  )
  assert.match(gaps[0]?.why ?? '', /refuses a rostered member/)
})

test('a gate that answers only the roster question is caught: one question right is not a control', () => {
  const roster_only = ({ message, rosters }: { message: { from_node_id: string | null }; rosters: { crew: { member_node_ids: readonly string[] } } }) =>
    message.from_node_id !== null && rosters.crew.member_node_ids.includes(message.from_node_id)

  const gaps = coverageOf(INBOUND_PATHS, gateRefuses, {
    'crew-room-acceptance': roster_only as never,
    'shared-room-acceptance': roster_only as never,
  })

  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A1', 'A2', 'A3'],
  )
  assert.match(gaps[0]?.why ?? '', /admits a message nobody attested/)
})

// --- the ask a member queued, handed to the session that offers it (martha#313) ---

test('an ask gate that admits every ask is not a control', () => {
  const gaps = coverageOf(INBOUND_PATHS, gateRefuses, undefined, undefined, undefined, undefined, { 'a-crews-own-asker': () => true })
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A21'],
  )
  assert.match(gaps[0]?.why ?? '', /admits an ask whose asker is not a member this crew started/)
})

test('an ask gate that refuses every ask is caught too', () => {
  const gaps = coverageOf(INBOUND_PATHS, gateRefuses, undefined, undefined, undefined, undefined, { 'a-crews-own-asker': () => false })
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A21'],
  )
  assert.match(gaps[0]?.why ?? '', /refuses an ask from a member this crew started/)
})

test('a row naming an ask gate nobody has built is named', () => {
  const invented: InboundPath = {
    id: 'A98',
    what: 'an ask gate someone will write later',
    klass: 'delivered',
    control: { kind: 'ask-gate', gate: 'a-gate-someone-will-write-later' },
    attestation: 'none',
  } as unknown as InboundPath
  assert.deepEqual(
    coverageOf([...INBOUND_PATHS, invented], gateRefuses).map((gap) => gap.path),
    ['A98'],
  )
})

test('an ask gate on the wrong kind of row is a gap, since an ask is text put into a turn', () => {
  const fetched: InboundPath = {
    id: 'B98',
    what: 'an ask gate where nothing is delivered',
    klass: 'fetched',
    control: { kind: 'ask-gate', gate: 'a-crews-own-asker' },
    attestation: 'none',
  }
  assert.deepEqual(
    coverageOf([...INBOUND_PATHS, fetched], gateRefuses).map((gap) => gap.path),
    ['B98'],
  )
})

// --- code the host starts by itself (issue #16) --------------------------------

// The rows the launch gate stands on: code the host starts by itself, and the text handed from bytes the owner
// approved (martha#306). A gate that fails a question fails every one of them.
const LAUNCHED = INBOUND_PATHS.filter((path) => path.klass === 'launched' || path.control.kind === 'approved-text').map((path) => path.id)

const withLaunchGates = (gate: LaunchGate) =>
  coverageOf(INBOUND_PATHS, gateRefuses, undefined, { 'owner-approved-launch-config': gate })

test('the registry has launched rows, and every one of them stands on the launch gate', () => {
  assert.notDeepEqual(LAUNCHED, [])
  for (const path of INBOUND_PATHS.filter((row) => row.klass === 'launched')) {
    assert.equal(path.control.kind, 'launch-gate', path.id)
  }
})

test('a planted launched path with no control makes the check fail, and it names that path', () => {
  const planted: InboundPath = {
    id: 'C99',
    what: 'a planted copy of a launched path, with control none',
    klass: 'launched',
    control: { kind: 'none' },
    attestation: 'none',
  }
  const gaps = coverageOf([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['C99'],
  )
})

test('a launched path claiming the shell gate is a gap, even though the shell gate refuses its id', () => {
  const planted: InboundPath = {
    id: 'C98',
    what: 'a launched path claiming the shell gate',
    klass: 'launched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  }
  assert.equal(gateRefuses('C98'), true)
  const gaps = coverageOf([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['C98'],
  )
  assert.match(gaps[0]?.why ?? '', /starts by itself/)
})

test('a launched path claiming a delivery gate is a gap too', () => {
  const planted: InboundPath = {
    id: 'C97',
    what: 'a launched path claiming a delivery gate',
    klass: 'launched',
    control: { kind: 'delivery-gate', gate: 'crew-room-acceptance' },
    attestation: 'none',
  }
  const gaps = coverageOf([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['C97'],
  )
})

test('a launch gate on a path the host does not start is a gap', () => {
  const planted: InboundPath = {
    id: 'A96',
    what: 'a delivered path claiming the launch gate',
    klass: 'delivered',
    control: { kind: 'launch-gate', gate: 'owner-approved-launch-config', residual: 'a residual' },
    attestation: 'none',
  }
  const gaps = coverageOf([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A96'],
  )
})

test('a launch gate nobody has built is not a control', () => {
  const invented = {
    id: 'C96',
    what: 'a launched path naming a gate that does not exist',
    klass: 'launched',
    control: { kind: 'launch-gate', gate: 'a-gate-someone-will-write-later', residual: 'a residual' },
    attestation: 'none',
  } as unknown as InboundPath
  const gaps = coverageOf([...INBOUND_PATHS, invented], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['C96'],
  )
  assert.match(gaps[0]?.why ?? '', /nobody has built/)
})

test('a launched path must say in words what happens where Martha does not start the host', () => {
  const silent: InboundPath = {
    id: 'C95',
    what: 'a launched path with no residual',
    klass: 'launched',
    control: { kind: 'launch-gate', gate: 'owner-approved-launch-config', residual: '  ' },
    attestation: 'none',
  }
  const gaps = coverageOf([...INBOUND_PATHS, silent], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['C95'],
  )
})

test('a launch gate that admits everyone is not a control', () => {
  const gaps = withLaunchGates(() => true)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits config the owner has not approved/)
})

test('a launch gate that refuses everyone is caught too', () => {
  const gaps = withLaunchGates(() => false)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /refuses config the owner approved/)
})

// The mistakes a launch gate could make while still answering most questions
// right. Each is the real gate with one rule taken out, so only that rule's
// probe can catch it.

const [SERVERS] = LAUNCH_FILES_OF_HOST['claude-code']

test('a gate that approves by file name, not content, is caught', () => {
  const by_name: LaunchGate = (request) =>
    admitsLaunch(request) ||
    (Object.hasOwn(LAUNCH_FILES_OF_HOST, request.host) &&
      request.entries.every((entry) => entry.kind === 'absent' || (entry.kind === 'file' && entry.path === SERVERS)) &&
      request.approved_fingerprints.length > 0)
  const gaps = withLaunchGates(by_name)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits an approved file whose content changed under the same name/)
})

test('a gate that only looks at the checkout itself, not the directories above, is caught', () => {
  const here_only: LaunchGate = (request) =>
    admitsLaunch({ ...request, entries: request.entries.filter((entry) => !entry.path.startsWith('../')) })
  const gaps = withLaunchGates(here_only)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits a config one directory up/)
})

test('a gate that trusts an approved symlink is caught', () => {
  const trusts_links: LaunchGate = (request) =>
    admitsLaunch(request) ||
    (Object.hasOwn(LAUNCH_FILES_OF_HOST, request.host) &&
      request.tree !== null &&
      request.approved_fingerprints.includes(fingerprintOf(request)))
  const gaps = withLaunchGates(trusts_links)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits a symlink/)
})

test('a gate that lets a host it has no file list for start is caught', () => {
  const any_host: LaunchGate = (request) =>
    admitsLaunch(request) || !Object.hasOwn(LAUNCH_FILES_OF_HOST, request.host)
  const gaps = withLaunchGates(any_host)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits a host it has no file list for/)
})

test('a gate that takes an empty read for an empty checkout is caught', () => {
  const trusts_empty: LaunchGate = (request) =>
    admitsLaunch(request) || (Object.hasOwn(LAUNCH_FILES_OF_HOST, request.host) && request.entries.length === 0)
  const gaps = withLaunchGates(trusts_empty)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits a request whose config was never read/)
})

// --- every session event the host emits is declared ---------------------------

// The Claude Code host's own list is derived and checked in ../claude_code_host;
// these plant a host whose emitted events are exactly what its declaration lists.
const EMITTED = Object.keys(CLAUDE_CODE_SESSION_EVENTS.events)

test('a host that emits exactly what it declares has no gaps', () => {
  assert.deepEqual(gapsInSessionEvents(CLAUDE_CODE_SESSION_EVENTS, EMITTED), [])
})

test('a planted session event the declaration does not list turns the check red, by name', () => {
  const gaps = gapsInSessionEvents(CLAUDE_CODE_SESSION_EVENTS, [...EMITTED, 'resume_fork'])
  assert.equal(gaps.length, 1)
  assert.match(gaps[0]?.path ?? '', /resume_fork/)
})

test('a declared session event the host stops emitting turns the check red, by name', () => {
  const emitted = EMITTED.filter((event) => event !== CREW_REFRESH)
  const gaps = gapsInSessionEvents(CLAUDE_CODE_SESSION_EVENTS, emitted)
  assert.equal(gaps.length, 1)
  assert.match(gaps[0]?.path ?? '', /crew_refresh/)
})

const STAMPED = Object.keys(CLAUDE_CODE_PROMPT_ORIGINS.sources)

test('a host that stamps exactly the origin kinds it declares has no gaps', () => {
  assert.deepEqual(gapsInPromptOrigins(CLAUDE_CODE_PROMPT_ORIGINS, STAMPED), [])
})

test('a planted origin kind the declaration does not map turns the check red, by name', () => {
  const gaps = gapsInPromptOrigins(CLAUDE_CODE_PROMPT_ORIGINS, [...STAMPED, 'session-inbox'])
  assert.deepEqual(gaps.map((gap) => gap.path), ['prompt origin session-inbox on claude-code'])
  assert.match(gaps[0]?.why ?? '', /does not say which source/)
})

test('a declared origin kind the host stops stamping turns the check red, by name', () => {
  const gaps = gapsInPromptOrigins(CLAUDE_CODE_PROMPT_ORIGINS, STAMPED.filter((kind) => kind !== 'bridge'))
  assert.deepEqual(gaps.map((gap) => gap.path), ['prompt origin bridge on claude-code'])
  assert.match(gaps[0]?.why ?? '', /never stamps it/)
})

// --- every tool the mesh server registers is decided (martha#2, item 5 (c)) --
//
// Against every recorded version at once (martha#49): a tool any of them
// registers is decided, and a decided name none of them registers is a gap.

const NEWEST = RECORDED_MESH_SERVERS[RECORDED_MESH_SERVERS.length - 1] as RecordedMeshServer
const UNRECORDED = '999.0.0'
const withTools = (tools: readonly string[]): readonly RecordedMeshServer[] => [{ ...NEWEST, tools }]
const recordedTools = [...new Set(RECORDED_MESH_SERVERS.flatMap((recorded) => recorded.tools))].sort()

test('every tool any recorded mesh server registers is either allowed or refused, and nothing else is named', () => {
  assert.deepEqual(gapsInMeshTools(), [])
})

test('a tool the server adds, neither allowed nor refused, is named', () => {
  const added = `${MESH_TOOL_PREFIX}read_everything_new`
  const gaps = gapsInMeshTools(withTools([...NEWEST.tools, added]))
  assert.deepEqual(gaps.map((gap) => gap.path), [`mesh tool ${added}`])
  assert.match(gaps[0]?.why ?? '', /neither allowed nor refused/)
})

test('a planted record of a version nobody recorded, with a tool nobody decided, is named with its version', () => {
  const added = `${MESH_TOOL_PREFIX}read_everything_new`
  const planted: RecordedMeshServer = { ...NEWEST, server_version: UNRECORDED, tools: [...NEWEST.tools, added] }
  const gaps = gapsInMeshTools([...RECORDED_MESH_SERVERS, planted])
  assert.deepEqual(gaps.map((gap) => gap.path), [`mesh tool ${added}`])
  assert.ok(gaps[0]?.why.includes(`${NEWEST.server} ${UNRECORDED}`), gaps[0]?.why ?? '')
})

test('with two versions recorded, a tool only the newer one registers must be decided too', () => {
  const added = `${MESH_TOOL_PREFIX}only_in_the_newer`
  const older: RecordedMeshServer = { ...NEWEST, server_version: '0.0.1' }
  const newer: RecordedMeshServer = { ...NEWEST, server_version: UNRECORDED, tools: [...NEWEST.tools, added] }
  const gaps = gapsInMeshTools([older, newer])
  assert.deepEqual(gaps.map((gap) => gap.path), [`mesh tool ${added}`])
  assert.ok(gaps[0]?.why.includes(UNRECORDED), gaps[0]?.why ?? '')
})

test('a version recorded twice is named', () => {
  const gaps = gapsInMeshTools([NEWEST, NEWEST])
  assert.deepEqual(gaps.map((gap) => gap.path), [`mesh server ${NEWEST.server} ${NEWEST.server_version}`])
  assert.match(gaps[0]?.why ?? '', /recorded twice/)
})

test('an allowed name no recorded server registers is named', () => {
  const [gone] = MESH_TOOLS_THAT_RUN
  const gaps = gapsInMeshTools(withTools(NEWEST.tools.filter((tool) => tool !== gone)))
  assert.deepEqual(gaps.map((gap) => gap.path), [`mesh tool ${gone}`])
  assert.match(gaps[0]?.why ?? '', /allowed, and no recorded server registers it/)
})

test('a refused name no recorded server registers is named', () => {
  const [gone] = MESH_TOOLS_REFUSED
  const gaps = gapsInMeshTools(withTools(NEWEST.tools.filter((tool) => tool !== gone)))
  assert.deepEqual(gaps.map((gap) => gap.path), [`mesh tool ${gone}`])
  assert.match(gaps[0]?.why ?? '', /refused, and no recorded server registers it/)
})

test('a name the retired version alone registered is named once its record is gone', () => {
  const [gone] = MESH_TOOLS_THAT_RUN
  assert.ok(gone !== undefined)
  const retiring: RecordedMeshServer = { ...NEWEST, server_version: '0.0.1' }
  const staying: RecordedMeshServer = { ...NEWEST, tools: NEWEST.tools.filter((tool) => tool !== gone) }
  assert.deepEqual(gapsInMeshTools([retiring, staying]), [])
  assert.deepEqual(gapsInMeshTools([staying]).map((gap) => gap.path), [`mesh tool ${gone}`])
})

test('a recorded tool without the mesh prefix is named: the prefix is the run-time hinge', () => {
  const unprefixed = 'read_everything_new'
  const gaps = gapsInMeshTools(withTools([...NEWEST.tools, unprefixed]))
  assert.ok(gaps.some((gap) => gap.path === `mesh tool ${unprefixed}` && new RegExp(MESH_TOOL_PREFIX).test(gap.why)))
})

test('a recorded mesh tool whose name holds __ is named: the last-__ split would judge only its tail', () => {
  const joined = `${MESH_TOOL_PREFIX}read__inbox`
  const gaps = gapsInMeshTools(withTools([...NEWEST.tools, joined]), [...MESH_TOOLS_THAT_RUN], [...MESH_TOOLS_REFUSED, joined])
  assert.deepEqual(gaps.map((gap) => gap.path), [`mesh tool ${joined}`])
  assert.match(gaps[0]?.why ?? '', /holds __/)
})

test('a name both allowed and refused is named', () => {
  const [both] = MESH_TOOLS_REFUSED
  assert.ok(both !== undefined)
  const gaps = gapsInMeshTools(RECORDED_MESH_SERVERS, [...MESH_TOOLS_THAT_RUN, both], MESH_TOOLS_REFUSED)
  assert.deepEqual(gaps.map((gap) => gap.path), [`mesh tool ${both}`])
  assert.match(gaps[0]?.why ?? '', /both allowed and refused/)
})

test('a gate that pins the config but not the checkout it runs is caught', () => {
  const approved_tree = LAUNCH_PROBES[0]?.request.tree ?? null
  const config_only: LaunchGate = (request) =>
    admitsLaunch({ ...request, tree: request.tree === null ? null : approved_tree })
  const gaps = withLaunchGates(config_only)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits an approved config whose checkout changed under it/)
})

test('the allowed and refused mesh tools together are exactly the recorded tools, each once', () => {
  const decided = [...MESH_TOOLS_THAT_RUN, ...MESH_TOOLS_REFUSED].sort()
  assert.deepEqual(decided, recordedTools)
})

/** The registry's rows that name an argument gate: the words an owner hands the host through martha start. */
const ARGUMENT_ROWS = INBOUND_PATHS.filter((path) => path.control.kind === 'refused-before-launch').map((path) => path.id)

test('the owner\'s words to martha start are a row, and an argument gate stands on it', () => {
  assert.deepEqual(ARGUMENT_ROWS, ['A15'])
})

test('an argument gate that passes every word to the host is not a control', () => {
  const gaps = coverageOf(INBOUND_PATHS, gateRefuses, DELIVERY_GATES, LAUNCH_GATES, { 'owner-arguments-load-no-config': () => true })
  assert.deepEqual(gaps.map((gap) => gap.path), ARGUMENT_ROWS)
  assert.match(gaps[0]?.why ?? '', /passes/)
})

test('an argument gate that refuses every word, none included, is caught too', () => {
  const gaps = coverageOf(INBOUND_PATHS, gateRefuses, DELIVERY_GATES, LAUNCH_GATES, { 'owner-arguments-load-no-config': () => false })
  assert.deepEqual(gaps.map((gap) => gap.path), ARGUMENT_ROWS)
  assert.match(gaps[0]?.why ?? '', /refuses no arguments at all/)
})

test('an argument gate that knows only one config switch is caught: one question right is not a control', () => {
  const settings_only = (args: readonly string[]) => !args.includes('--settings')
  const gaps = coverageOf(INBOUND_PATHS, gateRefuses, DELIVERY_GATES, LAUNCH_GATES, { 'owner-arguments-load-no-config': settings_only })
  assert.deepEqual(gaps.map((gap) => gap.path), ARGUMENT_ROWS)
})

test('a row naming an argument gate nobody built is a gap, by name', () => {
  const invented: InboundPath = {
    id: 'A97',
    what: 'a planted path naming an argument gate that does not exist',
    klass: 'delivered',
    control: { kind: 'refused-before-launch', gate: 'nobody-built-this' as never },
    attestation: 'none',
  }
  const gaps = coverageOf([...INBOUND_PATHS, invented], gateRefuses)
  assert.deepEqual(gaps, [{ path: 'A97', why: 'names an argument gate nobody has built: nobody-built-this' }])
})

test('the shipped argument gate answers every probe as the probe expects', () => {
  for (const probe of ARGUMENT_PROBES) {
    assert.equal(ARGUMENT_GATES['owner-arguments-load-no-config'](probe.args), probe.passes, probe.what)
  }
})

// --- every shell-gate row is reached by a recording (martha#121) -------------------

const SHELL_GATE_ROWS = INBOUND_PATHS.filter((path) => claimsTheShellGate(path.control)).map((path) => path.id)

test('a shell-gate row nothing records is a gap, named; recording every one leaves none', () => {
  const undeclared = SHELL_GATE_ROWS.filter((id) => !REGISTRY_ROWS_THAT_ARE_NOT_TURN_SOURCES.includes(id))
  assert.deepEqual(shellGateRowsNothingRecords(undeclared), [])
  for (const missing of SHELL_GATE_ROWS.filter((id) => !REGISTRY_ROWS_THAT_ARE_NOT_TURN_SOURCES.includes(id))) {
    const gaps = shellGateRowsNothingRecords(undeclared.filter((id) => id !== missing))
    assert.deepEqual(gaps.map((gap) => gap.path), [missing], missing)
    assert.match(gaps[0]?.why ?? '', /nothing the host records/)
  }
})

test('a planted shell-gate row nobody records fails the check by its name', () => {
  const planted: InboundPath = { id: 'A97', what: 'a planted path', klass: 'delivered', control: { kind: 'shell-gate' }, attestation: 'none' }
  const undeclared = SHELL_GATE_ROWS.filter((id) => !REGISTRY_ROWS_THAT_ARE_NOT_TURN_SOURCES.includes(id))
  assert.deepEqual(
    shellGateRowsNothingRecords(undeclared, [...INBOUND_PATHS, planted]).map((gap) => gap.path),
    ['A97'],
  )
})

test('a row declared no turn source that a host records anyway is a gap: the declaration is false', () => {
  const declared = REGISTRY_ROWS_THAT_ARE_NOT_TURN_SOURCES.find((id) => SHELL_GATE_ROWS.includes(id))
  assert.ok(declared !== undefined)
  const undeclared = SHELL_GATE_ROWS.filter((id) => !REGISTRY_ROWS_THAT_ARE_NOT_TURN_SOURCES.includes(id))
  const gaps = shellGateRowsNothingRecords([...undeclared, declared])
  assert.deepEqual(gaps.map((gap) => gap.path), [declared])
  assert.match(gaps[0]?.why ?? '', /declared no turn source/)
})

test('rows of other controls are never asked to be recorded', () => {
  const others = INBOUND_PATHS.filter((path) => !claimsTheShellGate(path.control))
  assert.ok(others.length > 0)
  assert.deepEqual(shellGateRowsNothingRecords([], others), [])
})

// --- a member's file tools are checked path by path (martha#168) -------------------

test('the shipped path gate answers every probe as the probe expects', () => {
  for (const probe of PATH_PROBES) {
    assert.equal(admitsAWriteNoLaterGitRunReads(probe), probe.admits, probe.what)
  }
})

test('a path gate that admits everything, and one that refuses everything, are both caught', () => {
  const admitsAll: PathGate = () => true
  const refusesAll: PathGate = () => false
  assert.deepEqual(
    coverageOf(INBOUND_PATHS, gateRefuses, DELIVERY_GATES, LAUNCH_GATES, ARGUMENT_GATES, { 'nothing-a-later-git-run-reads': admitsAll }).map((gap) => gap.why),
    ['the gate nothing-a-later-git-run-reads admits the checkout\'s own git directory'],
  )
  assert.deepEqual(
    coverageOf(INBOUND_PATHS, gateRefuses, DELIVERY_GATES, LAUNCH_GATES, ARGUMENT_GATES, { 'nothing-a-later-git-run-reads': refusesAll }).map((gap) => gap.why),
    ['the gate nothing-a-later-git-run-reads refuses an ordinary file in the checkout'],
  )
})

test('a row naming a path gate nobody built is a gap, by name', () => {
  const invented: InboundPath = {
    id: 'A97',
    what: 'a planted path naming a path gate that does not exist',
    klass: 'delivered',
    control: { kind: 'check_every_path_is_gated', gate: 'nobody-built-this' as never, also: [] },
    attestation: 'none',
  }
  const gaps = coverageOf([...INBOUND_PATHS, invented], gateRefuses)
  assert.deepEqual(gaps, [{ path: 'A97', why: 'names a path gate nobody has built: nobody-built-this' }])
})

test('a control a row carries beside its path gate is judged by its own rule too', () => {
  // The row claims a shell gate that does not refuse it: the path gate alone is not the whole control.
  const beside: InboundPath = {
    id: 'A96',
    what: 'a planted path whose shell gate does not stand',
    klass: 'delivered',
    control: { kind: 'check_every_path_is_gated', gate: 'nothing-a-later-git-run-reads', also: [{ kind: 'shell-gate' }] },
    attestation: 'none',
  }
  const gaps = coverageOf([...INBOUND_PATHS, beside], (path) => path !== 'A96')
  assert.deepEqual(gaps, [{ path: 'A96', why: 'claims the shell gate, and the shell gate does not refuse it' }])
  // And with the shell gate standing, the same row is no gap.
  assert.deepEqual(coverageOf([beside], gateRefuses, DELIVERY_GATES, LAUNCH_GATES, ARGUMENT_GATES, { 'nothing-a-later-git-run-reads': admitsAWriteNoLaterGitRunReads }), [])
})

test('the row for code a checkout runs claims the path gate, with the shell gate beside it (#168)', () => {
  const row = INBOUND_PATHS.find((path) => path.id === 'A13')
  assert.ok(row !== undefined)
  assert.deepEqual(row.control, { kind: 'check_every_path_is_gated', gate: 'nothing-a-later-git-run-reads', also: [{ kind: 'shell-gate' }] })
})


// --- the shapes a path alone cannot express (martha#192) ---------------------------
//
// A config on disk names a tree path, so the question is only answerable in a
// checkout that holds one. The check asks these beside the name-only probes, and the
// stand-in below stands a real checkout for each: this is the probe that fails when
// the value rule is dropped from the gate, which no name-only probe would notice.

/**
 * A checkout on disk holding the probe's configuration, and where the member stands
 * in it. It is left on disk until the test ends: the gate reads it when it is asked,
 * and a checkout removed before that answers about nothing.
 */
function standInNow(t: TestContext): (probe: ConfigPathProbe) => PathProbe {
  const made: string[] = []
  t.after(() => {
    for (const top of made) removeTheTree(top)
  })
  return (probe) => {
    const top = mkdtempSync(join(tmpdir(), 'martha-192-probe-'))
    made.push(top)
    mkdirSync(join(top, '.git'), { recursive: true })
    writeFileSync(join(top, '.git', 'config'), `${probe.config.join('\n')}\n`)
    return { admits: probe.admits, what: probe.what, path: join(top, probe.writes), cwd: top, home: top }
  }
}

test('the gate answers the configuration questions too, and a gate that lost them is named (#192)', (t) => {
  const standIn = standInNow(t)
  assert.ok(CONFIG_PATH_PROBES.length >= 3 && CONFIG_PATH_PROBES.some((probe) => probe.admits), 'the probes hold an admitted control and the shapes beside it')
  assert.equal(gapsInConfigPathCoverage(admitsAWriteNoLaterGitRunReads, standIn), undefined, 'the real gate answers every configuration question')

  // The value rule dropped: the ordinary file is still admitted, so every name-only
  // probe passes, and only these questions notice the loss.
  const withoutTheRule = (probe: PathProbe): boolean => !probe.path.includes(`${sep}.git${sep}`)
  assert.notEqual(gapsInConfigPathCoverage(withoutTheRule, standIn), undefined, 'a gate that lost the value rule is named')
  assert.ok(gapsInConfigPathCoverage(withoutTheRule, standIn)?.includes('admits'), `the gap says the gate admits what it should refuse (${gapsInConfigPathCoverage(withoutTheRule, standIn)})`)

  // And a gate that refuses every write into any checkout is caught by the admitted probe.
  assert.ok(gapsInConfigPathCoverage(() => false, standIn)?.includes('refuses an ordinary file'), `a gate that refuses everything is named (${gapsInConfigPathCoverage(() => false, standIn)})`)

  // The wiring, not these questions alone: the pass that reads the register asks
  // them too, so a gate that lost the value rule is named there. A gate that answers
  // every name-only probe as the shipped one does, and admits every write into a
  // checkout whose config names a tree path, stands for the loss.
  const lostTheRule = (probe: PathProbe): boolean =>
    PATH_PROBES.some((known) => known.path === probe.path && known.what === probe.what) ? admitsAWriteNoLaterGitRunReads(probe) : true
  const row: InboundPath = {
    id: 'A95',
    what: 'a planted row whose path gate lost the configuration rule',
    klass: 'delivered',
    control: { kind: 'check_every_path_is_gated', gate: 'nothing-a-later-git-run-reads', also: [] },
    attestation: 'none',
  }
  const wired = gapsInGateCoverage([row], gateRefuses, DELIVERY_GATES, LAUNCH_GATES, ARGUMENT_GATES, { 'nothing-a-later-git-run-reads': lostTheRule }, standIn)
  assert.ok(wired.some((gap) => gap.why.includes('admits the hooks folder a tree config names')), `the register pass names the lost value rule (${wired.map((gap) => gap.why).join('; ') || 'no gap'})`)
})

// --- the ring results still carry the keys the parse reads (martha#247) ---------
//
// The parse reads `to` on A5 and `peer` on A4, and keys each branch on the success
// marker beside it (`answer`, `caller_notified`). Those names are the pinned mesh
// server's, so a release that renames one leaves the parse reading nothing: the row
// then records no sender and the member loses its shell in silence. The check runs
// against the recorded key sets, and names the row and the version that lost one.

const NEWEST_RING_KEYS = RECORDED_RING_RESULT_KEYS.at(-1) as RecordedRingResultKeys
const WITHOUT = (recorded: RecordedRingResultKeys, tool: string, key: string): RecordedRingResultKeys => ({
  ...recorded,
  results: { ...recorded.results, [tool]: (recorded.results[tool] ?? []).filter((carried) => carried !== key) },
})

test('every recorded mesh server version still carries the keys the ring parse reads', () => {
  assert.ok(RECORDED_RING_RESULT_KEYS.length > 0, 'no mesh server version recorded the ring results')
  assert.deepEqual(gapsInRingResultKeys(), [])
})

/** Both keys the check reads on each ring tool — the id and the marker — read from the parse's own table, never typed again. */
const KEYS_THE_CHECK_READS = Object.entries(RING_RESULT_KEYS).flatMap(([tool, keys]) =>
  [keys.id, keys.marker].map((key) => ({ tool, key, row: PATH_OF_SOURCE[sourceOfAMeshToolResult(tool)] })),
)

test('a recorded version that has lost a key is named with the row it belongs to, the key and the version', () => {
  assert.equal(KEYS_THE_CHECK_READS.length, 4, 'the two ring tools, an id and a marker each')
  for (const { tool, key, row } of KEYS_THE_CHECK_READS) {
    const gaps = gapsInRingResultKeys([WITHOUT(NEWEST_RING_KEYS, tool, key)])
    assert.deepEqual(gaps.map((gap) => gap.path), [row], `${tool} without ${key}`)
    assert.match(gaps[0]?.why ?? '', new RegExp(`carries no ${key}`))
    assert.ok(gaps[0]?.why.includes(NEWEST_RING_KEYS.server_version), `the gap names the version (${gaps[0]?.why ?? ''})`)
  }
})

test('a version that lost nothing is named for nothing, and a key the recording no longer carries is named once', () => {
  assert.deepEqual(gapsInRingResultKeys([NEWEST_RING_KEYS, { ...NEWEST_RING_KEYS, server_version: '0.0.1' }]), [])
  const [first] = KEYS_THE_CHECK_READS
  assert.ok(first !== undefined, 'the parse reads no key at all')
  const renamed = WITHOUT(NEWEST_RING_KEYS, first.tool, first.key)
  const gaps = gapsInRingResultKeys([renamed])
  assert.equal(gaps.filter((gap) => gap.path === first.row).length, 1, 'one gap for the one row that lost its key')
})

// --- the mesh answer shapes (martha#251) -----------------------------------------

const NEWEST_SHAPES: RecordedMeshAnswerShape = (() => {
  const newest = RECORDED_MESH_ANSWER_SHAPES.at(-1)
  if (newest === undefined) throw new Error('no recorded mesh answer shape')
  return newest
})()

/** The newest recording without one leaf of one tool. */
function shapesWithout(tool: string, leaf: string): RecordedMeshAnswerShape {
  return {
    ...NEWEST_SHAPES,
    tools: { ...NEWEST_SHAPES.tools, [tool]: (NEWEST_SHAPES.tools[tool] ?? []).filter((each) => each !== leaf) },
  }
}

test('every recorded leaf of every session answer has a rule, and every rule a recorded leaf', () => {
  assert.deepEqual(gapsInMeshAnswerShapes(), [])
  assert.ok(Object.keys(ADMITS).length > 20, 'the reading admits almost nothing')
})

test('a recorded answer that lost a leaf is named, with the leaf whose rule nothing carries now', () => {
  for (const [tool, leaf] of [[MESH_HELLO, 'petname'], [MESH_HELLO, 'node_id'], [MESH_GOODBYE, 'said_goodbye']] as const) {
    const gaps = gapsInMeshAnswerShapes([shapesWithout(tool, leaf)])
    assert.ok(gaps.some((gap) => gap.path === leaf), `${tool} without ${leaf}: ${JSON.stringify(gaps)}`)
  }
})

test('a rule no recorded answer carries is named with the leaf it admits', () => {
  const invented = { ...ADMITS, 'citizenship.second_thoughts': () => true }
  const gaps = gapsInMeshAnswerShapes(RECORDED_MESH_ANSWER_SHAPES, invented)
  assert.deepEqual(gaps.map((gap) => gap.path), ['citizenship.second_thoughts'])
})

test('a recorded leaf no rule admits is named, so a release that adds one is not read silently', () => {
  const widened = RECORDED_MESH_ANSWER_SHAPES.map((version) => ({
    ...version,
    tools: { ...version.tools, [MESH_HELLO]: [...(version.tools[MESH_HELLO] ?? []), 'citizenship.second_thoughts'] },
  }))
  const gaps = gapsInMeshAnswerShapes(widened)
  assert.deepEqual(gaps.map((gap) => gap.path), ['citizenship.second_thoughts'])
})
