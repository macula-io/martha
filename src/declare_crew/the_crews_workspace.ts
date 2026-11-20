// The crew's name, terminal, workspace and mesh (martha#931, Raf's draft on issuecomment-7033712899): the blocks that
// say where the crew lives and how it is reached, beside who is on it.
//
// The parse lives here, beside declare_crew, which hands it the declaration and its own refusal, as the thresholds are
// read (./the_crews_thresholds.ts). It takes no host and reads no file. Only the workspace's root is read by Martha
// today: it places the crew's clones, and its worktrees beside them. The rest is checked field by field, so a misspelt
// key is refused rather than ignored, and is read by no part of Martha yet.

import { isAbsolute, join, normalize, sep } from 'node:path'

/** The declaration's keys for the four blocks, kept here: declare_crew reads them through the lists below. */
const CREW_ID = 'id'
const TERMINAL = 'terminal'
const WORKSPACE = 'workspace'
const MESH = 'mesh'

/** The terminals a crew's members may be opened in; the first is the one a declaration that names none opens in. */
export const TERMINALS: readonly string[] = ['kitty', 'tmux']

/** The crew's name, when the declaration names one, and the terminal its members open in (martha#932). */
export interface WhereTheCrewOpens {
  readonly id: string | null
  readonly terminal: string
}

/** Where a crew opens when its declaration names neither an id nor a terminal. */
export const WHERE_A_CREW_OPENS_WHEN_UNNAMED: WhereTheCrewOpens = { id: null, terminal: TERMINALS[0]! }

/** Where the crew opens, from a declaration theWorkspacesClonesOf has already checked. */
export function whereTheCrewOpens(declaration: Block): WhereTheCrewOpens {
  const id = declaration[CREW_ID]
  const terminal = declaration[TERMINAL]
  return { id: typeof id === 'string' ? id.trim() : WHERE_A_CREW_OPENS_WHEN_UNNAMED.id, terminal: typeof terminal === 'string' ? terminal : WHERE_A_CREW_OPENS_WHEN_UNNAMED.terminal }
}

/** The fields a workspace may name: the folder its clones sit in, the folders allowed beside them, and its own orgs. */
export const WORKSPACE_KEYS = ['root', 'root_allowed', 'own_orgs'] as const

/** The mesh's own fields, and the services it names, each `{ service, on? }`. */
export const MESH_KEYS = ['realm', 'keys'] as const
export const MESH_SERVICES = ['mail', 'memory', 'graph', 'kanban'] as const
export const MESH_SERVICE_KEYS = ['service', 'on'] as const

/** A realm, as the mesh names one: 64 hex characters. */
export const A_REALM = /^[0-9a-f]{64}$/

/** An organisation's name, as GitHub spells one. */
export const AN_ORG = /^[A-Za-z0-9][A-Za-z0-9-]*$/

/** How a field of these blocks is refused: the field, dotted under its block, and why. */
export type RefuseAWorkspaceField = (field: string, why: string) => never

type Block = Readonly<Record<string, unknown>>

const isBlock = (value: unknown): value is Block => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

function refuseUnknownKeys(entry: Block, known: readonly string[], at: string, refuse: RefuseAWorkspaceField): void {
  const unknown = Object.keys(entry).find((key) => !known.includes(key))
  if (unknown !== undefined) refuse(`${at}.${unknown}`, `is not a field here (they are ${known.join(', ')})`)
}

/**
 * The folder the crew's clones sit in, absolute, when the declaration names a workspace root; null when it names none.
 * The four blocks are each checked here, so a misspelt field in any of them is refused by name.
 */
export function theWorkspacesClonesOf(declaration: Block, root: string, refuse: RefuseAWorkspaceField): string | null {
  const id = declaration[CREW_ID]
  if (id !== undefined && !isText(id)) refuse(CREW_ID, 'is not a name')
  const terminal = declaration[TERMINAL]
  if (terminal !== undefined && (typeof terminal !== 'string' || !TERMINALS.includes(terminal))) refuse(TERMINAL, `is not a terminal Martha knows (they are ${TERMINALS.join(', ')})`)
  refuseTheMesh(declaration[MESH], refuse)
  return clonesOf(declaration[WORKSPACE], root, refuse)
}

function clonesOf(value: unknown, root: string, refuse: RefuseAWorkspaceField): string | null {
  if (value === undefined) return null
  if (!isBlock(value)) return refuse(WORKSPACE, `is not an object of ${WORKSPACE_KEYS.join(', ')}`)
  refuseUnknownKeys(value, WORKSPACE_KEYS, WORKSPACE, refuse)
  refuseAList(value['root_allowed'], `${WORKSPACE}.root_allowed`, (entry) => isText(entry) && !entry.includes('/'), 'a folder name', refuse)
  refuseAList(value['own_orgs'], `${WORKSPACE}.own_orgs`, (entry) => typeof entry === 'string' && AN_ORG.test(entry), 'an organisation', refuse)
  const named = value['root']
  if (named === undefined) return null
  if (!isText(named) || isAbsolute(named)) return refuse(THE_WORKSPACES_ROOT, 'is not a folder relative to the project root')
  const clones = normalize(join(root, named))
  if (!clones.startsWith(root + sep)) refuse(THE_WORKSPACES_ROOT, 'leaves the project root')
  return clones
}

/** A list whose every entry passes `is`, refused by the entry's index when one does not; absent is no list at all. */
function refuseAList(value: unknown, at: string, is: (entry: unknown) => boolean, what: string, refuse: RefuseAWorkspaceField): void {
  if (value === undefined) return
  if (!Array.isArray(value)) return refuse(at, `is not a list of ${what}s`)
  value.forEach((entry: unknown, i) => {
    if (!is(entry)) refuse(`${at}[${i}]`, `is not ${what}`)
  })
}

/** The mesh block: a realm, the folder member keys sit in, and each service as `{ service, on? }`. */
function refuseTheMesh(value: unknown, refuse: RefuseAWorkspaceField): void {
  if (value === undefined) return
  if (!isBlock(value)) return refuse(MESH, `is not an object of ${[...MESH_KEYS, ...MESH_SERVICES].join(', ')}`)
  refuseUnknownKeys(value, [...MESH_KEYS, ...MESH_SERVICES], MESH, refuse)
  if (value['realm'] !== undefined && (typeof value['realm'] !== 'string' || !A_REALM.test(value['realm']))) refuse(`${MESH}.realm`, 'is not a realm: 64 hex characters')
  if (value['keys'] !== undefined && !isText(value['keys'])) refuse(`${MESH}.keys`, 'is not a folder')
  for (const name of MESH_SERVICES) refuseAService(value[name], `${MESH}.${name}`, refuse)
}

/** One service the mesh names: `{ service, on? }`, or nothing. */
function refuseAService(service: unknown, at: string, refuse: RefuseAWorkspaceField): void {
  if (service === undefined) return
  if (!isBlock(service)) return refuse(at, `is not an object of ${MESH_SERVICE_KEYS.join(', ')}`)
  refuseUnknownKeys(service, MESH_SERVICE_KEYS, at, refuse)
  if (!isText(service['service'])) refuse(`${at}.service`, 'is not a service name')
  if (service['on'] !== undefined && typeof service['on'] !== 'boolean') refuse(`${at}.on`, 'is not true or false')
}

/** The workspace's root as a refusal names it: the field a clones or worktrees place in house_rules is refused beside. */
export const THE_WORKSPACES_ROOT = `${WORKSPACE}.root`

/** The top-level keys this file checks, for declare_crew's list of the keys a declaration may hold. */
export const WORKSPACE_TOP_LEVEL_KEYS: readonly string[] = [CREW_ID, TERMINAL, WORKSPACE, MESH]

/** The fields of each block this file checks, by the block's key, for the declaration's page (docs/the-declaration.md). */
export const WORKSPACE_BLOCK_FIELDS: Readonly<Record<string, readonly string[]>> = {
  [WORKSPACE]: WORKSPACE_KEYS,
  [MESH]: [...MESH_KEYS, ...MESH_SERVICES],
}
