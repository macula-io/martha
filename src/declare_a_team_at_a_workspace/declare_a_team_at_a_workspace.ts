// `martha up` (martha#511): a team crew declared at a workspace, the folder that holds the owner's clones and worktrees.
//
// This exists so the owner opens one terminal in their workspace, types `martha up --claude && martha up`, and gets one
// crew across both hosts without writing its declaration by hand: a Supervisor and workers on Claude Code, workers on
// the engine. The workspace is not a git checkout, so the crew is the folder's own, keyed in Martha's state by its real
// path (../keep_martha_state_outside_the_checkout, crewKeyOf): every member started there reads one store and one channel.
//
// The members are config, not code (DECIDED 2026-11-20, Raf: "are the members hardcoded or via config?"). The team in
// ./the_claude_code_team.json only seeds the first declaration, written by whichever command runs first, with the parts
// every member shares: the owner, the team's table, how often a session reads the channel and the workspace layout.
// From then on the declaration is the config: each command starts the members it declares on its own host, with each
// member's own name and model, and a run never adds a member back. The owner changes the crew with `martha crew add`,
// `remove` and `set-model`, or by editing the file. Every member names its own host, so the command that starts one
// host's members can tell them by the declaration alone.
//
// It never writes over a declaration: the first write is O_EXCL.

import fs, { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { DocumentStore } from '../host_contract/host_contract.ts'
import {
  ACTS,
  APPROVE_LANDING,
  CHANNEL_READ_SECONDS_WHEN_UNNAMED,
  CLONES,
  DECLARATION_DIRECTORY,
  DECLARATION_FILE,
  DECLARATION_VERSION,
  DeclarationRefused,
  declareCrewOnHosts,
  HOLD_REVIEWS,
  HOST,
  OWNER,
  THE_ENGINES_HOST,
  WORKSPACE_LAYOUT,
  WORKTREES,
  WORKTREES_BESIDE_CLONES,
  type CrewSettings,
  type TheVocabulariesOfHost,
  type WorkspaceLayout,
} from '../declare_crew/declare_crew.ts'
import { declarationDirectory, NO_OWNER, writeOnce } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { nodeIdsFor, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'

/** The team `up --claude` declares, as data (./the_claude_code_team.json). */
const THE_CLAUDE_CODE_TEAM: { readonly mode: string; readonly model: string; readonly workers: number } = JSON.parse(
  readFileSync(new URL('./the_claude_code_team.json', import.meta.url), 'utf8'),
)

/** The mode a team is declared in: a name for people to read. */
export const TEAM_MODE = THE_CLAUDE_CODE_TEAM.mode

/** The team's roles: the one that hands out work and speaks to the owner, the ones that build, the ones that review. */
export const TEAM_ROLES = [SUPERVISOR, 'builder', 'reviewer'] as const
export const [SUPERVISOR_ROLE, BUILDER_ROLE, REVIEWER_ROLE] = TEAM_ROLES

/**
 * The team's table: the Supervisor assigns, offers the owner's asks, restarts and resumes beside the owner; a landing
 * is the owner's yes alone; and a builder's own session may be a review, as builders review each other's work.
 */
export const TEAM_TABLE = {
  ...Object.fromEntries(ACTS.map((act) => [act, [OWNER, SUPERVISOR_ROLE]])),
  [APPROVE_LANDING]: [OWNER],
  [HOLD_REVIEWS]: [OWNER, BUILDER_ROLE],
}

/** One member a command adds to the team: its name, its role, the model it runs and the host it runs on. */
export interface TeamMember {
  readonly name: string
  readonly role: string
  readonly model: string
  readonly host: string
}

/** The model the Claude Code members run (martha#511): Opus, by the alias Claude Code's own vocabulary spells. */
export const CLAUDE_CODE_TEAM_MODEL = THE_CLAUDE_CODE_TEAM.model

/** How many Claude Code workers `martha up --claude` adds beside its Supervisor. */
export const CLAUDE_CODE_WORKERS = THE_CLAUDE_CODE_TEAM.workers

/** The prefix a Claude Code worker's name takes before its number. */
export const CLAUDE_CODE_WORKER_PREFIX = `${CLAUDE_CODE_TEAM_MODEL}-`

/** The Claude Code members the first declaration is seeded with (martha#511): one Supervisor and the workers. */
export const CLAUDE_CODE_TEAM: readonly TeamMember[] = [
  { name: SUPERVISOR_ROLE, role: SUPERVISOR_ROLE, model: CLAUDE_CODE_TEAM_MODEL, host: CLAUDE_CODE },
  ...Array.from({ length: CLAUDE_CODE_WORKERS }, (_, i) => ({ name: `${CLAUDE_CODE_WORKER_PREFIX}${i + 1}`, role: BUILDER_ROLE, model: CLAUDE_CODE_TEAM_MODEL, host: CLAUDE_CODE })),
]

/** The workers plain `up` declares, as data (./the_engine_team.json). */
const THE_ENGINE_TEAM: { readonly model: string; readonly name: string; readonly workers: number; readonly endpoint: TheEngineTeamsEndpoint } = JSON.parse(
  readFileSync(new URL('./the_engine_team.json', import.meta.url), 'utf8'),
)

/** Where the engine's workers reach their model when the crew declares no endpoint: the provider, its URL and its key's variable. */
export interface TheEngineTeamsEndpoint {
  readonly provider: string
  readonly host: string
  readonly key_variable: string
}

/** The endpoint plain `martha up` declares when the crew has none (martha#511 part B, ruling (c)). */
export const ENGINE_TEAM_ENDPOINT: TheEngineTeamsEndpoint = THE_ENGINE_TEAM.endpoint

/** What plain `martha up` asks the owner, once, when the key's variable is unset: the file the key is in. */
export const THE_KEY_FILE_QUESTION = `Where is your ${ENGINE_TEAM_ENDPOINT.provider} key file? `

/** The model the engine's workers run (martha#511): DeepSeek Flash, as the provider's own model list names it. */
export const ENGINE_TEAM_MODEL = THE_ENGINE_TEAM.model

/** The members plain `martha up` adds (martha#511): the engine's workers, each a builder on the engine. */
export const ENGINE_TEAM: readonly TeamMember[] = Array.from({ length: THE_ENGINE_TEAM.workers }, (_, i) => ({
  name: `${THE_ENGINE_TEAM.name}-${i + 1}`,
  role: BUILDER_ROLE,
  model: ENGINE_TEAM_MODEL,
  host: THE_ENGINES_HOST,
}))

/**
 * The folder under a workspace that holds its clones, as `<clones>/<org>/<repo>`: a workspace that has one declares its
 * layout, with the worktrees beside it, as `martha init` declares one a checkout proves (martha#611).
 */
export const A_WORKSPACES_CLONES = 'github.com'

/** The layout a workspace holds: its clones folder and the worktrees beside it, or null when it has no clones folder. */
export function theLayoutAt(root: string): WorkspaceLayout | null {
  const clones = join(root, A_WORKSPACES_CLONES)
  return fs.statSync(clones, { throwIfNoEntry: false })?.isDirectory() === true ? { clones, worktrees: join(root, WORKTREES_BESIDE_CLONES) } : null
}

/** A team's declaration with `members`, in the shape the reader reads (../declare_crew): the parts both commands share. */
export function teamDeclaration(owner: string, layout: WorkspaceLayout | null, host: string, members: readonly TeamMember[]) {
  return {
    version: DECLARATION_VERSION,
    owner,
    [HOST]: host,
    members: members.map((member) => ({ name: member.name, role: member.role, model: member.model, [HOST]: member.host })),
    mode: { name: TEAM_MODE, roles: TEAM_ROLES, may: TEAM_TABLE },
    ...(layout === null ? {} : { house_rules: { [WORKSPACE_LAYOUT]: true, [CLONES]: layout.clones, [WORKTREES]: layout.worktrees } }),
    channel_read_seconds: CHANNEL_READ_SECONDS_WHEN_UNNAMED,
  }
}

export interface TeamRequest {
  /** The workspace's absolute path. */
  readonly root: string
  /** The owner's name, as git knows it; null when git has none. */
  readonly owner: string | null
  readonly state: MarthaState
  readonly documents: DocumentStore
  /** Each host's models, the declaration is read back against. */
  readonly vocabularies: TheVocabulariesOfHost
  /** The crew-level host a first write names. */
  readonly host: string
  /** The members the first declaration is seeded with; once a declaration exists, it is not read. */
  readonly seed: readonly TeamMember[]
}

export type TeamDeclared =
  | { readonly declared: true; readonly settings: CrewSettings; readonly declaration: string; readonly wrote: boolean }
  | { readonly declared: false; readonly refusal: string }

/** The crew the reader makes of the declaration at `root`, or its refusal's words. */
async function readTheCrew(request: TeamRequest): Promise<CrewSettings | string> {
  try {
    return await declareCrewOnHosts(request.documents, request.root, request.vocabularies)
  } catch (error) {
    if (error instanceof DeclarationRefused) return error.message
    throw error
  }
}

/** Writes the first declaration, with every member of the request; why not, or undefined. */
function writeTheFirst(request: TeamRequest, declaration: string): string | undefined {
  const owner = request.owner?.trim() ?? ''
  if (owner === '') return NO_OWNER
  const unmade = declarationDirectory(join(request.root, DECLARATION_DIRECTORY))
  if (unmade !== undefined) return unmade
  return writeOnce(declaration, `${JSON.stringify(teamDeclaration(owner, theLayoutAt(request.root), request.host, request.seed), null, 2)}\n`)
}

/**
 * The team declared at `root`: seeded with the request's members when there is no declaration, else read as it is;
 * then the seeded members are given their node ids, as `martha init` gives them.
 */
export async function declareTheTeam(request: TeamRequest): Promise<TeamDeclared> {
  const declaration = join(request.root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const wrote = !fs.existsSync(declaration)
  if (wrote) {
    const unwritten = writeTheFirst(request, declaration)
    if (unwritten !== undefined) return { declared: false, refusal: unwritten }
  }
  const settings = await readTheCrew(request)
  if (typeof settings === 'string') return { declared: false, refusal: settings }
  const ids = nodeIdsFor(request.state, wrote ? request.seed.map((member) => member.name) : [])
  if ('refusal' in ids) return { declared: false, refusal: ids.refusal }
  return { declared: true, settings, declaration, wrote }
}
