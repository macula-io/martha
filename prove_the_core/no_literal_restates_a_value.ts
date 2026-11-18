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
//   - a literal holding a constant's value as a whole path segment, split on
//     `/` only: `join(checkout, '.git/config')` restates CONFIG as surely as
//     `'config'` would, and `join(checkout, '.git', CONFIG)` is what the rule asks
//     for (martha#437). A word inside prose is never split out, so prose stays a
//     word, and a literal that is exactly the path of a source the check reads
//     names that file as a module specifier does, so its segments are never
//     judged: `file: 'wake_a_member/wake_a_member.ts'` in a slice's coincidences
//     is the slice's directory, not the WAKE_A_MEMBER tool. A literal holding
//     an address is judged whole too, never split (the owner's ruling on
//     martha#437, r=3): a URL, anything with `://`, a GitHub owner/repo name
//     whose owner has a hyphen, as the whole literal or one word of it, or a
//     GitHub API route — `macula-io/martha`, `-R macula-io/martha`,
//     `macula-io/martha#253`, `repos/macula-io/martha/actions/runs`. A route is
//     an address whatever stands before it and whether its owner has a hyphen or
//     is built by a substitution (`/repos/macula-io/martha/issues`,
//     `repos/rgfaber/wordcraft/actions/runs`, `repos/${repo}/commits`). A
//     hyphen-free `owner/repo` outside a route is spelled like a relative path
//     (`actions/runs`, `torvalds/linux`) and stays split, so a copy inside it is
//     still named;
//   - the literal text of a template with a substitution, judged piece by piece
//     and never as a whole, since what it builds at run time is unknown
//     (martha#437): each substitution stands as one mark, the text splits on the
//     same `/`, and a piece holding a mark is the run time's rather than the
//     tree's, so it is never judged. `${dir}/settings.json` names
//     `settings.json`; `${dir}settings.json` and `${dir}/settings.${flavour}`
//     name nothing. A dynamic `import()`'s specifier and a tag's template are
//     left out, as a module's path is;
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
// template piece a substitution stands inside, a value read from a fixture), and
// a literal that CONTAINS a value other than as a whole path segment — the
// sixteen `mcp__<server>__<tool>` names in the relay's hooks contain the plugin's
// name from its manifest, and never equal it (martha#289; the manifest, not a
// constant, since #343) — or a value that itself spans more than one segment.

import ts from 'typescript'

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { isInAType, lineOf, nodesOf, parseSource } from './parse_a_source.ts'

/** The shortest value this check reads: `env` and `id` are words before they are values. */
export const SHORTEST_VALUE = 4

/**
 * The smallest number this check reads where a declaration holds one (martha#441). The floor is on size, not on kind:
 * below it the tree's numbers are the small ones it writes everywhere — `20`, `64`, `100` and a sub-second poll among
 * them — where a copy cannot be told from a coincidence. At and above it sit the numbers the tree defines, whatever
 * kind they are: a minute, a deadline, a ceiling, the longest text a message may carry, the modulus a petname's
 * four-digit group turns over at.
 */
export const SHORTEST_NUMBER = 10_000

/**
 * Whether a number a declaration holds is one the tree may define (martha#441): a number at or above the floor, never
 * one below it. Without the floor every `0` and `2` in the tree would be a copy of some constant holding it.
 */
const isANumberTheTreeMayDefine = (value: number): boolean => Math.abs(value) >= SHORTEST_NUMBER

/** The type a record's definition is marked with when its keys and values are shared values. */
export const THE_MARKER = 'DefinesItsValues'

/** A place that must name a value by literal, and why the word there means something else. */
export interface Exception {
  /**
   * A value the tree defines, written as the constant that holds it, so the type here is that constant's: a sentence's
   * value is a string, a number's is a number (martha#441). The check compares values, so it holds a number as the
   * digits that constant defines, never as the number its caller happened to write.
   */
  readonly value: string | number
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
  /** True when the literal holds the value as one path segment rather than equalling it (martha#437). */
  readonly segment: boolean
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

/**
 * A number as a value, kept apart from a string that spells the same text: the
 * check compares values, so `60_000` and `60000` are one value while `'60000'` is
 * another (martha#441). Its digits are the number's own value, not its spelling.
 */
const NUMBER = 'number:'

/** The number an initializer holds, through `as const`, `satisfies` and parentheses; null when it holds none. */
const numberOf = (node: ts.Node | undefined): string | null => {
  if (node === undefined) return null
  if (ts.isNumericLiteral(node)) return `${NUMBER}${Number(node.text.replaceAll('_', ''))}`
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return numberOf(node.expression)
  return null
}

/** The value an initializer holds: a string's text, or a number's value (martha#441). */
const valueText = (node: ts.Node | undefined): string | null => textOf(node) ?? numberOf(node)

/** The value a number carries, for the rule that says which numbers the tree defines. */
const asANumber = (value: string): number => Number(value.slice(NUMBER.length))

/** Whether a value is a number's rather than a string's. */
const isANumber = (value: string): boolean => value.startsWith(NUMBER)

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
  const value = valueText(declaration.initializer)
  if (value !== null) {
    // A number is a value here only where the tree defines a magnitude (martha#441).
    if (isANumber(value) && !isANumberTheTreeMayDefine(asANumber(value))) return []
    return [{ path, name: declaration.name.text, value, exported, node: declaration, alias: isAnAlias(declaration) }]
  }
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

/** A literal that carries a value: a string's text, or a number's own value (martha#441). */
const isAValueLiteral = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.NumericLiteral =>
  isALiteral(node) || ts.isNumericLiteral(node)

/** The expression a call applies, where a dynamic `import()` names a module rather than a value (martha#437). */
const isADynamicImport = (node: ts.Node): boolean => ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword

/**
 * Whether a template with a substitution is one this check reads: not a dynamic
 * `import()`'s specifier, and not a tag's template, both of which name a module
 * or a format rather than carrying a value (martha#437).
 */
const isAJudgedTemplate = (node: ts.Node): node is ts.TemplateExpression =>
  ts.isTemplateExpression(node) &&
  !isADynamicImport(node.parent) &&
  !(ts.isTaggedTemplateExpression(node.parent) && node.parent.template === node)

/** Any node this check reads: a value literal, or a template with a substitution. */
const isRead = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.NumericLiteral | ts.TemplateExpression =>
  isAValueLiteral(node) || isAJudgedTemplate(node)

/** The value a value literal carries, as the definitions hold it. */
const valueOfALiteral = (node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.NumericLiteral): string =>
  ts.isNumericLiteral(node) ? `${NUMBER}${Number(node.text.replaceAll('_', ''))}` : node.text

/** A value as a message writes it: a number's digits, a string's text. */
const asTheMessageShowsIt = (value: string): string => (isANumber(value) ? value.slice(NUMBER.length) : value)

/**
 * A declared coincidence's value as the check holds it (martha#441): the reader hands a string it resolved, while a
 * caller that names a number's constant hands that number, so a number becomes the value its digits are. Every entry
 * the rule reads passes through here first, and a number that skipped it would match no finding.
 */
const theValueTheCheckHolds = (value: string | number): string => (typeof value === 'number' ? `${NUMBER}${value}` : value)

/** The entries with their values as the check holds them, in the order they were declared. */
const asTheCheckHoldsThem = (exceptions: readonly Exception[]): readonly Exception[] =>
  exceptions.map((exception) => ({ ...exception, value: theValueTheCheckHolds(exception.value) }))

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
    if (isAValueLiteral(at)) found.push(at)
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
  segment: false,
})

/** The constant a finding names: the holder to import, or, when none holds the value any more, the one the change took away. */
const namedFor = (holder: Definition | undefined, fromTheChange: DefinedByTheChange): { readonly constant: { readonly module: string; readonly name: string }; readonly gone: boolean } =>
  holder === undefined ? { constant: fromTheChange, gone: true } : { constant: { module: holder.path, name: holder.name }, gone: false }

/**
 * What a literal that DEFINES a constant is: a copy of another module's value
 * (R2), a copy of a value the change defines (R1), or the definition itself. The
 * constant the change itself defines is not a copy of the value it defines, but
 * it is a copy of another module's holder that held the value before the change,
 * or, when none did, of another module's holder the same change adds: two new
 * modules holding one new value are each named against the other.
 *
 * Against a value the change defines, a definition is a copy wherever it sits,
 * its own module included, unless it is itself an exported holder of that value
 * in the same module: `EDIT_TOOL = 'Edit'` beside the record whose key it names
 * holds the value as the record does, while a private `const T = 'Edit'` there
 * is a copy of it.
 */
function findingsForADefinition(definition: Definition, line: number, declared: readonly DefinedByTheChange[], definitions: readonly Definition[], everyDefinition: readonly Definition[]): Finding[] {
  const isDefinedByTheChange = (one: Definition): boolean => declared.some((entry) => entry.value === one.value && entry.module === one.path && entry.name === one.name)
  const holders = holdersOf(definition.value, definitions, definition.path)
  const heldBefore = holders.filter((each) => each.path !== definition.path && !isDefinedByTheChange(each))
  // A definition is compared against every holder, a coincidence declared or not (martha#441): a place's own exception
  // says what the word means there, not that another module's copy of the value is not a copy. It is only kept out of
  // the constants a USE is told to import.
  const everyHolder = holdersOf(definition.value, everyDefinition, definition.path)
  if (isDefinedByTheChange(definition)) return namedAgainst(definition, line, heldBefore[0] ?? holders.find((each) => each.path !== definition.path) ?? everyHolder.find((each) => each.path !== definition.path))
  const isACopyAgainst = (module: string): boolean => module !== definition.path || !definition.exported
  const isAHolder = definition.exported && !definition.alias
  const holdsANewDefinition = (entry: DefinedByTheChange): boolean => everyHolder.some((each) => each.path === entry.module && each.name === entry.name)
  const fromTheChange = declared.find((entry) => entry.value === definition.value && isACopyAgainst(entry.module) && !(isAHolder && holdsANewDefinition(entry)))
  if (fromTheChange !== undefined) {
    const { constant, gone } = namedFor(holders.find((each) => isACopyAgainst(each.path)) ?? everyHolder.find((each) => isACopyAgainst(each.path)), fromTheChange)
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

/** What splits a literal into the segments of a path: only `/`, so a word in prose is never split out (martha#437). */
export const PATH_SEPARATOR = '/'

/**
 * The distinct segments of a literal written as a path, each long enough to be a
 * value, never the literal itself: `'.git/config'` holds `config`, and a literal
 * with no separator holds none (martha#437).
 */
export const pathSegmentsOf = (literal: string): string[] =>
  [...new Set(literal.split(PATH_SEPARATOR))].filter((segment) => segment !== literal && segment.length >= SHORTEST_VALUE)

/** What a URL holds, wherever it stands in a literal. */
const URL_MARK = '://'

/** A GitHub owner with a hyphen, then a repository: what tells a slug from a relative path such as `actions/runs`. */
const SLUG = '[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/[A-Za-z0-9._-]+'

/** An owner/repo name as a word of its own, whose owner has a hyphen: `macula-io/martha`, `-R macula-io/martha`, `macula-io/martha#253`. */
const OWNER_REPO = new RegExp(`(?:^|\\s)${SLUG}(?=$|\\s|#)`)

/**
 * Where a substitution stands in a template's text, so a piece the run time builds
 * is never judged as a value the tree holds (martha#437).
 */
export const SUBSTITUTION_MARK = '\u0000'

/** One name in a GitHub API route: a word of name characters, or the mark of a substitution where an owner is built at run time. */
const ROUTE_WORD = '(?:[A-Za-z0-9._-]|\\u0000)'

/**
 * A GitHub API route: `repos/` and the owner that follows it, whatever stands
 * before it (start, a space, a leading `/`), whether the owner has a hyphen or is
 * a substitution's mark. It takes a repository after the owner, so a directory
 * that happens to be named `repos` is still a path (martha#437, Jupiter's note on
 * PR 469).
 */
const REPOS_ROUTE = new RegExp(`(?:^|[\\s/])repos/(?:\\u0000|[A-Za-z0-9._-]+/${ROUTE_WORD})`)

/**
 * Whether a literal holds an address, which is judged whole and never split: a
 * URL, a GitHub owner/repo name whose owner has a hyphen as a word of its own
 * (the owner's ruling on martha#437, r=3), or a GitHub API route — `repos/…` —
 * whose owner may have no hyphen and may be built at run time (Jupiter's note on
 * PR 469). A bare hyphen-free `owner/repo` is spelled like a relative path and is
 * not one.
 */
export const holdsAnAddress = (literal: string): boolean => literal.includes(URL_MARK) || OWNER_REPO.test(literal) || REPOS_ROUTE.test(literal)

/** The text a template holds, each substitution standing as one mark, so what it builds at run time is visible as built (martha#437). */
export const textOfATemplate = (node: ts.TemplateExpression): string =>
  node.templateSpans.reduce((text, span) => `${text}${SUBSTITUTION_MARK}${span.literal.text}`, node.head.text)

/** The distinct segments of a path literal that name a value on their own: never the literal itself, and never one a substitution stands in (martha#437). */
export const piecesOfALiteral = (literal: string): string[] => pathSegmentsOf(literal).filter((piece) => !piece.includes(SUBSTITUTION_MARK))

/** A value written as one segment of a path literal: a use of it, as the bare value would be (martha#437). */
const findingsForTheSegments = (path: string, line: number, segments: readonly string[], files: ReadonlySet<string>, declared: readonly DefinedByTheChange[], definitions: readonly Definition[]): Finding[] =>
  segments
    .filter((segment) => !files.has(segment))
    .flatMap((segment) => findingsForAUse(path, line, segment, declared, definitions).map((finding) => ({ ...finding, segment: true })))

/** The literals of a source that can carry a value: not a module's path, not a property's name, not a type (rule 1 of part b). */
const literalsThatCarryAValue = (file: ts.SourceFile): ts.Node[] =>
  nodesOf(file).filter(isRead).filter((node) => !namesAModule(node) && !namesAProperty(node) && !isInAType(node))

/** What one literal is, if it restates something; `files` are the paths of the sources read, whose segments name directories, not values. */
function findingsAt(node: ts.Node, line: number, path: string, declared: readonly DefinedByTheChange[], definitions: readonly Definition[], everyDefinition: readonly Definition[], definitionAt: ReadonlyMap<ts.Node, Definition>, files: ReadonlySet<string>): Finding[] {
  if (ts.isTemplateExpression(node)) {
    const text = textOfATemplate(node)
    return holdsAnAddress(text) ? [] : findingsForTheSegments(path, line, piecesOfALiteral(text), files, declared, definitions)
  }
  const literal = valueOfALiteral(node as ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.NumericLiteral)
  if (!isANumber(literal) && literal.length < SHORTEST_VALUE) return []
  const definition = definitionAt.get(node)
  const whole = definition === undefined
    ? findingsForAUse(path, line, literal, declared, definitions)
    : findingsForADefinition(definition, line, declared, definitions, everyDefinition)
  return files.has(literal) || holdsAnAddress(literal) ? whole : [...whole, ...findingsForTheSegments(path, line, pathSegmentsOf(literal), files, declared, definitions)]
}

/**
 * The restatements to name, among `sources`, on the lines `judge.judged` names
 * (every line when it is null) and over the whole tree for a value the change
 * defines or revalues. Paths are relative to `src/`.
 */
export function restatementsIn(sources: readonly CoreSource[], judge: Judge): Finding[] {
  const reads = parseAll(sources)
  const declared = judge.defined ?? []
  const exceptions = asTheCheckHoldsThem(judge.exceptions ?? [])
  const everyDefinition = reads.flatMap(definitionsIn)
  // A place the tree declares a coincidence holds its value for no USE to import (martha#441). The relay's beat cannot
  // import the core's minute, so the minute stays the one every other copy is told to name. A definition is still read
  // as one, and every holder still answers a definition's comparison: what a place means does not change what holds the
  // value, only what a copy elsewhere should import.
  const definitions = everyDefinition.filter((definition) => !exceptions.some((exception) => exception.value === definition.value && exception.file === definition.path))
  const judged = judge.judged
  const files = new Set(reads.map((read) => read.path))
  const definitionAt = new Map(everyDefinition.flatMap((definition) => literalsUnder(definition.node).map((literal) => [literal, definition] as const)))
  const isDeclaredACoincidence = (finding: Finding): boolean =>
    exceptions.some((exception) => exception.value === finding.literal && exception.file === finding.path)
  const isJudged = (finding: Finding): boolean =>
    judged === null || judged.has(at(finding.path, finding.line)) || declared.some((entry) => entry.value === finding.literal)
  return reads
    .flatMap(({ path, file }) => literalsThatCarryAValue(file).flatMap((node) => findingsAt(node, lineOf(file, node), path, declared, definitions, everyDefinition, definitionAt, files)))
    .filter((finding) => !isDeclaredACoincidence(finding) && isJudged(finding))
    .sort(byPlace)
}

/** The sites a set of judged lines holds, read from the sources — a literal, or a template with a substitution: what the gate may say it looked at. */
export function literalSitesJudged(sources: readonly CoreSource[], judged: ReadonlySet<string> | null): number {
  return parseAll(sources).flatMap(({ path, file }) =>
    nodesOf(file).filter(isRead).filter((node) => judged === null || judged.has(at(path, lineOf(file, node)))),
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
    exception.reason.trim() === '' || repeated(exception, index) || !excused.has(`${theValueTheCheckHolds(exception.value)}\u0000${exception.file}`))
}

/** What a finding whose value the change took away tells its author to do. */
export const GONE = '(gone in this change: keep a constant that holds this value and import it here, or write this line without the value)'

/** Each finding as the one line CI prints. */
export const lineOfAFinding = (finding: Finding): string =>
  `${finding.path}:${finding.line}: '${asTheMessageShowsIt(finding.literal)}'${finding.segment ? ' (a path segment)' : ''} restates ${finding.module} ${finding.name}${finding.gone ? ` ${GONE}` : ''}`

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
