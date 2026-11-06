// The mechanical check step 2 asks for: a path that reaches a shell-holding
// member with no control makes CI fail, naming the path.
//
// This runs in CI (see the `gate coverage` job in .github/workflows/ci.yml) and
// its unit tests plant ungated paths to prove it is not vacuous: a row copied
// from the table without its control, a row whose control field was forgotten, a
// row claiming the shell gate while the gate does not refuse it, a row naming a
// delivery gate that does not exist, a delivery gate that admits everyone, one
// that refuses everyone, and one that answers only some of the questions.
//
// A `launched` row (code the host starts by itself, issue #16) is held to the
// same standard with its own gate. No tool is called and no model runs on such
// a path, so a launched row claiming the shell gate or a delivery gate is
// claiming cover that cannot stand there, and is a gap. The launch gate it
// names is driven once per question: it must refuse config the owner has not
// approved, an approved server whose content changed under the same name, an
// approved config whose checkout changed under it (the script it runs), config
// outside any git checkout, a file added after approval, a config one
// directory up, a symlink even when approved, a host it has no file list for,
// and a request whose config was never read — and it must admit approved
// config and a checkout with no config at all.
//
// A name is not a control, and neither is a gate that gets one question right.
// Every delivery gate a row names is DRIVEN here, once per question it has to
// answer: it must refuse an unattested message, a session talking to itself, a
// message addressed elsewhere, a kind that is not talk, and a sender the roster
// does not name — and it must admit a rostered member, so a gate that refuses
// everything is caught too.

import { DELIVERY_GATES, LAUNCH_GATES, type InboundPath } from '../inbound_paths/inbound_paths.ts'
import type { DeliveryGate, RoomMessage, RoomRosters } from '../admit_a_room_message/admit_a_room_message.ts'
import {
  fingerprintOf,
  LAUNCH_FILES_OF_HOST,
  type ConfigEntry,
  type Host,
  type LaunchGate,
  type LaunchRequest,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import {
  CLAUDE_CODE_EMITTED_SESSION_EVENTS,
  CLAUDE_CODE_SESSION_EVENTS,
  undeclaredSessionEvents,
  type HostSessionEvents,
} from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { RECORDED_MESH_SERVER, type RecordedMeshServer } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import {
  MESH_TOOLS_REFUSED,
  MESH_TOOLS_THAT_RUN,
  MESH_TOOL_PREFIX,
} from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'

export interface Gap {
  readonly path: string
  readonly why: string
}

// Synthetic node ids, never a real one: this repository is public.
const SELF = '0'.repeat(64)
const MEMBER = '1'.repeat(64)
const STRANGER = '2'.repeat(64)

const ROSTERS: RoomRosters = {
  crew: { member_node_ids: [SELF, MEMBER] },
  shared: { member_node_ids: [SELF, MEMBER] },
}

interface Probe {
  readonly admits: boolean
  readonly what: string
  readonly message: RoomMessage
  readonly rosters?: RoomRosters
  readonly self?: string
}

const PROBES: readonly Probe[] = [
  {
    admits: true,
    what: 'a rostered member, attested, addressed here, talking',
    message: { attested: true, from_node_id: MEMBER, to_node_ids: [SELF], kind: 'message' },
  },
  {
    admits: false,
    what: 'a message nobody attested',
    message: { attested: false, from_node_id: MEMBER, to_node_ids: [SELF], kind: 'message' },
  },
  {
    admits: false,
    what: 'a session talking to itself',
    message: { attested: true, from_node_id: SELF, to_node_ids: [SELF], kind: 'message' },
  },
  {
    admits: false,
    what: 'a message addressed to another session',
    message: { attested: true, from_node_id: MEMBER, to_node_ids: [MEMBER], kind: 'message' },
  },
  {
    admits: false,
    what: 'a kind that is not talk',
    message: { attested: true, from_node_id: MEMBER, to_node_ids: [SELF], kind: 'presence_changed' },
  },
  {
    admits: false,
    what: 'a sender the roster does not name',
    message: { attested: true, from_node_id: STRANGER, to_node_ids: [SELF], kind: 'message' },
  },
  {
    admits: false,
    what: 'a sender that is not a node id, even when a roster lists it',
    message: { attested: true, from_node_id: 'not-a-node-id', to_node_ids: [SELF], kind: 'message' },
    rosters: {
      crew: { member_node_ids: [SELF, MEMBER, 'not-a-node-id'] },
      shared: { member_node_ids: [SELF, MEMBER, 'not-a-node-id'] },
    },
  },
  {
    admits: false,
    what: 'a message in a session whose own id is not a node id',
    message: { attested: true, from_node_id: MEMBER, to_node_ids: [SELF], kind: 'message' },
    self: '',
  },
]

/**
 * Every row that reaches a shell-holding member without a control that stands on it.
 *
 * `gateRefuses` is the real shell gate, driven once per row that claims it.
 * `delivery_gates` is the real map of gates, driven once per question per row
 * that names one.
 */
export function gapsInGateCoverage(
  paths: readonly InboundPath[],
  gateRefuses: (path: string) => boolean,
  delivery_gates: Readonly<Record<string, DeliveryGate>> = DELIVERY_GATES,
  launch_gates: Readonly<Record<string, LaunchGate>> = LAUNCH_GATES,
): readonly Gap[] {
  const gaps: Gap[] = []

  for (const path of paths) {
    const control: InboundPath['control'] | undefined = path.control

    if (control === undefined) {
      gaps.push({ path: path.id, why: 'no control is declared' })
      continue
    }

    if (control.kind === 'none') {
      gaps.push({ path: path.id, why: 'declared as having no control' })
      continue
    }

    if (path.klass === 'launched' && control.kind !== 'launch-gate') {
      gaps.push({ path: path.id, why: `is code the host starts by itself, and ${control.kind} does not stand in front of that` })
      continue
    }

    if (control.kind === 'launch-gate') {
      const gap = path.klass !== 'launched'
        ? 'names a launch gate on a path the host does not start by itself'
        : control.residual.trim() === ''
          ? 'does not say what happens where Martha does not start the host'
          : launchGateGap(control.gate, launch_gates[control.gate])
      if (gap !== undefined) gaps.push({ path: path.id, why: gap })
      continue
    }

    if (control.kind === 'shell-gate' && !gateRefuses(path.id)) {
      gaps.push({ path: path.id, why: 'claims the shell gate, and the shell gate does not refuse it' })
      continue
    }

    if (control.kind === 'delivery-gate') {
      const gap = deliveryGateGap(control.gate, delivery_gates[control.gate])
      if (gap !== undefined) gaps.push({ path: path.id, why: gap })
      continue
    }

    if (control.kind === 'no-text-reaches-the-model' && control.why.trim() === '') {
      gaps.push({ path: path.id, why: 'claims no text reaches the model and does not say why' })
    }
  }

  return gaps
}

// A host the launch probes use, its first listed file, and a second one: the
// probes are built from the module's own lists, never a restated file name.
const PROBE_HOST: Host = 'claude-code'
const [SERVERS, SETTINGS] = LAUNCH_FILES_OF_HOST[PROBE_HOST]

const sha = (digit: string) => digit.repeat(64)

/** Every listed file for the probe host, absent, with any present ones laid over. */
function onDisk(present: readonly ConfigEntry[]): readonly ConfigEntry[] {
  const absent: ConfigEntry[] = LAUNCH_FILES_OF_HOST[PROBE_HOST]
    .filter((name) => !present.some((entry) => entry.path === name))
    .map((name) => ({ path: name, kind: 'absent' }))
  return [...absent, ...present]
}

const SERVERS_ONLY = onDisk([{ path: SERVERS, kind: 'file', sha256: sha('a') }])
// Synthetic git tree ids: the checkout as approved, and after a pull.
const TREE = '1'.repeat(40)
const PULLED = '2'.repeat(40)
const APPROVED = [fingerprintOf({ entries: SERVERS_ONLY, tree: TREE })]

export interface LaunchProbe {
  readonly admits: boolean
  readonly what: string
  readonly request: LaunchRequest
}

/** The questions every launch gate is asked; the first is the approved config. */
export const LAUNCH_PROBES: readonly LaunchProbe[] = [
  {
    admits: true,
    what: 'config the owner approved',
    request: { host: PROBE_HOST, entries: SERVERS_ONLY, tree: TREE, approved_fingerprints: APPROVED },
  },
  {
    admits: true,
    what: 'a checkout with no config at all',
    request: { host: PROBE_HOST, entries: onDisk([]), tree: null, approved_fingerprints: [] },
  },
  {
    admits: false,
    what: 'config the owner has not approved',
    request: { host: PROBE_HOST, entries: SERVERS_ONLY, tree: TREE, approved_fingerprints: [] },
  },
  {
    admits: false,
    what: 'an approved file whose content changed under the same name',
    request: { host: PROBE_HOST, entries: onDisk([{ path: SERVERS, kind: 'file', sha256: sha('b') }]), tree: TREE, approved_fingerprints: APPROVED },
  },
  {
    admits: false,
    what: 'an approved config whose checkout changed under it, the script it runs included',
    request: { host: PROBE_HOST, entries: SERVERS_ONLY, tree: PULLED, approved_fingerprints: APPROVED },
  },
  {
    admits: false,
    what: 'config outside any git checkout, even with its fingerprint approved',
    request: {
      host: PROBE_HOST,
      entries: SERVERS_ONLY,
      tree: null,
      approved_fingerprints: [fingerprintOf({ entries: SERVERS_ONLY, tree: null })],
    },
  },
  {
    admits: false,
    what: 'a file added after the approval',
    request: {
      host: PROBE_HOST,
      entries: onDisk([{ path: SERVERS, kind: 'file', sha256: sha('a') }, { path: SETTINGS, kind: 'file', sha256: sha('c') }]),
      tree: TREE,
      approved_fingerprints: APPROVED,
    },
  },
  {
    admits: false,
    what: 'a config one directory up from the checkout',
    request: {
      host: PROBE_HOST,
      entries: [...SERVERS_ONLY, { path: `../${SERVERS}`, kind: 'file', sha256: sha('d') }],
      tree: TREE,
      approved_fingerprints: APPROVED,
    },
  },
  {
    admits: false,
    what: 'a symlink, even one the owner approved',
    request: {
      host: PROBE_HOST,
      entries: onDisk([{ path: SERVERS, kind: 'symlink', target: SERVERS }]),
      tree: TREE,
      approved_fingerprints: [fingerprintOf({ entries: onDisk([{ path: SERVERS, kind: 'symlink', target: SERVERS }]), tree: TREE })],
    },
  },
  {
    admits: false,
    what: 'a request whose config was never read',
    request: { host: PROBE_HOST, entries: [], tree: TREE, approved_fingerprints: [] },
  },
  {
    admits: false,
    what: 'a host it has no file list for',
    request: { host: 'a-host-nobody-listed', entries: [], tree: TREE, approved_fingerprints: [] },
  },
]

function launchGateGap(name: string, gate: LaunchGate | undefined): string | undefined {
  if (gate === undefined) return `names a launch gate nobody has built: ${name}`

  for (const probe of LAUNCH_PROBES) {
    if (gate(probe.request) !== probe.admits) {
      return probe.admits ? `the gate ${name} refuses ${probe.what}` : `the gate ${name} admits ${probe.what}`
    }
  }

  return undefined
}

/**
 * Every event a host emits when a session starts that its declaration does not
 * cover, and every declared event the host never emits. An undeclared event
 * fails closed at run time; this makes it fail CI first, so a new host event is
 * decided rather than discovered. A declared event nobody emits is a decision
 * that protects nothing, such as a refresh the mod no longer reports as one.
 */
export function gapsInSessionEvents(
  declared: HostSessionEvents = CLAUDE_CODE_SESSION_EVENTS,
  emitted: readonly string[] = CLAUDE_CODE_EMITTED_SESSION_EVENTS,
): readonly Gap[] {
  const undeclared = undeclaredSessionEvents(declared, emitted).map((event) => ({
    path: `session event ${event} on ${declared.host}`,
    why: 'the host emits it and its declaration does not say what it does to the record',
  }))
  const never_emitted = Object.keys(declared.events)
    .filter((event) => !emitted.includes(event))
    .map((event) => ({
      path: `session event ${event} on ${declared.host}`,
      why: 'it is declared and the host never emits it',
    }))
  return [...undeclared, ...never_emitted]
}

/**
 * Every mesh tool whose decision does not match the recorded server: a tool it
 * registers that is neither allowed nor refused, an allowed or refused name it
 * does not register, a name both allowed and refused, and a tool outside the
 * mesh prefix, which the run-time check would not judge at all. A new release
 * of the server fails CI here by name before a member meets the tool.
 */
export function gapsInMeshTools(
  recorded: RecordedMeshServer = RECORDED_MESH_SERVER,
  allowed: readonly string[] = MESH_TOOLS_THAT_RUN,
  refused: readonly string[] = MESH_TOOLS_REFUSED,
): readonly Gap[] {
  const on = `${recorded.server} ${recorded.server_version}`
  const gap = (tool: string, why: string): Gap => ({ path: `mesh tool ${tool}`, why })
  const unprefixed = recorded.tools
    .filter((tool) => !tool.startsWith(MESH_TOOL_PREFIX))
    .map((tool) => gap(tool, `${on} registers it, and its name does not start with ${MESH_TOOL_PREFIX}: the run-time check would not judge it`))
  const undecided = recorded.tools
    .filter((tool) => tool.startsWith(MESH_TOOL_PREFIX) && !allowed.includes(tool) && !refused.includes(tool))
    .map((tool) => gap(tool, `${on} registers it, and it is neither allowed nor refused`))
  const both = allowed.filter((tool) => refused.includes(tool)).map((tool) => gap(tool, 'it is both allowed and refused'))
  const unregistered = (names: readonly string[], decision: string) =>
    names
      .filter((tool) => !recorded.tools.includes(tool))
      .map((tool) => gap(tool, `it is ${decision}, and the recorded server does not register it (${on})`))
  return [...unprefixed, ...undecided, ...both, ...unregistered(allowed, 'allowed'), ...unregistered(refused, 'refused')]
}

function deliveryGateGap(name: string, gate: DeliveryGate | undefined): string | undefined {
  if (gate === undefined) return `names a delivery gate nobody has built: ${name}`

  for (const probe of PROBES) {
    const answered = gate({
      message: probe.message,
      rosters: probe.rosters ?? ROSTERS,
      self_node_id: probe.self ?? SELF,
    })
    if (answered !== probe.admits) {
      return probe.admits
        ? `the gate ${name} refuses ${probe.what}`
        : `the gate ${name} admits ${probe.what}`
    }
  }

  return undefined
}
