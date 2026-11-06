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

export type ModuleReferenceKind = 'import' | 'export_from' | 'dynamic_import' | 'require'

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

const referenceOf = (file: ts.SourceFile, node: ts.Node): ModuleReference | null => {
  const at = (specifier: string | null, kind: ModuleReferenceKind, type_only: boolean): ModuleReference =>
    ({ specifier, kind, type_only, line: lineOf(file, node) })
  if (ts.isImportDeclaration(node)) {
    return at(literalText(node.moduleSpecifier), 'import', node.importClause?.isTypeOnly ?? false)
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
    return at(literalText(node.moduleSpecifier), 'export_from', node.isTypeOnly)
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return at(literalText(node.moduleReference.expression), 'require', node.isTypeOnly)
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

/** The module references of an already parsed source. */
export function moduleReferencesIn(file: ts.SourceFile): readonly ModuleReference[] {
  return nodesOf(file).flatMap(node => referenceOf(file, node) ?? [])
}
