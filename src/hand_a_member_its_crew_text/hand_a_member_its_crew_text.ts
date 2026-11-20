// Hand a member its crew text.
//
// This exists so a member Martha starts knows the crew's working rules, its own role and how this crew works,
// without anyone pasting them in (martha#306). A checkout's own CLAUDE.md stays out of a session on purpose (A16,
// ../inbound_paths), so without this slice a member started by Martha is handed no crew text at all.
//
// The text is composed from data: the crew's declaration, the texts Martha ships (./texts) and the texts a crew
// writes for itself under .martha/. Nothing here reads disk and nothing here holds a text as code, so a test can hand
// in any bytes and the launcher decides which bytes are the approved ones (../launch_a_claude_code_member reads them
// once, at launch).
//
// The order is the design's (martha#306): who the member is, the practice when the crew switched it on, its role's
// text, the mode's text, the lines it sends, and the crew's conventions when it declares a file. The lines are
// generated from ../read_a_crew_line, so what a member is taught is what the reader accepts.
//
// Nothing is defaulted silently, as ../declare_crew refuses everywhere else: a role or a mode with no text is refused
// naming the file to write, a conventions file the declaration names and the disk does not hold is refused, a
// placeholder the composer does not know is refused naming it, and a section over the ceiling is refused naming the
// file and the size.

import { join, relative, sep } from 'node:path'

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import { crewTextFilesOf, DeclarationRefused, declareCrew, DECLARATION_DIRECTORY, MODE_TEXTS_DIRECTORY, OWNER, ROLE_TEXTS_DIRECTORY } from '../declare_crew/declare_crew.ts'
export { crewTextFilesOf }
import { aMostIsSet, CREW_LINE_LINES_MOST, FAIL_ONLY_ON_HARM, HOUSE_RULE_TRIMS, MUTANTS_ON_GUARDS_ONLY, REVIEW_ROUNDS_MOST, type TheCrewsTrims } from '../declare_crew/the_crews_trims.ts'
import type { DocumentStore, FileTree } from '../host_contract/host_contract.ts'
import { CREW_LINES, linesACardTeaches } from '../read_a_crew_line/crew_lines.ts'
import type { ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { OFFER_OWNER_ASKS, whoTheTableGrants } from '../declare_crew/declare_crew.ts'
import { thePortedRules, type WhatThePortedRulesRead } from './the_ported_rules.ts'
import { theWorkspaceTheCrewDeclared } from '../guard_workspace/guard_workspace.ts'

/**
 * Where Martha's own texts ship, inside this slice. `import.meta.dirname` is the one way a slice may know its own
 * place: it imports nothing, and the modules a slice may import are node:path and node:crypto (prove_the_core).
 */
export const SHIPPED_TEXTS = join(import.meta.dirname, 'texts')

/** The practice text's name, relative to the shipped directory. The role and mode texts sit in the two directories
 * declare_crew names, so a crew's own text and a shipped one are found by the same path below their root. */
export const PRACTICE_TEXT = 'practice.md'

/**
 * The most a composed section may be, in characters. It is one constant, named here and nowhere else: a section is
 * handed to every session of every member, so a crew text that grew without limit would cost every session its
 * context. Over it, the launch is refused naming the file that made the section over-long.
 */
export const THE_SECTION_CEILING = 24_000

/** A text, and the file it was read from: the words a refusal can show the owner. */
export interface ATextAndItsFile {
  readonly file: string
  readonly text: string
}

/** Everything the composer is given, all of it read for it: the composer reads nothing itself. */
export interface TheTextsAMemberReads {
  readonly member: string
  readonly role: string
  readonly mode: string
  readonly owner: string
  /** The practice text, or null when the crew did not switch `house_rules.practice` on. */
  readonly practice: ATextAndItsFile | null
  /** The member's role text, or null when there is none to hand, which is a refusal. */
  readonly role_text: ATextAndItsFile | null
  /** The mode's text, or null when there is none to hand, which is a refusal. */
  readonly mode_text: ATextAndItsFile | null
  /** The crew's conventions, when its declaration names one. */
  readonly conventions: ATextAndItsFile | null
  /** The crew's four trims, whose sentences the cards teach (martha#1010). */
  readonly trims: TheCrewsTrims
  /** What the crew-code rules Martha hands are read from (martha#971): the declaration's switches and this member's grants. */
  readonly ported: Omit<WhatThePortedRulesRead, 'owner'>
}

/** Why a section was not composed: the file to blame, and the words to show the owner. */
export class CrewTextRefused extends Error {
  readonly file: string

  constructor(file: string, why: string) {
    super(`${file}: ${why}`)
    this.name = 'CrewTextRefused'
    this.file = file
  }
}

/** The crew text a launch hands, or why it hands none: the one place a launcher and a test read this. */
export type TheCrewTextToHand = { readonly text: string } | { readonly refusal: string }

/** Why a member is not started when its crew text is refused: the member named first, then what to write or fix. */
export const noCrewTextFor = (member: string, refusal: string): string => `${member} would be handed no crew text. ${refusal}`

/** A launch that hands no crew text, because the crew declared none. */
export const NO_CREW_TEXT: TheCrewTextToHand = { text: '' }

/**
 * The text one member is handed, composed once from the bytes the launch carried, or why it is not handed. The crew's
 * own texts are answered from `carried` alone — the bytes the approval read and hashed — so a file rewritten after the
 * approval reaches no session; Martha's shipped texts are read through `files`. A refusal names the file to write, the
 * placeholder nobody fills, or the size; it is a refusal rather than a default, so a member never works on text that is
 * not the crew's. A launch that names no crew is handed the empty text, which is the one answer this slice gives
 * without reading anything.
 */
export function crewTextToHand(
  settings: CrewSettings | undefined,
  member: string,
  carried: Readonly<Record<string, Uint8Array>>,
  files: Pick<FileTree, 'kindOf' | 'bytesOf'>,
): TheCrewTextToHand {
  if (settings === undefined) return NO_CREW_TEXT
  try {
    return { text: handAMemberItsCrewText(theTextsAMemberReads(settings, member, textsIn(settings.paths.root, carried, files))) }
  } catch (error) {
    if (error instanceof CrewTextRefused) return { refusal: error.message }
    throw error
  }
}

/**
 * The texts a member reads, by where they stand. A path the launch carried is answered from those bytes, which is
 * every crew text the approval found; a shipped path is read from the package; and anything else is a crew file the
 * approval found absent, which is answered as absent so the shipped text stands in, as the design says it does.
 */
function textsIn(root: string, carried: Readonly<Record<string, Uint8Array>>, files: Pick<FileTree, 'kindOf' | 'bytesOf'>): ReadAText {
  const shipped = textIn(files)
  return (path) => {
    const belowRoot = relative(root, path).split(sep).join('/')
    if (Object.hasOwn(carried, belowRoot)) return Buffer.from(carried[belowRoot]!).toString('utf8')
    return path.startsWith(SHIPPED_TEXTS) ? shipped(path) : null
  }
}

/**
 * A text file as it is on the machine, or null when it is not there. A file that is there and cannot be read as text
 * is refused rather than answered with null: falling back to a shipped text would hand a member text the crew did not
 * write, and falling back to no conventions would hand it less than the crew declared. A directory where a text should
 * be is refused too, naming it: it is not a file, and reading it as absent would quietly hand the shipped text instead.
 */
function textIn(files: Pick<FileTree, 'kindOf' | 'bytesOf'>): ReadAText {
  return (path) => {
    const kind = files.kindOf(path)
    if (kind.kind === 'absent') return null
    if (kind.kind !== 'file') {
      const what = kind.kind === 'symlink' ? 'a link' : kind.kind === 'directory' ? 'a directory, and a text is a file' : 'not a plain file'
      throw new CrewTextRefused(path, `is ${what}, so the text it holds cannot be read as the crew's own`)
    }
    return Buffer.from(files.bytesOf(path)).toString('utf8')
  }
}

/**
 * The crew's own text files for a project, or none when there is no crew declared there. A declaration that is there
 * and is refused is not answered as none: its refusal names the file and the field, and the owner is told that rather
 * than being shown an approval that quietly holds no crew text (martha#306, r=2). It is read with the models the host
 * offers, as a member's own start reads it, so an approval and a start can never disagree about the declaration.
 */
export async function crewTextFilesToApprove(documents: DocumentStore, root: string, models: ModelVocabulary): Promise<readonly string[]> {
  try {
    return crewTextFilesOf(await declareCrew(documents, root, models))
  } catch (error) {
    if (error instanceof DeclarationRefused && error.field === null && error.message.endsWith('is missing')) return []
    throw error
  }
}

/** The placeholders that stand for a line a member sends. */
export const LINE_PLACEHOLDERS = ['handoff', 'doc_handoff', 'verdict', 'doc_verdict'] as const
export type LinePlaceholder = (typeof LINE_PLACEHOLDERS)[number]

/** The placeholders one of the crew's trims fills, named as the house rule is (martha#1010). */
export const TRIM_PLACEHOLDERS = HOUSE_RULE_TRIMS
export type TrimPlaceholder = (typeof HOUSE_RULE_TRIMS)[number]

/** The placeholders a text may carry, in the words the crew's own texts use. The owner's is the word the declaration
 * names the owner by, so a text and a declaration cannot come to spell the same person two ways. The crew's four trims
 * are placeholders too (martha#1010): each fills with a sentence, or with nothing when the owner turned its notice off. */
export const PLACEHOLDERS = [OWNER, ...LINE_PLACEHOLDERS, ...TRIM_PLACEHOLDERS] as const
export type Placeholder = (typeof PLACEHOLDERS)[number]

/**
 * The lines the section teaches, keyed by the placeholder a text names them with, generated from the same definitions
 * the reader parses (../read_a_crew_line), so the words a member is taught are the words the crew accepts.
 */
export function theLinesTaught(): Readonly<Record<LinePlaceholder, string>> {
  const taught = linesACardTeaches()
  if (taught.length !== CREW_LINES.length * 2) {
    throw new Error(`the card text taught ${taught.length} lines for ${CREW_LINES.length} shapes, so a placeholder cannot be paired with its line`)
  }
  const lineOf = (verb: string, design: boolean): string => {
    const shape = CREW_LINES.findIndex((line) => line.verb === verb)
    return taught[shape * 2 + (design ? 1 : 0)]?.line ?? ''
  }
  return { handoff: lineOf('HANDOFF', false), doc_handoff: lineOf('HANDOFF', true), verdict: lineOf('VERDICT', false), doc_verdict: lineOf('VERDICT', true) }
}

/** Reads a file's text, or null when the file is not there. */
export type ReadAText = (path: string) => string | null

/**
 * Everything one member is handed, resolved against the declaration: the crew's own file for a role or a mode wins
 * over Martha's shipped one, the practice only when the crew switched it on (and never rewritten), and the
 * conventions only from the file the declaration names. A conventions file that is named and absent is a refusal:
 * falling back to no conventions would hand a member less than the crew declared.
 */
export function theTextsAMemberReads(settings: CrewSettings, member: string, read: ReadAText): TheTextsAMemberReads {
  const onTheCrew = settings.members.find((candidate) => candidate.name === member)
  if (onTheCrew === undefined) throw new CrewTextRefused(settings.paths.declaration, `names no member ${member}`)
  const firstOf = (...paths: readonly string[]): ATextAndItsFile | null => {
    for (const path of paths) {
      const text = read(path)
      if (text !== null) return { file: path, text }
    }
    return null
  }
  return {
    member: onTheCrew.name,
    role: onTheCrew.role,
    mode: settings.mode.name,
    owner: settings.owner,
    practice: settings.house_rules.practice ? firstOf(join(SHIPPED_TEXTS, PRACTICE_TEXT)) : null,
    role_text: firstOf(join(settings.paths.crew, ROLE_TEXTS_DIRECTORY, `${onTheCrew.role}.md`), join(SHIPPED_TEXTS, ROLE_TEXTS_DIRECTORY, `${onTheCrew.role}.md`)),
    mode_text: firstOf(join(settings.paths.crew, MODE_TEXTS_DIRECTORY, `${settings.mode.name}.md`), join(SHIPPED_TEXTS, MODE_TEXTS_DIRECTORY, `${settings.mode.name}.md`)),
    conventions: conventionsOf(settings, member, firstOf),
    trims: settings.house_rules,
    ported: thePortedRulesOf(settings, onTheCrew.role),
  }
}

/**
 * What the ported rules read of the declaration (martha#971): the workspace as the git guard reads it, so its rules are
 * taught exactly where it holds them (review r=1), the review model, and this role's two grants.
 */
function thePortedRulesOf(settings: CrewSettings, role: string): Omit<WhatThePortedRulesRead, 'owner'> {
  const { clones, worktrees } = theWorkspaceTheCrewDeclared(settings) ?? { clones: null, worktrees: null }
  return {
    layout: clones === null || worktrees === null ? null : { clones, worktrees },
    review_model: settings.house_rules.review_model,
    assigns_work: whoTheTableGrants(settings.mode.may.assign_work).includes(role),
    offers_owner_asks: whoTheTableGrants(settings.mode.may[OFFER_OWNER_ASKS]).includes(role),
  }
}

/** The conventions the declaration names, or why there is none to hand. */
function conventionsOf(settings: CrewSettings, member: string, firstOf: (...paths: readonly string[]) => ATextAndItsFile | null): ATextAndItsFile | null {
  if (settings.paths.conventions === null) return null
  const conventions = firstOf(settings.paths.conventions)
  if (conventions === null) throw new CrewTextRefused(settings.paths.conventions, `the declaration names it as this crew's conventions and no such file is there, so ${member} would be handed a crew with none`)
  return conventions
}

/**
 * The section a member's session starts with, composed from what it was given, or why it was not composed.
 *
 * The parts are the design's, in its order; a part whose text is absent is left out only where the design says so
 * (the practice is the crew's switch, the conventions are its declaration). A role or a mode with no text at all is
 * a refusal, because a member told nothing about what it is would be a member Martha started without knowing.
 */
export function handAMemberItsCrewText(texts: TheTextsAMemberReads): string {
  const values = placeholdersFor(texts)
  const filled = (text: string, file: string): string => replaceThePlaceholders(text.trim(), file, values)
  const role = textOf(texts.role_text, join(DECLARATION_DIRECTORY, ROLE_TEXTS_DIRECTORY, `${texts.role}.md`), `role text for "${texts.role}"`)
  const mode = textOf(texts.mode_text, join(DECLARATION_DIRECTORY, MODE_TEXTS_DIRECTORY, `${texts.mode}.md`), `mode text for "${texts.mode}"`)
  const parts: string[] = [
    `## You are ${texts.member}, the crew's ${texts.role}\n\nThis crew works ${texts.mode}, and its owner is ${texts.owner}.`,
    ...(texts.practice === null ? [] : [`## Crew practice\n\n${filled(numbered(texts.practice.text), texts.practice.file)}`]),
    `## Your role: ${texts.role}\n\n${filled(role.text, role.file)}`,
    `## How this crew works: ${texts.mode}\n\n${filled(mode.text, mode.file)}`,
    `## The lines you send\n\n${theLinesTaughtText()}`,
    ...thePortedRules({ owner: texts.owner, ...texts.ported }),
    ...(texts.conventions === null ? [] : [`## Conventions\n\n${filled(texts.conventions.text, texts.conventions.file)}`]),
  ]
  const section = parts.join('\n\n')
  assertUnderTheCeiling(section.length, texts)
  return section
}

/** A text a part is built from, or the refusal naming the file to write. */
function textOf(text: ATextAndItsFile | null, toWrite: string, what: string): ATextAndItsFile {
  if (text === null) throw new CrewTextRefused(toWrite, `Martha ships no ${what}, and this crew has written none. Write one at that path.`)
  return text
}

/** Each rule of the practice on its own line, numbered as the crew's rules are. */
function numbered(practice: string): string {
  return practice
    .split(/\n\s*\n/)
    .map((rule) => rule.trim())
    .filter((rule) => rule !== '')
    .map((rule, at) => `(${at + 1}) ${rule}`)
    .join('\n\n')
}

/** The lines a member sends, as the crew's reader accepts them. */
function theLinesTaughtText(): string {
  return linesACardTeaches()
    .map((taught) => `- \`${taught.line}\` — ${taught.says}`)
    .join('\n')
}

/** What each placeholder stands for, from the declaration and the lines the reader accepts. */
function placeholdersFor(texts: TheTextsAMemberReads): Readonly<Record<Placeholder, string>> {
  return { [OWNER]: texts.owner, ...theLinesTaught(), ...theTrimSentences(texts.trims) }
}

/**
 * What a crew's trim says to a member (martha#1010), or nothing when the owner turned it off: a number with no fixed
 * line (0, or false) leaves the crew's own rule in place for the rounds, and drops a line that says only what the trim
 * asked for. What is written here is the only copy: a card that quotes a trim quotes this text.
 */
function theTrimSentences(trims: TheCrewsTrims): Readonly<Record<TrimPlaceholder, string>> {
  const rounds = trims[REVIEW_ROUNDS_MOST]
  const lines = trims[CREW_LINE_LINES_MOST]
  return {
    [REVIEW_ROUNDS_MOST]: aMostIsSet(rounds)
      ? `At most ${String(rounds)} review rounds per package. A FAIL after the last one goes to the owner as a scope question, never as another round.`
      : 'Review rounds repeat as fix-and-verify until every required review passes; the bar never drops to end a round.',
    [CREW_LINE_LINES_MOST]: aMostIsSet(lines) ? `A HANDOFF or VERDICT is at most ${String(lines)} lines.` : '',
    [FAIL_ONLY_ON_HARM]: trims[FAIL_ONLY_ON_HARM]
      ? 'FAIL only for harm a user or the owner would hit: a behaviour bug, lost work, a leak, a security hole. Anything else is a PASS note.'
      : '',
    [MUTANTS_ON_GUARDS_ONLY]: trims[MUTANTS_ON_GUARDS_ONLY] ? 'Mutants and planted bugs only on guard and security code.' : '',
  }
}

/**
 * Fills the placeholders a text may carry, naming the file that holds one this composer does not know. A crew text
 * naming something nobody fills would otherwise reach every member's session with `{{…}}` in it, reading as a rule.
 * A line whose whole content is placeholders that fill nothing is dropped, so a trim the owner turned off leaves no
 * blank line in the card (martha#1010).
 */
function replaceThePlaceholders(text: string, file: string, values: Readonly<Record<Placeholder, string>>): string {
  const filled = text
    .split('\n')
    .filter((line) => !saysNothingOnceFilled(line, values))
    .map((line) => line.replace(A_PLACEHOLDER, (whole, name: string) => {
      if (!isPlaceholder(name)) {
        throw new CrewTextRefused(file, `it names ${whole}, which Martha does not fill (it fills ${PLACEHOLDERS.map((one) => `{{${one}}}`).join(', ')})`)
      }
      return values[name]
    }))
    .join('\n')
  // A paragraph a dropped line sat between leaves nothing but its blank lines: a card is read, so they go too.
  return filled.replace(/\n{3,}/g, '\n\n').trim()
}

/** A placeholder as a text writes it: the name in braces, with the spaces a writer of prose leaves there. */
const A_PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g

/** Whether a line is placeholders alone, every one of them filling nothing: the line a turned-off trim drops. */
function saysNothingOnceFilled(line: string, values: Readonly<Record<Placeholder, string>>): boolean {
  const named = [...line.matchAll(A_PLACEHOLDER)].map((match) => match[1] ?? '')
  if (named.length === 0 || line.replace(A_PLACEHOLDER, '').trim() !== '') return false
  return named.every((name) => isPlaceholder(name) && values[name] === '')
}

function isPlaceholder(name: string): name is Placeholder {
  return (PLACEHOLDERS as readonly string[]).includes(name)
}

/** Over the ceiling, the refusal names the file holding the longest text and the size the section came to. */
function assertUnderTheCeiling(size: number, texts: TheTextsAMemberReads): void {
  if (size <= THE_SECTION_CEILING) return
  const held = [texts.practice, texts.role_text, texts.mode_text, texts.conventions].filter((text): text is ATextAndItsFile => text !== null)
  const longest = held.reduce<ATextAndItsFile | null>((a, b) => (a === null || b.text.length > a.text.length ? b : a), null)
  // Every file is named with its size, not only the longest: the file that grew need not be the longest one, and a
  // refusal that named the wrong file would send the owner to trim text that was always that size.
  const sizes = held.map((text) => `${text.file} is ${text.text.length}`).join(', ')
  throw new CrewTextRefused(longest?.file ?? DECLARATION_DIRECTORY, `the crew text this member is handed is ${size} characters, over Martha's limit of ${THE_SECTION_CEILING}: ${sizes}`)
}
