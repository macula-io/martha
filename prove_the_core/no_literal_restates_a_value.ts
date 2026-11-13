// No literal spells out a value the tree already defines (martha#289).
//
// The rule this holds: a string literal that equals the value of an exported
// string constant must import that constant instead of writing the value again.
// A renamed tool, switch, folder or env variable then cannot leave a stale copy
// behind that the tests agree with, which is how #251 took three build rounds.
//
// What counts as an exported constant: a top-level `export const NAME = '<text>'`,
// its initializer a string literal or a substitution-free template, directly or
// through `as const`, `satisfies` or parentheses. A computed initializer is not a
// value a literal could restate.
//
// What counts as a restatement, read from the syntax tree so a comment, a string
// or a line break cannot hide or fake one:
//
//   - a literal whose text equals a constant's value, anywhere in a module,
//     the module that defines it included;
//   - a *definition* whose value equals an exported constant of ANOTHER module,
//     exported or not: three private `const X = 'node_modules'` beside
//     `DEPENDENCIES` are three restatements, and `const T = 'Bash'` is the same
//     bypass (martha#289, Uranus's R2);
//   - a literal equal to a value the range DEFINES or REVALUES, judged over the
//     whole tree and not only on its own lines (R1): an added constant makes
//     every old copy of its value stale at once, and a revalued one leaves every
//     literal still holding the old value behind.
//
// Kept out, so a word used as data does not trip it:
//
//   - a module specifier, which is a path and not a value;
//   - a declared name — an object key, a member name, an enum member, a binding's
//     property name — which names a property rather than carrying the value;
//   - the initializer of the constant's own definition in its own module;
//   - a value shorter than SHORTEST_VALUE, which is a word before it is a value;
//   - a (value, file) the tree declares as a coincidence, with its reason. An
//     exception that matches nothing, carries no reason, or repeats another is
//     itself an error: the list can only shrink by an edit a reviewer reads.
//
// Out of reach, and left to review: a value built at run time (`'Ba' + 'sh'`, a
// template with a substitution, a value read from a fixture), and a literal that
// CONTAINS a value without equalling it — the seven `mcp__<server>__<tool>` names
// in the relay's hooks contain `CREW_SERVER` and never equal it (martha#289).

import ts from 'typescript'

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { lineOf, nodesOf, parseSource } from './parse_a_source.ts'

/** The shortest value this check reads: `env` and `id` are words before they are values. */
export const SHORTEST_VALUE = 4

/** A place that must name a value by literal, and why the word there means something else. */
export interface Exception {
  readonly value: string
  /** Relative to `src/`. */
  readonly file: string
  readonly reason: string
}

/** A value the change itself defines or revalues, with the constant it belongs to (R1). */
export interface DefinedByTheChange {
  readonly value: string
  /** Relative to `src/`. */
  readonly module: string
  readonly name: string
}

/** How a finding came about, and what to say about it. */
export type Rule = 'restates_a_constant' | 'defines_an_exported_value' | 'restates_a_value_the_change_defines'

export interface Finding {
  /** Relative to `src/`. */
  readonly path: string
  readonly line: number
  readonly literal: string
  /** The constant the literal should have imported. */
  readonly module: string
  readonly name: string
  readonly rule: Rule
}

/** What to judge: the lines a change adds, and the values it defines or revalues. */
export interface Judge {
  /** `${path}:${line}` for the lines the change adds; null judges the whole tree. */
  readonly judged: ReadonlySet<string> | null
  readonly defined?: readonly DefinedByTheChange[]
  readonly exceptions?: readonly Exception[]
}

interface Definition {
  readonly path: string
  readonly name: string
  readonly value: string
  readonly exported: boolean
  readonly node: ts.VariableDeclaration
}

interface Read {
  readonly path: string
  readonly file: ts.SourceFile
}

const parseAll = (sources: readonly CoreSource[]): Read[] =>
  sources.map((source) => ({ path: source.path, file: parseSource(source.text, source.path).file }))

const textOf = (node: ts.Node | undefined): string | null => {
  if (node === undefined) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return textOf(node.expression)
  return null
}

const isExported = (statement: ts.VariableStatement): boolean =>
  (ts.getCombinedModifierFlags(statement.declarationList.declarations[0]!) & ts.ModifierFlags.Export) !== 0

/** Every constant a source defines with a literal value, in the order it declares them. */
function definitionsIn({ path, file }: Read): Definition[] {
  return file.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) return []
    const exported = isExported(statement)
    return statement.declarationList.declarations.flatMap((declaration) => {
      const value = textOf(declaration.initializer)
      if (value === null || !ts.isIdentifier(declaration.name)) return []
      return [{ path, name: declaration.name.text, value, exported, node: declaration }]
    })
  })
}

/** Whether a literal names a module, which is a path and not a value. */
const namesAModule = (node: ts.Node): boolean => {
  const parent = node.parent
  return (
    (ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    ts.isImportTypeNode(parent) ||
    ts.isJSDocImportTag(parent)
  )
}

/** The declarations whose `name` is a property's name rather than a value. */
const DECLARATIONS_WITH_A_NAME: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.EnumMember,
])

/** Whether a literal names a property rather than carrying a value. */
const namesAProperty = (node: ts.Node): boolean => {
  const parent = node.parent
  if (ts.isBindingElement(parent)) return parent.propertyName === node
  return DECLARATIONS_WITH_A_NAME.has(parent.kind) && (parent as ts.NamedDeclaration).name === node
}

const isALiteral = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

/** A constant as a source declares it, with the line its value is written on. */
export interface ConstantInSource {
  readonly name: string
  readonly value: string
  readonly exported: boolean
  readonly line: number
}

/**
 * The constants one source declares with a literal value, by name and line. The
 * range reader uses it on both ends of a change, so the constants a change adds
 * or revalues are found the way the rule finds every other definition.
 */
export function constantsIn(text: string, path: string): ConstantInSource[] {
  const { file } = parseSource(text, path)
  return definitionsIn({ path, file }).map(({ name, value, exported, node }) => ({ name, value, exported, line: lineOf(file, node.initializer ?? node) }))
}

/** The literals a definition's initializer holds, so `'x' as const` is its definition as `'x'` is. */
function literalsUnder(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = []
  const visit = (at: ts.Node): void => {
    if (isALiteral(at)) found.push(at)
    ts.forEachChild(at, visit)
  }
  visit(node)
  return found
}

const at = (path: string, line: number): string => `${path}:${line}`

const byPlace = (a: Finding, b: Finding): number => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1)

/** The constants holding `value`, another module's first, in a stable order. */
const holdersOf = (value: string, definitions: readonly Definition[], module: string): Definition[] =>
  definitions
    .filter((definition) => definition.exported && definition.value === value)
    .sort((a, b) => Number(a.path === module) - Number(b.path === module) || a.path.localeCompare(b.path) || a.name.localeCompare(b.name))

/** One finding, as the rule reports it. */
const findingAt = (path: string, line: number, literal: string, constant: { readonly module: string; readonly name: string }, rule: Rule): Finding => ({
  path,
  line,
  literal,
  module: constant.module,
  name: constant.name,
  rule,
})

/**
 * What a literal that DEFINES a constant is: a copy of another module's value
 * (R2), or the definition itself — and the constant the change itself defines is
 * the one definition that is not a copy.
 */
function findingsForADefinition(definition: Definition, line: number, declared: readonly DefinedByTheChange[], definitions: readonly Definition[]): Finding[] {
  const isItsOwnDefinition = declared.some((entry) => entry.value === definition.value && entry.module === definition.path && entry.name === definition.name)
  if (isItsOwnDefinition) return []
  const fromTheChange = declared.find((entry) => entry.value === definition.value)
  if (fromTheChange !== undefined) return [findingAt(definition.path, line, definition.value, fromTheChange, 'restates_a_value_the_change_defines')]
  const holder = definitions.find((each) => each.exported && each.value === definition.value && each.path !== definition.path)
  return holder === undefined ? [] : [findingAt(definition.path, line, definition.value, { module: holder.path, name: holder.name }, 'defines_an_exported_value')]
}

/** What a literal that USES a value is: a copy of the constant holding it, or of the value the change defines. */
function findingsForAUse(path: string, line: number, literal: string, declared: readonly DefinedByTheChange[], definitions: readonly Definition[]): Finding[] {
  const fromTheChange = declared.find((entry) => entry.value === literal)
  if (fromTheChange !== undefined) return [findingAt(path, line, literal, fromTheChange, 'restates_a_value_the_change_defines')]
  const holder = holdersOf(literal, definitions, path)[0]
  return holder === undefined ? [] : [findingAt(path, line, literal, { module: holder.path, name: holder.name }, 'restates_a_constant')]
}

/** The literals of a source that can carry a value: not a module's path, not a property's name. */
const literalsThatCarryAValue = (file: ts.SourceFile): ts.Node[] =>
  nodesOf(file).filter(isALiteral).filter((node) => !namesAModule(node) && !namesAProperty(node))

/** What one literal is, if it restates something. */
function findingsAt(node: ts.Node, line: number, path: string, declared: readonly DefinedByTheChange[], definitions: readonly Definition[], definitionAt: ReadonlyMap<ts.Node, Definition>): Finding[] {
  const literal = (node as ts.StringLiteral).text
  if (literal.length < SHORTEST_VALUE) return []
  const definition = definitionAt.get(node)
  return definition === undefined
    ? findingsForAUse(path, line, literal, declared, definitions)
    : findingsForADefinition(definition, line, declared, definitions)
}

/**
 * The restatements to name, among `sources`, on the lines `judge.judged` names
 * (every line when it is null) and over the whole tree for a value the change
 * defines or revalues. Paths are relative to `src/`.
 */
export function restatementsIn(sources: readonly CoreSource[], judge: Judge): Finding[] {
  const reads = parseAll(sources)
  const definitions = reads.flatMap(definitionsIn)
  const declared = judge.defined ?? []
  const exceptions = judge.exceptions ?? []
  const judged = judge.judged
  const definitionAt = new Map(definitions.flatMap((definition) => literalsUnder(definition.node).map((literal) => [literal, definition] as const)))
  const isDeclaredACoincidence = (finding: Finding): boolean =>
    exceptions.some((exception) => exception.value === finding.literal && exception.file === finding.path)
  const isJudged = (finding: Finding): boolean =>
    judged === null || judged.has(at(finding.path, finding.line)) || declared.some((entry) => entry.value === finding.literal)
  return reads
    .flatMap(({ path, file }) => literalsThatCarryAValue(file).flatMap((node) => findingsAt(node, lineOf(file, node), path, declared, definitions, definitionAt)))
    .filter((finding) => !isDeclaredACoincidence(finding) && isJudged(finding))
    .sort(byPlace)
}

/** The literal sites a set of judged lines holds, read from the sources: what the gate may say it looked at. */
export function literalSitesJudged(sources: readonly CoreSource[], judged: ReadonlySet<string> | null): number {
  return parseAll(sources).flatMap(({ path, file }) =>
    nodesOf(file).filter(isALiteral).filter((node) => judged === null || judged.has(at(path, lineOf(file, node)))),
  ).length
}

/** The exceptions that match nothing in this tree, carry no reason, repeat another, or name a folder a file is not. */
export function exceptionsNotHeld(sources: readonly CoreSource[], exceptions: readonly Exception[]): Exception[] {
  const reads = parseAll(sources)
  const valuesIn = new Map(reads.map(({ path, file }) => [path, new Set(nodesOf(file).filter(isALiteral).filter((node) => !namesAModule(node)).map((node) => (node as ts.StringLiteral).text))]))
  const repeated = (exception: Exception, index: number): boolean =>
    exceptions.findIndex((each) => each.value === exception.value && each.file === exception.file) !== index
  return exceptions.filter((exception, index) =>
    exception.reason.trim() === '' || repeated(exception, index) || valuesIn.get(exception.file)?.has(exception.value) !== true)
}

/** Each finding as the one line CI prints. */
export const lineOfAFinding = (finding: Finding): string =>
  `${finding.path}:${finding.line}: '${finding.literal}' restates ${finding.module} ${finding.name}`
