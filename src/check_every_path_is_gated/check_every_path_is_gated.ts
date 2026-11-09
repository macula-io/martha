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

import { join } from 'node:path'

import { ARGUMENT_GATES, DELIVERY_GATES, INBOUND_PATHS, LAUNCH_GATES, type Control, type InboundPath } from '../inbound_paths/inbound_paths.ts'
import { REGISTRY_ROWS_THAT_ARE_NOT_TURN_SOURCES } from '../take_in_a_turn/take_in_a_turn.ts'
import type { ArgumentGate } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import type { DeliveryGate, RoomMessage, RoomRosters } from '../admit_a_room_message/admit_a_room_message.ts'
import {
  fingerprintOf,
  LAUNCH_FILES_OF_HOST,
  type ConfigEntry,
  type Host,
  type LaunchGate,
  type LaunchRequest,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { undeclaredSessionEvents, type HostSessionEvents } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { undeclaredPromptOrigins, type HostPromptOrigins } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import { RECORDED_MESH_SERVERS, type RecordedMeshServer } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
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
 * that names one. `path_gates` is the same for a row whose control checks every
 * path a member's file tools name (martha#168): it is empty here, because the
 * gate reads the machine and a slice may import no adapter, so whoever runs the
 * check supplies it — and a row naming a gate the caller did not supply is a gap,
 * never a pass.
 */
export function gapsInGateCoverage(
  paths: readonly InboundPath[],
  gateRefuses: (path: string) => boolean,
  delivery_gates: Readonly<Record<string, DeliveryGate>> = DELIVERY_GATES,
  launch_gates: Readonly<Record<string, LaunchGate>> = LAUNCH_GATES,
  argument_gates: Readonly<Record<string, ArgumentGate>> = ARGUMENT_GATES,
  path_gates: Readonly<Record<string, PathGate>> = {},
): readonly Gap[] {
  const gaps: Gap[] = []
  const gates: Gates = { delivery: delivery_gates, launch: launch_gates, argument: argument_gates, path: path_gates }

  for (const path of paths) {
    const why = gapOfRow(path, gateRefuses, gates)
    if (why !== undefined) gaps.push({ path: path.id, why })
  }

  return gaps
}

/** Every gate a row may name, by kind. */
interface Gates {
  readonly delivery: Readonly<Record<string, DeliveryGate>>
  readonly launch: Readonly<Record<string, LaunchGate>>
  readonly argument: Readonly<Record<string, ArgumentGate>>
  readonly path: Readonly<Record<string, PathGate>>
}

/**
 * Why one row is a gap, or undefined when its control stands on it. Each kind
 * of control is judged by its own rule, and the first rule that applies decides.
 */
function gapOfRow(path: InboundPath, gateRefuses: (path: string) => boolean, gates: Gates): string | undefined {
  const control: InboundPath['control'] | undefined = path.control

  if (control === undefined) return 'no control is declared'

  if (control.kind === 'none') return 'declared as having no control'

  if (path.klass === 'launched' && control.kind !== 'launch-gate') {
    return `is code the host starts by itself, and ${control.kind} does not stand in front of that`
  }

  if (control.kind === 'launch-gate') return launchedRowGap(path, control, gates.launch)

  if (control.kind === 'refused-before-launch') return argumentRowGap(path, control.gate, gates.argument)

  if (control.kind === 'check_every_path_is_gated') return gatedPathRowGap(path, control, gateRefuses, gates)

  return claimedControlGap(path, control, gateRefuses, gates.delivery)
}

/**
 * Why a row claiming a path gate is a gap: the gate nobody built, a gate that
 * answers one of the questions wrong, or a control it carries beside the path
 * gate that does not stand on the row either (martha#168).
 */
function gatedPathRowGap(
  path: InboundPath,
  control: Extract<Control, { kind: 'check_every_path_is_gated' }>,
  gateRefuses: (path: string) => boolean,
  gates: Gates,
): string | undefined {
  const gate = gates.path[control.gate]
  if (gate === undefined) return `names a path gate nobody has built: ${control.gate}`
  const failed = PATH_PROBES.find((probe) => gate(probe) !== probe.admits)
  if (failed !== undefined) {
    return failed.admits ? `the gate ${control.gate} refuses ${failed.what}` : `the gate ${control.gate} admits ${failed.what}`
  }
  return control.also.map((also) => gapOfRow({ ...path, control: also }, gateRefuses, gates)).find((why) => why !== undefined)
}

/** Why a row naming an argument gate is a gap: it is not delivered text, or its gate fails a question. */
function argumentRowGap(path: InboundPath, name: string, argument_gates: Readonly<Record<string, ArgumentGate>>): string | undefined {
  if (path.klass !== 'delivered') return 'names an argument gate on a path that hands the host no words'
  const gate = argument_gates[name]
  if (gate === undefined) return `names an argument gate nobody has built: ${name}`
  const failed = ARGUMENT_PROBES.find((probe) => gate(probe.args) !== probe.passes)
  if (failed === undefined) return undefined
  return failed.passes ? `the gate ${name} refuses ${failed.what}` : `the gate ${name} passes ${failed.what}`
}

export interface ArgumentProbe {
  readonly passes: boolean
  readonly what: string
  readonly args: readonly string[]
}

/**
 * A path a member's file tool names, whether the gate must admit it, and where
 * the member stands: the checkout a write lands in, and its home.
 */
export interface PathProbe {
  readonly admits: boolean
  readonly what: string
  /** The path the member's Write names. */
  readonly path: string
  /** The member's working directory: the checkout a git dir is found from. */
  readonly cwd: string
  /** The host's home, which a leading `~` resolves against. */
  readonly home: string
}

/**
 * What decides whether a member's file tool may write a path it names. Built in
 * the host adapter that holds the guard, and passed to the check by whoever runs
 * it: a slice may import no adapter, so the check takes the gate as an argument
 * rather than naming a function it cannot reach.
 */
export type PathGate = (probe: PathProbe) => boolean

/** The home and the checkout the path-gate probes stand in: neither exists on any machine, so the answer rests on the names alone. */
const PROBE_HOME = '/an-owners-home'
const PROBE_CHECKOUT = '/the/checkout'

/**
 * The questions every path gate is asked, one per class of path a member's file
 * tool can name: an ordinary file in the checkout it stands in, the checkout's
 * own git directory, a `.git` a member would add under `src` spelled as macOS
 * reads it, and the owner's own git configuration. The first is admitted, so a
 * gate that refuses everything is caught.
 */
export const PATH_PROBES: readonly PathProbe[] = [
  { admits: true, what: 'an ordinary file in the checkout', path: join(PROBE_CHECKOUT, 'src', 'a.ts'), cwd: PROBE_CHECKOUT, home: PROBE_HOME },
  { admits: false, what: "the checkout's own git directory", path: join(PROBE_CHECKOUT, '.git', 'hooks', 'pre-commit'), cwd: PROBE_CHECKOUT, home: PROBE_HOME },
  { admits: false, what: 'a .git a member would add, spelled as a case-insensitive disk reads it', path: join(PROBE_CHECKOUT, 'src', '.GIT'), cwd: PROBE_CHECKOUT, home: PROBE_HOME },
  { admits: false, what: "the owner's own git configuration", path: join(PROBE_HOME, '.gitconfig'), cwd: PROBE_CHECKOUT, home: PROBE_HOME },
]

/**
 * The questions every argument gate is asked, one per class of word the host
 * acts on after the launch gate: a prompt, config, a plugin, a permission, a
 * session brought back, a switch smuggled in as another's value, a switch the
 * gate has never heard of, and the short and --switch=value spellings that
 * reach the same switches. The first is no arguments at all, so a gate that
 * refuses everything is caught.
 */
export const ARGUMENT_PROBES: readonly ArgumentProbe[] = [
  { passes: true, what: 'no arguments at all', args: [] },
  { passes: true, what: 'a model to run', args: ['--model', 'a-model'] },
  { passes: false, what: 'a prompt on the command line', args: ['a prompt'] },
  { passes: false, what: 'a settings file or JSON', args: ['--settings', '{}'] },
  { passes: false, what: 'which settings sources load', args: ['--setting-sources', 'user,project'] },
  { passes: false, what: 'a tool-server config', args: ['--mcp-config', 'servers.json'] },
  { passes: false, what: 'a plugin directory', args: ['--plugin-dir', 'plugin'] },
  { passes: false, what: 'skipping every permission check', args: ['--dangerously-skip-permissions'] },
  { passes: false, what: 'a permission mode', args: ['--permission-mode', 'bypassPermissions'] },
  { passes: false, what: 'a session brought back', args: ['--resume', 'a-session'] },
  { passes: false, what: 'a switch carried as another switch\'s value', args: ['--model', '--settings', '{}'] },
  { passes: false, what: 'a switch nobody has read', args: ['--a-switch-a-later-host-adds'] },
  { passes: false, what: 'a prompt by its short switch', args: ['-p', 'a prompt'] },
  { passes: false, what: 'the last session brought back by its short switch', args: ['-c'] },
  { passes: false, what: 'a session brought back by its short switch', args: ['-r', 'a-session'] },
  { passes: false, what: 'a settings file in the --switch=value spelling', args: ['--settings={}'] },
  { passes: false, what: 'a passed switch in the --switch=value spelling', args: ['--model=a-model'] },
]

/** Why a row naming a launch gate is a gap: it is not launched, says nothing of where Martha does not start the host, or its gate fails a question. */
function launchedRowGap(
  path: InboundPath,
  control: Extract<Control, { kind: 'launch-gate' }>,
  launch_gates: Readonly<Record<string, LaunchGate>>,
): string | undefined {
  return path.klass !== 'launched'
    ? 'names a launch gate on a path the host does not start by itself'
    : control.residual.trim() === ''
      ? 'does not say what happens where Martha does not start the host'
      : launchGateGap(control.gate, launch_gates[control.gate])
}

/** Why a row claiming the shell gate, a delivery gate or that no text reaches the model is a gap. */
function claimedControlGap(
  path: InboundPath,
  control: Control,
  gateRefuses: (path: string) => boolean,
  delivery_gates: Readonly<Record<string, DeliveryGate>>,
): string | undefined {
  if (control.kind === 'shell-gate' && !gateRefuses(path.id)) {
    return 'claims the shell gate, and the shell gate does not refuse it'
  }

  if (control.kind === 'delivery-gate') return deliveryGateGap(control.gate, delivery_gates[control.gate])

  if (control.kind === 'no-text-reaches-the-model' && control.why.trim() === '') {
    return 'claims no text reaches the model and does not say why'
  }

  return undefined
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
 *
 * `emitted` comes from the host's adapter, derived from the host's own schema
 * (../claude_code_host for Claude Code, whose test runs this check on it).
 */
export function gapsInSessionEvents(declared: HostSessionEvents, emitted: readonly string[]): readonly Gap[] {
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
 * Every origin kind a host stamps on a prompt that its declaration does not
 * map to a turn source, and every declared kind the host never stamps. An
 * undeclared kind fails closed at run time (another session's message); this
 * makes it fail CI first, so a new kind is decided rather than discovered.
 *
 * `emitted` comes from the host's adapter, recorded from the host itself
 * (../claude_code_host for Claude Code, whose test runs this check on it).
 */
export function gapsInPromptOrigins(declared: HostPromptOrigins, emitted: readonly string[]): readonly Gap[] {
  const undeclared = undeclaredPromptOrigins(declared, emitted).map((kind) => ({
    path: `prompt origin ${kind} on ${declared.host}`,
    why: 'the host stamps it and its declaration does not say which source it is',
  }))
  const never_emitted = Object.keys(declared.sources)
    .filter((kind) => !emitted.includes(kind))
    .map((kind) => ({
      path: `prompt origin ${kind} on ${declared.host}`,
      why: 'it is declared and the host never stamps it',
    }))
  return [...undeclared, ...never_emitted]
}

/** Where Claude Code joins a server's name to its tool's own name; its adapter splits at the last one. */
const HOST_NAME_SEPARATOR = '__'

/**
 * Every mesh tool whose decision does not match the recorded servers, all of
 * them at once (martha#49): a tool any recorded version registers that is
 * neither allowed nor refused, an allowed or refused name no recorded version
 * registers, a name both allowed and refused, a tool outside the mesh prefix,
 * which the run-time check would not judge at all, and a tool whose name holds
 * `__`, which Claude Code's adapter would cut short: it takes a called
 * `mcp__<server>__<tool>` apart at the last `__`, because a server's name may
 * hold `__` and a mesh tool's may not. A version recorded twice is named too. A
 * new release of the server fails CI here by name before a member meets the
 * tool, and so does a decision that only a retired version needed.
 */
export function gapsInMeshTools(
  recorded: readonly RecordedMeshServer[] = RECORDED_MESH_SERVERS,
  allowed: readonly string[] = MESH_TOOLS_THAT_RUN,
  refused: readonly string[] = MESH_TOOLS_REFUSED,
): readonly Gap[] {
  const gap = (tool: string, why: string): Gap => ({ path: `mesh tool ${tool}`, why })
  const registered = [...new Set(recorded.flatMap((record) => record.tools))].sort()
  const by = (tool: string) =>
    recorded
      .filter((record) => record.tools.includes(tool))
      .map((record) => `${record.server} ${record.server_version}`)
      .join(', ')
  const twice = recorded
    .filter((record, at) => recorded.findIndex((other) => other.server === record.server && other.server_version === record.server_version) !== at)
    .map((record) => ({ path: `mesh server ${record.server} ${record.server_version}`, why: 'it is recorded twice: each version has one record' }))
  const unprefixed = registered
    .filter((tool) => !tool.startsWith(MESH_TOOL_PREFIX))
    .map((tool) => gap(tool, `${by(tool)} registers it, and its name does not start with ${MESH_TOOL_PREFIX}: the run-time check would not judge it`))
  const undecided = registered
    .filter((tool) => tool.startsWith(MESH_TOOL_PREFIX) && !allowed.includes(tool) && !refused.includes(tool))
    .map((tool) => gap(tool, `${by(tool)} registers it, and it is neither allowed nor refused`))
  const both = allowed.filter((tool) => refused.includes(tool)).map((tool) => gap(tool, 'it is both allowed and refused'))
  const split = registered
    .filter((tool) => tool.includes(HOST_NAME_SEPARATOR))
    .map((tool) => gap(tool, `${by(tool)} registers it, and its name holds ${HOST_NAME_SEPARATOR}: a host that takes a called name apart at its last ${HOST_NAME_SEPARATOR} would judge only its tail`))
  const held = recorded.map((record) => `${record.server} ${record.server_version}`).join(', ') || 'none'
  const unregistered = (names: readonly string[], decision: string) =>
    names
      .filter((tool) => !registered.includes(tool))
      .map((tool) => gap(tool, `it is ${decision}, and no recorded server registers it (${held})`))
  return [...twice, ...unprefixed, ...undecided, ...both, ...split, ...unregistered(allowed, 'allowed'), ...unregistered(refused, 'refused')]
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

/**
 * Rows that claim the shell gate while nothing the host records ever reaches
 * them (martha#121). The shell gate refuses only what the session's record
 * holds, so a row whose path no recording ever produces is a promise the gate
 * never keeps. `recorded` is every path a host's production code recorded
 * when driven with every event it declares: an adapter's own test drives it
 * (../launch_a_claude_code_member for Claude Code) and hands the paths here.
 *
 * A row the registry declares is no turn source (an inheritance, a forgery the
 * host never reports) is not asked to be recorded; such a row that a recording
 * does reach is a gap too, since the declaration is then false.
 */
export function shellGateRowsNothingRecords(
  recorded: readonly string[],
  paths: readonly InboundPath[] = INBOUND_PATHS,
  not_turn_sources: readonly string[] = REGISTRY_ROWS_THAT_ARE_NOT_TURN_SOURCES,
): readonly Gap[] {
  const reached = new Set(recorded)
  const gaps: Gap[] = []
  for (const path of paths) {
    const declared_none = not_turn_sources.includes(path.id)
    if (declared_none && reached.has(path.id)) {
      gaps.push({ path: path.id, why: 'is declared no turn source, and a host records it' })
    } else if (claimsTheShellGate(path.control) && !declared_none && !reached.has(path.id)) {
      gaps.push({ path: path.id, why: 'claims the shell gate, and nothing the host records ever reaches it' })
    }
  }
  return gaps
}

/**
 * Whether a row claims the shell gate, beside any other control it carries: a
 * row may claim it through a path gate's `also` (martha#168).
 */
export function claimsTheShellGate(control: Control): boolean {
  return control.kind === 'shell-gate' || (control.kind === 'check_every_path_is_gated' && control.also.some(claimsTheShellGate))
}
