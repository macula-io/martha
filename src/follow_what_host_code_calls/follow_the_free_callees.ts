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
// exports it. The chase stops at a global (compare_under_renaming.ts's list), but only where no scope of the bundle
// binds that name: a module that declares its own `require` has it followed like any other name.
//
// Two depths, as Raf ruled on martha#811 (DECIDED 2026-11-19 "A: full on guards, 1 level on loaders (Recommended)"):
// the full chase follows each recorded definition's own callees in turn until none is left; one level records the
// text's direct callees and follows nothing further, so their own callees stay inside their text, renamed. A name
// already recorded is never recorded twice: its entry is reused, which ends cycles.
//
// A name the bundle binds nowhere, or in two ways in one scope, cannot be told, and the field is unreadable. So is a
// recorded binding written after it is declared in any way but the one lazy init a bundle uses (`var X;` then plain
// `X=...`): a later `X=b` over a value, a compound or logical assignment, an increment, a destructuring target or a
// loop's own target would change what the name holds while its recorded text read the same.
//
// One shape of later write is read: a setter slot, a binding declared with a value whose every later write is a plain
// `X=p` that is the whole body of a function of one parameter `p` (the host's `var b=()=>{return};function tLl(e){b=e}`,
// exported as setSessionOverridesGetter). The default and each setter's text are recorded, so a changed default or a
// changed setter differs. Every call of a setter the bundle itself makes, by its own name or by a name another module
// imports it under, is the host's own code: the call is recorded and its one value followed, as a lazy init's value is
// (the host's `Nml({isDiskless:()=>J(),...})` sets `var r={isDiskless:()=>!1,...};function Nml(o){r=o}`). A setter the
// bundle refers to in any other way, passed as a value or called with other than one value, is unreadable. What an
// embedder passes through a setter the host exports publicly is outside the bundle and is not followed: an accepted
// residual of #139, as Supervisor ruled on martha#811 r=1 by Raf's r=3 words, beside callbacks passed as values.
//
// The index reads a bundle's import and export lists. A setter exported where it is declared is followed through its
// importers like one an export list names. A module of the bundle imported at run time (`import("/$bunfs/…")`) is past
// the index: code the chase reads that does it, or a setter exported under a name a run-time importer names, is
// unreadable, naming it (martha#811 r=2).

import ts from 'typescript'

import { CHUNK } from '../cut_the_rules_from_the_host_binary/protected_config_places.ts'
import { GLOBALS, readsAValue, Unreadable } from '../compare_two_host_recordings/compare_under_renaming.ts'
import { bindingsInStatement, bindsDirectly, bindsHere, namesBoundBy, scopeOf } from '../compare_two_host_recordings/the_scopes_of_a_text.ts'
import type { Depth, GuardCalls } from '../compare_two_host_recordings/what_a_recorded_text_calls.ts'

/** The path a module of the bundle imports another of its modules by. */
const BUNDLE_PATH = '/$bunfs/'
/** How a module imports another at run time, past the import lists the bundle's index reads. */
const DYNAMIC_IMPORT = 'import('
/** The mark a CommonJS module carries after the chunk mark: it exports through `module.exports`, never an `export{}`. */
const COMMON_JS = '@bun-cjs'

interface Module {
  readonly start: number
  readonly text: string
  file?: ts.SourceFile
  /** Every write to a name in the module, by the name, read once. */
  writes?: ReadonlyMap<string, readonly AWrite[]>
}

/**
 * One write to a name: the name as written, and the expression that writes it. Only `plain`, `X=...`, can be the
 * lazy init of a binding declared bare; every other kind is a write the follower does not read.
 */
interface AWrite {
  readonly name: ts.Identifier
  readonly kind: 'plain' | 'compound' | 'update' | 'destructuring' | 'loop target'
  readonly node: ts.Node
}

/** One definition the chase reached: where it is, what it binds, its text as recorded, and what is assigned to it later. */
interface Definition {
  readonly module: Module
  readonly node: ts.Node
  readonly text: string
  readonly assigned: readonly ts.BinaryExpression[]
  /** Each value the bundle passes to a setter of the binding, where it is: followed as an assigned value is. */
  readonly passed: readonly Passed[]
}

/** One value the bundle passes to a setter: its module, the value, where it starts there, and the call's text. */
interface Passed {
  readonly module: Module
  readonly value: ts.Expression
  readonly start: number
  readonly call: string
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

  /** Each module that imports `name` from the bundle's own modules, and its local name there; read the first time it is asked. */
  importersOf(name: string): ReadonlyArray<{ readonly module: Module; readonly local: string }> {
    this.#importers ??= this.#noteTheImports()
    return this.#importers.get(name) ?? []
  }

  #importers: Map<string, Array<{ readonly module: Module; readonly local: string }>> | undefined

  /**
   * Whether a module that imports a module at run time (`import(…)`) names `name` where a property is read or taken
   * apart (`.name`, `{name`, `"name"`). Such a module reaches an export the import lists never show, so a setter exported
   * under that name could be called where the follower does not look. Read from the text, so it errs toward refusing.
   */
  namedAtRunTime(name: string): boolean {
    const named = new RegExp(`[.{,"'\`]${name.replace(/[$]/g, '\\$&')}(?![\\w$])`)
    return this.#modules.some((module) => module.text.includes(DYNAMIC_IMPORT) && named.test(module.text))
  }

  /** Each name an `import{}` from the bundle lists, by the name it imports, with the module and its local name there. */
  #noteTheImports(): Map<string, Array<{ readonly module: Module; readonly local: string }>> {
    const found = new Map<string, Array<{ readonly module: Module; readonly local: string }>>()
    const IMPORT_LIST = new RegExp(`import\\{([^}]*)\\}from"${BUNDLE_PATH.replace(/[$/]/g, '\\$&')}`, 'g')
    const listed = this.#modules.flatMap((module) =>
      [...module.text.matchAll(IMPORT_LIST)].flatMap((match) => pairsOf(match[1] ?? '').map(([imported, local]) => ({ imported, module, local }))),
    )
    for (const { imported, module, local } of listed) found.set(imported, [...(found.get(imported) ?? []), { module, local }])
    return found
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

/** Whether an operator assigns: `=`, or one of the compound and logical forms (`+=`, `??=`, `||=` and the rest). */
const isAnAssignment = (kind: ts.SyntaxKind): boolean => kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment

/** The names a destructuring target writes: `[X]`, `{X}`, `{a:X}`, `[X=1]`, `[...X]`, nested at any depth. */
function targetsOf(target: ts.Expression): ts.Identifier[] {
  if (ts.isIdentifier(target)) return [target]
  if (ts.isParenthesizedExpression(target)) return targetsOf(target.expression)
  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) return targetsOf(target.left)
  if (ts.isSpreadElement(target) || ts.isSpreadAssignment(target)) return targetsOf(target.expression)
  if (ts.isArrayLiteralExpression(target)) return target.elements.flatMap(targetsOf)
  if (ts.isObjectLiteralExpression(target)) {
    return target.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return [property.name]
      if (ts.isPropertyAssignment(property)) return targetsOf(property.initializer)
      if (ts.isSpreadAssignment(property)) return targetsOf(property.expression)
      return []
    })
  }
  return []
}

/** The writes an assignment makes: a plain or compound one to a name, or a destructuring's names. */
function writesOfAnAssignment(node: ts.BinaryExpression): AWrite[] {
  const plain = node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  if (ts.isIdentifier(node.left)) return [{ name: node.left, kind: plain ? 'plain' : 'compound', node }]
  return plain ? targetsOf(node.left).map((name) => ({ name, kind: 'destructuring' as const, node })) : []
}

/** Whether a node is `++` or `--`, before or after its operand. */
const isAnUpdate = (node: ts.Node): node is ts.PrefixUnaryExpression | ts.PostfixUnaryExpression =>
  (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)

/** Whether a node is a for-in or for-of loop whose target is a name already bound, not one it declares. */
const isALoopOverABinding = (node: ts.Node): node is ts.ForOfStatement | ts.ForInStatement =>
  (ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer)

/** The writes one node makes to a name, of each kind: an assignment, an increment, a destructuring, a loop's own target. */
function writesBy(node: ts.Node): AWrite[] {
  if (ts.isBinaryExpression(node) && isAnAssignment(node.operatorToken.kind)) return writesOfAnAssignment(node)
  if (isAnUpdate(node)) return targetsOf(node.operand).map((name) => ({ name, kind: 'update' as const, node }))
  if (isALoopOverABinding(node)) return targetsOf(node.initializer as ts.Expression).map((name) => ({ name, kind: 'loop target' as const, node }))
  return []
}

/** Every write to a name in a module, by the name, in source order. */
function writesIn(module: Module, file: ts.SourceFile): ReadonlyMap<string, readonly AWrite[]> {
  if (module.writes !== undefined) return module.writes
  const found = new Map<string, AWrite[]>()
  const visit = (node: ts.Node): void => {
    for (const write of writesBy(node)) found.set(write.name.text, [...(found.get(write.name.text) ?? []), write])
    ts.forEachChild(node, visit)
  }
  visit(file)
  module.writes = found
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

/** The node a function's whole body would be if it were `assignment` alone: its block when it is the block's one statement. */
function theBodyAround(assignment: ts.BinaryExpression): ts.Node {
  const statement = assignment.parent
  return ts.isExpressionStatement(statement) && ts.isBlock(statement.parent) && statement.parent.statements.length === 1 ? statement.parent : assignment
}

/** Whether a function takes one plain parameter named `name`: no other, no default, no rest. */
function takesOnly(setter: ts.SignatureDeclaration, name: string): boolean {
  const [only, ...more] = setter.parameters
  if (only === undefined || more.length > 0) return false
  return only.dotDotDotToken === undefined && only.initializer === undefined && ts.isIdentifier(only.name) && only.name.text === name
}

/** A function whose whole body is `write`, a plain `X=p` with `p` its one parameter: a setter; otherwise undefined. */
function setterOf(write: AWrite): ts.SignatureDeclaration | undefined {
  if (write.kind !== 'plain' || !ts.isBinaryExpression(write.node) || !ts.isIdentifier(write.node.right)) return undefined
  const body = theBodyAround(write.node)
  const setter = body.parent
  const isAFunction = ts.isFunctionDeclaration(setter) || ts.isFunctionExpression(setter) || ts.isArrowFunction(setter)
  return isAFunction && setter.body === body && takesOnly(setter, write.node.right.text) ? setter : undefined
}

/** What is written to a recorded variable after its declaration: lazy assignments, or the setters of a setter slot. */
interface LaterWrites {
  readonly assigned: readonly ts.BinaryExpression[]
  readonly setters: readonly ts.SignatureDeclaration[]
}

/**
 * The assignments to a variable declared with no value, such as a bundle's lazily set module binding (`var X;` and,
 * in the module's init function, `X=...`): those in its module whose name is that same binding, in source order. Any
 * other write to the binding (to one declared with a value, or of any kind but a plain `=`) is unreadable, naming it.
 */
function assignedTo(declaration: ts.VariableDeclaration, scope: ts.Node, module: Module, file: ts.SourceFile): LaterWrites {
  const writes = namesBoundBy(declaration.name).flatMap((name) => (writesIn(module, file).get(name) ?? []).filter((write) => bindsTheSame(write.name, scope)))
  const lazy = declaration.initializer === undefined && ts.isIdentifier(declaration.name)
  const setters = lazy ? [] : writes.map(setterOf)
  if (writes.length > 0 && setters.length === writes.length && setters.every((setter) => setter !== undefined)) return { assigned: [], setters }
  const unread = writes.find((write) => !lazy || write.kind !== 'plain')
  if (unread !== undefined) {
    throw new Unreadable(`a binding the host's code reaches, ${unread.name.text}, is written after it is declared (${unread.kind}: ${unread.node.getText(file).slice(0, 80)})`)
  }
  return { assigned: writes.map((write) => write.node as ts.BinaryExpression), setters: [] }
}

/** That a function or class declaration's name is never written later, the same rule as a variable declared with a value. */
function neverWritten(name: string, scope: ts.Node, module: Module, file: ts.SourceFile): void {
  const unread = (writesIn(module, file).get(name) ?? []).find((write) => bindsTheSame(write.name, scope))
  if (unread !== undefined) {
    throw new Unreadable(`a binding the host's code reaches, ${name}, is written after it is declared (${unread.kind}: ${unread.node.getText(file).slice(0, 80)})`)
  }
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
    return theDefinitionIn(only, { bundle, module, file, scope, name })
  }
  throw new Unreadable(`a recorded text calls ${name}, which the host's bundle binds nowhere (at ${String(module.start + from.getStart(file))})`)
}

/** A binding the chase reached in its own module, with every later write to it read, or unreadable as assignedTo says. */
function theDefinitionIn(
  only: ts.Node | { readonly import: ts.ImportDeclaration; readonly binding: ts.Node },
  where: { readonly bundle: Bundle; readonly module: Module; readonly file: ts.SourceFile; readonly scope: ts.Node; readonly name: string },
): Definition {
  const { bundle, module, file, scope, name } = where
  if ('import' in only) return { module, node: only.binding, text: definitionText(only, file), assigned: [], passed: [] }
  if (!ts.isVariableDeclaration(only)) neverWritten(name, scope, module, file)
  const { assigned, setters } = ts.isVariableDeclaration(only) ? assignedTo(only, scope, module, file) : { assigned: [], setters: [] }
  const passed = setters.flatMap((setter) => valuesPassedTo(bundle, module, setter))
  const text = valuedText(definitionText(only, file), assigned, file) + [...setters.map((setter) => setter.getText(file)), ...passed.map(({ call }) => call)].map((each) => `;${each}`).join('')
  return { module, node: only, text, assigned, passed }
}

/** The name a setter is bound by: a function declaration's, or the variable its value is; a setter with none cannot be followed. */
function setterNameOf(setter: ts.SignatureDeclaration): ts.Identifier {
  if (ts.isFunctionDeclaration(setter) && setter.name !== undefined) return setter.name
  const { parent } = setter
  if (ts.isVariableDeclaration(parent) && parent.initializer === setter && ts.isIdentifier(parent.name)) return parent.name
  throw new Unreadable(`a setter of a binding the host's code reaches is bound by no name its calls can be found by`)
}

/** The scope that binds a name, from where it is declared outward. */
function scopeBinding(declared: ts.Identifier): ts.Node {
  for (let scope: ts.Node | undefined = declared.parent; scope !== undefined; scope = scope.parent) if (bindsHere(scope, declared.text)) return scope
  throw new Unreadable(`no scope of the host binds ${declared.text}`)
}

/** Every value the bundle passes to `setter`, in its own module and in each module that imports it. */
function valuesPassedTo(bundle: Bundle, module: Module, setter: ts.SignatureDeclaration): Passed[] {
  const name = setterNameOf(setter)
  const seen = new Set<string>()
  const passed = passedThrough(bundle, { module, file: bundle.fileOf(module), scope: scopeBinding(name), name: name.text }, seen)
  // A setter exported where it is declared (`export function S…`) is exported under its own name.
  const exportedInline = (ts.getCombinedModifierFlags(name.parent as ts.Declaration) & ts.ModifierFlags.Export) !== 0
  return exportedInline ? [...passed, ...passedThroughTheName(bundle, name.text, seen)] : passed
}

/** Each identifier of a module's tree spelled `name`. */
function identifiersNamed(file: ts.SourceFile, name: string): ts.Identifier[] {
  const found: ts.Identifier[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/**
 * The values passed to a setter bound by `name` in `scope`: each one-value call of it, and through each name it is
 * exported under, each module importing it. Any other reference is unreadable, naming it. `seen` ends export cycles.
 */
function passedThrough(bundle: Bundle, where: { readonly module: Module; readonly file: ts.SourceFile; readonly scope: ts.Node; readonly name: string }, seen: Set<string>): Passed[] {
  const passed: Passed[] = []
  for (const at of identifiersNamed(where.file, where.name).filter((each) => bindsTheSame(each, where.scope))) {
    const { parent } = at
    if (ts.isExportSpecifier(parent)) passed.push(...passedThroughImporters(bundle, parent, at, seen))
    else if (readsAValue(at)) passed.push(passedBy(parent, at, where))
  }
  return passed
}

/** The values passed through each module importing a setter under the name `specifier` exports it by. */
function passedThroughImporters(bundle: Bundle, specifier: ts.ExportSpecifier, at: ts.Identifier, seen: Set<string>): Passed[] {
  return (specifier.propertyName ?? specifier.name) === at ? passedThroughTheName(bundle, specifier.name.text, seen) : []
}

/**
 * The values passed through each module importing a setter by the name it is exported under. A module that imports
 * at run time and names that name could call the setter where no import list shows it: unreadable, naming it.
 */
function passedThroughTheName(bundle: Bundle, exported: string, seen: Set<string>): Passed[] {
  if (seen.has(exported)) return []
  seen.add(exported)
  if (bundle.namedAtRunTime(exported)) {
    throw new Unreadable(`a setter of a binding the host's code reaches is exported as ${exported}, and a module that imports at run time names it`)
  }
  return bundle.importersOf(exported).flatMap(({ module, local }) => {
    const file = bundle.fileOf(module)
    return passedThrough(bundle, { module, file, scope: file, name: local }, seen)
  })
}

/** The value one reference to a setter passes: it must be the callee of a call with one value, never spread. */
function passedBy(parent: ts.Node, at: ts.Identifier, where: { readonly module: Module; readonly file: ts.SourceFile; readonly name: string }): Passed {
  const [value, ...more] = ts.isCallExpression(parent) && parent.expression === at ? parent.arguments : []
  if (value === undefined || more.length > 0 || ts.isSpreadElement(value)) {
    throw new Unreadable(`a setter of a binding the host's code reaches, ${where.name}, is used other than called with one value (${parent.getText(where.file).slice(0, 80)})`)
  }
  return { module: where.module, value, start: value.getStart(where.file), call: parent.getText(where.file) }
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

/**
 * Whether `name`, read at `from`, is a global the chase stops at: one on the list that no scope from there out to its
 * module binds. A module of the bundle that declares the name (`var require=...`) is followed instead, like any name.
 */
function isAnUnboundGlobal(from: ts.Node, name: string): boolean {
  if (!GLOBALS.has(name)) return false
  for (let scope: ts.Node | undefined = from; scope !== undefined; scope = scope.parent) {
    const { statements, parameters } = scopeOf(scope)
    if (parameters.some((parameter) => namesBoundBy(parameter.name).includes(name))) return false
    if (statements.some((statement) => (ts.isVariableDeclaration(statement) ? namesBoundBy(statement.name).includes(name) : bindingsInStatement(statement, name).length > 0))) return false
  }
  return true
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

/** The free names `node` calls, or reads at all when `every`, in the order first met; never one it declares. A global is kept: whether the bundle binds it is the chase's to tell. */
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
    if (seen.has(name.text) || declaresWithin(textStart, name, file)) return false
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
  for (const { module, value, start } of entry.passed) {
    addCalls(calls, bound(module, [value], start, !isCodeValue(value)), (name) => `a value passed to a setter of the host calls ${name}, bound two ways`)
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
    for (const node of nodes) refuseARunTimeImport(node, file)
    const names = nodes.flatMap((node) => freeNamesIn(node, file, every, textStart)).filter((name, index, all) => all.findIndex((other) => other.text === name.text) === index)
    return Object.fromEntries(names.filter((name) => !isAnUnboundGlobal(name, name.text)).map((name) => [name.text, entryOf(definitionOf(bundle, module, name, name.text))]))
  }
  const guard_calls = seed(entryOf, bound)
  if (depth === 'full') for (const entry of reached) entry.calls = calledByEntry(entry, bundle.fileOf(entry.module), bound)
  return { guard_calls, functions: reached.map(({ text, calls }) => ({ function: text, calls })) }
}

/**
 * That code the chase reads imports none of the bundle's own modules at run time (`import("/$bunfs/…")`, or a
 * specifier that is not a literal): what such an import's namespace calls is past the index, so it is unreadable,
 * naming the import. A platform module imported at run time reaches no code of the bundle.
 */
function refuseARunTimeImport(node: ts.Node, file: ts.SourceFile): void {
  const visit = (at: ts.Node): void => {
    if (ts.isCallExpression(at) && at.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = at.arguments
      const aPlatformModule = specifier !== undefined && ts.isStringLiteralLike(specifier) && !specifier.text.startsWith(BUNDLE_PATH)
      if (!aPlatformModule) throw new Unreadable(`code the host's recorded text reaches imports a module of the bundle at run time (${at.getText(file).slice(0, 80)})`)
    }
    ts.forEachChild(at, visit)
  }
  visit(node)
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
  return reach(bundle, depth, (entryOf) => Object.fromEntries(names.filter((name) => !isAnUnboundGlobal(from, name)).map((name) => [name, entryOf(definitionOf(bundle, module, from, name))])))
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

