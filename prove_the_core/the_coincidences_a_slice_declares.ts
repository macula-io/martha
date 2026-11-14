// The coincidences each slice declares, read from the syntax tree (martha#289 part b, r=3).
//
// A slice that spells a word a constant elsewhere holds, meaning something else by it, says so in one file of a
// fixed name inside itself, `<slice>/coincidences.ts`, which exports COINCIDENCES: `{ value, file, reason }`
// entries, each value named by the constant that holds it, imported the way code imports it. The file sits under
// src/, so tsc still turns a renamed constant into a red build.
//
// The check finds those files by name among the sources it already parses and READS them: it never imports one.
// An import of a path built at run time is what imports_beyond_the_core names, and reading means the check runs no
// code from the tree it judges. So the reader resolves only what it can see, and refuses the rest by name:
//
//   - a value or reason that is a name: a constant of the same file, or one imported by name (renamed or not) from
//     a relative path, resolved to the constant that module defines;
//   - a reason that is a string, or a template whose every substitution is such a name;
//   - anything else (a spread, a call, a property or other computed value, a name nothing resolves, an entry that
//     is not `{ value, file, reason }`, or a file whose COINCIDENCES is no array) is refused, never skipped.

import { dirname, join, normalize } from 'node:path'

import ts from 'typescript'

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { constantsIn, type Exception } from './no_literal_restates_a_value.ts'
import { lineOf, parseSource } from './parse_a_source.ts'

/** The one name a slice's coincidence file has. */
export const COINCIDENCE_FILE = 'coincidences.ts'

/** The export the file declares its entries under. */
export const COINCIDENCE_EXPORT = 'COINCIDENCES'

/** An entry, with the file that declares it and the line it stands on. */
export interface DeclaredCoincidence extends Exception {
  readonly declared_in: string
  readonly line: number
}

/** A place the reader cannot read, and why. */
export interface UnreadableCoincidence {
  readonly path: string
  readonly line: number
  readonly why: string
}

/** What the reader found: the entries it could read, and every place it could not. */
export interface CoincidencesRead {
  readonly entries: readonly DeclaredCoincidence[]
  readonly unreadable: readonly UnreadableCoincidence[]
}

/** Why a place is refused, each in the words the gate prints. */
export const NO_ARRAY = `declares no ${COINCIDENCE_EXPORT} array the check can read`
export const NOT_AN_ENTRY = 'is not an entry of the form { value, file, reason }'
export const A_SPREAD = 'spreads into the list, which the check cannot read'
export const COMPUTED = 'is computed (a call, a property or an expression), which the check cannot read'
export const UNRESOLVED = 'names nothing the check can resolve: a constant of this file, or one imported by name from a relative path'
export const NOT_A_DECLARATION = 'is not allowed in a coincidence file, which holds only named imports from a relative path, string constants and the list'

/** Whether a statement is a named import from a relative path, of values or of types: never a side effect, a default or a namespace. */
const isANamedImport = (statement: ts.Statement): boolean =>
  ts.isImportDeclaration(statement) &&
  ts.isStringLiteral(statement.moduleSpecifier) &&
  statement.moduleSpecifier.text.startsWith('.') &&
  statement.importClause !== undefined &&
  statement.importClause.name === undefined &&
  statement.importClause.namedBindings !== undefined &&
  ts.isNamedImports(statement.importClause.namedBindings)

/** Whether a statement declares only constants whose value is a string, or the list itself. */
const isAConstantOrTheList = (statement: ts.Statement): boolean => {
  if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) return false
  return statement.declarationList.declarations.every((declaration) => {
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return false
    const value = unwrapped(declaration.initializer)
    return declaration.name.text === COINCIDENCE_EXPORT ? ts.isArrayLiteralExpression(value) : ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
  })
}

/** The statements a coincidence file may not hold, so nothing in it is code that escapes the reach rules (ruling P, condition 1). */
const statementsNotAllowed = (path: string, file: ts.SourceFile): UnreadableCoincidence[] =>
  file.statements
    .filter((statement) => !isANamedImport(statement) && !isAConstantOrTheList(statement))
    .map((statement) => ({ path, line: lineOf(file, statement), why: NOT_A_DECLARATION }))

/** Whether a path names a coincidence file: its base name is exactly COINCIDENCE_FILE, wherever it sits. */
export const isACoincidenceFile = (path: string): boolean => path.split(/[\\/]/).at(-1) === COINCIDENCE_FILE

/** The expression under `as`, `satisfies` and parentheses. */
const unwrapped = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? unwrapped(node.expression) : node

/** The names a file can resolve: its own constants, and each name it imports from a relative path, as [module, name]. */
interface Names {
  readonly local: ReadonlyMap<string, string>
  readonly imported: ReadonlyMap<string, readonly [string, string]>
  /** A constant of another module by its name there, or undefined when that module defines none. */
  readonly valueIn: (module: string, name: string) => string | undefined
}

/** The constants a source defines, by name: never a record's entry, which no entry names. */
const constantsByName = (text: string, path: string): ReadonlyMap<string, string> =>
  new Map(constantsIn(text, path).filter((constant) => constant.record === undefined).map((constant) => [constant.name, constant.value]))

/** Each name one import binds, as [the name here, [the module it comes from, its name there]]. The shape rule already holds every import to named and relative. */
function bindingsOf(statement: ts.Statement, path: string): (readonly [string, readonly [string, string]])[] {
  if (!isANamedImport(statement)) return []
  const declaration = statement as ts.ImportDeclaration
  const module = normalize(join(dirname(path), (declaration.moduleSpecifier as ts.StringLiteral).text))
  const bindings = declaration.importClause!.namedBindings as ts.NamedImports
  return bindings.elements.map((element) => [element.name.text, [module, (element.propertyName ?? element.name).text]] as const)
}

const namesOf = (source: CoreSource, file: ts.SourceFile, valueIn: Names['valueIn']): Names => ({
  local: constantsByName(source.text, source.path),
  imported: new Map(file.statements.flatMap((statement) => bindingsOf(statement, source.path))),
  valueIn,
})

type Resolved = { readonly text: string } | { readonly why: string }

/** The value of a name, through the file's own constants or the module it is imported from. */
function resolveName(name: string, names: Names): Resolved {
  const local = names.local.get(name)
  if (local !== undefined) return { text: local }
  const from = names.imported.get(name)
  const value = from === undefined ? undefined : names.valueIn(from[0], from[1])
  return value === undefined ? { why: UNRESOLVED } : { text: value }
}

/** A template whose every substitution is a name, put together; why not, otherwise. */
function resolveTemplate(template: ts.TemplateExpression, names: Names): Resolved {
  let text = template.head.text
  for (const span of template.templateSpans) {
    const part: Resolved = ts.isIdentifier(span.expression) ? resolveName(span.expression.text, names) : { why: COMPUTED }
    if ('why' in part) return part
    text += part.text + span.literal.text
  }
  return { text }
}

/** The text an entry's field holds: a name, or, where text may be written, a string or a template of names; why not, otherwise. */
function resolveText(node: ts.Expression, names: Names, strings: boolean): Resolved {
  const at = unwrapped(node)
  if (ts.isIdentifier(at)) return resolveName(at.text, names)
  if (strings && (ts.isStringLiteral(at) || ts.isNoSubstitutionTemplateLiteral(at))) return { text: at.text }
  return strings && ts.isTemplateExpression(at) ? resolveTemplate(at, names) : { why: COMPUTED }
}

/** An entry's fields by name, or why it is not an entry: a spread, or a property that is not a plain `name: value`. */
function fieldsOf(entry: ts.ObjectLiteralExpression): ReadonlyMap<string, ts.Expression> | string {
  const fields = new Map<string, ts.Expression>()
  for (const property of entry.properties) {
    if (ts.isSpreadAssignment(property)) return A_SPREAD
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return NOT_AN_ENTRY
    fields.set(property.name.text, property.initializer)
  }
  return fields
}

/** The three fields of an entry, resolved, or why one cannot be. */
function resolveFields(fields: ReadonlyMap<string, ts.Expression>, names: Names): readonly [string, string, string] | string {
  const written = ['value', 'file', 'reason'].map((name) => fields.get(name))
  if (fields.size !== 3 || written.includes(undefined)) return NOT_AN_ENTRY
  const parts = written.map((node, index) => resolveText(node!, names, index > 0))
  const refused = parts.find((part): part is { why: string } => 'why' in part)
  return refused === undefined ? (parts.map((part) => (part as { text: string }).text) as unknown as readonly [string, string, string]) : refused.why
}

/** One element of the list, as an entry or as the reason it cannot be read. */
function readEntry(element: ts.Expression, declared_in: string, file: ts.SourceFile, names: Names): DeclaredCoincidence | UnreadableCoincidence {
  const line = lineOf(file, element)
  const entry = unwrapped(element)
  const fields = ts.isSpreadElement(element) ? A_SPREAD : !ts.isObjectLiteralExpression(entry) ? (ts.isIdentifier(entry) ? UNRESOLVED : COMPUTED) : fieldsOf(entry)
  const resolved = typeof fields === 'string' ? fields : resolveFields(fields, names)
  if (typeof resolved === 'string') return { path: declared_in, line, why: resolved }
  const [value, path, reason] = resolved
  return { value, file: path, reason, declared_in, line }
}

/** Whether a statement is exported. */
const isExported = (statement: ts.VariableStatement): boolean => statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false

/** The COINCIDENCES list a file declares, or null when it declares none the check can read. */
function listIn(file: ts.SourceFile): ts.ArrayLiteralExpression | null {
  const declaration = file.statements
    .filter((statement): statement is ts.VariableStatement => ts.isVariableStatement(statement) && isExported(statement))
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((each) => ts.isIdentifier(each.name) && each.name.text === COINCIDENCE_EXPORT && each.initializer !== undefined)
  const list = declaration === undefined ? null : unwrapped(declaration.initializer!)
  return list !== null && ts.isArrayLiteralExpression(list) ? list : null
}

/** What one coincidence file declares: its entries, or every place in it the reader cannot read. */
function readAFile(source: CoreSource, valueIn: Names['valueIn']): CoincidencesRead {
  const { file } = parseSource(source.text, source.path)
  const notAllowed = statementsNotAllowed(source.path, file)
  if (notAllowed.length > 0) return { entries: [], unreadable: notAllowed }
  const list = listIn(file)
  if (list === null) return { entries: [], unreadable: [{ path: source.path, line: 1, why: NO_ARRAY }] }
  const names = namesOf(source, file, valueIn)
  const read = list.elements.map((element) => readEntry(element, source.path, file, names))
  return {
    entries: read.filter((one): one is DeclaredCoincidence => !('why' in one)),
    unreadable: read.filter((one): one is UnreadableCoincidence => 'why' in one),
  }
}

/**
 * Every coincidence the slices declare, read from the files named COINCIDENCE_FILE among `sources`, with every
 * place the reader cannot read. Paths are relative to src/, as the sources name them.
 */
export function coincidencesIn(sources: readonly CoreSource[]): CoincidencesRead {
  const texts = new Map(sources.map((source) => [source.path, source.text]))
  const constantsOf = new Map<string, ReadonlyMap<string, string>>()
  const valueIn = (module: string, name: string): string | undefined => {
    const text = texts.get(module)
    if (text !== undefined && !constantsOf.has(module)) constantsOf.set(module, constantsByName(text, module))
    return constantsOf.get(module)?.get(name)
  }
  const read = sources.filter((one) => isACoincidenceFile(one.path)).map((source) => readAFile(source, valueIn))
  return { entries: read.flatMap((one) => one.entries), unreadable: read.flatMap((one) => one.unreadable) }
}

/** One unreadable place, as the gate prints it. */
export const lineOfAnUnreadableCoincidence = (place: UnreadableCoincidence): string => `${place.path}:${place.line}: ${place.why}`
