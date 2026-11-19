// What a recorded text calls, followed through the host's bundle to each callee's definition (martha#811, R6).
//
// A recorded field compared under renaming (compare_under_renaming.ts) would read a callee swapped for another as the
// same text, because only the callee's name differs. So every free name a recorded text calls is followed to where
// the bundle binds it, and that definition is recorded beside the text, with the entry each name binds to. A swapped
// callee is then a changed index or a changed definition, and --check names the field.
//
// "Called" is a name in call position (the root of a called member chain, so `Wn` in `Wn.join(...)`), and, in a
// binding that is not a function (a member alias like `Wn.join`, a `require(...)` or an interop call), every free name
// in its initializer. A definition is whatever the bundle binds the name with: a function or class declaration, one
// variable declarator, or one import, a platform module's kept whole and a bundle module's followed to the module that
// exports it. The chase stops at a global (compare_under_renaming.ts's list).
//
// Two depths, as Raf ruled on martha#811 (DECIDED 2026-11-19 "A: full on guards, 1 level on loaders (Recommended)"):
// the full chase follows each recorded definition's own callees in turn until none is left; one level records the
// text's direct callees and follows nothing further, so their own callees stay inside their text, renamed. A name
// already recorded is never recorded twice: its entry is reused, which ends cycles.
//
// A name the bundle binds nowhere, or in two ways in one scope, cannot be told, and the field is unreadable.

import ts from 'typescript'

import { CHUNK } from '../cut_the_rules_from_the_host_binary/protected_config_places.ts'
import { GLOBALS, readsAValue, Unreadable } from '../compare_two_host_recordings/compare_under_renaming.ts'
import { bindingsInStatement, bindsDirectly, bindsHere, namesBoundBy, scopeOf } from '../compare_two_host_recordings/the_scopes_of_a_text.ts'
import type { Depth, GuardCalls } from '../compare_two_host_recordings/what_a_recorded_text_calls.ts'

/** The path a module of the bundle imports another of its modules by. */
const BUNDLE_PATH = '/$bunfs/'
/** The mark a CommonJS module carries after the chunk mark: it exports through `module.exports`, never an `export{}`. */
const COMMON_JS = '@bun-cjs'

interface Module {
  readonly start: number
  readonly text: string
  file?: ts.SourceFile
  /** Every plain assignment to a name in the module, by the name, read once. */
  assignments?: ReadonlyMap<string, readonly ts.BinaryExpression[]>
}

/** One definition the chase reached: where it is, what it binds, its text as recorded, and what is assigned to it later. */
interface Definition {
  readonly module: Module
  readonly node: ts.Node
  readonly text: string
  readonly assigned: readonly ts.BinaryExpression[]
}

/** The host's bundle, split at its chunk marks, each module parsed the first time a name is looked up in it. */
export class Bundle {
  readonly #modules: readonly Module[]
  readonly #exporters = new Map<string, Array<{ readonly module: Module; readonly local: string }>>()

  constructor(text: string) {
    const starts = [0]
    for (let at = text.indexOf(CHUNK); at >= 0; at = text.indexOf(CHUNK, at + 1)) starts.push(at)
    this.#modules = starts.map((start, index) => ({ start, text: text.slice(start, starts[index + 1] ?? text.length) }))
    for (const module of this.#modules.filter((each) => !each.text.slice(0, each.text.indexOf('\n')).includes(COMMON_JS))) this.#noteTheExportsOf(module)
  }

  /** Each name a module's `export{}` lists export, noted with the module and its local name there. */
  #noteTheExportsOf(module: Module): void {
    for (const match of module.text.matchAll(/export\{([^}]*)\}/g)) {
      for (const [local, exported] of pairsOf(match[1] ?? '')) this.#exporters.set(exported, [...(this.#exporters.get(exported) ?? []), { module, local }])
    }
  }

  /** The module that holds the bundle's text at `at`. */
  moduleAt(at: number): Module {
    let found = this.#modules[0]
    for (const module of this.#modules) if (module.start <= at) found = module
    if (found === undefined) throw new Unreadable('the host text holds no module')
    return found
  }

  /** The module's syntax tree, parsed once. */
  fileOf(module: Module): ts.SourceFile {
    module.file ??= ts.createSourceFile('module.js', module.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    return module.file
  }

  /** The one module that exports `name`, and its local name there. */
  exporterOf(name: string): { readonly module: Module; readonly local: string } {
    const from = this.#exporters.get(name) ?? []
    const [only] = from
    if (from.length !== 1 || only === undefined) throw new Unreadable(`${String(from.length)} modules of the host export ${name}, not one`)
    return only
  }
}

/** The last host text split, and its bundle: the recorder reads one host, and splitting it is the costly part. */
let last: { readonly text: string; readonly bundle: Bundle } | undefined

/** The bundle of a host's text, split once for every field read from it. */
export function bundleOf(text: string): Bundle {
  if (last?.text !== text) last = { text, bundle: new Bundle(text) }
  return last.bundle
}

/** Each `local as exported` pair of an import or export list; a bare name is both. */
function pairsOf(list: string): Array<readonly [string, string]> {
  return list.split(',').map((entry) => entry.trim().split(/\s+as\s+/)).filter((pair) => pair[0] !== '').map((pair) => [pair[0] ?? '', pair.at(-1) ?? ''] as const)
}

/**
 * A variable whose value is a class or function expression of its own name, as the declaration it amounts to: a bundle
 * writes `class X{}` in one release and `var X=class X{}` in another, and the two bind the same code.
 */
function asDeclaration(name: ts.BindingName, value: ts.Expression, file: ts.SourceFile): string | undefined {
  return (ts.isClassExpression(value) || ts.isFunctionExpression(value)) && ts.isIdentifier(name) && value.name?.text === name.text ? value.getText(file) : undefined
}

const VARIABLE_KEYWORD = (list: ts.VariableDeclarationList): string => ((list.flags & ts.NodeFlags.Const) !== 0 ? 'const' : (list.flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var')

/** The text a binding is recorded by: the declaration whole, one declarator with its keyword, or one import. */
function definitionText(found: ts.Node | { readonly import: ts.ImportDeclaration; readonly binding: ts.Node }, file: ts.SourceFile): string {
  if ('import' in found) {
    const from = found.import.moduleSpecifier.getText(file)
    const { binding } = found
    if (ts.isImportSpecifier(binding)) return `import{${binding.getText(file)}}from${from}`
    if (ts.isNamespaceImport(binding)) return `import ${binding.getText(file)} from${from}`
    return `import ${binding.getText(file)} from${from}`
  }
  if (ts.isVariableDeclaration(found)) {
    const declared = found.initializer === undefined ? undefined : asDeclaration(found.name, found.initializer, file)
    return declared ?? `${VARIABLE_KEYWORD(found.parent as ts.VariableDeclarationList)} ${found.getText(file)}`
  }
  return found.getText(file)
}

/** Every plain assignment `name = ...` in a module, by the name. */
function assignmentsIn(module: Module, file: ts.SourceFile): ReadonlyMap<string, readonly ts.BinaryExpression[]> {
  if (module.assignments !== undefined) return module.assignments
  const found = new Map<string, ts.BinaryExpression[]>()
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) found.set(node.left.text, [...(found.get(node.left.text) ?? []), node])
    ts.forEachChild(node, visit)
  }
  visit(file)
  module.assignments = found
  return found
}

/** Whether `name` at `at` is the binding `scope` makes: no scope between them binds the name again. */
function bindsTheSame(at: ts.Identifier, scope: ts.Node): boolean {
  for (let between: ts.Node | undefined = at.parent; between !== undefined; between = between.parent) {
    if (between === scope) return true
    if (bindsHere(between, at.text)) return false
  }
  return false
}

/**
 * The assignments to a variable declared with no value, such as a bundle's lazily set module binding (`var X;` and,
 * in the module's init function, `X=...`): those in its module whose name is that same binding, in source order.
 */
function assignedTo(declaration: ts.VariableDeclaration, scope: ts.Node, module: Module, file: ts.SourceFile): ts.BinaryExpression[] {
  if (declaration.initializer !== undefined || !ts.isIdentifier(declaration.name)) return []
  const name = declaration.name
  return [...(assignmentsIn(module, file).get(name.text) ?? [])].filter((assignment) => bindsTheSame(assignment.left as ts.Identifier, scope))
}

/**
 * A definition's text with what is assigned to it later. One assignment is written as the declaration's value, the form
 * an eagerly set module gives it, so a release that moves a module to lazy init reads the same; several stay in order.
 */
function valuedText(declared: string, assigned: readonly ts.BinaryExpression[], file: ts.SourceFile): string {
  const [only] = assigned
  if (assigned.length === 1 && only !== undefined) return asDeclaration(only.left as ts.Identifier, only.right, file) ?? `${declared}=${only.right.getText(file)}`
  return declared + assigned.map((assignment) => `;${assignment.getText(file)}`).join('')
}

/** Where `name`, read at `from` in `module`, is bound: the nearest scope that binds it, followed across the bundle's own imports. */
function definitionOf(bundle: Bundle, module: Module, from: ts.Node, name: string): Definition {
  const file = bundle.fileOf(module)
  for (let scope: ts.Node | undefined = from; scope !== undefined; scope = scope.parent) {
    const only = theBindingIn(scope, name)
    if (only === undefined) continue
    if ('import' in only && importsFromTheBundle(only.import)) return definitionOf(bundle, ...whereTheBundleExports(bundle, only.binding, name))
    const assigned = 'import' in only || !ts.isVariableDeclaration(only) ? [] : assignedTo(only, scope, module, file)
    return { module, node: 'import' in only ? only.binding : only, text: valuedText(definitionText(only, file), assigned, file), assigned }
  }
  throw new Unreadable(`a recorded text calls ${name}, which the host's bundle binds nowhere (at ${String(module.start + from.getStart(file))})`)
}

/** The one binding `scope` makes of `name`, or undefined when it makes none; a parameter or two bindings are unreadable. */
function theBindingIn(scope: ts.Node, name: string): ts.Node | { readonly import: ts.ImportDeclaration; readonly binding: ts.Node } | undefined {
  const { statements, parameters } = scopeOf(scope)
  if (parameters.some((parameter) => namesBoundBy(parameter.name).includes(name))) {
    throw new Unreadable(`a recorded text calls ${name}, a parameter of a function around it, whose value the bundle does not hold`)
  }
  const found = statements.flatMap((statement) => (ts.isVariableDeclaration(statement) ? (namesBoundBy(statement.name).includes(name) ? [statement] : []) : bindingsInStatement(statement, name)))
  if (found.length > 1) throw new Unreadable(`a scope of the host binds ${name} ${String(found.length)} ways`)
  return found[0]
}

/** Whether an import reads one of the bundle's own modules. */
const importsFromTheBundle = (declaration: ts.ImportDeclaration): boolean =>
  ts.isStringLiteral(declaration.moduleSpecifier) && declaration.moduleSpecifier.text.startsWith(BUNDLE_PATH)

/** Where a binding imported from the bundle's own modules is defined: the exporting module, its tree, and its local name there. */
function whereTheBundleExports(bundle: Bundle, binding: ts.Node, name: string): [Module, ts.Node, string] {
  const imported = ts.isImportSpecifier(binding) ? (binding.propertyName ?? binding.name).text : name
  const exporter = bundle.exporterOf(imported)
  const home = bundle.fileOf(exporter.module)
  return [exporter.module, home, exporter.local]
}

/** Whether a definition is a function or class, whose callees are its calls; any other binding is an alias, and every free name of it is followed. */
function isCode(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return true
  return ts.isVariableDeclaration(node) && node.initializer !== undefined && isCodeValue(node.initializer)
}

/** Whether a value is a function or class itself, read for its calls alone. */
const isCodeValue = (value: ts.Expression): boolean => ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isClassExpression(value)

/** The root name of a called expression: `Wn` in `Wn.default.join(...)`. */
function calledRoot(callee: ts.Expression): ts.Identifier | undefined {
  let at: ts.Expression = callee
  while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at) || ts.isParenthesizedExpression(at)) at = at.expression
  return ts.isIdentifier(at) ? at : undefined
}

/** The free names `node` calls, or reads at all when `every`, in the order first met; never one it declares or a global. */
function freeNamesIn(node: ts.Node, file: ts.SourceFile, every: boolean, textStart: number): ts.Identifier[] {
  const found: ts.Identifier[] = []
  const visit = (at: ts.Node): void => {
    if (ts.isCallExpression(at) || ts.isNewExpression(at)) {
      const root = calledRoot(at.expression)
      if (root !== undefined) found.push(root)
    } else if (ts.isTaggedTemplateExpression(at)) {
      const root = calledRoot(at.tag)
      if (root !== undefined) found.push(root)
    } else if (every && ts.isIdentifier(at) && readsAValue(at)) found.push(at)
    ts.forEachChild(at, visit)
  }
  visit(node)
  const seen = new Set<string>()
  return found.filter((name) => {
    if (GLOBALS.has(name.text) || seen.has(name.text) || declaresWithin(textStart, name, file)) return false
    seen.add(name.text)
    return true
  })
}

/**
 * Whether `name` is bound by a scope of the recorded text itself: one that starts where the text starts or after it,
 * such as its own parameters, a variable it declares, or a loop's own binding. A name bound further out is free. The
 * module is never the text's own scope, even when the text is its first statement and so starts where it starts: a
 * definition's own name, bound in the module, is then free, and a recursive call follows it to itself.
 */
function declaresWithin(textStart: number, name: ts.Identifier, file: ts.SourceFile): boolean {
  for (let scope: ts.Node | undefined = name.parent; scope !== undefined && !ts.isSourceFile(scope) && scope.getStart(file) >= textStart; scope = scope.parent) {
    if (bindsDirectly(scope, name.text)) return true
  }
  return false
}

/**
 * What an entry calls: a function's or class's calls, every free name of any other binding, and the same of each value
 * assigned to it later, each read from where it starts.
 */
function calledByEntry(entry: Definition, file: ts.SourceFile, bound: Bound): Record<string, number> {
  const calls = bound(entry.module, [entry.node], entry.node.getStart(file), !isCode(entry.node))
  for (const { right } of entry.assigned) {
    addCalls(calls, bound(entry.module, [right], right.getStart(file), !isCodeValue(right)), (name) => `a value assigned to a binding of the host calls ${name}, bound two ways`)
  }
  return calls
}

/** Adds `more` to `calls`, by the entry each name binds to; a name already bound to another entry is unreadable, as `twoWays` says. */
function addCalls(calls: Record<string, number>, more: Record<string, number>, twoWays: (name: string) => string): void {
  for (const [name, index] of Object.entries(more)) {
    if (calls[name] !== undefined && calls[name] !== index) throw new Unreadable(twoWays(name))
    calls[name] = index
  }
}

/** One entry the chase reached, and the entry each name it calls binds to. */
type Reached = Definition & { calls: Record<string, number> }

/**
 * The chase itself: `seed` gives the field's own calls, by the entry each binds to, and every entry reached is followed
 * in turn when the depth is full. An entry already reached is reused, never recorded twice.
 */
function reach(bundle: Bundle, depth: Depth, seed: (entryOf: (definition: Definition) => number, bound: Bound) => Record<string, number>): GuardCalls {
  const reached: Reached[] = []
  const entryOf = (definition: Definition): number => {
    const known = reached.findIndex((entry) => entry.module === definition.module && entry.node === definition.node)
    if (known >= 0) return known
    return reached.push({ ...definition, calls: {} }) - 1
  }
  const bound: Bound = (module, nodes, textStart, every) => {
    const file = bundle.fileOf(module)
    const names = nodes.flatMap((node) => freeNamesIn(node, file, every, textStart)).filter((name, index, all) => all.findIndex((other) => other.text === name.text) === index)
    return Object.fromEntries(names.map((name) => [name.text, entryOf(definitionOf(bundle, module, name, name.text))]))
  }
  const guard_calls = seed(entryOf, bound)
  if (depth === 'full') for (const entry of reached) entry.calls = calledByEntry(entry, bundle.fileOf(entry.module), bound)
  return { guard_calls, functions: reached.map(({ text, calls }) => ({ function: text, calls })) }
}

/** The free names some code calls, or reads at all when `every`, by the entry each binds to. */
type Bound = (module: Module, nodes: readonly ts.Node[], textStart: number, every: boolean) => Record<string, number>

/**
 * Every definition the calls of `sources` reach, followed through the bundle to `depth`, and the entry each name binds
 * to. Each source is a recorded text and where the bundle holds it.
 */
export function calleesOf(bundle: Bundle, sources: ReadonlyArray<{ readonly at: number; readonly length: number }>, depth: Depth): GuardCalls {
  return reach(bundle, depth, (_entryOf, bound) => {
    const guard_calls: Record<string, number> = {}
    for (const { at, length } of sources) {
      const module = bundle.moduleAt(at)
      const nodes = nodesWithin(bundle.fileOf(module), at - module.start, at - module.start + length)
      // A recorded text is code: its callees are its calls, never every name it reads.
      addCalls(guard_calls, bound(module, nodes, at - module.start, false), (name) => `two recorded texts of one field call ${name}, bound two ways`)
    }
    return guard_calls
  })
}

/**
 * What `names`, called by code at `at`, reach: as calleesOf, for a guard read as the names it calls rather than as one
 * text (the markdown loader's managed-folder guard, martha#412).
 */
export function calleesOfNames(bundle: Bundle, at: number, names: readonly string[], depth: Depth): GuardCalls {
  const module = bundle.moduleAt(at)
  const from = innermostAt(bundle.fileOf(module), at - module.start)
  return reach(bundle, depth, (entryOf) => Object.fromEntries(names.filter((name) => !GLOBALS.has(name)).map((name) => [name, entryOf(definitionOf(bundle, module, from, name))])))
}

/** The outermost nodes that lie wholly inside `[start, end)`: the recorded text's own code, never the code around it. */
function nodesWithin(file: ts.SourceFile, start: number, end: number): ts.Node[] {
  const within: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    if (node.end <= start || node.getStart(file) >= end) return
    // A syntax list is the parser's grouping of a node's children, not a node of the code: its children are read.
    if (node.kind !== ts.SyntaxKind.SyntaxList && node.getStart(file) >= start && node.end <= end) within.push(node)
    else node.getChildren(file).forEach(visit)
  }
  visit(file)
  if (within.length === 0) throw new Unreadable('a recorded text is not where the bundle was said to hold it')
  return within
}

/**
 * Where the bundle binds `name` for code at the first of `anchors` that can see a binding of it: the place of a
 * recorded text a reader wrote other than the bundle spells it (a constant put in by value), found by the name it
 * declares rather than by its text.
 */
export function placeOf(bundle: Bundle, anchors: readonly number[], name: string): { readonly at: number; readonly length: number } {
  for (const anchor of anchors) {
    const module = bundle.moduleAt(anchor)
    const file = bundle.fileOf(module)
    const definition = unlessUnreadable(() => definitionOf(bundle, module, innermostAt(file, anchor - module.start), name))
    if (definition === undefined) continue
    const at = definition.module.start + definition.node.getStart(bundle.fileOf(definition.module))
    return { at, length: definition.module.start + definition.node.end - at }
  }
  throw new Unreadable(`no recorded place binds ${name}`)
}

/** What `read` returns, or undefined when what it reads is unreadable; any other error is thrown on. */
function unlessUnreadable<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch (error) {
    if (error instanceof Unreadable) return undefined
    throw error
  }
}

/** The innermost node of `file` that holds `at`. */
function innermostAt(file: ts.SourceFile, at: number): ts.Node {
  let node: ts.Node = file
  for (;;) {
    const inner: ts.Node | undefined = node.getChildren(file).find((child) => child.getStart(file) <= at && at < child.end)
    if (inner === undefined) return node
    node = inner
  }
}

