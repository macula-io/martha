// The owner's to-do list (martha#316): the acts only the person at the keyboard can do, each with the exact command
// to run and what that command does, kept until the act is done.
//
// This exists so nothing the crew needs from the owner gets lost in a chat. A member the mode lets assign work puts
// an act on the list; it leaves the list when that member says the owner did it, or when the act's own check answers
// that it is done. The owner reads the list in the crew's pane, or with `martha todo` in a terminal.
//
// The list is an append-only stream in the crew's row streams (martha#254 R1), not a file per row.
// Asking an act of the owner is one row, its end is another, and the open list is the fold of the two. Nothing is
// ever removed, so a removal can never fail quietly and leave a row on the owner's list, and the history of what the
// owner was asked, and when it ended, stays. Every write names the length it read, so two writers never lose a row.
//
// A row is what the owner will paste, so it holds to the strictest rules here: one-line fields with no control or
// hidden character, so what is shown is every byte of what is copied; a description for every command; no secret by
// any of the shapes TOKEN_PREFIXES names; and a check that is one of two typed questions whose argv is built here,
// never a shell string. The pane and the terminal draw what this slice hands them and decide nothing.

import { OWNER, type Act } from '../declare_crew/declare_crew.ts'
import type { HostContract, Row, StoredRow } from '../host_contract/host_contract.ts'
import { ROW_NOT_DURABLE, ROW_STREAM_MOVED } from '../host_contract/host_contract.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'

/** The stream the owner's list lives in, in the crew's row streams. */
export const OWNER_TODO_STREAM = 'owner_todo'

/** The row that puts an act on the owner's list. */
export const ACT_ASKED_OF_OWNER = 'act_asked_of_owner'

/** The row that takes an act off it, saying who ended it. */
export const ACT_DONE_BY_OWNER = 'act_done_by_owner'

/** The tool a member puts an act on the owner's list with. */
export const OWNER_TODO_ADD = 'owner_todo_add'

/** The tool a member takes an act off it with, once the owner says it is done. */
export const OWNER_TODO_DONE = 'owner_todo_done'

/** What the mod asks the launcher for: the owner's list, as the pane draws it. */
export const THE_OWNERS_TODO_ASK = 'the_owners_todo'

/** What `owner_todo_add` says it is for. */
export const OWNER_TODO_ADD_DESCRIPTION =
  "Put an act only the owner can do on the owner's to-do list: a merge that needs their yes, a secret only they can set, an interactive login. Give each command the exact text the owner pastes and, in `does`, one line saying what it does and what success looks like; the owner reads `does` and sees the command in full before copying it. Name variables, never their values: a command holding a token is refused. An optional check (`pr_merged` or `tag_exists`) takes the row off by itself once it answers yes. Answers with the row's id."

/** What `owner_todo_done` says it is for. */
export const OWNER_TODO_DONE_DESCRIPTION =
  "Take an act off the owner's to-do list once the owner says it is done. The row stays in the list's history with who took it off."

/** The one line the pane and the terminal show above the list: a member wrote every row. */
export const A_MEMBER_WROTE_THIS = 'A member wrote this list: read the command, not the description.'

/** How often the sweep asks the open rows' checks whether their act is done: read by the timer and by its test. */
export const SWEEP_INTERVAL_MS = 45_000

/**
 * What a one-line field refuses: the Unicode classes, not a hand-kept list. Cc, the C0 and C1 controls and DEL, which
 * break a line or repaint a row; Cf, the format characters (bidi overrides and isolates, zero-width characters, the
 * word joiner, the soft hyphen, the BOM, the tag characters), which run the bytes one way and the row another or hide
 * them from the eye; Zl and Zp, which break a line as a newline does; and Default_Ignorable_Code_Point, which adds
 * the invisible characters outside Cf (the combining grapheme joiner, the variation selectors, the Hangul fillers).
 */
export const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u

/** The prefixes of the secrets a command may not hold: a row names a variable, never its value. */
export const TOKEN_PREFIXES = ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_', 'glpat-', 'xoxb-', 'xoxp-', 'sk-ant-', 'AKIA', 'npm_', 'hf_'] as const

/** How many characters of a token's body follow its prefix before a word is read as a secret. */
const TOKEN_BODY = 16

/** The longest command a row holds, in characters. */
export const MAX_COMMAND = 500

/** The longest one-line field (a title, a goal, who waits, what a command does), in characters. */
export const MAX_LINE = 200

/** An id a row is named by, here and in the Supervisor's standing items (martha#317): a package ref or a short slug, never a path. */
export const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/
const OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/
const TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/

/** The two questions a row's check may ask, and nothing else. */
export const CHECK_KINDS = ['pr_merged', 'tag_exists'] as const

/** A check: a typed question whose argv is built here from validated parts. */
export type TodoCheck =
  | { readonly pr_merged: { readonly repo: string; readonly number: number } }
  | { readonly tag_exists: { readonly repo: string; readonly tag: string } }

/** One act of a row: the exact command the copy carries, and what it does in plain words. */
export interface TodoCommand {
  readonly command: string
  readonly does: string
}

/** An act on the owner's list. `added_by` is the launch's member: the row's claim, drawn as one. */
export interface OwnerTodoRow {
  readonly id: string
  readonly title: string
  readonly goal: string
  readonly waiting_on: string
  readonly added_by: string
  readonly since: number
  readonly commands: readonly TodoCommand[]
  readonly check?: TodoCheck
}

/** Who ended an act: the member that says the owner did it, or the act's own check. */
export type DoneBy = { readonly by: 'member'; readonly member: string } | { readonly by: 'check'; readonly check: TodoCheck }

/** What the list needs of a host: its clock, and the crew's row streams. */
export type TodoHost = LedgerHost

/** What the sweep needs besides: the host's processes, and the directory its checks run in. */
export type SweepingHost = TodoHost & Pick<HostContract, 'processes'>

/** A slice's answer: what it tells the caller, or why it would not. */
export type TodoAnswer = { readonly told: string } | { readonly refused: string }

// --- the rules a row holds to --------------------------------------------------

const ESCAPED = /[.*+?^${}()|[\]\\]/g

/** A word that starts with a known token prefix and runs on long enough to be a secret. */
const TOKEN = new RegExp(`(?:^|[^A-Za-z0-9])(${TOKEN_PREFIXES.map((prefix) => prefix.replace(ESCAPED, '\\$&')).join('|')})[A-Za-z0-9_-]{${TOKEN_BODY},}`)

/** Why a one-line field is refused, naming it, or undefined when it holds. Empty is allowed only when `optional`. */
function lineRefusal(field: string, value: unknown, optional: boolean, max: number = MAX_LINE): string | undefined {
  if (value === undefined || value === '') return optional ? undefined : `${field} is missing`
  if (typeof value !== 'string') return `${field} is not text`
  if (CONTROL.test(value)) return `${field} holds a control or hidden character, so what is shown would not be what is pasted`
  if (value.trim() !== value) return `${field} starts or ends with a space`
  return value.length > max ? `${field} is longer than ${max} characters` : undefined
}

/** Why one command is refused, naming it by its place in the list, or undefined when it holds. */
function commandRefusal(at: number, raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object') return `commands[${at}] is not { command, does }`
  const { command, does } = raw as Record<string, unknown>
  const shown = lineRefusal(`commands[${at}].command`, command, false, MAX_COMMAND)
  if (shown !== undefined) return shown
  const secret = TOKEN.exec(command as string)
  if (secret !== null) return `commands[${at}].command holds what reads as a secret (it starts ${secret[1]}): name the variable that holds it instead`
  if (does === undefined || does === '') return `commands[${at}].does is missing: say in one line what the command does and what success looks like`
  return lineRefusal(`commands[${at}].does`, does, false)
}

/** The commands a call names, or why they are refused. */
function commandsIn(raw: unknown): readonly TodoCommand[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'commands is missing: a row carries at least one { command, does }'
  const refused = raw.map((one, at) => commandRefusal(at, one)).find((said) => said !== undefined)
  if (refused !== undefined) return refused
  return raw.map((one) => ({ command: (one as TodoCommand).command, does: (one as TodoCommand).does }))
}

/** A `pr_merged` check's arguments, or null when they are not a repository and a pull request's number. */
function mergedCheck(raw: unknown): TodoCheck | null {
  if (raw === null || typeof raw !== 'object') return null
  const { repo, number } = raw as Record<string, unknown>
  return typeof repo === 'string' && OWNER_REPO.test(repo) && Number.isInteger(number) && (number as number) > 0 ? { pr_merged: { repo, number: number as number } } : null
}

/** A `tag_exists` check's arguments, or null when they are not a repository and a tag no flag or `..` hides in. */
function tagCheck(raw: unknown): TodoCheck | null {
  if (raw === null || typeof raw !== 'object') return null
  const { repo, tag } = raw as Record<string, unknown>
  if (typeof repo !== 'string' || !OWNER_REPO.test(repo) || typeof tag !== 'string') return null
  return TAG.test(tag) && !tag.includes('..') ? { tag_exists: { repo, tag } } : null
}

/** The check a call names: none, one of the two kinds, or why it is refused. */
function checkIn(raw: unknown): TodoCheck | undefined | string {
  if (raw === undefined) return undefined
  const kinds = raw !== null && typeof raw === 'object' ? Object.keys(raw) : []
  if (kinds.length !== 1 || !(CHECK_KINDS as readonly string[]).includes(kinds[0]!)) return `check is of no known kind: it is one of ${CHECK_KINDS.join(', ')}`
  const held = raw as Record<string, unknown>
  const check = kinds[0] === 'pr_merged' ? mergedCheck(held['pr_merged']) : tagCheck(held['tag_exists'])
  return check ?? `check.${kinds[0]} names no repository as owner/name, or a ${kinds[0] === 'pr_merged' ? 'pull request number' : 'tag'} it may ask about`
}

/** The fields of a row besides its commands and check, each refused by name. */
const FIELDS: readonly { readonly name: 'title' | 'goal' | 'waiting_on'; readonly optional: boolean }[] = [
  { name: 'title', optional: false },
  { name: 'goal', optional: true },
  { name: 'waiting_on', optional: true },
]

/** The row a call asks for, `added_by` and `since` its launch's and its clock's, or why it is refused by name. */
export function theActAsked(args: Readonly<Record<string, unknown>>, added_by: string, since: number): OwnerTodoRow | { readonly refused: string } {
  const id = args['id']
  if (typeof id !== 'string' || !SAFE_ID.test(id)) return { refused: 'id is letters, digits, ".", "_" or "-", at most 80 of them' }
  const field = FIELDS.map((one) => lineRefusal(one.name, args[one.name], one.optional)).find((said) => said !== undefined)
  if (field !== undefined) return { refused: field }
  const commands = commandsIn(args['commands'])
  if (typeof commands === 'string') return { refused: commands }
  const check = checkIn(args['check'])
  if (typeof check === 'string') return { refused: check }
  const text = (name: string): string => (typeof args[name] === 'string' ? (args[name] as string) : '')
  return { id, title: text('title'), goal: text('goal'), waiting_on: text('waiting_on'), added_by, since, commands, ...(check === undefined ? {} : { check }) }
}

// --- who may keep the list ------------------------------------------------------

/** The declaration, as much of it as keeping the list is decided by: the members, and who may assign work. */
export interface TheDeclaration {
  readonly members: readonly { readonly name: string; readonly role: string }[]
  readonly mode: { readonly may: Readonly<Partial<Record<Act, readonly string[]>>> }
}

/** Who the table lets assign work: the act whose grant lets a member keep the owner's list. */
const theGrantOf = (declaration: TheDeclaration): readonly string[] => declaration.mode.may.assign_work ?? []

/**
 * Whether `member` may put an act on the owner's list or take one off, read from the declaration's table and never
 * from the mode's name (Uranus's ruling on martha#316): its role is granted `assign_work`, or the table grants
 * that act to the owner and nothing else — a crew in which nobody but the owner assigns work, whose members act
 * as the owner's own sessions. A team table naming the owner and a role lets only that role keep the list, even when
 * no member holds that role yet.
 */
export function mayKeepTheOwnersList(declaration: TheDeclaration, member: string): boolean {
  const granted = theGrantOf(declaration)
  const role = declaration.members.find((one) => one.name === member)?.role
  if (role === undefined) return false
  if (granted.includes(role)) return true
  return granted.includes(OWNER) && granted.every((one) => one === OWNER)
}

/** Why a member may not keep the list, naming who may. */
export function whoMayKeepTheList(declaration: TheDeclaration, member: string): string {
  return `${member} may not keep the owner's list: this crew's table lets ${theGrantOf(declaration).join(', ') || 'nobody'} assign work, and only they may put an act on it or take one off. Nothing was written.`
}

// --- the stream -----------------------------------------------------------------

/**
 * A row as the stream holds it, read back: the row, or null when it is no row of this list. `added_by` is drawn in
 * the row's heading, so it holds to a one-line field's rules like every other field a row shows.
 */
function askedIn(row: Row): OwnerTodoRow | null {
  if (row['kind'] !== ACT_ASKED_OF_OWNER || typeof row['since'] !== 'number') return null
  if (lineRefusal('added_by', row['added_by'], false) !== undefined) return null
  const asked = theActAsked(row, row['added_by'] as string, row['since'])
  return 'refused' in asked ? null : asked
}

/**
 * The open list: every act asked and not yet done, oldest first. A row the stream holds that is no row of this list
 * (a hand-written one, a row that would paste something other than it shows) is left off rather than drawn.
 */
export function theOpenRows(stored: readonly StoredRow[]): readonly OwnerTodoRow[] {
  const open = new Map<string, OwnerTodoRow>()
  for (const { row } of stored) {
    if (row['kind'] === ACT_DONE_BY_OWNER && typeof row['id'] === 'string') open.delete(row['id'])
    const asked = askedIn(row)
    if (asked !== null && !open.has(asked.id)) open.set(asked.id, asked)
  }
  return [...open.values()].sort((a, b) => a.since - b.since)
}

/** Appends `row` at the length the list was read at, and says what became of it. */
async function appendAtLength(host: TodoHost, row: Row, length: number, told: string): Promise<TodoAnswer> {
  try {
    await host.stores.rows.append(OWNER_TODO_STREAM, row, length)
    return { told }
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === ROW_STREAM_MOVED) return { refused: 'the owner\'s list moved while this was written, so nothing was written: call again' }
    if (code === ROW_NOT_DURABLE) return { told: `${told}, though the host could not make it durable` }
    return { refused: `the owner's list did not keep the row: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Puts the act a call asks for on the owner's list, as `added_by`; answers with its id and nothing of its text. */
export async function addAnAct(host: TodoHost, args: Readonly<Record<string, unknown>>, added_by: string): Promise<TodoAnswer> {
  const asked = theActAsked(args, added_by, host.clock.now())
  if ('refused' in asked) return asked
  const stored = await host.stores.rows.read(OWNER_TODO_STREAM)
  if (theOpenRows(stored).some((row) => row.id === asked.id)) return { refused: `${asked.id} is already on the owner's list` }
  return appendAtLength(host, { kind: ACT_ASKED_OF_OWNER, ...asked }, stored.length, `${asked.id} is on the owner's list`)
}

/** Takes the act `id` off the owner's list, saying who ended it. */
export async function closeAnAct(host: TodoHost, id: unknown, done: DoneBy): Promise<TodoAnswer> {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) return { refused: 'id is letters, digits, ".", "_" or "-", at most 80 of them' }
  const stored = await host.stores.rows.read(OWNER_TODO_STREAM)
  if (!theOpenRows(stored).some((row) => row.id === id)) return { refused: `${id} is not on the owner's list` }
  return appendAtLength(host, { kind: ACT_DONE_BY_OWNER, id, at: host.clock.now(), ...done }, stored.length, `${id} is off the owner's list`)
}

// --- the checks -------------------------------------------------------------------

/** The argv a check becomes, from validated parts: the runner never sees a shell. */
export function checkArgv(check: TodoCheck): readonly string[] {
  if ('pr_merged' in check) return ['gh', 'api', `repos/${check.pr_merged.repo}/pulls/${check.pr_merged.number}`, '--jq', '.merged']
  return ['gh', 'api', `repos/${check.tag_exists.repo}/git/ref/tags/${check.tag_exists.tag}`]
}

/** Whether a check that ran says its act is done: `gh api` exits 0 for an unmerged pull request too. */
export function checkDone(check: TodoCheck, ran: { readonly exit_code: number | null; readonly stdout: string }): boolean {
  if (ran.exit_code !== 0) return false
  return 'pr_merged' in check ? ran.stdout.trim() === 'true' : true
}

/**
 * One sweep: every open row with a check asks it once, and a row whose check says done is taken off by its check.
 * A check that failed or could not run leaves its row. A list with no check runs no process. Answers the ids taken off.
 */
export async function sweepTheList(host: SweepingHost, cwd: string): Promise<readonly string[]> {
  const checked = theOpenRows(await host.stores.rows.read(OWNER_TODO_STREAM)).filter((row) => row.check !== undefined)
  const closed: string[] = []
  for (const row of checked) {
    const check = row.check as TodoCheck
    const [command, ...args] = checkArgv(check)
    const ran = await host.processes.run({ command: command!, args, cwd }).catch(() => ({ exit_code: null, stdout: '', stderr: '' }))
    if (!checkDone(check, ran)) continue
    if ('told' in (await closeAnAct(host, row.id, { by: 'check', check }))) closed.push(row.id)
  }
  return closed
}

// --- what the owner is shown ------------------------------------------------------

/** What the copy puts on the clipboard for one act: the `!` form the owner pastes into a session. */
export const commandLine = (act: TodoCommand): string => `! ${act.command}`

/** What the copy puts on the clipboard for a row: one act per line, in the row's order. */
export const copyText = (row: OwnerTodoRow): string => row.commands.map(commandLine).join('\n')

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** How long ago `since` was, in the largest whole unit. */
export function agoOf(now: number, since: number): string {
  const quiet = Math.max(0, now - since)
  if (quiet >= DAY_MS) return `${Math.floor(quiet / DAY_MS)}d`
  if (quiet >= HOUR_MS) return `${Math.floor(quiet / HOUR_MS)}h`
  return `${Math.floor(quiet / MINUTE_MS)}m`
}

/** A row's heading: its title, who waits, since when, and who the row says added it, as a claim. */
export function theHeadingOf(row: OwnerTodoRow, now: number): string {
  const waits = row.waiting_on === '' ? [] : [`waiting on ${row.waiting_on}`]
  return [row.title, ...waits, `since ${agoOf(now, row.since)} ago`, `says it is from ${row.added_by}`].join(' · ')
}

/** What the owner is told when nothing waits on them. */
export const NOTHING_WAITS_ON_THE_OWNER = 'Nothing is waiting on you.'

/** The list as `martha todo` prints it: every row, every command in full under what it does. */
export function theListForTheTerminal(rows: readonly OwnerTodoRow[], now: number): readonly string[] {
  if (rows.length === 0) return [NOTHING_WAITS_ON_THE_OWNER]
  return [A_MEMBER_WROTE_THIS, ...rows.flatMap((row) => [
    `${row.id}: ${theHeadingOf(row, now)}`,
    ...(row.goal === '' ? [] : [`  ${row.goal}`]),
    ...row.commands.flatMap((act) => [`  - ${act.does}`, `    ${commandLine(act)}`]),
  ])]
}

/** One row as the pane draws it: its acts are revealed, and its copy carried, only on the focused row. */
export interface TodoPaneRow {
  readonly id: string
  readonly heading: string
  readonly goal: string
  readonly revealed: boolean
  readonly acts: readonly { readonly does: string; readonly line: string }[]
  /** What the copy carries: the row's `!` lines when it is revealed, and '' when it is not, so nothing unseen is copied. */
  readonly copy: string
}

/** The lines the pane's list takes besides its rows: its heading, and the claim line or the line saying nothing waits. */
export const PANE_LIST_CHROME = 2

/** The heading the pane draws the list under. */
export const THE_OWNERS_LIST_HEADING = 'Waiting on you'

/** The list as the pane draws it: the focused row (the first when `focus` is on none), the next one, and each row. */
export interface TodoPane {
  /** The heading the list is drawn under. */
  readonly heading: string
  /** The line under it: that a member wrote the list, or, with no row, that nothing waits on the owner. */
  readonly claim: string
  readonly focus: string
  readonly next: string
  readonly rows: readonly TodoPaneRow[]
  /** How many lines the rows take in the pane, so it can ask the host for them. */
  readonly lines: number
}

/** The pane's part of the list, with `focus` the row the owner's keyboard is on. */
export function theListForThePane(rows: readonly OwnerTodoRow[], focus: unknown, now: number): TodoPane {
  const at = Math.max(0, rows.findIndex((row) => row.id === focus))
  const focused = rows[at]?.id ?? ''
  const shown = rows.map((row) => {
    const revealed = row.id === focused
    const acts = row.commands.map((act) => ({ does: act.does, line: revealed ? commandLine(act) : '' }))
    return { id: row.id, heading: theHeadingOf(row, now), goal: row.goal, revealed, acts, copy: revealed ? copyText(row) : '' }
  })
  const lines = shown.reduce((sum, row) => sum + 1 + (row.goal === '' ? 0 : 1) + row.acts.length * (row.revealed ? 2 : 1), 0)
  // Its heading, then the claim line (or, with no row, the line saying nothing waits), then the rows.
  const claim = rows.length === 0 ? NOTHING_WAITS_ON_THE_OWNER : A_MEMBER_WROTE_THIS
  return { heading: THE_OWNERS_LIST_HEADING, claim, focus: focused, next: rows[(at + 1) % Math.max(1, rows.length)]?.id ?? '', rows: shown, lines: PANE_LIST_CHROME + lines }
}
