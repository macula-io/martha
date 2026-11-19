// Nothing in the core reads a kept transcript (martha#646, D4).
//
//   node prove_the_core/what_the_core_may_reach/nothing_reads_the_kept_transcripts.ts [--root <dir>]
//
// Exit 0 no slice of src/ reads the kept place; 1 a slice does, each file and line named; 2 the check could not look
// (the place's own name is not declared, no source was found, or a source does not parse). It never passes because it
// could not look.
//
// A kept transcript holds what a member's session did, in the clear but for the tokens redacted from it. It is kept to be
// read AFTER the launch has ended, and by the owner and not by another slice: a slice that read it would give the core a
// second input the launch gate never saw, and the design says plainly that the copy is never an input. So the one file
// that writes it is the only place that touches it, and everything else in the core is held off by this check.
//
// What it reads: the syntax tree of every source under src/, so a name inside a string or a comment is text and never a
// finding, and a read split over lines is still a read. A finding is a read call whose argument names the place — the
// place's own constant (its name read from the declaration, the value imported from it, never spelled here) or a text
// that is that place's path — with the file and the line the call starts on.
//
// What it cannot see, stated: a read whose path is built by a slice's own helper before it reaches the read call (the
// helper's call names the place, not the fs call); a read through a subprocess or a host's own store; and anything
// outside src/, which this check never reads. The clean-install proof's failure capture, the one reader the design
// allows, lives under installer/ and reads the kept copy as the owner does, so it is never a finding here.
//
// This folder is outside src/, the core, on purpose: it imports the TypeScript compiler, a package the core itself may
// never import.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'

import { TRANSCRIPTS_PLACE } from '../../src/keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import type { CoreSource } from '../../src/host_contract/core_source.ts'
import { coreSources } from '../read_the_manifest_and_the_linter/core_sources.ts'
import { lineOf, nodesOf, parseSource } from '../read_a_source/parse_a_source.ts'

/** What every line this check prints starts with. */
export const NAME = 'nothing_reads_the_kept_transcripts'

/** The core's own directory, relative to the repository. */
const CORE = 'src'

/** The one directory of src/ that writes the kept place, and so the one that may touch it. */
export const THE_WRITER = `${CORE}/keep_the_transcripts_of_a_launch/`

/** The slice that declares the place: the name is read from its own declaration, never spelled in this check. */
export const THE_STATE_SLICE = `${CORE}/keep_martha_state_outside_the_checkout/`

/** The calls that read a place's bytes or names: a call of one of these that names the kept place is a finding. */
export const THE_READS: readonly string[] = [
  'readFileSync', 'readFile', 'readdirSync', 'readdir', 'createReadStream', 'openSync', 'open', 'readSync',
]

/** One reader of the kept place, as a red run names it. */
export interface AReader {
  /** The source, relative to the repository. */
  readonly file: string
  /** The 1-based line the read call starts on. */
  readonly line: number
  /** The read the call makes, for the line a red run prints. */
  readonly call: string
}

/** A source that did not parse: the check could not look at it, which is never a pass. */
export interface Unreadable {
  readonly file: string
  readonly line: number
  readonly message: string
}

/** Whether a source is a test, which proves the place rather than reading it in the core's work. */
export const isATestSource = (path: string): boolean => path.includes('.node-test.')

/** Whether a source is judged: every source of the core except a test and the one directory that writes the place. */
export const isJudged = (path: string): boolean =>
  path.startsWith(`${CORE}/`) && !isATestSource(path) && !path.startsWith(THE_WRITER)

/**
 * The name the state slice gives the place, read from the declaration whose value is the place's: the check never
 * spells the name, so a rename moves both together or the check says it cannot look.
 */
export function thePlacesNameIn(sources: readonly CoreSource[], theValue: string): string | undefined {
  const declared = sources.filter((source) => source.path.startsWith(THE_STATE_SLICE))
  for (const source of declared) {
    const name = thePlaceNameInSource(source, theValue)
    if (name !== undefined) return name
  }
  return undefined
}

/** The name one source declares for a constant whose value is `theValue`, or undefined when it declares none. */
function thePlaceNameInSource(source: CoreSource, theValue: string): string | undefined {
  const { file } = parseSource(source.text, source.path)
  for (const node of nodesOf(file)) {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) continue
    const initializer = node.initializer
    if (initializer !== undefined && ts.isStringLiteral(initializer) && initializer.text === theValue) return node.name.text
  }
  return undefined
}

/** The name a call is made by: an identifier's text, or the last name of a property access. */
const calledBy = (expression: ts.Expression): string | undefined => {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/**
 * How a source's syntax names the kept place: the constant's own name, or a text that walks through its path. The path
 * is matched as a segment of a whole path, so `${state}/transcripts/one.jsonl` and `join(state, 'transcripts')` both
 * count, and a word that merely starts with the same letters (`transcripts_old`) never does.
 */
export interface Matcher {
  readonly theName: string
  /** Whether `text` walks through the kept place's own path. */
  readonly holdsIn: (text: string) => boolean
}

/** A matcher for the place whose constant is named `theName` and whose own path is `theValue`. */
export function matcherFor(theName: string, theValue: string): Matcher {
  const escaped = theValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const aPathThrough = new RegExp(`(^|/)${escaped}(/|$)`)
  return { theName, holdsIn: (text) => aPathThrough.test(text) }
}

/** Whether `node` names the kept place: its own constant, or a text that walks through its path. */
const namesThePlace = (node: ts.Node, matcher: Matcher): boolean => {
  if (ts.isIdentifier(node)) return node.text === matcher.theName
  // A template's static pieces are not string nodes: `\`${state}/transcripts/x\`` spells the place in a middle.
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return matcher.holdsIn(node.text)
  }
  return false
}

/** Whether any node of `node`'s subtree names the kept place. */
const holdsThePlace = (node: ts.Node, matcher: Matcher): boolean => {
  if (namesThePlace(node, matcher)) return true
  let found = false
  ts.forEachChild(node, (child) => {
    if (!found && holdsThePlace(child, matcher)) found = true
  })
  return found
}

/**
 * Every read of the kept place in one source: a call of one of THE_READS whose arguments name it. Empty when the source
 * does not touch it, and when the source is not judged at all.
 */
export function readersIn(source: CoreSource, matcher: Matcher): readonly AReader[] {
  if (!isJudged(source.path)) return []
  const { file } = parseSource(source.text, source.path)
  const readers: AReader[] = []
  for (const node of nodesOf(file)) {
    if (!ts.isCallExpression(node)) continue
    const call = calledBy(node.expression)
    if (call === undefined || !THE_READS.includes(call)) continue
    if (!node.arguments.some((argument) => holdsThePlace(argument, matcher))) continue
    readers.push({ file: source.path, line: lineOf(file, node), call })
  }
  return readers
}

/** A source the compiler could not read: the check cannot judge it, and says so rather than passing it. */
export function unreadableIn(source: CoreSource): Unreadable | undefined {
  if (!isJudged(source.path)) return undefined
  const first = parseSource(source.text, source.path).errors[0]
  return first === undefined ? undefined : { file: source.path, line: first.line, message: first.message }
}

/** The core's sources under `root`, each path spelled from the repository; none when the tree holds no src/. */
export const theCoresSources = (root: string): readonly CoreSource[] => {
  if (!existsSync(join(root, CORE))) return []
  return coreSources(join(root, CORE)).map((source) => ({ path: `${CORE}/${source.path}`, text: source.text }))
}

/** An option's value from the words a run was given, or undefined when it is not there. */
const option = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

/** The check over the tree at `root`: the exit code, and the lines a run prints. */
export function theGate(root: string): [number, string[]] {
  const sources = theCoresSources(root)
  const judged = sources.filter((source) => isJudged(source.path))
  if (judged.length === 0) return [2, [`${NAME}: no source of the core was found under ${join(root, CORE)}, so nothing was checked`]]
  const theName = thePlacesNameIn(sources, TRANSCRIPTS_PLACE)
  if (theName === undefined) {
    return [2, [`${NAME}: the state slice declares no name for the place whose value is "${TRANSCRIPTS_PLACE}", so the check could not look`]]
  }
  const unreadable = judged.flatMap((source) => unreadableIn(source) ?? [])
  if (unreadable.length > 0) {
    return [2, [`${NAME}: the check could not read ${unreadable.length} source(s) of the core:`,
      ...unreadable.map((one) => `  ${one.file}:${one.line}: ${one.message}`)]]
  }
  const readers = judged.flatMap((source) => readersIn(source, matcherFor(theName, TRANSCRIPTS_PLACE)))
  if (readers.length > 0) {
    return [1, [`${NAME}: ${readers.length} read(s) of the kept transcripts in the core, where only ${THE_WRITER} may touch them:`,
      ...readers.map((reader) => `  ${reader.file}:${reader.line}: ${reader.call} names the kept place`)]]
  }
  return [0, [`${NAME}: read ${judged.length} source(s) of the core, and none of them reads the kept transcripts`]]
}

// Run when it is run, and only read when a test imports it: a module whose runner ran on import would set the exit code
// of whatever process imported it.
if (import.meta.main) {
  const root = option(process.argv.slice(2), '--root') ?? join(import.meta.dirname, '../..')
  const [code, lines] = theGate(root)
  for (const line of lines) (code === 0 ? process.stdout : process.stderr).write(`${line}\n`)
  process.exitCode = code
}
