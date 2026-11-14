// Where one file spells a name crew-code owns (martha#468).
//
// A source is read as the parser reads it, so only what the code says counts: a comment naming a crew-code name explains
// a difference and is silent, a string literal is not, and a template piece that runs on into a value is a name too
// (`crew_channel_taken/${member}` spells `crew_channel_taken`). A file that is not a source — a fixture, a shell
// script — has no parser to tell its words from its text, so a name is read there where it stands between characters
// that cannot be part of one, and a family is judged against each such word.

import { theTextsASourceSpells } from '../../prove_the_core/the_texts_a_source_spells.ts'
import { isScannedSource } from '../host_contract/core_source.ts'
import { CREW_CODE_NAMES, type CrewCodeName } from './the_crew_code_names.ts'

/** A file kind the check reads as text, because it can carry a name and has no parser. */
const TEXT_EXTENSIONS = ['.json', '.jsonl', '.sh'] as const

/** Whether a file is one the check reads: a source, or a file of a kind that can carry a name as text. */
export const isAFileTheCheckReads = (path: string): boolean => isScannedSource(path) || TEXT_EXTENSIONS.some((extension) => path.endsWith(extension))

/** One place a file spells a name crew-code owns. */
export interface Finding {
  /** The file, as the caller named it. */
  readonly path: string
  /** The 1-based line the name is on. */
  readonly line: number
  /** What was spelled. */
  readonly text: string
  /** What crew-code gives that name to. */
  readonly what: string
}

/** What the name is to crew-code, or undefined when this text is none of its names. */
export function crewCodeNameOf(text: string, names: readonly CrewCodeName[] = CREW_CODE_NAMES): { readonly text: string; readonly what: string } | undefined {
  for (const name of names) {
    if (matches(name, text)) return { text: name.kind === 'family' ? text : name.text, what: name.what }
  }
  return undefined
}

const matches = (name: CrewCodeName, text: string): boolean =>
  name.kind === 'literal' ? text === name.text : name.kind === 'runs_on' ? text.startsWith(name.text) : name.pattern.test(text)

/** A character that can be part of a name, so a name is found inside a line only where one of these is not beside it. */
const NOT_A_NAME_LETTER = '[A-Za-z0-9_]'

/** `text` as a pattern that finds it in a line, bounded so a longer word is not it. */
const boundedIn = (text: string): RegExp =>
  new RegExp(`(?<!${NOT_A_NAME_LETTER})${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!${NOT_A_NAME_LETTER})`)

/** The words a line holds, for a family to be judged against each: what stands between characters a name cannot hold. */
const wordsIn = (line: string): readonly string[] => line.split(/[^A-Za-z0-9_.\-/]+/).filter((word) => word !== '')

/** The names a source spells, as the parser reads it: a comment has no node, so a name there is never one of these. */
function findingsInASource(path: string, text: string, names: readonly CrewCodeName[]): readonly Finding[] {
  return theTextsASourceSpells(text, path).flatMap((spelled) => {
    const name = crewCodeNameOf(spelled.text, names)
    return name === undefined ? [] : [{ path, line: spelled.line, text: spelled.text, what: name.what }]
  })
}

/** The names one line of a file with no parser spells: a family judged against each word the line holds, a literal or a
 * runs-on judged whole and bounded so a longer word is not it. Either way what is reported is the text found. */
function findingsOnALine(path: string, line: string, at: number, names: readonly CrewCodeName[]): readonly Finding[] {
  return names.flatMap((name) => {
    const found =
      name.kind === 'family'
        ? wordsIn(line).find((held) => name.pattern.test(held))
        : boundedIn(name.text).test(line)
          ? name.text
          : undefined
    return found === undefined ? [] : [{ path, line: at + 1, text: found, what: name.what }]
  })
}

/** What one file spells, as findings, in the order the file holds them. The table is a parameter with the shipped one
 * as its default, so a test can judge the same tree against an emptied table and show that this is what catches a name. */
export function findingsIn(path: string, text: string, names: readonly CrewCodeName[] = CREW_CODE_NAMES): readonly Finding[] {
  if (isScannedSource(path)) return findingsInASource(path, text, names)
  return text.split('\n').flatMap((line, at) => findingsOnALine(path, line, at, names))
}
