// Records the leaves of the pinned mesh server's own session answers, and the
// petnames it derives, one record per version of the server (martha#251).
//
// The strict shell gate may read a `mesh_hello` or `mesh_goodbye` answer as the
// member's own only while every leaf in it is something the launch supplied or can
// compute (../prove_a_mesh_answer_is_wordless). Which leaves an answer carries is the
// server's decision, not ours, so it is read from the server itself: two servers of
// the pinned version started with different settings, each asked the same tools.
//
// Runs once by hand for a version, never in CI: a recording is a reviewed act, and CI
// has no station to say hello to.
//
//   npm pack @macula-io/mcp@<version>
//   npm run record:mesh-answers -- <the .tgz npm pack wrote> <its server bin>
//
// What the two runs prove. A value both runs report the same way is no proof of
// anything on its own, so only the bare run's values are kept as defaults, and every
// one of them that follows a setting must DIFFER in the named run: that is what shows
// a default is the server's own and not an echo. `lobby_topic` is the one value no
// setting names, so it must stay the same. The station is the one exception, and it is
// named here rather than smoothed over: the recorder needs a station it can reach, so
// it moves from the server's default seed to the one the environment names, with the
// node id that station gave (MARTHA_RECORDING_STATION), and that is a different value,
// but it cannot also be moved somewhere unreachable to prove the point twice.
//
// What it does not become: it pins the leaves and defaults the pinned server gave when
// it was recorded, not that a running server still gives them, and never a value that
// is somebody's own — the answers are written down with every 64-hex id replaced.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { argv, env, exit, stderr } from 'node:process'

import { recordMeshTree } from '../install_the_recorded_mesh_server/install_the_recorded_mesh_server.ts'
import { MESH_TREE_RECORDING } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { MESH_SERVER_PACKAGE, RECORDED_MESH_SERVERS } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { MESH_GOODBYE, MESH_HELLO } from '../prove_a_mesh_answer_is_wordless/prove_a_mesh_answer_is_wordless.ts'
import { recordedNodeId, type RecordedId } from '../name_a_node_by_its_petname/name_a_node_by_its_petname.ts'
import { DEPENDENCIES } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { MeshServer } from './ask_a_mesh_server_a_tool.ts'

const SHAPES = new URL('../prove_a_mesh_answer_is_wordless/recorded_mesh_answer_shapes.json', import.meta.url)
const PETNAMES = new URL('../name_a_node_by_its_petname/recorded_petnames.json', import.meta.url)

/** The leaf a run's answer carries for each value a rule may read as "the server's default". */
const DEFAULT_LEAF: Readonly<Record<string, string>> = {
  banner: 'banner',
  lobby_topic: 'lobby_topic',
  station: 'connected_to',
  interval_seconds: 'interval_seconds',
  contact_policy: 'ring.contact_policy',
  policy_label: 'ring.policy_label',
  policy_source: 'ring.policy_source',
  portal: 'realm.portal',
}

/** The defaults a named setting must MOVE: proof that each one is the server's own default and not an echo. */
const FOLLOWS_A_SETTING: readonly string[] = [
  'banner',
  'station',
  'interval_seconds',
  'contact_policy',
  'policy_label',
  'policy_source',
  'portal',
]

/** The default no setting names, which must stay the same in both runs. */
const STAYS_THE_SAME: readonly string[] = ['lobby_topic']

/** The station the named run links to, as `host:port@<its node id>`, taken from the environment so this public tree keeps no station's id. */
const STATION_VARIABLE = 'MARTHA_RECORDING_STATION'

/** The station the named run links to, refused when the environment names none. */
function namedStation(): string {
  const named = env[STATION_VARIABLE]
  if (named === undefined || named === '') {
    throw new Error(`set ${STATION_VARIABLE} to host:port@<node id> of a station this recorder can reach`)
  }
  return named
}

/** The label the chosen id carries, so a replaced petname is still the one that id would get. */
const petnameForChosenId = 'bold_rust_moose_4847'

/** The ids the petname recording pins, each written as how it is made so this public tree keeps no node id. */
const PETNAME_IDS: readonly RecordedId[] = [
  { repeat: '0' },
  { repeat: 'f' },
  ...[1, 2, 3, 4, 5].map((n) => ({ sha256_of: `martha petnames ${n}` })),
]

interface AnswerRecord {
  readonly tools: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

interface RecordedVersion {
  readonly server_version: string
  readonly integrity: string
  readonly tools: Readonly<Record<string, readonly string[]>>
  readonly defaults: Readonly<Record<string, string | number | boolean | null>>
  readonly states: Readonly<Record<'bare' | 'named', Readonly<Record<string, unknown>>>>
  readonly labels: Readonly<Record<string, string>>
}

interface ShapeRecording {
  readonly _why: string
  readonly server: string
  readonly versions: readonly RecordedVersion[]
}

interface PetnameRecording {
  readonly _why: string
  readonly server: string
  readonly server_versions: readonly string[]
  readonly pairs: readonly { readonly id: RecordedId; readonly petname: string }[]
}

/** Every leaf of a JSON value: primitives and arrays, nested objects by their dotted path. */
function leavesOf(value: Readonly<Record<string, unknown>>, prefix = ''): readonly (readonly [string, unknown])[] {
  const leaves: (readonly [string, unknown])[] = []
  for (const [key, inner] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
      leaves.push(...leavesOf(inner as Readonly<Record<string, unknown>>, path))
    } else leaves.push([path, inner] as const)
  }
  return leaves
}

/** The value at a dotted path, or undefined when the answer carries no such leaf. */
function valueAt(answer: Readonly<Record<string, unknown>>, path: string): unknown {
  let node: unknown = answer
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined
    node = (node as Readonly<Record<string, unknown>>)[key]
  }
  return node
}

/**
 * The answer with every identity and every scratch path replaced, so nothing of a recorder's own is published: a
 * 64-hex id is replaced wherever it appears, a petname by the one the chosen id would carry, and the scratch root by
 * a path that never was.
 */
function withoutIdentities(answer: unknown, replacement: { readonly nodes: string; readonly petname: string; readonly scratch: string }): unknown {
  if (typeof answer === 'string') {
    return answer
      .replace(/[0-9a-f]{64}/g, replacement.nodes)
      .split(replacement.scratch)
      .join('/tmp/martha-record')
  }
  if (Array.isArray(answer)) return answer.map((inner) => withoutIdentities(inner, replacement))
  if (typeof answer === 'object' && answer !== null) {
    return Object.fromEntries(
      Object.entries(answer as Readonly<Record<string, unknown>>).map(([key, inner]) => {
        if (key === 'petname' && typeof inner === 'string') return [key, replacement.petname]
        return [key, withoutIdentities(inner, replacement)]
      }),
    )
  }
  return answer
}

/** One run of the pinned server: its HOME, its settings, its hello input. */
interface Run {
  readonly name: 'bare' | 'named'
  readonly home: string
  readonly env: Readonly<Record<string, string>>
  readonly hello: Readonly<Record<string, unknown>>
}

/** What one run's server answered, tool by tool. */
async function answersOf(server_file: string, run: Run): Promise<AnswerRecord> {
  const server = MeshServer.start(server_file, {
    HOME: run.home,
    MACULA_MCP_AGENT: `martha-record-${run.name}`,
    CLAUDE_CODE_SESSION_ID: `martha-record-${run.name}`,
    ...run.env,
  })
  try {
    await server.initialize()
    const hello = await server.tool(MESH_HELLO, run.hello)
    const goodbye = await server.tool(MESH_GOODBYE, {})
    return { tools: { [MESH_HELLO]: hello, [MESH_GOODBYE]: goodbye } }
  } finally {
    server.stop()
  }
}

/**
 * What a small script printed when it ran against the installed tree's own modules, or a failure naming it.
 *
 * The module is found by a name the installed tree holds, so nothing here imports a computed name: the one place a
 * module is named by a path is the child process's own script, which is data and never part of Martha's code.
 */
function askTheInstalledTree(installed: string, script: string, more: Readonly<Record<string, string>> = {}): unknown {
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env['PATH'] ?? '', TREE: installed, PACKAGE: MESH_SERVER_PACKAGE, ...more },
    encoding: 'utf8',
  })
  if (ran.status !== 0) throw new Error(`the installed tree's own module did not answer: ${(ran.stderr ?? '').trim()}`)
  return JSON.parse(ran.stdout)
}

/** The contact-policy labels the pinned server defines, by code, read from its own module. */
function labelsOf(tree: string): Readonly<Record<string, string>> {
  const script = `const p = await import(\`\${process.env.TREE}/node_modules/\${process.env.PACKAGE}/dist/policy.js\`);
console.log(JSON.stringify(Object.fromEntries(Object.values(p.POLICY).map((code) => [String(code), p.policyLabel(code)]))))`
  return askTheInstalledTree(tree, script) as Readonly<Record<string, string>>
}

/** The petnames the pinned server derives, read from its own module. */
function petnamesOf(tree: string): readonly { readonly id: RecordedId; readonly petname: string }[] {
  const script = `const m = await import(\`\${process.env.TREE}/node_modules/\${process.env.PACKAGE}/dist/petname.js\`);
console.log(JSON.stringify(JSON.parse(process.env.IDS).map((node_id) => ({ node_id, petname: m.petname(node_id) }))))`
  const taken = askTheInstalledTree(tree, script, { IDS: JSON.stringify(PETNAME_IDS.map(recordedNodeId)) }) as readonly {
    readonly node_id: string
    readonly petname: string
  }[]
  return PETNAME_IDS.map((id) => {
    const petname = taken.find((pair) => pair.node_id === recordedNodeId(id))?.petname
    if (petname === undefined) throw new Error(`the installed tree derived no petname for the id written as ${JSON.stringify(id)}`)
    return { id, petname }
  })
}

/** The recording with one version in it: added in version order, or replacing that version's record. */
function withVersion(current: ShapeRecording, record: RecordedVersion): ShapeRecording {
  const others = current.versions.filter((version) => version.server_version !== record.server_version)
  return { ...current, versions: [...others, record].sort((a, b) => compareVersions(a.server_version, b.server_version)) }
}

function compareVersions(left: string, right: string): number {
  const [a, b] = [left.split('.').map(Number), right.split('.').map(Number)]
  for (let at = 0; at < Math.max(a.length, b.length); at++) {
    const order = (a[at] ?? 0) - (b[at] ?? 0)
    if (order !== 0) return order
  }
  return 0
}

const [tarballPath, serverBin] = argv.slice(2)
if (tarballPath === undefined || serverBin === undefined) {
  stderr.write('usage: record_mesh_answers.ts <the .tgz npm pack wrote> <its server bin>\n')
  exit(2)
}

const scratch = mkdtempSync(join(tmpdir(), 'martha-record-answers-'))

/** The two runs: every setting empty, then every setting named. */
function runsIn(root: string): readonly Run[] {
  const bannerFile = join(root, 'banner.txt')
  const policyFile = join(root, 'contact_policy.json')
  writeFileSync(bannerFile, 'martha records the default banner\n')
  writeFileSync(
    policyFile,
    `${JSON.stringify({ contact_policy: 'closed', offers: ['martha records an answer shape'], allowlist: [] }, null, 2)}\n`,
  )
  return [
    { name: 'bare', home: join(root, 'home-bare'), env: {}, hello: { operator_name: 'martha recorder' } },
    {
      name: 'named',
      home: join(root, 'home-named'),
      env: {
        MACULA_MESH_STATIONS: namedStation(),
        MACULA_MCP_BANNER_FILE: bannerFile,
        MACULA_MCP_CONTACT_POLICY_FILE: policyFile,
        MACULA_MCP_REALM_URL: 'https://realm.beam-campus.net',
        MACULA_MCP_CITIZEN_DISPLAY_NAME: 'martha records the named run',
      },
      hello: { operator_name: 'martha recorder', interval_seconds: 30 },
    },
  ]
}


/** The leaves each tool answered with in both runs, or why the two runs disagree. */
function shapesInBothRuns(bare: AnswerRecord, named: AnswerRecord): Record<string, readonly string[]> {
  const tools: Record<string, readonly string[]> = {}
  for (const tool of [MESH_HELLO, MESH_GOODBYE]) {
    const bareLeaves = leavesOf(bare.tools[tool] ?? {}).map(([path]) => path)
    const namedLeaves = leavesOf(named.tools[tool] ?? {}).map(([path]) => path)
    const differ = bareLeaves.filter((path) => !namedLeaves.includes(path)).concat(namedLeaves.filter((path) => !bareLeaves.includes(path)))
    if (differ.length > 0) throw new Error(`${tool} answered different leaves in the two runs: ${differ.join(', ')}`)
    tools[tool] = [...bareLeaves].sort()
  }
  return tools
}

/** The bare run's values for the leaves a rule may read as the server's default, or why one is not a default. */
function defaultsIn(bare: AnswerRecord, named: AnswerRecord): Record<string, string | number | boolean | null> {
  const hello = bare.tools[MESH_HELLO] ?? {}
  const defaults: Record<string, string | number | boolean | null> = {}
  for (const [name, leaf] of Object.entries(DEFAULT_LEAF)) {
    const value = valueAt(hello, leaf)
    if (value === undefined) throw new Error(`the bare run reported no ${leaf}, so ${name} has no default`)
    defaults[name] = value as string | number | boolean | null
  }
  for (const name of FOLLOWS_A_SETTING) {
    if (defaults[name] === valueInTheNamedRun(name, named)) {
      throw new Error(`${name} is the same (${String(defaults[name])}) in both runs, so it is no default this can vouch for`)
    }
  }
  for (const name of STAYS_THE_SAME) {
    if (defaults[name] !== valueInTheNamedRun(name, named)) {
      throw new Error(`${name} moved between the runs, and no setting of the server names it`)
    }
  }
  return defaults
}

/** What the named run reported at the leaf a default is read from. */
function valueInTheNamedRun(name: string, named: AnswerRecord): unknown {
  const leaf = DEFAULT_LEAF[name]
  return leaf === undefined ? undefined : valueAt(named.tools[MESH_HELLO] ?? {}, leaf)
}

/** A version's whole shape record, from the two runs, the server's own labels and the tree it came from. */
function recordOfVersion(tree: { readonly server_version: string; readonly integrity: string }, installed: string, bare: AnswerRecord, named: AnswerRecord): RecordedVersion {
  const replacement = { nodes: '0'.repeat(64), petname: petnameForChosenId, scratch }
  return {
    server_version: tree.server_version,
    integrity: tree.integrity,
    tools: shapesInBothRuns(bare, named),
    defaults: defaultsIn(bare, named),
    states: {
      bare: withoutIdentities(bare.tools, replacement) as Readonly<Record<string, unknown>>,
      named: withoutIdentities(named.tools, replacement) as Readonly<Record<string, unknown>>,
    },
    labels: labelsOf(installed),
  }
}

/** Both runs of one server version, keyed by the run's name, or why one answered nothing. */
async function runsAnsweredIn(server_file: string, runs: readonly Run[]): Promise<Record<Run['name'], AnswerRecord>> {
  const answered: Partial<Record<Run['name'], AnswerRecord>> = {}
  for (const run of runs) {
    mkdirSync(run.home, { recursive: true })
    answered[run.name] = await answersOf(server_file, run)
  }
  const bare = answered.bare
  const named = answered.named
  if (bare === undefined || named === undefined) throw new Error('a run answered nothing')
  return { bare, named }
}

try {
  const tree = recordMeshTree({ tarball: readFileSync(tarballPath), recording: MESH_TREE_RECORDING, scratch })
  const record_of_server = RECORDED_MESH_SERVERS.find((recorded) => recorded.server_version === tree.server_version)
  const bin = record_of_server?.bins[serverBin]
  if (record_of_server === undefined || bin === undefined) {
    stderr.write(`${MESH_SERVER_PACKAGE} ${tree.server_version} has no recorded bin ${serverBin}\n`)
    exit(1)
  }
  const installed = join(scratch, 'installed-tree')
  const server_file = join(installed, DEPENDENCIES, MESH_SERVER_PACKAGE, bin)

  const { bare, named } = await runsAnsweredIn(server_file, runsIn(scratch))

  const current = JSON.parse(readFileSync(SHAPES, 'utf8')) as ShapeRecording
  const record = recordOfVersion(tree, installed, bare, named)
  writeFileSync(SHAPES, `${JSON.stringify(withVersion(current, record), null, 2)}\n`)

  const petnames = petnamesOf(installed)
  const kept = JSON.parse(readFileSync(PETNAMES, 'utf8')) as PetnameRecording
  const disagreement = kept.pairs.filter(
    (pair) => petnames.find((taken) => recordedNodeId(taken.id) === recordedNodeId(pair.id))?.petname !== pair.petname,
  )
  if (disagreement.length > 0) {
    throw new Error(`${MESH_SERVER_PACKAGE} ${tree.server_version} derives different petnames for ${disagreement.map((pair) => recordedNodeId(pair.id)).join(', ')}`)
  }
  const versions = [...new Set([...kept.server_versions, tree.server_version])].sort(compareVersions)
  writeFileSync(PETNAMES, `${JSON.stringify({ ...kept, server_versions: versions, pairs: [...petnames] }, null, 2)}\n`)

  process.stdout.write(`recorded ${MESH_SERVER_PACKAGE} ${tree.server_version}: ${Object.keys(record.tools).join(', ')}\n`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
