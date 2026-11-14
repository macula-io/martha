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
// A record counts too, only when its definition is marked `satisfies DefinesItsValues`
// (src/host_contract/defines_its_values.ts): each of its string
// keys is a value named `RECORD.key (key)`, and each string value one named
// `RECORD.key`. A marked record the check cannot read entry by entry, or a marker
// anywhere but on such a record, is an error naming it (markersNotHeld).
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
//   - a literal equal to a value the range DEFINES, REVALUES or REMOVES, judged
//     over the whole tree and not only on its own lines (R1): an added constant
//     makes every old copy of its value stale at once, and a revalued, renamed or
//     removed one leaves every literal still holding the old value behind.
//
// A finding names the constant to import: another module's before the literal's
// own, a constant before a record's entry, then by module and name. When no
// constant holds the value any more, the change took it away, and the finding says
// so and what to do.
//
// Kept out, so a word used as data does not trip it:
//
//   - a module specifier, which is a path and not a value;
//   - a declared name — an object key, a member name, an enum member, a binding's
//     property name — which names a property rather than carrying the value, and a
//     property named where it is used, `'k' in x` and `x['k']`, since `x.k` is
//     never judged either (part b, rule 2);
//   - a literal in a type, `type T = 'a' | 'b'` or `kind: 'tree'`, which the
//     compiler holds and which names a type, not a value (part b, rule 1);
//   - a constant annotated with a named type, `IDLE: State = 'idle'`: it is an
//     alias of a member that type defines, so it holds no value for a literal to
//     restate, and a change that adds, keeps or drops one defines nothing. Turning
//     a holder into an alias still takes its value away (R1), so the annotation
//     is no way to silence its copies (part b, rule 3);
//   - the initializer of the constant's own definition in its own module;
//   - a value shorter than SHORTEST_VALUE, which is a word before it is a value;
//   - a (value, file) the tree declares as a coincidence, with its reason. An
//     exception that excuses no finding, carries no reason, or repeats another is
//     itself an error: the list can only shrink by an edit a reviewer reads.
//
// Out of reach, and left to review: a value built at run time (`'Ba' + 'sh'`, a
// template with a substitution, a value read from a fixture), and a literal that
// CONTAINS a value without equalling it — the sixteen `mcp__<server>__<tool>` names
// in the relay's hooks contain the plugin's name from its manifest, and never equal
// it (martha#289; the manifest, not a constant, since #343).

import ts from 'typescript'

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { isInAType, lineOf, nodesOf, parseSource } from './parse_a_source.ts'

/** The shortest value this check reads: `env` and `id` are words before they are values. */
export const SHORTEST_VALUE = 4

/** The type a record's definition is marked with when its keys and values are shared values. */
export const THE_MARKER = 'DefinesItsValues'

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
  /** True when no constant holds the value any more: the change took it away. */
  readonly gone: boolean
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
  /** The node whose literals are this definition: a constant's declaration, or an entry's key or value. */
  readonly node: ts.Node
  /** The marked record this is an entry of; undefined for a constant. */
  readonly record?: string
  /** Annotated with a named type: an alias of a member that type defines, never a holder (rule 3 of part b). */
  readonly alias: boolean
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

/** The rightmost name of a type reference: `DefinesItsValues` in `M.DefinesItsValues` too. */
const nameOfAType = (name: ts.EntityName): string => (ts.isIdentifier(name) ? name.text : name.right.text)

const isTheMarker = (node: ts.Node | undefined): boolean =>
  node !== undefined && ts.isTypeReferenceNode(node) && nameOfAType(node.typeName) === THE_MARKER

/** `Object.freeze(x)`, whose one argument is the record. */
const isAFreeze = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && node.expression.getText() === 'Object.freeze' && node.arguments.length === 1

/** The object a marked initializer holds, through `Object.freeze`, `as const` and parentheses; null when it holds none. */
function recordUnder(node: ts.Expression): ts.ObjectLiteralExpression | null {
  if (ts.isObjectLiteralExpression(node)) return node
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return recordUnder(node.expression)
  if (ts.isSatisfiesExpression(node) && !isTheMarker(node.type)) return recordUnder(node.expression)
  return isAFreeze(node) ? recordUnder(node.arguments[0]!) : null
}

/** The record a declaration's initializer marks as defining its values; null when it marks none. */
const markedRecordOf = (declaration: ts.VariableDeclaration): ts.ObjectLiteralExpression | null => {
  const initializer = declaration.initializer
  if (initializer === undefined || !ts.isSatisfiesExpression(initializer) || !isTheMarker(initializer.type)) return null
  return recordUnder(initializer.expression)
}

/** The key of an entry the check can read: an identifier or a string, never computed. */
const keyOf = (entry: ts.PropertyAssignment): string | null =>
  ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name) ? entry.name.text : null

/** The values a marked record defines: each key, and each value. */
function entriesOf(path: string, record: string, object: ts.ObjectLiteralExpression): Definition[] {
  return object.properties.flatMap((entry) => {
    if (!ts.isPropertyAssignment(entry)) return []
    const key = keyOf(entry)
    if (key === null) return []
    const asKey: Definition = { path, name: `${record}.${key} (key)`, value: key, exported: true, node: entry.name, record, alias: false }
    const value = textOf(entry.initializer)
    return value === null ? [asKey] : [asKey, { path, name: `${record}.${key}`, value, exported: true, node: entry.initializer, record, alias: false }]
  })
}

/**
 * Whether a declaration is annotated with a named type: `IDLE: State = 'idle'` names
 * a member the type `State` defines, so a literal `'idle'` elsewhere means that
 * member and not this constant (rule 3 of part b).
 */
const isAnAlias = (declaration: ts.VariableDeclaration): boolean => declaration.type !== undefined && ts.isTypeReferenceNode(declaration.type)

/** What one declaration defines: its own value, or the entries of the record it marks. */
function definitionsOfADeclaration(path: string, declaration: ts.VariableDeclaration, exported: boolean): Definition[] {
  if (!ts.isIdentifier(declaration.name)) return []
  const value = textOf(declaration.initializer)
  if (value !== null) return [{ path, name: declaration.name.text, value, exported, node: declaration, alias: isAnAlias(declaration) }]
  const record = exported ? markedRecordOf(declaration) : null
  return record === null ? [] : entriesOf(path, declaration.name.text, record)
}

/** Every constant a source defines with a literal value, and every entry of a record it marks, in the order it declares them. */
function definitionsIn({ path, file }: Read): Definition[] {
  return file.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) return []
    const exported = isExported(statement)
    return statement.declarationList.declarations.flatMap((declaration) => definitionsOfADeclaration(path, declaration, exported))
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

/**
 * Whether a literal names a property rather than carrying a value: a declared
 * name, or a property named at the use site (rule 2 of part b) — the left side of
 * `in` and the argument of an element access, since `x.owner` is never judged and
 * `x['owner']` names the same property.
 */
const namesAProperty = (node: ts.Node): boolean => {
  const parent = node.parent
  if (ts.isBindingElement(parent)) return parent.propertyName === node
  if (ts.isElementAccessExpression(parent)) return parent.argumentExpression === node
  if (ts.isBinaryExpression(parent)) return parent.operatorToken.kind === ts.SyntaxKind.InKeyword && parent.left === node
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
  /** The marked record this is an entry of; undefined for a constant. */
  readonly record?: string
}

/**
 * The constants one source declares with a literal value, by name and line. The
 * range reader uses it on both ends of a change, so the constants a change adds
 * or revalues are found the way the rule finds every other definition.
 */
export function constantsIn(text: string, path: string): ConstantInSource[] {
  const { file } = parseSource(text, path)
  return definitionsIn({ path, file }).map(({ name, value, exported, node, record, alias }) => ({
    name,
    value,
    // An alias holds no value of its own, so a change that adds, keeps or drops one defines nothing (rule 3 of part b).
    exported: exported && !alias,
    line: lineOf(file, ts.isVariableDeclaration(node) ? node.initializer ?? node : node),
    ...(record === undefined ? {} : { record }),
  }))
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

/** The constants holding `value`: another module's first, a constant before a record's entry, then by module and name. */
const holdersOf = (value: string, definitions: readonly Definition[], module: string): Definition[] =>
  definitions
    .filter((definition) => definition.exported && !definition.alias && definition.value === value)
    .sort((a, b) =>
      Number(a.path === module) - Number(b.path === module) ||
      Number(a.record !== undefined) - Number(b.record !== undefined) ||
      a.path.localeCompare(b.path) ||
      a.name.localeCompare(b.name))

/** One finding, as the rule reports it. */
const findingAt = (path: string, line: number, literal: string, constant: { readonly module: string; readonly name: string }, rule: Rule, gone = false): Finding => ({
  path,
  line,
  literal,
  module: constant.module,
  name: constant.name,
  rule,
  gone,
})

/** The constant a finding names: the holder to import, or, when none holds the value any more, the one the change took away. */
const namedFor = (holder: Definition | undefined, fromTheChange: DefinedByTheChange): { readonly constant: { readonly module: string; readonly name: string }; readonly gone: boolean } =>
  holder === undefined ? { constant: fromTheChange, gone: true } : { constant: { module: holder.path, name: holder.name }, gone: false }

/**
 * What a literal that DEFINES a constant is: a copy of another module's value
 * (R2), a copy of a value the change defines (R1), or the definition itself. The
 * constant the change itself defines is not a copy of the value it defines, but
 * it is a copy of another module's holder that held the value before the change.
 *
 * Against a value the change defines, a definition is a copy wherever it sits,
 * its own module included, unless it is itself an exported holder of that value
 * in the same module: `EDIT_TOOL = 'Edit'` beside the record whose key it names
 * holds the value as the record does, while a private `const T = 'Edit'` there
 * is a copy of it.
 */
function findingsForADefinition(definition: Definition, line: number, declared: readonly DefinedByTheChange[], definitions: readonly Definition[]): Finding[] {
  const isDefinedByTheChange = (one: Definition): boolean => declared.some((entry) => entry.value === one.value && entry.module === one.path && entry.name === one.name)
  const holders = holdersOf(definition.value, definitions, definition.path)
  const heldBefore = holders.filter((each) => each.path !== definition.path && !isDefinedByTheChange(each))
  if (isDefinedByTheChange(definition)) return namedAgainst(definition, line, heldBefore[0])
  const isACopyAgainst = (module: string): boolean => module !== definition.path || !definition.exported
  const isAHolder = definition.exported && !definition.alias
  const holdsANewDefinition = (entry: DefinedByTheChange): boolean => holders.some((each) => each.path === entry.module && each.name === entry.name)
  const fromTheChange = declared.find((entry) => entry.value === definition.value && isACopyAgainst(entry.module) && !(isAHolder && holdsANewDefinition(entry)))
  if (fromTheChange !== undefined) {
    const { constant, gone } = namedFor(holders.find((each) => isACopyAgainst(each.path)), fromTheChange)
    return [findingAt(definition.path, line, definition.value, constant, 'restates_a_value_the_change_defines', gone)]
  }
  return namedAgainst(definition, line, heldBefore[0])
}

/**
 * A definition against the holder that held its value before the change. A new
 * exported definition of a value another module still holds is the copy, named
 * on its own line, so only an exception in its own file can excuse it; the old
 * holder is never named for it (martha#289 part b, stage 2).
 */
const namedAgainst = (definition: Definition, line: number, holder: Definition | undefined): Finding[] =>
  holder === undefined ? [] : [findingAt(definition.path, line, definition.value, { module: holder.path, name: holder.name }, 'defines_an_exported_value')]

/** What a literal that USES a value is: a copy of the constant holding it, or of the value the change defines. */
function findingsForAUse(path: string, line: number, literal: string, declared: readonly DefinedByTheChange[], definitions: readonly Definition[]): Finding[] {
  const holder = holdersOf(literal, definitions, path)[0]
  const fromTheChange = declared.find((entry) => entry.value === literal)
  if (fromTheChange !== undefined) {
    const { constant, gone } = namedFor(holder, fromTheChange)
    return [findingAt(path, line, literal, constant, 'restates_a_value_the_change_defines', gone)]
  }
  return holder === undefined ? [] : [findingAt(path, line, literal, { module: holder.path, name: holder.name }, 'restates_a_constant')]
}

/** The literals of a source that can carry a value: not a module's path, not a property's name, not a type (rule 1 of part b). */
const literalsThatCarryAValue = (file: ts.SourceFile): ts.Node[] =>
  nodesOf(file).filter(isALiteral).filter((node) => !namesAModule(node) && !namesAProperty(node) && !isInAType(node))

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

/**
 * The exceptions that excuse no finding in this tree, carry no reason, or repeat
 * another. An entry is held only while the rule, run over the whole tree without
 * the list, names its value in its file: a word the rule no longer judges there
 * (a type, a property name, an alias's member) needs no excuse.
 */
export function exceptionsNotHeld<Entry extends Exception>(sources: readonly CoreSource[], exceptions: readonly Entry[]): Entry[] {
  const excused = new Set(restatementsIn(sources, { judged: null }).map((finding) => `${finding.literal}\u0000${finding.path}`))
  const repeated = (exception: Exception, index: number): boolean =>
    exceptions.findIndex((each) => each.value === exception.value && each.file === exception.file) !== index
  return exceptions.filter((exception, index) =>
    exception.reason.trim() === '' || repeated(exception, index) || !excused.has(`${exception.value}\u0000${exception.file}`))
}

/** What a finding whose value the change took away tells its author to do. */
export const GONE = '(gone in this change: keep a constant that holds this value and import it here, or write this line without the value)'

/** Each finding as the one line CI prints. */
export const lineOfAFinding = (finding: Finding): string =>
  `${finding.path}:${finding.line}: '${finding.literal}' restates ${finding.module} ${finding.name}${finding.gone ? ` ${GONE}` : ''}`

/** A marker the check cannot hold to its claim: misplaced, renamed, or on a record it cannot read entry by entry. */
export interface MarkerNotHeld {
  /** Relative to `src/`. */
  readonly path: string
  readonly line: number
  /** The record the marker stands on, or the name it hides under. */
  readonly record: string
  readonly reason: string
}

/** What a marked record holds that the check cannot read; null when it reads every entry. */
function entryNotRead(entry: ts.ObjectLiteralElementLike): string | null {
  if (ts.isSpreadAssignment(entry)) return 'a spread'
  if (ts.isShorthandPropertyAssignment(entry)) return 'a shorthand entry'
  if (!ts.isPropertyAssignment(entry)) return 'a method or accessor'
  if (keyOf(entry) === null) return 'a computed or non-string key'
  return textOf(entry.initializer) === null ? `a value that is not a string at '${keyOf(entry)}'` : null
}

/** The declaration a marker stands on, when it stands where a marker may: the outermost wrapper of a top-level exported const. */
function declarationMarkedBy(reference: ts.TypeReferenceNode): ts.VariableDeclaration | null {
  const satisfies = reference.parent
  if (!ts.isSatisfiesExpression(satisfies) || satisfies.type !== reference) return null
  const declaration = satisfies.parent
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== satisfies || !ts.isIdentifier(declaration.name)) return null
  const statement = declaration.parent.parent
  return ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent) && isExported(statement) ? declaration : null
}

/** Why one use of the marker's type is not held, or null when it marks a record the check reads whole. */
function whyAMarkerIsNotHeld(reference: ts.TypeReferenceNode): { readonly record: string; readonly reason: string } | null {
  const alias = reference.parent
  if (ts.isTypeAliasDeclaration(alias) && alias.type === reference) return { record: alias.name.text, reason: `aliases ${THE_MARKER}, which must be written by its own name` }
  const declaration = declarationMarkedBy(reference)
  if (declaration === null) return { record: THE_MARKER, reason: 'stands where no record is marked: it must be the outermost `satisfies` of a top-level exported const' }
  const record = (declaration.name as ts.Identifier).text
  const object = markedRecordOf(declaration)
  if (object === null) return { record, reason: 'marks a value that is not an object literal' }
  const unread = object.properties.map(entryNotRead).find((reason) => reason !== null)
  return unread === undefined || unread === null ? null : { record, reason: `holds ${unread}, which the check cannot read` }
}

/** An import or export that gives the marker a second name, by which it would escape the check. */
const isARenamedMarker = (node: ts.Node): node is ts.ImportSpecifier | ts.ExportSpecifier =>
  (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) &&
  node.propertyName !== undefined &&
  node.propertyName.text === THE_MARKER &&
  node.name.text !== THE_MARKER

/**
 * Every marker the check cannot hold to its claim, by place: one inside a call or
 * anywhere but on a top-level exported const, one on a value that is not an
 * object literal, one on a record holding an entry the check cannot read, and one
 * imported, exported or aliased under a second name.
 */
export function markersNotHeld(sources: readonly CoreSource[]): MarkerNotHeld[] {
  return parseAll(sources).flatMap(({ path, file }) =>
    nodesOf(file).flatMap((node): MarkerNotHeld[] => {
      if (isARenamedMarker(node)) return [{ path, line: lineOf(file, node), record: node.name.text, reason: `renames ${THE_MARKER}, which must be written by its own name` }]
      if (!isTheMarker(node)) return []
      const why = whyAMarkerIsNotHeld(node as ts.TypeReferenceNode)
      return why === null ? [] : [{ path, line: lineOf(file, node), ...why }]
    }))
}

/** Each marker not held as the one line CI prints. */
export const lineOfAMarkerNotHeld = (marker: MarkerNotHeld): string =>
  `${marker.path}:${marker.line}: ${marker.record} is marked ${THE_MARKER} but ${marker.reason}`
