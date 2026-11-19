// The scopes of a parsed text, and which scope binds a name read in it (martha#811).
//
// The callee follower (follow_the_free_callees.ts) walks these scopes out from a name to find where the host's bundle
// binds it; the compare (compare_under_renaming.ts) walks them inside one recorded text to tell a name the text binds
// in a nested scope, renamed per binding, from a name bound at the text's top or not at all, renamed by name across the
// field. A `var` binds in the function or text around it, however deep in that body's blocks it is written.

import ts from 'typescript'

/** The names a binding pattern or name declares. */
export function namesBoundBy(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : namesBoundBy(element.name)))
}

/** What one statement of a scope binds `name` to, as the definitions to record. */
export function bindingsInStatement(statement: ts.Node, name: string): Array<ts.Node | { readonly import: ts.ImportDeclaration; readonly binding: ts.Node }> {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) return [statement]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.filter((declaration) => namesBoundBy(declaration.name).includes(name))
  if (ts.isImportDeclaration(statement) && statement.importClause !== undefined) return importBindingsOf(statement, statement.importClause, name)
  return []
}

/** What one import binds `name` to: its default, its namespace or one of its named imports, each with the import. */
function importBindingsOf(statement: ts.ImportDeclaration, clause: ts.ImportClause, name: string): Array<{ readonly import: ts.ImportDeclaration; readonly binding: ts.Node }> {
  const { name: local, namedBindings } = clause
  const bound: ts.Node[] = []
  if (local?.text === name) bound.push(local)
  if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings) && namedBindings.name.text === name) bound.push(namedBindings)
  if (namedBindings !== undefined && ts.isNamedImports(namedBindings)) bound.push(...namedBindings.elements.filter((element) => element.name.text === name))
  return bound.map((binding) => ({ import: statement, binding }))
}

/** Whether a node holds a list of statements directly: a text, a block or a clause of a switch. */
const holdsStatements = (node: ts.Node): node is ts.SourceFile | ts.Block | ts.ModuleBlock | ts.CaseClause | ts.DefaultClause =>
  ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)

/** A for loop's own initializer, or undefined for any other node. */
const loopInitializerOf = (node: ts.Node): ts.ForInitializer | undefined =>
  ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) ? node.initializer : undefined

/** The statements a scope node holds directly, and the parameters it binds. */
export function scopeOf(node: ts.Node): { readonly statements: readonly ts.Node[]; readonly parameters: readonly ts.ParameterDeclaration[] } {
  if (holdsStatements(node)) return { statements: node.statements, parameters: [] }
  if (ts.isFunctionLike(node)) return { statements: [], parameters: node.parameters }
  if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) return { statements: [node.variableDeclaration], parameters: [] }
  const loop = loopInitializerOf(node)
  if (loop !== undefined && ts.isVariableDeclarationList(loop)) return { statements: loop.declarations, parameters: [] }
  return { statements: [], parameters: [] }
}

/** The names each body's hoisted `var`s bind, read once: a bundle's module wrapper is a body as long as the module. */
const hoisted = new WeakMap<ts.Node, ReadonlySet<string>>()

/** The names the `var` declarators of a function's body or a text bind in its blocks, never inside a nested function or class. */
function hoistedIn(node: ts.Node): ReadonlySet<string> {
  const known = hoisted.get(node)
  if (known !== undefined) return known
  const found = new Set<string>()
  const visit = (child: ts.Node): void => {
    if (ts.isFunctionLike(child) || ts.isClassLike(child)) return
    if (ts.isVariableDeclarationList(child) && (child.flags & ts.NodeFlags.BlockScoped) === 0) for (const declaration of child.declarations) namesBoundBy(declaration.name).forEach((name) => found.add(name))
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  hoisted.set(node, found)
  return found
}

/** Whether `scope` binds `name`: a parameter, a statement it holds, its own name as a function or class expression, or a hoisted `var`. */
export function bindsHere(scope: ts.Node, name: string): boolean {
  if (bindsDirectly(scope, name)) return true
  const body = hoistingBodyOf(scope)
  return body !== undefined && hoistedIn(body).has(name)
}

/** Whether `scope` binds `name` before any hoisting: a parameter, a statement it holds, or its own name as a function or class expression. */
export function bindsDirectly(scope: ts.Node, name: string): boolean {
  const { statements, parameters } = scopeOf(scope)
  if (parameters.some((parameter) => namesBoundBy(parameter.name).includes(name))) return true
  if (statements.some((statement) => (ts.isVariableDeclaration(statement) ? namesBoundBy(statement.name).includes(name) : bindingsInStatement(statement, name).length > 0))) return true
  return (ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) && scope.name?.text === name
}

/** The body a scope's `var`s hoist to: a text itself or a function's body; undefined for any other scope. */
const hoistingBodyOf = (scope: ts.Node): ts.Node | undefined =>
  ts.isSourceFile(scope) ? scope : ts.isFunctionLike(scope) ? (scope as ts.SignatureDeclaration & { readonly body?: ts.Node }).body : undefined

/** The nearest scope around `name` that binds it, or undefined when nothing in its text does. */
export function bindingScopeOf(name: ts.Identifier): ts.Node | undefined {
  for (let scope: ts.Node | undefined = name.parent; scope !== undefined; scope = scope.parent) {
    if (bindsHere(scope, name.text)) return scope
  }
  return undefined
}
