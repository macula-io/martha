// Parse a source of the core, the way the compiler reads it.
//
// The checks that prove something about the core's code read it here and judge
// its syntax tree, never its text. So a string, a comment, a regular expression
// or a line break cannot hide code from a check, nor make text look like code.
//
// This folder is outside src/, the core, on purpose: it imports the TypeScript
// compiler, a package the core itself may never import.

import ts from 'typescript'

export interface ParsedSource {
  readonly file: ts.SourceFile
  /** What the parser could not read, each with its line; empty when the file parses. */
  readonly errors: readonly { readonly line: number; readonly message: string }[]
}

export type ModuleReferenceKind = 'import' | 'export_from' | 'dynamic_import' | 'require' | 'type_reference'

export interface ModuleReference {
  /** The module as written; null when its name is computed and no check can know it. */
  readonly specifier: string | null
  readonly kind: ModuleReferenceKind
  readonly type_only: boolean
  readonly line: number
}

const SCRIPT_KINDS: readonly [string, ts.ScriptKind][] = [
  ['.tsx', ts.ScriptKind.TSX],
  ['.jsx', ts.ScriptKind.JSX],
  ['.js', ts.ScriptKind.JS],
  ['.mjs', ts.ScriptKind.JS],
  ['.cjs', ts.ScriptKind.JS],
]

const scriptKindOf = (path: string): ts.ScriptKind =>
  SCRIPT_KINDS.find(([extension]) => path.endsWith(extension))?.[1] ?? ts.ScriptKind.TS

/** The 1-based line a node starts on. */
export const lineOf = (file: ts.SourceFile, node: ts.Node): number =>
  file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1

/** Parse one source; the script kind follows its extension. */
export function parseSource(text: string, path: string): ParsedSource {
  const kind = scriptKindOf(path)
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  // The compiler's own assertions can fail on input it does not expect (a private
  // field named #constructor ends in a Debug Failure). Such a file cannot be read,
  // so it is reported like any other that does not parse, never thrown.
  let diagnostics: readonly ts.Diagnostic[]
  try {
    diagnostics = ts.transpileModule(text, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
    }).diagnostics ?? []
  } catch (failure) {
    const reason = String(failure).split('\n')[0]
    return { file, errors: [{ line: 1, message: `the compiler failed on it: ${reason}` }] }
  }
  const errors = diagnostics.map(diagnostic => ({
    line: diagnostic.file !== undefined && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
      : 1,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  }))
  return { file, errors }
}

/** Whether a node sits inside a type, where a name is never a value. */
export const isInAType = (node: ts.Node): boolean => {
  for (let at: ts.Node = node.parent; !ts.isSourceFile(at); at = at.parent) if (ts.isTypeNode(at)) return true
  return false
}

/**
 * Whether an identifier names a value here, rather than a property, a
 * declaration, a label or a type.
 */
export function isUsedAsAValue(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isShorthandPropertyAssignment(parent)) return true
  if (namesAPartOrALabel(node, parent) || namesAnImportOrExport(parent)) return false
  // A declaration, a property assignment or a member names its own name: not a use of a global.
  if ('name' in parent && parent.name === node) return false
  return !isInAType(node)
}

/** Whether the identifier is a qualified name's right side, a destructured property's name, or a label. */
const namesAPartOrALabel = (node: ts.Identifier, parent: ts.Node): boolean =>
  (ts.isQualifiedName(parent) && parent.right === node) ||
  (ts.isBindingElement(parent) && parent.propertyName === node) ||
  ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)

/** Whether the identifier is a name an import or an export binds. */
const namesAnImportOrExport = (parent: ts.Node): boolean =>
  ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)

/** Every node of a parsed source, in order. */
export function nodesOf(file: ts.SourceFile): ts.Node[] {
  const nodes: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    nodes.push(node)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return nodes
}

const literalText = (node: ts.Node | undefined): string | null =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null

/** A module reference made at the node being read. */
type ReferenceAt = (specifier: string | null, kind: ModuleReferenceKind, type_only: boolean) => ModuleReference

const referenceOf = (file: ts.SourceFile, node: ts.Node): ModuleReference | null => {
  const at: ReferenceAt = (specifier, kind, type_only) => ({ specifier, kind, type_only, line: lineOf(file, node) })
  return declaredReferenceOf(node, at) ?? typeOrCallReferenceOf(node, at)
}

// The statements that name a module: an import, an export from, an import equals.
const declaredReferenceOf = (node: ts.Node, at: ReferenceAt): ModuleReference | null => {
  if (ts.isImportDeclaration(node)) {
    return at(literalText(node.moduleSpecifier), 'import', node.importClause?.isTypeOnly ?? false)
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
    return at(literalText(node.moduleSpecifier), 'export_from', node.isTypeOnly)
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return at(literalText(node.moduleReference.expression), 'require', node.isTypeOnly)
  }
  return null
}

// The rest that name a module: a JSDoc import, an import type, a dynamic import, a require call.
const typeOrCallReferenceOf = (node: ts.Node, at: ReferenceAt): ModuleReference | null => {
  if (ts.isJSDocImportTag(node)) {
    return at(literalText(node.moduleSpecifier), 'import', true)
  }
  if (ts.isImportTypeNode(node)) {
    return at(ts.isLiteralTypeNode(node.argument) ? literalText(node.argument.literal) : null, 'import', true)
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return at(literalText(node.arguments[0]), 'dynamic_import', false)
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
    return at(literalText(node.arguments[0]), 'require', false)
  }
  return null
}

/** Every module a source names, as the compiler reads it: strings and comments never count. */
export function moduleReferencesOf(text: string, path: string): readonly ModuleReference[] {
  return moduleReferencesIn(parseSource(text, path).file)
}

// Every node inside the JSDoc comments of a source: `@type {import('x').T}` and
// `@import { T } from 'x'` name modules there, which the walk of the code skips.
function jsDocNodesOf(file: ts.SourceFile): ts.Node[] {
  const seen = new Set<ts.Node>()
  const visit = (node: ts.Node): void => {
    if (seen.has(node)) return
    seen.add(node)
    ts.forEachChild(node, visit)
  }
  // A node's own jsDoc holds every JSDoc block before it; the public
  // getJSDocCommentsAndTags keeps only the last, which would hide an `@import`
  // above a `@param`. The planted test of an `@import` followed by another block
  // fails by name if a compiler release moves this property.
  const blocksOf = (node: ts.Node): readonly ts.JSDoc[] => (node as { jsDoc?: readonly ts.JSDoc[] }).jsDoc ?? []
  for (const node of nodesOf(file)) blocksOf(node).forEach(visit)
  return [...seen]
}

// `/// <reference types="x" />`: a package's types, named in a comment the tree keeps apart.
const typeReferencesOf = (file: ts.SourceFile): ModuleReference[] =>
  file.typeReferenceDirectives.map(directive => ({
    specifier: directive.fileName,
    kind: 'type_reference',
    type_only: true,
    line: file.getLineAndCharacterOfPosition(directive.pos).line + 1,
  }))

/** The module references of an already parsed source: its code, its JSDoc and its type reference directives. */
export function moduleReferencesIn(file: ts.SourceFile): readonly ModuleReference[] {
  return [
    ...typeReferencesOf(file),
    ...[...nodesOf(file), ...jsDocNodesOf(file)].flatMap(node => referenceOf(file, node) ?? []),
  ].sort((a, b) => a.line - b.line)
}
