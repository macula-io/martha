// Declare the crew.
//
// A crew is declared as data, in the project's `.martha/martha.json`: who is on it,
// the mode's table of who may do what, and the house rules as switches. This
// slice reads that declaration once, checks every field, and returns one frozen
// CrewSettings. Every later slice takes CrewSettings, or the part it needs, as an
// argument; none reads a global, an environment variable or a home path for a
// setting (no_setting_outside_the_declaration.ts keeps that true).
//
// Solo and team are not two code paths. A mode is a name and a table: solo is a
// table in which the owner may do everything, team is a table with roles. The
// name is carried for people to read and is never compared here.
//
// Nothing is defaulted silently. A missing or unreadable declaration and a field
// of the wrong shape are each refused with the file and the field. A key this
// slice does not know, and a review model a host cannot run, are said in one line
// naming them and the crew is read on (martha#601): neither stops a leaked key,
// lost work, or a push to main without the owner's yes. What a release's init did not write is another matter,
// and each such field reads as the value init writes today: a house rule the
// declaration does not name is off, a table that names no act grants it to the
// owner alone (whoTheTableGrants), and a declaration that names no
// channel_read_seconds reads that value too (martha#374), so a file an earlier
// release wrote still declares.

import { hostRuns, type ModelVocabulary } from './a_hosts_model_vocabulary.ts'

export type { ModelVocabulary } from './a_hosts_model_vocabulary.ts'
import { memberNameKey } from './member_names.ts'
import { GITHUB, GITHUB_KEYS, githubOf, type CrewGithub } from './the_crews_github.ts'
import { TRANSCRIPTS, TRANSCRIPTS_KEYS, transcriptsOf, type CrewTranscripts } from './the_crews_transcripts.ts'
import { THRESHOLDS, THRESHOLDS_KEYS, thresholdsOf, type CrewThresholds } from './the_crews_thresholds.ts'
import { OWNER_NOTICES, OWNER_NOTICES_KEYS, ownerNoticesOf, type CrewOwnerNotices } from './the_crews_owner_notices.ts'
import { CLOCK_ZONE, clockZoneOf } from './the_crews_clock_zone.ts'
import { PROFILE, PROFILE_BLOCK_FIELDS, PROFILE_TOP_LEVEL_KEYS, profilesOf, theProfileOfAMember, type Billing, type TheProfiles } from './the_crews_profiles.ts'
export { BILLED_BY_API_KEY, BILLED_BY_SUBSCRIPTION, BILLINGS, type Billing } from './the_crews_profiles.ts'
import { ENGINE_ENDPOINT, ENGINE_ENDPOINT_OPTIONAL_KEYS, ENGINE_ENDPOINT_REQUIRED_KEYS, theEnginesEndpointOf, type EngineEndpoint } from './the_engines_endpoint.ts'
export {
  AN_ENVIRONMENT_NAME,
  ENDPOINT_SCHEMES,
  ENGINE_ENDPOINT,
  ENGINE_ENDPOINT_OPTIONAL_KEYS,
  ENGINE_ENDPOINT_REQUIRED_KEYS,
  THE_SCHEME_OF_A_BARE_HOST,
  isAKeyFilesPath,
  type EngineEndpoint,
} from './the_engines_endpoint.ts'
import { THE_WORKSPACES_ROOT, WORKSPACE_BLOCK_FIELDS, WORKSPACE_TOP_LEVEL_KEYS, theWorkspacesClonesOf, whereTheCrewOpens, type WhereTheCrewOpens } from './the_crews_workspace.ts'
import { isAbsolute, basename, dirname, join, normalize, sep } from 'node:path'

import type { DocumentStore } from '../host_contract/host_contract.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { GATE_AUDITS, GATE_ENFORCES, gateSettingOf, type GateSetting } from '../read_the_gate_mode/read_the_gate_mode.ts'

/** Where a crew's declaration lives, relative to the project root (martha#468: the folder is Martha's own). */
export const DECLARATION_DIRECTORY = '.martha'
export const DECLARATION_FILE = 'martha.json'

/**
 * The key a crew's host is declared under, at the top level and on a member (martha#541, package 5): one file says
 * which host runs each member, so `martha start` and `martha wake` start it there and never on another host.
 */
export const HOST = 'host'

/**
 * The host every release before this one started a member on (martha#541): what a declaration that names no host at
 * all reads as, under this reader's upgrade rule, so a crew an earlier release's init wrote still starts.
 */
export const THE_HOST_A_MEMBER_RAN_ON = CLAUDE_CODE

/**
 * The host Martha's engine is, as the engine's own recording names it (martha#547): one definition, read from the
 * recording rather than typed, so the name the declaration accepts and the name a launch starts cannot drift.
 */
export const THE_ENGINES_HOST: string = RECORDED_GOOSE_ENGINE.engine_name

/**
 * The hosts a declaration may name (martha#541, package 5): the hosts Martha knows. A name outside this list is refused
 * by field, naming these; a host in it that this release has no launcher for is refused at the start, by name, and is
 * never started on another host.
 */
export const HOSTS_IT_KNOWS: readonly string[] = [THE_HOST_A_MEMBER_RAN_ON, THE_ENGINES_HOST]

/**
 * The declaration crew-code reads, which an older checkout of Martha's may still hold in place of Martha's own
 * (martha#468). Named only so a refusal can say which file it found: nothing here reads one of its fields.
 */
export const CREW_CODE_DECLARATION_DIRECTORY = '.crew'
export const CREW_CODE_DECLARATION_FILE = 'crew.json'

/** The one declaration version this slice reads. */
export const DECLARATION_VERSION = 1

/**
 * The act that lets a member take the owner's queued asks and settle a batch of them (martha#313): one act for both
 * tools, so a crew cannot let a session take asks it may not settle.
 */
export const OFFER_OWNER_ASKS = 'offer_owner_asks'

/**
 * How often a session reads the crew's channel for a message it has not taken in (martha#253), for a declaration that
 * does not say (martha#374, the owner's 2026-11-13 ruling "use init's value"). One definition, and both sides use it:
 * `martha init` writes it into a new crew's file (../declare_a_solo_crew), and this slice reads a file an earlier
 * release's init wrote as that same value, so a crew declared before the field existed reads as one declared today.
 */
export const CHANNEL_READ_SECONDS_WHEN_UNNAMED = 30

/**
 * How long, in minutes, a handover waits behind a member's running turn before that turn is ended so the handover can
 * run (martha#311), for a declaration that does not say: the draft crew's ten.
 */
export const HANDOVER_CEILING_MINUTES_WHEN_UNNAMED = 10

/**
 * The range a declared ceiling must fall in (martha#311): below it every running turn would be ended at once, and above
 * it the end would never come inside one session.
 */
export const HANDOVER_CEILING_MINUTES_LEAST = 1
export const HANDOVER_CEILING_MINUTES_MOST = 60

/**
 * The act that lets a role's members end another member's session and start it again (martha#312): ending a session
 * mid-turn is a stronger act than unparking one, so it is granted on its own.
 */
export const RESTART_MEMBER = 'restart_member'

/**
 * The act whose yes a landing on a default branch stands on (martha#605): granted to the owner, the landing needs an ask
 * the owner said yes to; granted to a role, a member of that role says it by landing.
 */
export const APPROVE_LANDING = 'approve_landing'

/**
 * The act whose holders are the crew's reviewers (martha#541 package 6b): a member whose role holds it has its own
 * session held to `house_rules.review_model`, and a crew that grants it to no role has no reviewer members. An act and
 * not a role name, because roles are the crew's own words (`reviewer`, `critic`, `second_pair_of_eyes`) and Martha never
 * reads meaning into a name.
 */
export const HOLD_REVIEWS = 'hold_reviews'

/** The acts a mode's table assigns, in business words. */
export const ACTS = ['assign_work', APPROVE_LANDING, 'resume_parked_work', OFFER_OWNER_ASKS, RESTART_MEMBER, HOLD_REVIEWS] as const
export type Act = (typeof ACTS)[number]

/**
 * The owner, in a mode's table. The owner is a person, not a member, so no
 * member's role may take this name.
 */
export const OWNER = 'owner'

/**
 * The house rule that opens the crew's pane at a session's start and keeps its rows (martha#254). Off unless the
 * declaration names it, as every switch is: a crew that names no dashboard opens no pane and reports nothing.
 */
export const DASHBOARD = 'dashboard'

/** The house rule that runs the strict shell gate (martha#259): a session that took in text it cannot trace executes
 * nothing until it is replaced. Off unless the declaration names it, as every switch is, so an owner who wrote no
 * `house_rules` gets a member that keeps its shell (DECIDED 2026-11-11 "make the guard opt-in").
 *
 * Read for one upgrade only, since macula-io/martha#321 replaced it with `gate_enforces` and `gate_audits`: a file an
 * earlier release wrote still declares, and `true` there reads as the gate enforcing for every member. Nothing reads
 * this switch beside the new fields — see ../read_the_gate_mode for the one reading.
 */
export const STRICT_GATE = 'strict_gate'

/**
 * Whether the owner's bells ring when a member's host starts asking them something (martha#313): a bell in the member's
 * terminal and a desktop notification beside it, off unless the declaration turns it on. A member's own report never
 * rings it, so a member cannot make it a nuisance; the owner can mute one member's bells without touching the others.
 */
export const OWNER_BELL = 'owner_bell'

/** Whether a member hands over after a finished task (martha#255): off unless the declaration says true. */
export const REFRESH_BETWEEN_TASKS = 'refresh_between_tasks'

/**
 * The house rule that has the crew tell its Supervisor when work stalls (martha#320): a quiet member, a HANDOFF nobody
 * answered, a wait on a person, and a cycle of waits. Off unless the declaration names it, as every switch is, and it
 * takes three windows with it, so a crew that turns nudges on and names no window is refused rather than given one in
 * code.
 */
export const NUDGES = 'nudges'

/** The three windows a crew that reads nudges names, each in whole minutes: how long a stall, a review and a wait on a
 * person are allowed to last. Zero is a number a crew may mean — it turns that kind of nudge off. */
export const STALLED_MINUTES = 'stalled_minutes'
export const REVIEW_MINUTES = 'review_minutes'
export const PERSON_MINUTES = 'person_minutes'
export const NUDGE_MINUTES = [STALLED_MINUTES, REVIEW_MINUTES, PERSON_MINUTES] as const

/**
 * The house rule that wakes a member which is idle with work nobody holds (martha#959): off unless the declaration names
 * it, and it names two windows with it — the first wait, and the cap the doubling stops at — so no member is woken on a
 * window the code made up. `after_minutes: 0` is a crew that keeps the rule and turns it off.
 */
export const WAKE = 'wake'
export const WAKE_AFTER_MINUTES = 'wake_after_minutes'
export const WAKE_CAP_MINUTES = 'wake_cap_minutes'
export const WAKE_MINUTES = [WAKE_AFTER_MINUTES, WAKE_CAP_MINUTES] as const

/** Every window a house rule names, in whole minutes: the nudge windows, and the wake's two. */
export const HOUSE_RULE_MINUTES = [...NUDGE_MINUTES, ...WAKE_MINUTES] as const
export type HouseRuleMinutes = (typeof HOUSE_RULE_MINUTES)[number]

/** How many milliseconds a minute is: the unit these windows are named in, and the one the rules read them as. */
export const MINUTE_MS = 60_000

/**
 * Where a crew looks for work nobody holds (martha#319, package B): the top-level key, its places, and the idle window.
 * A declaration without the key has no backlog view and no idle nudge. With the key, `idle_minutes` is required and has
 * no default, as every window here; 0 turns the nudge off and leaves the view.
 */
export const BACKLOG = 'backlog'
export const BACKLOG_KEYS = ['places', 'idle_minutes'] as const

/** A place a backlog names: an organisation, or one repository of it. */
export const A_BACKLOG_PLACE = /^[A-Za-z0-9][A-Za-z0-9-]*(\/[A-Za-z0-9._-]+)?$/

/**
 * The roots a reboot deletes (martha#314): the top-level key naming them, as absolute paths. A declaration that names
 * none reads as an empty list, and the launch's own machine roots apply (../tell_a_citer_of_a_volatile_path), so a
 * crew declared before this key existed still declares after an upgrade. An explicit empty list is refused rather than
 * read as "none of mine": the key declares roots, it does not switch the note off, so a crew that wants the machine's
 * roots leaves the key out.
 */
export const VOLATILE_PATHS = 'volatile_paths'

/** A declared backlog: the places to look in, and how long a member may sit idle beside unheld work before a nudge. */
export interface Backlog {
  readonly places: readonly string[]
  readonly idle_minutes: number
}

/** The house rule that turns a crew's workspace layout on (martha#256), which brings the two places below with it. */
export const WORKSPACE_LAYOUT = 'workspace_layout'

/** The house rules a crew can switch on. Each is off unless the declaration says true. */
export const HOUSE_RULE_SWITCHES = ['owner_items', WORKSPACE_LAYOUT, 'member_work', 'practice', STRICT_GATE, DASHBOARD, REFRESH_BETWEEN_TASKS, OWNER_BELL, NUDGES, WAKE] as const
export type HouseRuleSwitch = (typeof HOUSE_RULE_SWITCHES)[number]

/** The house rule that names a model rather than switching a rule on. */
export const REVIEW_MODEL = 'review_model'

/**
 * The house rules that name a place rather than switching a rule on (martha#256): where a crew keeps its clones,
 * and where it keeps the worktrees its members branch in. They belong to `workspace_layout`, so that rule being on
 * means both are named: a crew that turned the layout on and named no places would have members making worktrees
 * wherever they happened to be.
 */
export const CLONES = 'clones'
export const WORKTREES = 'worktrees'
export const HOUSE_RULE_PLACES = [CLONES, WORKTREES] as const
export type HouseRulePlace = (typeof HOUSE_RULE_PLACES)[number]

/** The two places a crew's workspace layout names (martha#256): where its clones sit, and where its worktrees are made. */
export interface WorkspaceLayout {
  readonly clones: string
  readonly worktrees: string
}

/** The place a crew's worktrees sit in, beside the place that holds its clones: `worktrees` next to `clones`. */
export const WORKTREES_BESIDE_CLONES = 'worktrees'

/** What a checkout that proves no layout is told to add, in the words of this declaration's own keys (martha#611). */
export const LAYOUT_TO_ADD = 'Add "workspace_layout": true with "clones" and "worktrees" to house_rules to declare one.'

/** What a checkout's own path proves about its workspace (martha#611): the layout to declare, and the line `martha init` says of it. */
export interface WhatACheckoutProves {
  /** The two places to declare, or null when the checkout proves none. */
  readonly layout: WorkspaceLayout | null
  /** The line init says after its first: the two places, or why there is none and what to add. */
  readonly said: string
}

/** A checkout that proves no layout: none to declare, and the line that says why and what to add instead. */
const noLayout = (why: string): WhatACheckoutProves => ({ layout: null, said: `No workspace layout: ${why}. ${LAYOUT_TO_ADD}` })

/**
 * The workspace layout a checkout's own path proves (martha#611): a checkout at `<clones>/<org>/<name>`, whose origin
 * names that same `org/name`, keeps its clones in `<clones>` and its worktrees in `worktrees` beside them. A checkout
 * the origin does not place there proves no layout — what would be written is a guess about places the owner never
 * named — so the reason is answered instead, and `martha init` reads it (../declare_a_solo_crew).
 */
export function workspaceLayoutOf(root: string, repo: string | undefined, origin: string | null): WhatACheckoutProves {
  if (repo === undefined) {
    // The origin is not quoted back: it can carry a token in its userinfo, and this line is printed.
    const why = origin === null ? `${root} names no origin remote` : `the origin of ${root} names no repository as org/name`
    return noLayout(why)
  }
  if (`${basename(dirname(root))}/${basename(root)}` !== repo) return noLayout(`${root} does not sit at <clones>/${repo}`)
  const clones = dirname(dirname(root))
  const layout = { clones, worktrees: join(dirname(clones), WORKTREES_BESIDE_CLONES) }
  return { layout, said: `Workspace layout declared: clones ${layout.clones}, worktrees ${layout.worktrees}.` }
}

/** The mode a solo crew is declared in: a name for people to read. */
export const SOLO_MODE = 'solo'

/**
 * The role a solo crew's reviewer is in (martha#541 package 6b): the one role that holds `hold_reviews`, so a solo
 * crew's reviewer is a reviewer member and its own session is held to the crew's reviewer model. Not exported: the
 * word is this declaration's own, and a published constant would make every crew's spelling of its reviewer a finding.
 */
const SOLO_REVIEWER_ROLE = 'reviewer'

/** The members of a solo crew, each in the role it is named after. */
export const SOLO_MEMBERS = [
  { name: 'builder', role: 'builder' },
  { name: SOLO_REVIEWER_ROLE, role: SOLO_REVIEWER_ROLE },
] as const

/**
 * A solo crew's declaration (martha#98): the owner may do every act, how often its sessions read the crew channel
 * (martha#253) is the one value a writer sets and this reader reads a missing field as (martha#374), and the layout
 * its checkout proves (martha#611) is declared when one was given. The shape lives beside the reader so that what a
 * writer emits and what this slice accepts cannot drift; `martha init` writes it (../declare_a_solo_crew), and the
 * two places of a layout are written together or not at all, as a layout naming one without the other is refused here.
 *
 * A solo crew's reviewer role holds `hold_reviews` (martha#541 package 6b), so its own session is a review; every
 * other act is the owner's alone. A declaration written before the act existed names it nowhere, which reads as the
 * owner's alone, so an older crew is unchanged.
 */
export function soloDeclaration(owner: string, layout: WorkspaceLayout | null = null, host: string = THE_HOST_A_MEMBER_RAN_ON) {
  return {
    version: DECLARATION_VERSION,
    owner,
    host,
    members: SOLO_MEMBERS,
    mode: {
      name: SOLO_MODE,
      roles: SOLO_MEMBERS.map((member) => member.role),
      may: { ...Object.fromEntries(ACTS.map((act) => [act, [OWNER]])), [HOLD_REVIEWS]: [OWNER, SOLO_REVIEWER_ROLE] },
    },
    ...(layout === null ? {} : { house_rules: { [WORKSPACE_LAYOUT]: true, [CLONES]: layout.clones, [WORKTREES]: layout.worktrees } }),
    channel_read_seconds: CHANNEL_READ_SECONDS_WHEN_UNNAMED,
  }
}

/**
 * The two directories a role's text and a mode's text sit in (martha#306), named once here because two trees use the
 * same layout: a crew writes its own under its crew directory, and Martha ships the ones a crew has not written under
 * the same two names, so a crew overrides a shipped text by putting a file of the same name in the same place.
 */
export const ROLE_TEXTS_DIRECTORY = 'roles'
export const MODE_TEXTS_DIRECTORY = 'modes'

/** A member's name: what a crew calls it, and what its branches start with. */
export const MEMBER_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/

/** The one rule member names are compared by (martha#528), held in ./member_names.ts so a slice this one imports can use it. */
export { memberNameKey, sameMemberName } from './member_names.ts'


export interface Member {
  readonly name: string
  readonly role: string
  readonly model: string | null
  /** The host this member is started on, when the declaration names one for it; null when the crew's own applies. */
  readonly host: string | null
  /**
   * Declared but kept down (martha#511, the `parked` of Raf's draft on #931): `martha up` starts every member that is
   * not parked; false when the declaration does not say. Not the park a running member's work is put in.
   */
  readonly parked: boolean
  /**
   * The credential this member is billed through when it runs on Claude Code (martha#916): its profile's provider's
   * `billing`; null when it names no profile, or its provider names none, and the launch then picks.
   */
  readonly billing: Billing | null
}

export interface Mode {
  readonly name: string
  readonly roles: readonly string[]
  /** For each act, the roles (or the owner) that may take it. */
  readonly may: Readonly<Record<Act, readonly string[]>>
}

export type HouseRules = Readonly<Record<HouseRuleSwitch, boolean>> & {
  readonly review_model: string | null
  readonly clones: string | null
  readonly worktrees: string | null
} & Readonly<Record<HouseRuleMinutes, number | null>>

export interface CrewPaths {
  readonly root: string
  readonly crew: string
  readonly declaration: string
  /** The crew's conventions document, when it declares one. Read by the slices that render text. */
  readonly conventions: string | null
}

export interface CrewSettings {
  readonly paths: CrewPaths
  readonly owner: string
  /**
   * The host the crew starts a member on when the member names none (martha#541): the declaration's crew-level `host`,
   * or THE_HOST_A_MEMBER_RAN_ON when the declaration names none at all, so a file an earlier release wrote still
   * declares and still starts the host it always started.
   */
  readonly host: string
  readonly members: readonly Member[]
  readonly mode: Mode
  readonly house_rules: HouseRules
  /**
   * What the shell gate does to a member (martha#321): off, audited, or enforced, read once from the declaration's own
   * fields and from the old `strict_gate` boolean. Read it through ../read_the_gate_mode's gateModeFor, never by
   * comparing fields here.
   */
  readonly gate: GateSetting
  /**
   * How often, in seconds, a member's session reads the crew's channel for a message it has not taken in (martha#253).
   * A declaration that names none reads as the value `martha init` writes (martha#374), so a crew declared by an
   * earlier release carries messages without its owner editing the file.
   */
  readonly channel_read_seconds: number
  /**
   * How long a handover may wait behind a running turn before that turn is ended (martha#311): whole minutes, from
   * HANDOVER_CEILING_MINUTES_LEAST to HANDOVER_CEILING_MINUTES_MOST, and HANDOVER_CEILING_MINUTES_WHEN_UNNAMED when the
   * declaration names none.
   */
  readonly handover_ceiling_minutes: number
  /** Where to look for work nobody holds, and the idle window (martha#319); null when the declaration names none. */
  readonly backlog: Backlog | null
  /**
   * The roots a reboot deletes (martha#314), as the declaration names them; empty when it names none, and the launch's
   * own machine roots apply there. Read by ../tell_a_citer_of_a_volatile_path, which never writes a root of its own.
   */
  readonly volatile_paths: readonly string[]
  /** Where an engine member's model is reached (martha#541 package A), or null when the declaration names none. */
  readonly engine_endpoint: EngineEndpoint | null
  /** The crew's thresholds (martha#931 A): see ./the_crews_thresholds; each field the declaration leaves out reads today's value. */
  readonly thresholds: CrewThresholds
  /** The crew's GitHub block (martha#931 B): see ./the_crews_github. */
  readonly github: CrewGithub
  /** The crew's transcript bounds (martha#931 B): see ./the_crews_transcripts. */
  readonly transcripts: CrewTranscripts
  /** The host's notifications the owner is told of (martha#931 C): see ./the_crews_owner_notices. */
  readonly owner_notices: CrewOwnerNotices
  /** The time zone every clock time Martha prints for the crew reads in (martha#931 C): see ./the_crews_clock_zone. */
  readonly clock_zone: string
  /** The crew's name and the terminal its members open in (martha#932): see ./the_crews_workspace's whereTheCrewOpens. */
  readonly opens: WhereTheCrewOpens
}

/** Why a declaration is not one: the file, and the field when one is to blame. */
export class DeclarationRefused extends Error {
  readonly file: string
  readonly field: string | null

  constructor(file: string, field: string | null, why: string) {
    super(field === null ? `${file}: ${why}` : `${file}: ${field} ${why}`)
    this.name = 'DeclarationRefused'
    this.file = file
    this.field = field
  }
}

const TOP_LEVEL_KEYS = ['version', 'owner', 'members', 'mode', 'house_rules', 'conventions', 'channel_read_seconds', 'handover_ceiling_minutes', BACKLOG, VOLATILE_PATHS, HOST, ENGINE_ENDPOINT, THRESHOLDS, GITHUB, TRANSCRIPTS, OWNER_NOTICES, CLOCK_ZONE, ...WORKSPACE_TOP_LEVEL_KEYS, ...PROFILE_TOP_LEVEL_KEYS] as const
const REQUIRED_MEMBER_KEYS = ['name', 'role'] as const
/** The member key `martha up` reads to leave a declared member down (martha#511). */
export const PARKED = 'parked'
/**
 * The member key naming the file a member's mesh key is in (martha#931, DECIDED 2026-11-20 "ok we rely on the default"):
 * left out, the key is `<mesh.keys>/agent-<lowercased name>.key`. Checked as a path, read by no part of Martha today.
 */
export const MESH_KEY = 'mesh_key'
const OPTIONAL_MEMBER_KEYS = ['model', HOST, PARKED, PROFILE, MESH_KEY] as const
const MEMBER_KEYS = [...REQUIRED_MEMBER_KEYS, ...OPTIONAL_MEMBER_KEYS] as const
const MODE_KEYS = ['name', 'roles', 'may'] as const

// What a field must look like, written from its keys: `{ a, b, c? }`.
const shapeOf = (required: readonly string[], optional: readonly string[] = []) =>
  `{ ${[...required, ...optional.map(key => `${key}?`)].join(', ')} }`
/**
 * `gate_enforces` as Raf's draft spells it (martha#931): read as `gate_enforces`, and refused beside it, so one file
 * never names who the gate enforces for twice. The draft is open for comment; this keeps the file he has declaring.
 */
export const GATE_ENFORCE_AS_DRAFTED = 'gate_enforce'
const HOUSE_RULE_KEYS: readonly string[] = [
  ...HOUSE_RULE_SWITCHES,
  REVIEW_MODEL,
  ...HOUSE_RULE_PLACES,
  ...HOUSE_RULE_MINUTES,
  GATE_ENFORCES,
  GATE_AUDITS,
  GATE_ENFORCE_AS_DRAFTED,
]

/**
 * Every field a declaration may hold, by the block it sits in ('' for the top level; `members` for each member): the
 * lists the parse below refuses an unknown key by. docs/the-declaration.md names each one, and
 * ./the_declaration_page.node-test.ts holds the page to these lists both ways (martha#931).
 */
export const DECLARATION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  '': TOP_LEVEL_KEYS,
  members: MEMBER_KEYS,
  mode: MODE_KEYS,
  house_rules: HOUSE_RULE_KEYS,
  [BACKLOG]: BACKLOG_KEYS,
  [ENGINE_ENDPOINT]: [...ENGINE_ENDPOINT_REQUIRED_KEYS, ...ENGINE_ENDPOINT_OPTIONAL_KEYS],
  [THRESHOLDS]: THRESHOLDS_KEYS,
  [GITHUB]: GITHUB_KEYS,
  [TRANSCRIPTS]: TRANSCRIPTS_KEYS,
  [OWNER_NOTICES]: OWNER_NOTICES_KEYS,
  ...WORKSPACE_BLOCK_FIELDS,
  ...PROFILE_BLOCK_FIELDS,
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/**
 * Read the crew's declaration under `root` once, through the host's document
 * store, and return its settings. `root` is the project's absolute path, as the
 * composer knows it.
 *
 * `models` is the vocabulary the host runs, as its adapter records it (martha#315, martha#541): when the host names
 * its models, a `review_model` must be one of them, because a crew that named one Martha cannot spell would hold every
 * review to a model nothing ever matches; when the host takes any name its provider serves, any name is read.
 *
 * This reading is unchanged by martha#541 package 6b, so no caller of it changes: `review_model` is held to `models`
 * alone, whatever host a member names. A caller that knows each host's vocabulary reads the crew with
 * `declareCrewOnHosts`, which holds the model to every member's own host.
 */
export async function declareCrew(documents: DocumentStore, root: string, models: ModelVocabulary, note: (line: string) => void = () => {}): Promise<CrewSettings> {
  return readTheCrew(documents, root, { every_host: models }, note)
}

/**
 * The models each host the crew's members name runs, keyed by the name a declaration writes (martha#541 package 6b):
 * `claude-code` and `martha-engine` each answer with the vocabulary its own adapter recorded, and a host with no entry
 * is a host this release records none for.
 */
export type TheVocabulariesOfHost = ReadonlyMap<string, ModelVocabulary>

/**
 * Read the crew's declaration under `root` once, with a vocabulary per host (martha#541 package 6b): a crew whose
 * members run on different hosts is held to what each member's own host runs, not to one host's list.
 */
export async function declareCrewOnHosts(
  documents: DocumentStore,
  root: string,
  vocabularies: TheVocabulariesOfHost,
  note: (line: string) => void = () => {},
): Promise<CrewSettings> {
  return readTheCrew(documents, root, { by_host: vocabularies }, note)
}

/**
 * What the reviewer model is read against: one vocabulary for the whole crew, as `declareCrew` has always read it, or one
 * per host, as `declareCrewOnHosts` reads it (martha#541 package 6b).
 */
type TheModelsTheRuleReads = { readonly every_host: ModelVocabulary } | { readonly by_host: TheVocabulariesOfHost }

async function readTheCrew(
  documents: DocumentStore,
  root: string,
  models: TheModelsTheRuleReads,
  note: (line: string) => void,
): Promise<CrewSettings> {
  const crew = join(root, DECLARATION_DIRECTORY)
  const declaration = join(crew, DECLARATION_FILE)
  if (!isAbsolute(root)) throw new DeclarationRefused(declaration, null, 'is not under an absolute project root')
  const text = await readDeclaration(documents, declaration, join(root, CREW_CODE_DECLARATION_DIRECTORY, CREW_CODE_DECLARATION_FILE))
  const parsed = parseDeclaration(declaration, text)
  const conventions = isObject(parsed) && parsed['conventions'] === undefined ? await theConventionsWhenUnnamed(documents, crew) : null
  return deepFreeze(settingsOf(new Refuse(declaration, note), parsed, { root, crew, declaration, conventions_when_unnamed: conventions }, models))
}

/** The file a crew's conventions are read from when the declaration names none (martha#931): `conventions.md` in the crew directory. */
const CONVENTIONS_FILE_WHEN_UNNAMED = 'conventions.md'

/** The crew's conventions file when one sits at its default place, or null; read only to learn whether it is there, and only when the declaration names none. */
async function theConventionsWhenUnnamed(documents: DocumentStore, crew: string): Promise<string | null> {
  const path = join(crew, CONVENTIONS_FILE_WHEN_UNNAMED)
  return documents.read(path).then(() => path, () => null)
}

/**
 * The declaration's text, or a refusal saying why there is none. A checkout still holding crew-code's declaration is
 * refused by name (martha#468): its file is not read, only told apart from an empty one, so a person who finds their
 * crew stopped learns which file Martha looked for instead.
 */
async function readDeclaration(documents: DocumentStore, declaration: string, crewCodeDeclaration: string): Promise<string> {
  try {
    return await documents.read(declaration)
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'ENOENT') throw new DeclarationRefused(declaration, null, await whyMissing(documents, crewCodeDeclaration))
    throw new DeclarationRefused(declaration, null, `could not be read (${String(code ?? error)})`)
  }
}

/** `is missing`, or, when the checkout holds crew-code's declaration, that file named as the one in its place. */
async function whyMissing(documents: DocumentStore, crewCodeDeclaration: string): Promise<string> {
  const held = await documents.read(crewCodeDeclaration).then(() => true, () => false)
  return held ? `is missing, and ${crewCodeDeclaration} is crew-code's declaration, which Martha does not read` : 'is missing'
}

function parseDeclaration(declaration: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new DeclarationRefused(declaration, null, `is not JSON: ${(error as Error).message}`)
  }
}

// Throws a refusal for the declaration being read, naming the field; or says a line and reads on (martha#601).
class Refuse {
  readonly file: string
  readonly note: (line: string) => void

  constructor(file: string, note: (line: string) => void = () => {}) {
    this.file = file
    this.note = note
  }

  at(field: string | null, why: string): never {
    throw new DeclarationRefused(this.file, field, why)
  }

  /** A field this reader does not know, and anything else the crew is read past (martha#601): one line, naming it. */
  say(field: string, why: string): void {
    this.note(`${this.file}: ${field} ${why}`)
  }

  unknownKeys(value: Json, known: readonly string[], prefix: string): void {
    const unknown = Object.keys(value).find(key => !known.includes(key))
    if (unknown !== undefined) this.say(`${prefix}${unknown}`, `is not a field here (they are ${known.join(', ')}); ignoring it`)
  }
}

/** The places the reader is handed: the crew's own, and its conventions file when the declaration names none. */
type ThePlacesRead = Omit<CrewPaths, 'conventions'> & { readonly conventions_when_unnamed: string | null }

function settingsOf(refuse: Refuse, value: unknown, places: ThePlacesRead, models: TheModelsTheRuleReads): CrewSettings {
  if (!isObject(value)) return refuse.at(null, 'is not a JSON object')
  refuse.unknownKeys(value, TOP_LEVEL_KEYS, '')
  if (value['version'] !== DECLARATION_VERSION) refuse.at('version', `is not ${DECLARATION_VERSION}`)
  if (!isText(value['owner'])) refuse.at('owner', 'is not a name')
  const { conventions_when_unnamed, ...paths } = places
  const said = (field: string, why: string): never => refuse.at(field, why)
  const profiles = profilesOf(value, said)
  const mode = modeOf(refuse, value['mode'], value['members'])
  const members = membersOf(refuse, value['members'], mode.roles, profiles)
  const host = crewHostOf(refuse, value[HOST])
  const rules = houseRulesAsRead(refuse, value['house_rules'], theWorkspacesClonesOf(value, paths.root, said))
  return {
    paths: { ...paths, conventions: conventionsOf(refuse, value['conventions'], paths.crew) ?? conventions_when_unnamed },
    owner: value['owner'].trim(),
    host,
    members,
    mode,
    house_rules: houseRulesOf(refuse, rules, models, { members, mode, crew_host: host }),
    gate: gateOf(refuse, rules, members),
    channel_read_seconds: channelReadSecondsOf(refuse, value['channel_read_seconds']),
    handover_ceiling_minutes: handoverCeilingOf(refuse, value['handover_ceiling_minutes']),
    thresholds: thresholdsOf(value[THRESHOLDS], (field, why) => refuse.at(field, why)),
    github: githubOf(value[GITHUB], (field, why) => refuse.at(field, why)),
    transcripts: transcriptsOf(value[TRANSCRIPTS], (field, why) => refuse.at(field, why)),
    owner_notices: ownerNoticesOf(value[OWNER_NOTICES], (field, why) => refuse.at(field, why)),
    clock_zone: clockZoneOf(value[CLOCK_ZONE], (field, why) => refuse.at(field, why)),
    backlog: backlogOf(refuse, value[BACKLOG]),
    volatile_paths: volatilePathsOf(refuse, value[VOLATILE_PATHS]),
    engine_endpoint: theEnginesEndpointOf(said, value, profiles, (field, why) => refuse.say(field, why)),
    opens: whereTheCrewOpens(value),
  }
}

/**
 * The house rules as the reader judges them (martha#931): `gate_enforce`, as Raf's draft spells it, read as
 * `gate_enforces`; and, when the declaration names a workspace root and the rules name neither place, the clones in that
 * root and the worktrees beside it, as a checkout's own path proves them (workspaceLayoutOf). A place named in both is
 * refused, so the two can never disagree.
 */
function houseRulesAsRead(refuse: Refuse, value: unknown, clones: string | null): unknown {
  if (!isObject(value)) return value
  const { [GATE_ENFORCE_AS_DRAFTED]: drafted, ...rules } = value
  if (drafted !== undefined && rules[GATE_ENFORCES] !== undefined) refuse.at(`house_rules.${GATE_ENFORCE_AS_DRAFTED}`, `is named beside ${GATE_ENFORCES}, which it is read as`)
  const read: Json = drafted === undefined ? rules : { ...rules, [GATE_ENFORCES]: drafted }
  if (clones === null) return read
  const named = HOUSE_RULE_PLACES.find((place) => read[place] !== undefined)
  if (named !== undefined) refuse.at(`house_rules.${named}`, `is named beside ${THE_WORKSPACES_ROOT}, which places the clones and the worktrees`)
  return { ...read, [CLONES]: clones, [WORKTREES]: join(dirname(clones), WORKTREES_BESIDE_CLONES) }
}

/**
 * The roots a reboot deletes (martha#314): absolute paths, each once. A declaration that names none reads as an empty
 * list, since the launch's machine roots then apply; a value someone wrote that is not one is refused by name, never
 * read as that empty list, because a root that is not absolute would put every path under it in the note.
 */
function volatilePathsOf(refuse: Refuse, value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length === 0) return refuse.at(VOLATILE_PATHS, 'is not a list of absolute paths')
  const roots: string[] = []
  value.forEach((root: unknown, i: number) => {
    if (typeof root !== 'string' || !isAbsolute(root)) refuse.at(`${VOLATILE_PATHS}[${i}]`, 'is not an absolute path')
    const trimmed = root.replace(/\/+$/, '')
    if (roots.includes(trimmed)) refuse.at(`${VOLATILE_PATHS}[${i}]`, 'is named twice')
    roots.push(trimmed)
  })
  return roots
}

/** The declared backlog, or null when there is none: every place a name GitHub could hold, and the window named. */
function backlogOf(refuse: Refuse, value: unknown): Backlog | null {
  if (value === undefined) return null
  if (!isObject(value)) return refuse.at(BACKLOG, `is not ${shapeOf(BACKLOG_KEYS)}`)
  refuse.unknownKeys(value, BACKLOG_KEYS, `${BACKLOG}.`)
  const places = backlogPlacesOf(refuse, value['places'])
  const minutes = value['idle_minutes']
  if (minutes === undefined) return refuse.at(`${BACKLOG}.idle_minutes`, 'is missing: a backlog names how long a member may sit idle beside unheld work, 0 for no nudge')
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0) return refuse.at(`${BACKLOG}.idle_minutes`, 'is not a whole number of minutes, 0 or more')
  return { places, idle_minutes: minutes }
}

/** The places a backlog names: at least one, each an organisation or owner/repo. */
function backlogPlacesOf(refuse: Refuse, places: unknown): readonly string[] {
  if (!Array.isArray(places) || places.length === 0) return refuse.at(`${BACKLOG}.places`, 'is not a list of at least one organisation or owner/repo')
  const bad: unknown = places.find((place) => typeof place !== 'string' || !A_BACKLOG_PLACE.test(place))
  if (bad !== undefined) return refuse.at(`${BACKLOG}.places`, `holds ${JSON.stringify(bad)}, which is not an organisation or owner/repo`)
  return places as string[]
}

/**
 * How often a session reads the channel for a message: a positive whole number of seconds. A declaration that names
 * none reads as the value `martha init` writes today (martha#374), the same way a mode's table that does not name an
 * act reads it as the owner's: a file an earlier release wrote still declares after an upgrade.
 */
function channelReadSecondsOf(refuse: Refuse, value: unknown): number {
  if (value === undefined) return CHANNEL_READ_SECONDS_WHEN_UNNAMED
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return refuse.at('channel_read_seconds', 'is not a whole number of seconds, at least 1')
  return value
}

/**
 * How long a handover waits behind a running turn (martha#311): a whole number of minutes inside the range, or the
 * draft's ten when the declaration names none. A value someone wrote outside the range is refused by name, never read as
 * the default: 0 would end every running turn at once.
 */
function handoverCeilingOf(refuse: Refuse, value: unknown): number {
  if (value === undefined) return HANDOVER_CEILING_MINUTES_WHEN_UNNAMED
  const inRange = typeof value === 'number' && Number.isInteger(value) && value >= HANDOVER_CEILING_MINUTES_LEAST && value <= HANDOVER_CEILING_MINUTES_MOST
  if (!inRange) return refuse.at('handover_ceiling_minutes', `is not a whole number of minutes from ${HANDOVER_CEILING_MINUTES_LEAST} to ${HANDOVER_CEILING_MINUTES_MOST}`)
  return value
}

function modeOf(refuse: Refuse, value: unknown, members: unknown): Mode {
  if (typeof value === 'string') return aModeByName(refuse, value, members)
  if (!isObject(value)) return refuse.at('mode', `is not a mode's name, or ${shapeOf(MODE_KEYS)}`)
  refuse.unknownKeys(value, MODE_KEYS, 'mode.')
  if (!isText(value['name'])) refuse.at('mode.name', 'is not a name')
  const roles = rolesOf(refuse, value['roles'])
  return { name: value['name'], roles, may: mayOf(refuse, value['may'], roles) }
}

/**
 * A mode named by its name alone (martha#931, Raf's draft writes `"mode": "team"`): its text is
 * `.martha/modes/<name>.md`, as for every mode. A name Martha has a table of takes that table, as `martha init` writes
 * it (the Supervisor's ruling on PR 939). Any other name has the roles its members hold and a table that names no act,
 * so every act is the owner's (whoTheTableGrants), the reading a table that leaves an act out has always had. A crew
 * that grants an act to a role writes the mode as `{ name, roles, may }`.
 */
function aModeByName(refuse: Refuse, name: string, members: unknown): Mode {
  if (!isText(name)) return refuse.at('mode', 'is not a name')
  const own = marthasOwnTableOf(name.trim())
  if (own !== undefined) return own
  const held = Array.isArray(members) ? members.flatMap((member: unknown) => (isObject(member) && isText(member['role']) && member['role'] !== OWNER ? [member['role']] : [])) : []
  const may = Object.fromEntries(ACTS.map((act) => [act, [...whoTheTableGrants(undefined)]])) as Record<Act, string[]>
  return { name: name.trim(), roles: [...new Set(held)], may }
}

/** The mode Martha keeps a team table for, and its supervisor's role: the declaration's own words, kept here alone. */
const TEAM_MODE = 'team'
const TEAM_SUPERVISOR_ROLE = 'supervisor'

/**
 * Martha's own team table (the Supervisor's ruling on PR 939, matching how this crew works today; Raf may overrule):
 * a supervisor, builders and reviewers. The supervisor assigns work, unparks and restarts members, and brings the
 * owner's asks; the reviewers hold reviews; a landing is the owner's to approve.
 */
function theTeamTable(): Mode {
  const roles = [TEAM_SUPERVISOR_ROLE, SOLO_MEMBERS[0].role, SOLO_REVIEWER_ROLE]
  const may: Record<Act, string[]> = {
    assign_work: [TEAM_SUPERVISOR_ROLE],
    [APPROVE_LANDING]: [OWNER],
    resume_parked_work: [TEAM_SUPERVISOR_ROLE],
    [OFFER_OWNER_ASKS]: [TEAM_SUPERVISOR_ROLE],
    [RESTART_MEMBER]: [TEAM_SUPERVISOR_ROLE],
    [HOLD_REVIEWS]: [SOLO_REVIEWER_ROLE],
  }
  return { name: TEAM_MODE, roles, may }
}

/** The table Martha writes for a mode of this name (`martha init`'s solo crew, and its team table), or undefined when it has none. */
function marthasOwnTableOf(name: string): Mode | undefined {
  if (name === TEAM_MODE) return theTeamTable()
  const solo = soloDeclaration(OWNER).mode
  if (name !== solo.name) return undefined
  return { name: solo.name, roles: [...solo.roles], may: Object.fromEntries(ACTS.map((act) => [act, [...whoTheTableGrants((solo.may as Readonly<Record<string, unknown>>)[act])]])) as Record<Act, string[]> }
}

function rolesOf(refuse: Refuse, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return refuse.at('mode.roles', 'is not a list of role names')
  value.forEach((role: unknown, i) => {
    if (!isText(role)) refuse.at(`mode.roles[${i}]`, 'is not a name')
    if (role === OWNER) refuse.at(`mode.roles[${i}]`, `is the owner, who is a person and not a member's role`)
    if (value.indexOf(role) !== i) refuse.at(`mode.roles[${i}]`, 'is named twice')
  })
  return value as string[]
}

function mayOf(refuse: Refuse, value: unknown, roles: readonly string[]): Record<Act, string[]> {
  if (!isObject(value)) return refuse.at('mode.may', `is not ${shapeOf(ACTS)}`)
  refuse.unknownKeys(value, ACTS, 'mode.may.')
  const allowed = [OWNER, ...roles]
  return Object.fromEntries(ACTS.map(act => [act, whoMayOf(refuse, value[act], act, allowed)])) as Record<Act, string[]>
}

/**
 * Who a mode's table grants one act to, read from what its `may` holds for that act.
 *
 * An act the table does not name at all is the owner's alone (martha#313, martha#312). One rule for every act, so the
 * acts cannot drift apart, and the one reading that still lets a crew file written before an act existed declare after
 * an upgrade: `martha init` in v0.1.0 wrote no offer_owner_asks, and a refusal here would leave every verb refusing
 * until the owner edited the file by hand. The owner's own sessions are what the act then reaches, which is what a solo
 * crew has.
 *
 * An act that is there and names nobody reads as nobody here, and is refused where the declaration is read; so is a
 * grant that names something that is not the owner or a role of this mode.
 */
export function whoTheTableGrants(entry: unknown): readonly string[] {
  return entry === undefined ? [OWNER] : Array.isArray(entry) ? (entry as readonly string[]) : []
}

function whoMayOf(refuse: Refuse, entry: unknown, act: Act, allowed: readonly string[]): string[] {
  const who = [...whoTheTableGrants(entry)]
  if (who.length === 0) return refuse.at(`mode.may.${act}`, 'names nobody')
  who.forEach((name: unknown, i) => {
    if (typeof name !== 'string' || !allowed.includes(name)) {
      refuse.at(`mode.may.${act}[${i}]`, `is not the owner or a role of this mode (${allowed.join(', ')})`)
    }
  })
  return who
}

function membersOf(refuse: Refuse, value: unknown, roles: readonly string[], profiles: TheProfiles): Member[] {
  if (!Array.isArray(value)) return refuse.at('members', 'is not a list of members')
  const seen = new Set<string>()
  return value.map((member: unknown, i) => memberOf(refuse, member, `members[${i}]`, { roles, seen, profiles }))
}

/** What a member is read against: the mode's roles, the names already on the crew, and the declared profiles. */
interface TheMembersRead {
  readonly roles: readonly string[]
  readonly seen: Set<string>
  readonly profiles: TheProfiles
}

function memberOf(refuse: Refuse, member: unknown, at: string, read: TheMembersRead): Member {
  if (!isObject(member)) return refuse.at(at, `is not ${shapeOf(REQUIRED_MEMBER_KEYS, OPTIONAL_MEMBER_KEYS)}`)
  refuse.unknownKeys(member, MEMBER_KEYS, `${at}.`)
  const { role, parked } = member
  const name = memberNameOf(refuse, member.name, at, read.seen)
  if (typeof role !== 'string' || !read.roles.includes(role)) refuse.at(`${at}.role`, `is not a role of this mode (${read.roles.join(', ')})`)
  if (member[MESH_KEY] !== undefined && !isText(member[MESH_KEY])) refuse.at(`${at}.${MESH_KEY}`, 'is not a path')
  return { name, role, ...theModelAndHostOf(refuse, member, at, read.profiles), parked: parkedOf(refuse, parked, `${at}.${PARKED}`) }
}

/**
 * A member's model and host: its profile's (martha#931), or the member's own `model` and `host` as before. Its billing
 * is its profile's provider's (martha#916); a member with no profile names no billing, and the launch picks.
 */
function theModelAndHostOf(refuse: Refuse, member: Json, at: string, read: TheProfiles): Pick<Member, 'model' | 'host' | 'billing'> {
  const profiled = theProfileOfAMember(member, at, read, ['model', HOST], (field, why) => refuse.at(field, why))
  if (profiled !== null) return profiled
  const { model, host } = member
  if (model !== undefined && model !== null && !isText(model)) refuse.at(`${at}.model`, 'is not a model name, or null for the host\'s own')
  return { model: model ?? null, host: host === undefined ? null : hostNamed(refuse, host, `${at}.${HOST}`), billing: null }
}

/** A member's `parked` (martha#511): false when the declaration does not say, and refused by its field when it is not true or false. */
function parkedOf(refuse: Refuse, value: unknown, at: string): boolean {
  if (value === undefined) return false
  return typeof value === 'boolean' ? value : refuse.at(at, 'is not true or false')
}

/**
 * The crew's host (martha#541): the one a member that names none is started on. A declaration that names no host at
 * all reads as THE_HOST_A_MEMBER_RAN_ON, the host every release before this one started, under the reader's upgrade
 * rule; a name Martha does not know is refused by its field, never read as another host.
 */
function crewHostOf(refuse: Refuse, value: unknown): string {
  return value === undefined ? THE_HOST_A_MEMBER_RAN_ON : hostNamed(refuse, value, HOST)
}

/** A host name the declaration writes, refused by its field when it is not one Martha knows. */
function hostNamed(refuse: Refuse, value: unknown, at: string): string {
  if (typeof value !== 'string' || !HOSTS_IT_KNOWS.includes(value)) {
    refuse.at(at, `is not a host Martha knows (they are ${HOSTS_IT_KNOWS.join(', ')})`)
  }
  return value
}

/**
 * The host a member is started on (martha#541): the member's own, else the crew's, else the host every release before
 * this one started. The one reading, so a start and a wake cannot resolve it differently.
 */
export function theHostOfMember(settings: CrewSettings, member: Member): string {
  return member.host ?? settings.host
}

/** The same reading, before the crew's settings exist: the member's own host, else the crew's. */
const theHostOfResolved = (member: Member, crew_host: string): string => member.host ?? crew_host

/**
 * Whether a member's role holds `hold_reviews` (martha#541 package 6b): the member's own session is a review, so it is
 * held to the crew's reviewer model. A crew that grants the act to no role has no reviewer members.
 */
export function holdsReviews(settings: CrewSettings, member: Member): boolean {
  return settings.mode.may[HOLD_REVIEWS].includes(member.role)
}

/** The members whose own sessions are reviews (martha#541 package 6b): those whose role holds `hold_reviews`. */
export function reviewerMembersOf(settings: CrewSettings): readonly Member[] {
  return settings.members.filter((member) => holdsReviews(settings, member))
}

function memberNameOf(refuse: Refuse, name: unknown, at: string, seen: Set<string>): string {
  if (typeof name !== 'string' || !MEMBER_NAME.test(name)) refuse.at(`${at}.name`, `is not a name matching ${MEMBER_NAME}`)
  // Names are compared by the one rule (memberNameKey): Terra and terra would share branches and a mailbox.
  const folded = memberNameKey(name)
  if (seen.has(folded)) refuse.at(`${at}.name`, 'is on the crew twice (names are compared ignoring case)')
  seen.add(folded)
  return name
}

/**
 * What the gate does to a member, read from the declaration's own fields (martha#321).
 *
 * The reading itself is ../read_the_gate_mode's, so the owner's rule lives in one place; this only turns its refusal
 * into a declaration refusal naming the field, which is where the owner sees it.
 */
function gateOf(refuse: Refuse, value: unknown, members: readonly Member[]): GateSetting {
  const read = gateSettingOf(isObject(value) ? value : undefined, members.map((member) => member.name))
  if ('refused' in read) return refuse.at(`house_rules.${read.field}`, read.why)
  return read
}

function houseRulesOf(refuse: Refuse, value: unknown, models: TheModelsTheRuleReads, crew: TheCrewRead): HouseRules {
  if (value === undefined) return houseRulesFrom({})
  if (!isObject(value)) return refuse.at('house_rules', `is not ${shapeOf(HOUSE_RULE_KEYS)}`)
  refuse.unknownKeys(value, HOUSE_RULE_KEYS, 'house_rules.')
  refuseSwitches(refuse, value)
  noteTheReviewModel(refuse, value[REVIEW_MODEL], models, crew)
  refusePlaces(refuse, value)
  refuseMinutes(refuse, value)
  return houseRulesFrom(value)
}

function refuseSwitches(refuse: Refuse, value: Json): void {
  for (const name of HOUSE_RULE_SWITCHES) {
    if (value[name] !== undefined && typeof value[name] !== 'boolean') refuse.at(`house_rules.${name}`, 'is not true or false')
  }
}

/** What the reviewer-model rule is read over: the crew's members, its mode, and the host it starts a member on. */
interface TheCrewRead {
  readonly members: readonly Member[]
  readonly mode: Mode
  readonly crew_host: string
}

/**
 * The reviewer model, read against the models each host a member runs on takes (martha#315, martha#541 package 6b): a
 * name a member's own host cannot spell is said in one line, naming the models that host does run, and the crew is
 * read anyway (martha#601). A rule nothing could ever match is not one of the three harms the refusals are kept for.
 *
 * Every member's host is held to the name, not only the reviewer members': any member can spawn a subagent, so a name
 * one of the crew's hosts can never spell is said, and so is a host this release records no vocabulary for.
 */
function noteTheReviewModel(refuse: Refuse, model: unknown, models: TheModelsTheRuleReads, crew: TheCrewRead): void {
  if (model === undefined) return
  if (!isText(model)) return refuse.say(`house_rules.${REVIEW_MODEL}`, 'is not a model name; reading the crew without one')
  const name = model.trim()
  if ('every_host' in models) return noteOnTheOneHost(refuse, name, models.every_host)
  const vocabularies = models.by_host
  const held = new Set<string>()
  for (const member of crew.members) {
    const host = theHostOfResolved(member, crew.crew_host)
    if (held.has(host)) continue
    held.add(host)
    const vocabulary = vocabularies.get(host)
    const where = `house_rules.${REVIEW_MODEL}`
    if (vocabulary === undefined) {
      const known = [...vocabularies.keys()].join(', ')
      refuse.say(where, `cannot be held on ${host}, a host this release records no models for (it records ${known}); reading the crew anyway`)
      continue
    }
    if (hostRuns(vocabulary, name)) continue
    const runs = vocabulary.names.length === 0 ? 'none Martha can name' : vocabulary.names.join(', ')
    refuse.say(where, `is not a model ${host} runs (it runs ${runs}), so a review could never be held to it; reading the crew anyway`)
  }
}

/**
 * The reviewer model read against the one vocabulary `declareCrew` is handed (martha#315), said in one line and
 * read on (martha#601).
 */
function noteOnTheOneHost(refuse: Refuse, name: string, models: ModelVocabulary): void {
  if (hostRuns(models, name)) return
  const runs = models.names.length === 0 ? 'none Martha can name' : models.names.join(', ')
  refuse.say(`house_rules.${REVIEW_MODEL}`, `is not a model this host runs (it runs ${runs}), so a review could never be held to it; reading the crew anyway`)
}

/**
 * The places a crew keeps its clones and worktrees in: each an absolute path when it is named, and both named when
 * the workspace layout is on, so a member is never left to make a worktree wherever it is.
 */
function refusePlaces(refuse: Refuse, value: Json): void {
  for (const place of HOUSE_RULE_PLACES) {
    const named = value[place]
    if (named !== undefined && (!isText(named) || !isAbsolute(named))) refuse.at(`house_rules.${place}`, 'is not an absolute path')
  }
  if (value['workspace_layout'] !== true) return
  const missing = HOUSE_RULE_PLACES.find((place) => value[place] === undefined)
  if (missing !== undefined) {
    refuse.at(`house_rules.${missing}`, 'is missing, and house_rules.workspace_layout is on in this declaration')
  }
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * The three windows a crew that reads nudges names (martha#320): each a whole number of minutes, zero or more, and all
 * three named, so a member is never nudged on a window the code made up. A crew that turns nudges off names none of
 * them and reads no nudge.
 */
function refuseMinutes(refuse: Refuse, value: Json): void {
  for (const minutes of HOUSE_RULE_MINUTES) {
    const named = value[minutes]
    if (named !== undefined && (typeof named !== 'number' || !Number.isInteger(named) || named < 0)) {
      refuse.at(`house_rules.${minutes}`, 'is not a whole number of minutes, zero or more')
    }
  }
  refuseTheWindowsOf(refuse, value, NUDGES, NUDGE_MINUTES)
  refuseTheWindowsOf(refuse, value, WAKE, WAKE_MINUTES)
}

/** A window a rule needs, refused by name when the rule is on and the window is missing: never one the code made up. */
function refuseTheWindowsOf(refuse: Refuse, value: Json, rule: HouseRuleSwitch, windows: readonly string[]): void {
  if (value[rule] !== true) return
  const missing = windows.find((minutes) => value[minutes] === undefined)
  if (missing !== undefined) {
    refuse.at(`house_rules.${missing}`, `is missing, and house_rules.${rule} is on in this declaration`)
  }
}

function houseRulesFrom(value: Json): HouseRules {
  const switches = Object.fromEntries(HOUSE_RULE_SWITCHES.map(name => [name, value[name] === true]))
  const places = Object.fromEntries(HOUSE_RULE_PLACES.map(place => [place, textOrNull(value[place])]))
  const minutes = Object.fromEntries(HOUSE_RULE_MINUTES.map(name => [name, minuteOrNull(value[name])]))
  return {
    ...(switches as Record<HouseRuleSwitch, boolean>),
    ...(places as Record<HouseRulePlace, string | null>),
    ...(minutes as Record<HouseRuleMinutes, number | null>),
    // A value that is not a model name is read as no model, since a notice names it and the crew reads on (martha#601).
    review_model: isText(value[REVIEW_MODEL]) ? textOrNull(value[REVIEW_MODEL]) : null,
  }
}

/** A window in minutes as it is kept, or null when the declaration names none. A missing one is never zero: zero is a
 * crew turning a kind of nudge off, which is a decision, and no window at all is a crew that reads no nudge. */
const minuteOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null)

// The conventions document is named relative to the crew directory and must stay inside it.
function conventionsOf(refuse: Refuse, value: unknown, crew: string): string | null {
  if (value === undefined) return null
  if (!isText(value) || isAbsolute(value)) return refuse.at('conventions', 'is not a path relative to the crew directory')
  const path = normalize(join(crew, value))
  if (!path.startsWith(crew + sep)) refuse.at('conventions', 'leaves the crew directory')
  return path
}

/**
 * The crew's own text files, as the owner's approval names and fingerprints them (martha#306): a role's text for every
 * role of its mode, its mode's text, and its conventions when it names one. A file the crew has not written is named
 * all the same, so the approval records that it is absent rather than leaving it out.
 */
export function crewTextFilesOf(settings: CrewSettings): readonly string[] {
  const crew = settings.paths.crew
  return [
    ...settings.mode.roles.map((role) => join(crew, ROLE_TEXTS_DIRECTORY, `${role}.md`)),
    join(crew, MODE_TEXTS_DIRECTORY, `${settings.mode.name}.md`),
    ...(settings.paths.conventions === null ? [] : [settings.paths.conventions]),
  ]
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}
