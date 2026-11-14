// No core slice reads a host's bundle or the shape of a host's answer (martha#463).
//
// This exists so someone porting Martha to a second host finds every piece of Claude Code's own knowledge under the
// host adapters package.json declares, and a core slice that holds some fails here by name rather than reading as
// host-neutral.
//
// Two things are named, in a core slice's own code:
//
//   - a MINIFIER'S NAME: `[\w$]+`, a run of the characters a minifier names things with, written in a regular
//     expression or in the text of a string or template one is built from. A host's shipped bundle is minified, so
//     this is what cutting it looks like; source that is not minified is matched by an identifier's own shape
//     (`[A-Za-z_$][\w$]*`), which this check leaves alone.
//   - a FIELD OF A HOST'S ANSWER: a name the Claude Code host declares as one of its answer's own fields
//     (CLAUDE_CODE_ANSWER_FIELDS, in ../src/claude_code_host/the_agent_calls_answer.ts), spelt as a property, a
//     binding, a type member or a string in a core slice. The list is the host's, read where the host reads it, so a
//     field the host's reader takes up is refused in the core the day it is added.
//
// Not judged, as the core's other rules judge them: the host glue and the host adapters package.json declares, test
// files, the programs package.json's scripts run with their declared parts (the recorder, record_claude_code_host,
// is one: it cuts the bundle to write the recording the adapters read), and a slice's coincidences.ts.
//
// What it catches is mistakes and plain reaches, not code written to get past it; review guards against that.

import { sep } from 'node:path'

import ts from 'typescript'

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { lineOf, nodesOf, parseSource } from './parse_a_source.ts'
import { isTestFile } from './declared_in_package_json.ts'
import { isACoincidenceFile } from './the_coincidences_a_slice_declares.ts'

/** A minifier's name, as a pattern spells it: the word characters and the dollar, one or more. */
const A_MINIFIERS_NAME = /\[(?:\\w\$|\$\\w)\]\+/

export const CUTS_A_BUNDLE = 'matches a minifier\'s names, which is cutting a host\'s bundle'
export const READS_AN_ANSWER = 'reads a field of the host\'s own answer'

export interface AHostRead {
  /** Path relative to src/. */
  readonly path: string
  readonly line: number
  readonly why: string
  readonly text: string
}

/** What the check is told about the tree: which directories are not slices, and what the host's answers carry. */
export interface WhatIsNotASlice {
  /** The host glue and host adapters, as directories directly under src/. */
  readonly host_directories: readonly string[]
  readonly test_suffixes: readonly string[]
  /** The programs the scripts run and their declared parts, as directories directly under src/. */
  readonly programs: readonly string[]
  readonly answer_fields: readonly string[]
}

const sliceOf = (path: string): string => path.split(sep)[0] ?? ''

/** Whether `source` is a core slice's own code, which this check judges. */
const isJudged = (source: CoreSource, not: WhatIsNotASlice): boolean =>
  !not.host_directories.includes(sliceOf(source.path)) &&
  !not.programs.includes(sliceOf(source.path)) &&
  !isTestFile(not.test_suffixes, source.path) &&
  !isACoincidenceFile(source.path)

/** The text a pattern could be written in: a regular expression's own source, or a string's or template's text. */
function patternTextOf(node: ts.Node): string | undefined {
  if (ts.isRegularExpressionLiteral(node)) return node.text
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text
  return undefined
}

/** The name a node spells, when it is a property, a binding, a type member or a string. */
function spelledNameOf(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

/** Every host read in one source, each at its line. */
function hostReadsIn(source: CoreSource, answer_fields: readonly string[]): AHostRead[] {
  const { file } = parseSource(source.text, source.path)
  return nodesOf(file).flatMap((node): AHostRead[] => {
    const pattern = patternTextOf(node)
    if (pattern !== undefined && A_MINIFIERS_NAME.test(pattern)) {
      return [{ path: source.path, line: lineOf(file, node), why: CUTS_A_BUNDLE, text: pattern }]
    }
    const name = spelledNameOf(node)
    if (name !== undefined && answer_fields.includes(name)) {
      return [{ path: source.path, line: lineOf(file, node), why: READS_AN_ANSWER, text: name }]
    }
    return []
  })
}

/** Every host read in a core slice, among `sources` (relative to src/), with the line that holds it. */
export function hostReadsInTheCore(sources: readonly CoreSource[], not: WhatIsNotASlice): AHostRead[] {
  return sources.filter((source) => isJudged(source, not)).flatMap((source) => hostReadsIn(source, not.answer_fields))
}

/** One finding as a line: where, what it spells and why that is the host's. */
export const lineOfAHostRead = (read: AHostRead): string => `${read.path}:${read.line}: ${JSON.stringify(read.text)} ${read.why}`
