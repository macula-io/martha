// A tool-friction note (martha#318, ported from crew-code's `friction_note`): the Supervisor and
// every member are users of the plugin as much as the owner is, and what they hit is raised as an issue in a repository
// the crew declares — the next round of features is designed from the notes, not only from what the owner happens to
// see on the dashboard.
//
// One note answers three questions — what I tried, what the tool did, what I needed — and becomes an issue under the
// `friction` label, opening with the Purpose line every issue here states. No I/O: this says what the issue holds and
// reads what gh answered. The caller runs gh, and keeps the crew's own index of the notes it filed.
//
// What the note may not carry is the private-text decision's own, not a second list (../know_the_private_text_classes):
// a home path, a private address, an email outside the declared domains, a hex id, a token, and a lab hostname — every
// class the scan runs, so a note can never carry into an issue what the daily posted-text report would refuse there.
// The Supervisor's ruling on martha#318 (2026-11-20) is that, and the owner can overrule it; the declaration's
// `lab_hosts` field and the machine-name family stay out (DECIDED 2026-11-18 "who the fuck cares if our lab machine
// names leak??? they are behind a NAT / Yes, stop scanning them (Recommended)"). The rules the domains come from are
// ./the_crews_friction's.

import { refusedValuesIn, type Rules } from '../know_the_private_text_classes/the_private_text_classes.ts'
import { FRICTION_REPOS } from '../declare_crew/the_crews_friction.ts'
import { CONTROL } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'

/** The label every friction note is filed under, and the one a repository without it is given. */
export const FRICTION_LABEL = 'friction'
/** The colour of the label a repository is given when the first note meets one without it. */
export const FRICTION_LABEL_COLOUR = 'EDEDED'
/** What the label a repository is given stands for. */
export const FRICTION_LABEL_DESCRIPTION = "A friction note from the crew's users"

/** The kinds a note may be, for the Purpose line an issue opens with. */
export const FRICTION_KINDS = ['security', 'usability', 'capability', 'reliability', 'upkeep'] as const
export type FrictionKind = (typeof FRICTION_KINDS)[number]
/** The kind a note that names none is: a note about the tool is about working with it. */
export const DEFAULT_FRICTION_KIND: FrictionKind = 'usability'

/** A note is a few sentences, not a design: anything longer belongs in an issue of its own. */
export const MAX_NOTE_PART = 2_000
/** A title a reader can scan: the need, cut where GitHub stops showing it whole. */
export const MAX_NOTE_TITLE = 72

/** One friction note, as it is filed and kept. */
export interface FrictionNote {
  readonly repo: string
  readonly kind: FrictionKind
  readonly tried: string
  readonly did: string
  readonly need: string
  /** Who said it, as the crew names them. */
  readonly by: string
  /** Whether that member is one the crew's work is routed to: a note from the person who hands out work reads differently. */
  readonly supervisor: boolean
  /** The day it was filed, YYYY-MM-DD: the design round reads the notes newest first. */
  readonly day: string
}

/** What a note is filed with, as the tool takes it: the three answers, the kind, and the repository it lands in. */
export interface ANoteAsked {
  readonly repo?: unknown
  readonly kind?: unknown
  readonly tried?: unknown
  readonly did?: unknown
  readonly need?: unknown
}

/** Who files a note, and when: this launch's member, whether the crew's work is routed to it, and the day. */
export interface TheFiler {
  readonly member: string
  readonly supervisor: boolean
  readonly day: string
}

/** The two lists a note is judged against: the repositories it may land in, and the domains it may name. */
export interface TheNotesRules {
  readonly repos: readonly string[]
  readonly public_emails: readonly string[]
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** One answer of a note, as it is kept: the tool's input is untrusted, so it becomes a capped string here. */
const aPartOf = (value: unknown): string => String(value ?? '').slice(0, MAX_NOTE_PART)

/** Which part of a note is blank, if any: the three questions are the note, and a status line answers none of them. */
export const missingPartOf = (parts: { readonly tried: string; readonly did: string; readonly need: string }): string =>
  (['tried', 'did', 'need'] as const).find((part) => parts[part].trim() === '') ?? ''

/**
 * The note this call is, or null when the call is not one: a repository, every part answered, and a kind the crew knows.
 * A kind this crew does not know is null rather than the default, so a misspelt kind is answered, never filed as
 * something else.
 */
export function theNoteIn(asked: ANoteAsked, filer: TheFiler): FrictionNote | null {
  const repo = String(asked.repo ?? '').trim()
  const named = String(asked.kind ?? '').trim().toLowerCase()
  const kind = (FRICTION_KINDS as readonly string[]).includes(named) ? (named as FrictionKind) : DEFAULT_FRICTION_KIND
  const parts = { tried: aPartOf(asked.tried), did: aPartOf(asked.did), need: aPartOf(asked.need) }
  if (repo === '' || (named !== '' && kind !== named) || missingPartOf(parts) !== '') return null
  return { repo, kind, ...parts, by: filer.member, supervisor: filer.supervisor, day: filer.day }
}

/**
 * Why the need cannot be filed, or '': the need is an issue's title and its Purpose line, so a control character in it
 * would reach GitHub reading other than its bytes. The tool asks for the need in one line, so anything a one-line field
 * refuses is refused here, before gh runs.
 */
export const theNeedProblemOf = (need: string): string =>
  CONTROL.test(need) ? 'Not filed: the need is the issue title and its Purpose line, so it is one line, with no line break or hidden character. Nothing was sent.' : ''

/** Why a note may not land where it names, or '': a repository nothing declares is one nobody's token publishes into. */
export const theRepoProblemOf = (repo: string, rules: TheNotesRules, declaration: string): string => {
  if (rules.repos.length === 0) {
    return `Not filed: this crew declares no repository for friction notes. Add "${FRICTION_REPOS}": ["<org>/<repo>"] to ${declaration} and call again, and the note lands in the repository the tool lives in. Nothing was sent.`
  }
  if (rules.repos.includes(repo)) return ''
  return `Not filed: ${repo} is not a repository this crew files notes in (it declares ${rules.repos.join(', ')}). Change friction_repos in ${declaration} if that is wrong. Nothing was sent.`
}

/** The rules the note's own text is read by: the text classes only, as crew-code's note was read, and the declared domains. */
const theTextRules = (public_emails: readonly string[]): Rules => ({
  publicEmails: public_emails,
  // A note is not the repository's tree: the addresses and owners a scan resolves are not asked of it.
  publicAddresses: [],
  owners: [],
  ownRepo: '',
  // Off for a real note: every private value is refused, and no synthetic form passes. Only the class is said.
  allowSynthetic: false,
})

/**
 * Why a note may not be published, or '': an issue is read by anyone, so the note is held to every private-text class
 * the scan runs, and what it says is the class alone — never the value (martha#855). The lab hostname is one of the
 * classes, so a note can never make the daily posted-text report red (the Supervisor's ruling on martha#318, which the
 * owner can overrule).
 */
export const thePrivateTextProblemOf = (note: FrictionNote, rules: TheNotesRules): string => {
  const text = `${note.tried}\n${note.did}\n${note.need}`
  const refused = refusedValuesIn(text, theTextRules(rules.public_emails))[0]
  if (refused === undefined) return ''
  return `Not filed: the note carries ${refused.what}, and an issue is read by anyone. Say it without that — describe the box or the path, do not paste one — and call again. Nothing was sent.`
}

/** Why a note is not filed, or '': where it may land and what it may say are settled before gh runs at all. */
export const theNotesRefusalIn = (note: FrictionNote, rules: TheNotesRules, declaration: string): string =>
  theRepoProblemOf(note.repo, rules, declaration) || theNeedProblemOf(note.need) || thePrivateTextProblemOf(note, rules)

/** What the issue is called: the need, cut at a word, with an ellipsis where it was cut. */
export const theNotesTitle = (note: FrictionNote): string => {
  const need = oneLine(note.need)
  if (need.length <= MAX_NOTE_TITLE) return need
  const cut = need.slice(0, MAX_NOTE_TITLE - 1)
  const word = cut.lastIndexOf(' ')
  return `${(word > MAX_NOTE_TITLE / 2 ? cut.slice(0, word) : cut).trimEnd()}…`
}

/** The three questions, in the order the note asks them, under the Purpose line and headings every note shares. */
export const theNotesBody = (note: FrictionNote): string =>
  [
    `Purpose (${note.kind}): ${oneLine(note.need)}`,
    '',
    'A tool-friction note from a crew member: what it tried, what the plugin did, and what it needed.',
    '',
    '### What I tried',
    note.tried.trim(),
    '',
    '### What the tool did',
    note.did.trim(),
    '',
    '### What I needed',
    note.need.trim(),
    '',
    `Filed by ${note.by} (${note.supervisor ? 'the crew supervisor' : 'a crew member'}) on ${note.day}.`,
  ].join('\n')

/**
 * The issue `gh issue create` reported, from the one URL it prints on success. Anything else — an empty answer, a
 * warning, a URL that is not an issue — is no issue, and the caller says so rather than keeping a note that landed
 * nowhere.
 */
export const theFiledIssueIn = (stdout: string): number | null => {
  const found = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/(\d+)\s*$/m.exec(stdout)
  return found === null ? null : Number(found[1])
}

// --- the crew's own index of the notes it filed -----------------------------------

/** The file the crew's index of filed notes is kept in, under its own `friction` place. */
export const THE_NOTES_FILE = 'notes.json'

/** A note the crew filed, with the issue it became. */
export interface AFiledNote extends FrictionNote {
  readonly issue: number
}

/** Every note the crew filed, by `${repo}#${issue}`: the issue is the note itself, and this is what lets a reader count
 * or sweep them without asking GitHub on every draw. Losing it loses a record, never a note. */
export type TheNotesFiled = Readonly<Record<string, AFiledNote>>

/** The key a filed note is kept under: the repository and the issue, which is what the note is about. */
export const theNoteKeyOf = (repo: string, issue: number): string => `${repo}#${issue}`

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A note read back from the index, or null when it is not one this wrote: the entry it needs is the issue it became. */
const aFiledNoteIn = (value: unknown): AFiledNote | null => {
  if (!isObject(value)) return null
  const issue = value['issue']
  if (typeof issue !== 'number' || !Number.isFinite(issue)) return null
  const repo = value['repo']
  if (typeof repo !== 'string' || repo === '') return null
  return value as unknown as AFiledNote
}

/** The notes the crew has on file: an entry this cannot read is dropped, never kept as something it is not. */
export function theNotesIn(text: string | undefined): TheNotesFiled {
  if (text === undefined || text.trim() === '') return {}
  let held: unknown
  try {
    held = JSON.parse(text)
  } catch {
    return {}
  }
  if (!isObject(held)) return {}
  return Object.fromEntries(
    Object.entries(held).flatMap(([key, value]) => {
      const note = aFiledNoteIn(value)
      return note === null ? [] : [[key, note] as const]
    }),
  )
}

/** Every note with this one added, under its own key. */
export const theNotesWith = (notes: TheNotesFiled, note: AFiledNote): TheNotesFiled => ({ ...notes, [theNoteKeyOf(note.repo, note.issue)]: note })

/** Every note except those under `keys`, as the sweep drops the ones whose issue has closed. */
export const theNotesWithout = (notes: TheNotesFiled, keys: readonly string[]): TheNotesFiled =>
  Object.fromEntries(Object.entries(notes).filter(([key]) => !keys.includes(key)))

/** The index as it is kept: one line of JSON, so a reader of the file sees what a reader of the store sees. */
export const theNotesText = (notes: TheNotesFiled): string => `${JSON.stringify(notes)}\n`
