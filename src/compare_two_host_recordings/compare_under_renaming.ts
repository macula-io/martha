// What a recorded code field says once the minifier's names are taken out of it (martha#811).
//
// The minifier renames identifiers in every Claude Code release, so a host that moved no fact still differs from its
// recording in nearly every code field. This reads each recorded text with the TypeScript parser and rewrites only
// the names the minifier gives, numbered by first appearance: a consistent renaming then reads the same, and anything
// else still differs. A name bound at a text's top, or bound nowhere in it, is renamed by ONE mapping for the whole
// field (§1, §2, ...), since the field's other texts and its calls name it too. A name bound in a scope nested inside
// the text, such as a parameter or a function's own variable, is renamed per binding within that text (ℓ1, ℓ2, ...):
// the minifier reuses its short names across functions, so one name can be a local here and a callee there, and a
// mapping by name would shift every number after it (the_scopes_of_a_text.ts says which scope binds a name).
//
// Renamed: names declared in the text (parameters, variables, functions, classes, catch bindings, labels, import
// locals) and free names that are not on the committed list of globals. Kept as written: property names after `.`
// and `?.`, object keys (a shorthand key in a literal or a destructuring too), class members, import names, every global
// on the list, every literal, operator and keyword, and the order of the code. A field's `calls` and `guard_calls` keys
// are renamed by the field's own mapping; their indices are compared as they are.
//
// The parser fails closed: a text it reports a diagnostic for, or an identifier in a role not on the closed list
// below, makes the field unreadable. A field nobody can read never compares equal.

import ts from 'typescript'

import { bindingScopeOf } from './the_scopes_of_a_text.ts'

/** Why a text cannot be compared: the field is unreadable, and --check fails naming it. */
export class Unreadable extends Error {}

/**
 * The names a minifier never renames, compared as written: the ECMAScript globals, and what a Node or Bun bundle
 * reaches without declaring it. A name here is a fact of the code, so `process.env.X` against `qZ.env.X` differs.
 */
export const GLOBALS: ReadonlySet<string> = new Set([
  'globalThis', 'undefined', 'NaN', 'Infinity', 'arguments',
  'Object', 'Function', 'Array', 'Number', 'Boolean', 'String', 'Symbol', 'BigInt', 'Math', 'Date', 'RegExp', 'JSON',
  'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
  'Promise', 'Proxy', 'Reflect', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'Intl',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',
  'eval', 'escape', 'unescape',
  'process', 'require', 'module', 'exports', 'Buffer', 'console', 'Bun', '__dirname', '__filename',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask',
  'structuredClone', 'fetch', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
  'atob', 'btoa', 'performance', 'crypto', 'navigator',
])

/** How a recorded text is read as a program: as it is, as object members, as one expression, or as a function's opening. */
export type Shape = 'program' | 'members' | 'expression' | 'opening'

const PROGRAM_OF: Readonly<Record<Shape, (text: string) => { readonly program: string; readonly offset: number }>> = {
  program: (text) => ({ program: text, offset: 0 }),
  members: (text) => ({ program: `({${text}})`, offset: 2 }),
  expression: (text) => ({ program: `(${text})`, offset: 1 }),
  // A recorded opening stops inside the function's body; it is closed for the parse, never for the compare.
  opening: (text) => ({ program: `${text}}`, offset: 0 }),
}

type Role = 'kept' | 'renamed' | 'shorthand' | 'import-shorthand'

/** Roles where the identifier is a key or a member's name, compared as written. */
function keptRole(node: ts.Identifier, parent: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) return parent.name === node
  if (ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isPropertyDeclaration(parent)) return parent.name === node
  if (ts.isBindingElement(parent) || ts.isImportSpecifier(parent)) return parent.propertyName === node
  return ts.isMetaProperty(parent)
}

/** Whether the identifier is the name a variable, a parameter or a binding declares. */
const namesAVariable = (node: ts.Identifier, parent: ts.Node): boolean =>
  (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.name === node

/** Whether the identifier is the name a function or a class declares. */
const namesAFunctionOrClass = (node: ts.Identifier, parent: ts.Node): boolean =>
  (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) && parent.name === node

/** Whether the identifier is a local name an import binds under a name of its own. */
const namesAnImport = (parent: ts.Node): boolean =>
  ts.isImportClause(parent) || ts.isNamespaceImport(parent) || (ts.isImportSpecifier(parent) && parent.propertyName !== undefined)

/** Roles where the identifier is declared by the text. */
function declaredRole(node: ts.Identifier, parent: ts.Node): boolean {
  return namesAVariable(node, parent) || namesAFunctionOrClass(node, parent) || namesALabel(node) || namesAnImport(parent)
}

/** The closed list of nodes an identifier may be read in as a value. Any other parent makes the text unreadable. */
const VALUE_PARENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.CallExpression, ts.SyntaxKind.NewExpression, ts.SyntaxKind.PropertyAccessExpression, ts.SyntaxKind.ElementAccessExpression,
  ts.SyntaxKind.BinaryExpression, ts.SyntaxKind.PrefixUnaryExpression, ts.SyntaxKind.PostfixUnaryExpression, ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ParenthesizedExpression, ts.SyntaxKind.ArrayLiteralExpression, ts.SyntaxKind.SpreadElement, ts.SyntaxKind.SpreadAssignment,
  ts.SyntaxKind.TemplateSpan, ts.SyntaxKind.TaggedTemplateExpression, ts.SyntaxKind.TypeOfExpression, ts.SyntaxKind.VoidExpression,
  ts.SyntaxKind.DeleteExpression, ts.SyntaxKind.AwaitExpression, ts.SyntaxKind.YieldExpression, ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.ComputedPropertyName, ts.SyntaxKind.ExpressionWithTypeArguments, ts.SyntaxKind.HeritageClause,
  ts.SyntaxKind.ReturnStatement, ts.SyntaxKind.ExpressionStatement, ts.SyntaxKind.IfStatement, ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.SwitchStatement, ts.SyntaxKind.CaseClause, ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.VariableDeclaration, ts.SyntaxKind.Parameter, ts.SyntaxKind.BindingElement, ts.SyntaxKind.PropertyAssignment, ts.SyntaxKind.PropertyDeclaration,
])

/**
 * Whether the identifier is both a key and the variable it binds: `{a}` in an object destructuring. The key is the
 * host's own property name, so it is kept as written and only the variable is renamed (`{a:§1}`); renaming both would
 * read `{a}` and `{b}` the same.
 */
const destructuresItsOwnKey = (node: ts.Identifier, parent: ts.Node): boolean =>
  ts.isBindingElement(parent) && parent.name === node && parent.propertyName === undefined && parent.dotDotDotToken === undefined && ts.isObjectBindingPattern(parent.parent)

/** The role an identifier plays in its text, on the closed list; anything else is unreadable. */
function roleOf(node: ts.Identifier, isFree: (name: string) => boolean): Role {
  const parent = node.parent
  if (ts.isShorthandPropertyAssignment(parent)) return parent.name === node ? 'shorthand' : 'renamed'
  if (destructuresItsOwnKey(node, parent)) return 'shorthand'
  if (ts.isImportSpecifier(parent) && parent.propertyName === undefined) return 'import-shorthand'
  if (keptRole(node, parent)) return 'kept'
  if (declaredRole(node, parent)) return 'renamed'
  return valueRole(node, isFree)
}

/** The role of an identifier read as a value: a free global is kept, any other name renamed; a parent off the list is unreadable. */
function valueRole(node: ts.Identifier, isFree: (name: string) => boolean): Role {
  const parent = node.parent
  if (!VALUE_PARENTS.has(parent.kind)) throw new Unreadable(`an identifier in a ${ts.SyntaxKind[parent.kind]}, a role the compare does not read`)
  return isFree(node.text) && GLOBALS.has(node.text) ? 'kept' : 'renamed'
}

/**
 * Whether an identifier is read as a value where it stands: not a key, a member's name or a declaration. A shorthand
 * property reads the variable it names. The follower (follow_the_free_callees.ts) chases exactly these names.
 */
export function readsAValue(node: ts.Identifier): boolean {
  const { parent } = node
  if (ts.isShorthandPropertyAssignment(parent)) return true
  if (ts.isImportSpecifier(parent) || keptRole(node, parent) || declaredRole(node, parent)) return false
  if (ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) return parent.name !== node
  return VALUE_PARENTS.has(parent.kind)
}

/** Every identifier of a parsed text, in source order. */
function identifiersOf(file: ts.SourceFile): ts.Identifier[] {
  const found: ts.Identifier[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** A recorded text, parsed, refusing any text the parser reports a diagnostic for. */
function parsed(text: string, shape: Shape): { readonly file: ts.SourceFile; readonly offset: number } {
  const { program, offset } = PROGRAM_OF[shape](text)
  const file = ts.createSourceFile('recorded.js', program, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const diagnostics = (file as unknown as { readonly parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
  if (diagnostics.length > 0) throw new Unreadable(`the parser refuses the text: ${ts.flattenDiagnosticMessageText(diagnostics[0]?.messageText, ' ')}`)
  return { file, offset }
}

/** The names a text declares, which are never globals however they are spelt. */
function declaredIn(file: ts.SourceFile): Set<string> {
  return new Set(identifiersOf(file).filter((node) => declaredRole(node, node.parent)).map((node) => node.text))
}

/**
 * One mapping from a minified name to the number it was first seen at, shared by every text it renames: how a text's
 * names that no nested scope binds are renamed, those bound at the text's top and those bound nowhere in it.
 */
export class Renaming {
  readonly #numbers = new Map<string, number>()

  /** The name's stand-in, numbered on first sight. */
  of(name: string): string {
    const known = this.#numbers.get(name)
    if (known !== undefined) return `§${String(known)}`
    this.#numbers.set(name, this.#numbers.size + 1)
    return `§${String(this.#numbers.size)}`
  }
}

/** Whether an identifier names a label, which no scope binds: it is renamed by name. */
const namesALabel = (node: ts.Identifier): boolean =>
  (ts.isLabeledStatement(node.parent) || ts.isBreakStatement(node.parent) || ts.isContinueStatement(node.parent)) && node.parent.label === node

/**
 * A name's stand-in in one text: per binding when a scope nested in the text binds it, numbered in that text by first
 * appearance; by the field's renaming otherwise.
 */
function standInOf(node: ts.Identifier, outside: Renaming, locals: Map<string, number>): string {
  const scope = namesALabel(node) ? undefined : bindingScopeOf(node)
  if (scope === undefined || ts.isSourceFile(scope)) return outside.of(node.text)
  const binding = `${String(scope.pos)}:${node.text}`
  const known = locals.get(binding) ?? locals.size + 1
  locals.set(binding, known)
  return `ℓ${String(known)}`
}

/** A recorded text with the minifier's names replaced: per binding inside it, under the field's one renaming outside. */
export function normalized(text: string, shape: Shape, outside: Renaming): string {
  const { file, offset } = parsed(text, shape)
  const declared = declaredIn(file)
  const isFree = (name: string): boolean => !declared.has(name)
  const program = file.text
  let out = ''
  let at = 0
  const locals = new Map<string, number>()
  for (const node of identifiersOf(file)) {
    const role = roleOf(node, isFree)
    if (role === 'kept') continue
    const start = node.getStart(file)
    const stand_in = standInOf(node, outside, locals)
    const replacement = role === 'shorthand' ? `${node.text}:${stand_in}` : role === 'import-shorthand' ? `${node.text} as ${stand_in}` : stand_in
    out += program.slice(at, start) + replacement
    at = node.end
  }
  out += program.slice(at)
  return out.slice(offset, out.length - (program.length - offset - text.length))
}
