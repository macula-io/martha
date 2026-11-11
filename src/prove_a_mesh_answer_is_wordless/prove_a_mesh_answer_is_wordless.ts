// Whether a mesh tool's own session answer carries anything but the member's own
// (martha#251).
//
// A member cannot ring before it has a mesh session, and the call that starts one —
// `mesh_hello` — comes back as an ordinary MCP result, which the registry records on
// B2 with no sender to admit. Under the strict shell gate (`house_rules.strict_gate`,
// martha#259) that first answer closes the member's shell for the rest of the
// session, `mesh_ring` included, so the ring it was about to make is refused before
// it is placed and A4/A5 are never recorded. This slice is the way out: an answer the
// pinned server composed about the member itself takes nothing in, so the shell stays.
//
// THE RULE IS ON THE ANSWER, NOT ON THE TOOL NAME. Exempting `mesh_hello` by name was
// the first design and it was a hole: its answer carries `citizenship.error`, which is
// the `mcl-citizens/register_presence` provider's own reply text, and an error answer
// carries a MeshError's message and `from` (`src/reply.ts:22-27` of the pinned server).
// So every leaf is asked the same question — who can write these bytes? — and the
// answer is admitted only when it is something this launch supplied or can compute, or
// a number, a boolean, a stamp or a 64-hex id, none of which can carry an instruction.
//
//   - A leaf the recording does not carry is words, whatever it holds. That is what
//     keeps the provider's error, the policy file's quoted problems and a joined
//     realm's own strings out: none of them is in a recorded answer shape, so an
//     answer carrying one goes to B2 exactly as it does today.
//   - A leaf whose value this launch cannot compute is words. The launch supplies the
//     member's id, the environment the mesh server was given, the HOME under it, the
//     host's version and the call's own input; the recording supplies the defaults
//     the pinned server reports when nothing is set.
//   - A joined realm is not admitted at all (`realm.joined` only ever false here): the
//     realm writes `handle`, `account` and `org_identity` at join, and
//     `MACULA_MCP_AUTOJOIN_REALM` lets a realm bind an identity with no human in the
//     loop. A joined member's hello answer therefore stays on B2, and this fix is
//     claimed for a member whose identity is not bound to a realm.
//
// WHY THE SHAPE IS RECORDED AND NOT TYPED. The decisions below are meaningful only
// against an answer the server really gives. So the paths and defaults are recorded
// per server version from two runs of the pinned server (./recorded_mesh_answer_shapes.json,
// taken by ../record_mesh_answers), and ../check_every_path_is_gated fails by name when
// a recorded path has no rule, a rule has no recorded path, the recorded versions
// disagree on a path, or a recorded default is not one the two runs agreed on.
//
// The two tool names below ARE typed by hand, and that is said plainly: what is proven
// is each one's admission, leaf by leaf, against the recording. A tool not named here
// records on B2 exactly as before.

import { petnameOf } from '../name_a_node_by_its_petname/name_a_node_by_its_petname.ts'
import recording from './recorded_mesh_answer_shapes.json' with { type: 'json' }

/** The tool that starts a member's presence: the answer this slice exists for. */
export const MESH_HELLO = 'mesh_hello'

/** The tool that ends it: the same shape of answer, and the same reasoning. */
export const MESH_GOODBYE = 'mesh_goodbye'

/** The tools whose answers are read here, by their own names. */
export const WORDLESS_TOOLS: readonly string[] = [MESH_HELLO, MESH_GOODBYE]

/** The fallback name the pinned server registers when nothing else is left. */
export const FALLBACK_DISPLAY_NAME = 'macula-mcp agent'

/** The environment name the pinned server reads its display name from. */
export const DISPLAY_NAME_VARIABLE = 'MACULA_MCP_CITIZEN_DISPLAY_NAME'
/** The environment name the pinned server reads its stations from. */
export const STATIONS_VARIABLE = 'MACULA_MESH_STATIONS'
/** The environment name the pinned server reads its contact-policy file from. */
export const CONTACT_POLICY_FILE_VARIABLE = 'MACULA_MCP_CONTACT_POLICY_FILE'
/** The environment name the pinned server reads its realm portal from. */
export const REALM_URL_VARIABLE = 'MACULA_MCP_REALM_URL'

/** Where the pinned server keeps its contact-policy file when the entry names none, under the HOME it was given. */
const CONTACT_POLICY_FILE_UNDER_HOME = '.config/macula-mcp/contact_policy.json'

/** One server version's answer shapes and defaults, as recorded. */
export interface RecordedMeshAnswerShape {
  readonly server_version: string
  /** The tarball's integrity: the bytes these shapes were read from. */
  readonly integrity: string
  /** Each tool's answer's leaves, sorted, nested ones by dotted path. */
  readonly tools: Readonly<Record<string, readonly string[]>>
  /** The bare run's values, for the leaves a rule reads as "the server's default". */
  readonly defaults: Readonly<Record<string, string | number | boolean | null>>
  /** Both runs' whole answers, so a reviewer can see what a default was read from. */
  readonly states: Readonly<Record<'bare' | 'named', Readonly<Record<string, unknown>>>>
  /** The label the pinned server gives each contact-policy code. */
  readonly labels: Readonly<Record<string, string>>
}

const RECORDING = recording as {
  readonly _why: string
  readonly server: string
  readonly versions: readonly RecordedMeshAnswerShape[]
}

/** Every recorded version, oldest first. */
export const RECORDED_MESH_ANSWER_SHAPES: readonly RecordedMeshAnswerShape[] = RECORDING.versions

/** What this launch supplied, and what a leaf may be equal to. */
export interface WhatTheLaunchSupplies {
  /** The member's own node id: the identity the launcher started it with. */
  readonly node_id: string
  /** The environment the mesh server was given: every other variable emptied, then the entry's approved settings. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** The HOME the launch gave the server, which the default policy file sits under. */
  readonly home: string
  /** The version of the host Martha started, as the server's own client info spells it, or undefined when the launch cannot say. */
  readonly host_version?: string
  /** The call's own input: the member's own words, which its answer may repeat. */
  readonly input: Readonly<Record<string, unknown>>
}

/** An answer that reads nothing: the leaves it carried, for the journal and for a reviewer. */
export interface NothingTaken {
  readonly reads_nothing: true
  readonly tool: string
  readonly paths: readonly string[]
}

/** An answer that carries words, and why, in words the refusal repeats. */
export interface Words {
  readonly reads_nothing: false
  readonly why: string
}

export type MeshAnswerReading = NothingTaken | Words

/** Why an answer carried words, one sentence per kind of failure. */
export const WHY_WORDS = {
  notTheRecordedShape:
    'its answer was not one text block holding one JSON object, so what came back may be the other side’s own words',
  notRecorded: (tool: string) => `${tool} has no recorded answer shape, so nothing here can say its answer is the member’s own`,
  unknownPath: (path: string) =>
    `it carried ${path}, which no recorded answer has, so what fills it is not something this launch can account for`,
  notTheMembers: (path: string) => `it carried ${path}, which is not a value this launch supplied or can compute`,
} as const

/** The leaves every recorded version's answer for this tool carries, or undefined when the versions disagree. */
export function shapeOfATool(tool: string): readonly string[] | undefined {
  const first = RECORDED_MESH_ANSWER_SHAPES[0]?.tools[tool]
  if (first === undefined) return undefined
  const agreed = RECORDED_MESH_ANSWER_SHAPES.every((version) => sameStrings(version.tools[tool], first))
  return agreed ? first : undefined
}

/** The bare run's defaults, or undefined when the recorded versions disagree on them. */
export function recordedDefaults(): Readonly<Record<string, string | number | boolean | null>> | undefined {
  const first = RECORDED_MESH_ANSWER_SHAPES[0]?.defaults
  if (first === undefined) return undefined
  return RECORDED_MESH_ANSWER_SHAPES.every((version) => sameRecord(version.defaults, first)) ? first : undefined
}

/** The contact-policy labels, or undefined when the recorded versions disagree on them. */
export function recordedLabels(): Readonly<Record<string, string>> | undefined {
  const first = RECORDED_MESH_ANSWER_SHAPES[0]?.labels
  if (first === undefined) return undefined
  return RECORDED_MESH_ANSWER_SHAPES.every((version) => sameRecord(version.labels, first)) ? first : undefined
}

/**
 * What this mesh tool's answer reads, or undefined when it is not a tool this slice
 * reads at all — every other mesh tool's answer stays on B2, unchanged.
 */
export function wordsInAMeshAnswer(
  own_name: string,
  answer: unknown,
  launch: WhatTheLaunchSupplies,
): MeshAnswerReading | undefined {
  if (!WORDLESS_TOOLS.includes(own_name)) return undefined

  const shape = shapeOfATool(own_name)
  const defaults = recordedDefaults()
  const labels = recordedLabels()
  if (shape === undefined || defaults === undefined || labels === undefined) {
    return { reads_nothing: false, why: WHY_WORDS.notRecorded(own_name) }
  }

  const parsed = oneJsonObjectIn(answer)
  if (parsed === undefined) return { reads_nothing: false, why: WHY_WORDS.notTheRecordedShape }

  const leaves = leavesOf(parsed)
  const known = new Set(shape)
  for (const [path, value] of leaves) {
    if (!known.has(path)) return { reads_nothing: false, why: WHY_WORDS.unknownPath(path) }
    if (!admits(path, value, parsed, defaults, labels, launch)) {
      return { reads_nothing: false, why: WHY_WORDS.notTheMembers(path) }
    }
  }
  return { reads_nothing: true, tool: own_name, paths: leaves.map(([path]) => path).sort() }
}

/**
 * Whether this path's value is one this launch supplied or can compute. EVERY rule is
 * here and nowhere else, so ../check_every_path_is_gated reads the ruled paths from the
 * same table the run-time reading uses.
 */
export const ADMITS: Readonly<
  Record<
    string,
    (
      value: unknown,
      whole: Readonly<Record<string, unknown>>,
      defaults: Readonly<Record<string, string | number | boolean | null>>,
      labels: Readonly<Record<string, string>>,
      launch: WhatTheLaunchSupplies,
    ) => boolean
  >
> = {
  // The server's own constant, unless the entry's settings named a banner file — and then the bytes are a file's,
  // which no launch approved.
  banner: (value, _whole, defaults) => value === defaults['banner'],
  lobby_topic: (value, _whole, defaults) => value === defaults['lobby_topic'],
  // The member's own identity, three times over.
  node_id: (value, _whole, _defaults, _labels, launch) => value === launch.node_id.toLowerCase() && isNodeId(value),
  citizen_did: (value, _whole, _defaults, _labels, launch) => value === launch.node_id.toLowerCase() && isNodeId(value),
  'citizenship.citizen_did': (value, _whole, _defaults, _labels, launch) =>
    value === launch.node_id.toLowerCase() && isNodeId(value),
  // The label the server derives from that id, computed here (../name_a_node_by_its_petname).
  petname: (value, _whole, _defaults, _labels, launch) => value === petnameOf(launch.node_id),
  // The first station of the entry's own list, as the server spells it, or its default seed.
  connected_to: (value, _whole, defaults, _labels, launch) => value === stationOf(launch) || value === defaults['station'],
  // The member's own interval on its first call, or the server's default. A SECOND hello re-reports the first start's
  // value (the server raises it to its own minimum), which this rule does not admit: a false taint on the safe side.
  interval_seconds: (value, _whole, defaults, _labels, launch) =>
    isWholeNumber(value) && (value === launch.input['interval_seconds'] || value === defaults['interval_seconds']),
  already_active: isBoolean,
  said_goodbye: isBoolean,
  was_active: isBoolean,
  'citizenship.registered': isBoolean,
  rooms_left: isWholeNumber,
  'ring.allowlist_size': isWholeNumber,
  'ring.serving': (value) => value === 0 || value === 1,
  // The member's own serving procedure, built from the id the server holds: whatever one leading character the server
  // puts in front of it, then that id, then `/ring`. The leading character is never written here: a string literal
  // that starts at the home directory is refused in a slice (../prove_the_core/no_setting_outside_the_declaration),
  // and that check cannot tell a mesh procedure from a path. So the id is read at its offset instead.
  'ring.procedure': (value, _whole, _defaults, _labels, launch) => {
    const id = launch.node_id.toLowerCase()
    return (
      typeof value === 'string' &&
      value.length === id.length + SERVING_PROCEDURE_BYTES_AROUND_THE_ID &&
      value.slice(SERVING_PROCEDURE_LEADING_CHARACTERS, SERVING_PROCEDURE_LEADING_CHARACTERS + id.length) === id &&
      value.endsWith(SERVING_PROCEDURE_SUFFIX)
    )
  },
  'ring.contact_policy': (value, _whole, _defaults, labels) =>
    isWholeNumber(value) && Object.hasOwn(labels, String(value)),
  'ring.policy_label': (value, whole, _defaults, labels) => {
    const ring = isRecord(whole['ring']) ? whole['ring'] : {}
    return labels[String(ring['contact_policy'])] === value
  },
  'ring.policy_source': (value) => value === 'env' || value === 'file' || value === 'default',
  // The path the entry named, or the one under the HOME the launch gave the server.
  'ring.policy_file': (value, _whole, _defaults, _labels, launch) => value === policyFileOf(launch),
  // The operator's policy file is re-read on every call and rewritten by the server: only an empty list is admitted.
  'ring.offers': (value) => Array.isArray(value) && value.length === 0,
  // The ecosystem id of the realm that served `mcl-citizens/register_presence`. It is `plainHex(realm_id)` from another
  // node's advertisement, checked nowhere, so only the one shape that cannot carry an instruction is admitted.
  'citizenship.realm': isNodeId,
  'citizenship.registered_at': isIsoStamp,
  'citizenship.next_renewal_at': isIsoStamp,
  // The provider writes this instant, so it is admitted as a number and nothing else.
  'citizenship.expires_at': isWholeNumber,
  // The member's own names, as the server fits them: the entry's setting, its own operator name, the host it runs on.
  'citizenship.display_name': (value, _whole, _defaults, _labels, launch) =>
    displayNamesTheLaunchSupplies(launch).includes(String(value)),
  // The entry's realm portal, or the server's default. Also stripped of trailing slashes, as the server does.
  'realm.portal': (value, _whole, defaults, _labels, launch) => value === realmUrlOf(launch) || value === defaults['portal'],
  // A joined identity is the realm's to describe, and the realm's strings are its own: only "not joined" is admitted,
  // and the joined fields are not in the recorded shape at all.
  'realm.joined': (value) => value === false,
}

/** Whether this path's value is admitted, by its own rule; a path no rule names is words. */
function admits(
  path: string,
  value: unknown,
  whole: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, string | number | boolean | null>>,
  labels: Readonly<Record<string, string>>,
  launch: WhatTheLaunchSupplies,
): boolean {
  return ADMITS[path]?.(value, whole, defaults, labels, launch) ?? false
}

/**
 * The one JSON object an MCP tool's answer holds: exactly one text block, whose whole
 * text parses to a non-array object. Anything else — a string (the host's error
 * result), no block, two blocks — is not an answer this can read.
 *
 * ../read_a_ring_results_sender has the same parse for a ring's answer, private to it.
 * This is not that function imported: #247 owns that file and is closing without a
 * change, and a shared parse would mean two members editing one slice for a leaf each.
 * If a third caller appears, the two belong in one place and this note goes with it.
 */
export function oneJsonObjectIn(answer: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!Array.isArray(answer) || answer.length !== 1) return undefined
  const block = answer[0]
  if (!isRecord(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(block['text'])
  } catch {
    return undefined
  }
  return isRecord(parsed) ? parsed : undefined
}

/** The leaves of a JSON value: primitives and arrays, nested objects by their dotted path. */
function leavesOf(value: Readonly<Record<string, unknown>>, prefix = ''): readonly (readonly [string, unknown])[] {
  const leaves: (readonly [string, unknown])[] = []
  for (const [key, inner] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (isRecord(inner)) leaves.push(...leavesOf(inner, path))
    else leaves.push([path, inner] as const)
  }
  return leaves
}

/** The `host:port` of the first station the entry names, as the server reports it. */
export function stationOf(launch: WhatTheLaunchSupplies): string | undefined {
  const list = launch.env[STATIONS_VARIABLE]
  if (list === undefined || list === '') return undefined
  const first = list
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0)
  if (first === undefined) return undefined
  const match = /^(?:\[([^\]]+)\]|([^:@\s]+)):(\d+)@[0-9a-fA-F]{64}$/.exec(first)
  return match === null ? undefined : `${match[1] ?? match[2]}:${Number(match[3])}`
}

/** The contact-policy file the server reads: the entry's own, or the one under the HOME the launch gave it. */
export function policyFileOf(launch: WhatTheLaunchSupplies): string {
  const named = launch.env[CONTACT_POLICY_FILE_VARIABLE]
  if (named !== undefined && named !== '') return named
  return `${launch.home}/${CONTACT_POLICY_FILE_UNDER_HOME}`
}

/** The realm portal the server reports: the entry's own (trailing slashes stripped, as it does), else its default. */
export function realmUrlOf(launch: WhatTheLaunchSupplies): string | undefined {
  const named = launch.env[REALM_URL_VARIABLE]
  return named === undefined || named === '' ? undefined : named.replace(/\/+$/, '')
}

/**
 * The display names this launch can be answered with: the entry's setting, the member's
 * own `operator_name`, the host it runs on, and the server's fallback — each also in
 * the form the server's fitting leaves it in (0.51.2 trims and cuts it; 0.51.0 passes
 * the first non-empty candidate through as it is).
 */
export function displayNamesTheLaunchSupplies(launch: WhatTheLaunchSupplies): readonly string[] {
  const operator = launch.input['operator_name']
  const candidates = [
    launch.env[DISPLAY_NAME_VARIABLE],
    typeof operator === 'string' ? operator : undefined,
    `claude-code ${launch.host_version ?? ''}`.trim(),
    FALLBACK_DISPLAY_NAME,
  ]
  const names = candidates.flatMap((candidate) =>
    candidate === undefined || candidate === '' ? [] : [candidate, fitDisplayName(candidate)],
  )
  return names.filter((name): name is string => name !== undefined)
}

/** The server's own fitting: drop control characters and lone surrogates, trim, cut to 64 UTF-8 bytes on a boundary. */
export function fitDisplayName(candidate: string): string | undefined {
  const cleaned = candidate
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
  let out = ''
  let bytes = 0
  for (const character of cleaned) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > DISPLAY_NAME_BYTES) break
    out += character
    bytes += size
  }
  const fitted = out.trimEnd()
  return fitted === '' ? undefined : fitted
}

/** The one character the pinned server puts in front of the member's id in its serving procedure. */
const SERVING_PROCEDURE_LEADING_CHARACTERS = 1

/** What the serving procedure ends with, after the id. */
const SERVING_PROCEDURE_SUFFIX = '/ring'

/** The bytes around the id in a serving procedure: that one character, then the suffix. */
const SERVING_PROCEDURE_BYTES_AROUND_THE_ID =
  SERVING_PROCEDURE_LEADING_CHARACTERS + SERVING_PROCEDURE_SUFFIX.length

/** The bound mcl-citizens puts on a display name, as the pinned server's `MAX_DISPLAY_NAME_BYTES` sets it. */
export const DISPLAY_NAME_BYTES = 64

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoolean(value: unknown): boolean {
  return typeof value === 'boolean'
}

function isWholeNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** A node id, in the one form that cannot carry an instruction. */
function isNodeId(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** A whole-string ISO-8601 instant, so a stamp with text behind it is words. */
function isIsoStamp(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[]): boolean {
  if (left === undefined || left.length !== right.length) return false
  return left.every((value, at) => value === right[at])
}

function sameRecord(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (!sameStrings(leftKeys, rightKeys)) return false
  return leftKeys.every((key) => left[key] === right[key])
}
