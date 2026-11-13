// Hand a member its crew text.
//
// This exists so a member Martha starts knows the crew's working rules, its own role and how this crew works,
// without anyone pasting them in (martha#306). A checkout's own CLAUDE.md stays out of a session on purpose (A16,
// ../inbound_paths), so without this slice a member started by Martha is handed no crew text at all.
//
// The text is composed from data: the crew's declaration, the texts Martha ships (./texts) and the texts a crew
// writes for itself under .crew/. Nothing here reads disk and nothing here holds a text as code, so a test can hand
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
import type { DocumentStore, FileTree } from '../host_contract/host_contract.ts'
import { CREW_LINES, linesACardTeaches } from '../read_a_crew_line/crew_lines.ts'

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
 * than being shown an approval that quietly holds no crew text (martha#306, r=2).
 */
export async function crewTextFilesToApprove(documents: DocumentStore, root: string): Promise<readonly string[]> {
  try {
    return crewTextFilesOf(await declareCrew(documents, root))
  } catch (error) {
    if (error instanceof DeclarationRefused && error.field === null && error.message.endsWith('is missing')) return []
    throw error
  }
}

/** The placeholders a text may carry, in the words the crew's own texts use. The owner's is the word the declaration
 * names the owner by, so a text and a declaration cannot come to spell the same person two ways. */
export const PLACEHOLDERS = [OWNER, 'handoff', 'doc_handoff', 'verdict', 'doc_verdict'] as const
export type Placeholder = (typeof PLACEHOLDERS)[number]

/** The placeholders that stand for a line a member sends. */
export type LinePlaceholder = Exclude<Placeholder, typeof OWNER>

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
  const role = textOf(texts.role_text, join(DECLARATION_DIRECTORY, ROLE_TEXTS_DIRECTORY, `${texts.role}.md`), `a role text for "${texts.role}"`)
  const mode = textOf(texts.mode_text, join(DECLARATION_DIRECTORY, MODE_TEXTS_DIRECTORY, `${texts.mode}.md`), `a mode text for "${texts.mode}"`)
  const parts: string[] = [
    `## You are ${texts.member}, the crew's ${texts.role}\n\nThis crew works ${texts.mode}, and its owner is ${texts.owner}.`,
    ...(texts.practice === null ? [] : [`## Crew practice\n\n${filled(numbered(texts.practice.text), texts.practice.file)}`]),
    `## Your role: ${texts.role}\n\n${filled(role.text, role.file)}`,
    `## How this crew works: ${texts.mode}\n\n${filled(mode.text, mode.file)}`,
    `## The lines you send\n\n${theLinesTaughtText()}`,
    ...(texts.conventions === null ? [] : [`## Conventions\n\n${filled(texts.conventions.text, texts.conventions.file)}`]),
  ]
  const section = parts.join('\n\n')
  assertUnderTheCeiling(section.length, texts)
  return section
}

/** A text a part is built from, or the refusal naming the file to write. */
function textOf(text: ATextAndItsFile | null, toWrite: string, what: string): ATextAndItsFile {
  if (text === null) throw new CrewTextRefused(toWrite, `there is no ${what}: Martha ships none under that name and this crew writes none. Write it there.`)
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
  return { [OWNER]: texts.owner, ...theLinesTaught() }
}

/**
 * Fills the placeholders a text may carry, naming the file that holds one this composer does not know. A crew text
 * naming something nobody fills would otherwise reach every member's session with `{{…}}` in it, reading as a rule.
 */
function replaceThePlaceholders(text: string, file: string, values: Readonly<Record<Placeholder, string>>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, name: string) => {
    if (!isPlaceholder(name)) {
      throw new CrewTextRefused(file, `it names ${whole}, which Martha does not fill (it fills ${PLACEHOLDERS.map((one) => `{{${one}}}`).join(', ')})`)
    }
    return values[name]
  })
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
