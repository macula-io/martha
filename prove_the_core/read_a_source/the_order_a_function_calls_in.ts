// The order a function calls things in, read from its source as a syntax tree (martha#659).
//
// The dry release harness (rehearse_a_release/place_main_as_a_dry_release/dry_release.mjs) runs the installer's own
// steps in installRelease's order. It holds a copy of that order, and a copy drifts: an installer that moves a step
// would turn nothing red. So the order is read here, from installRelease's source and from the harness's, and
// ./the_dry_release_runs_the_installers_order.node-test.ts compares the two, never a list typed by hand.
//
// The order is the order the calls run in, not the order they are written in:
//   - an argument that is a call runs before the call it is passed to: `f(g())` is g, then f;
//   - an argument that is a function runs inside the call: `place({ unpack: () => u() })` is place, then u;
//   - a call of a function named in `inline` is replaced by that function's own order, where it is called.
// A callee is named by its last part, so `steps.swapLink(...)` and `swapLink(...)` are both swapLink.
//
// This folder is outside src/, the core, on purpose: it imports the TypeScript compiler, a package the core itself may
// never import.

import ts from 'typescript'

import { parseSource } from './parse_a_source.ts'

/** A callee's name: an identifier, or the last part of a property access; undefined for anything else. */
const calleeName = (callee: ts.Expression): string | undefined => {
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return undefined
}

/** Whether a node is a function written in place, whose body runs when something calls it. */
const isAFunction = (node: ts.Node): boolean => ts.isArrowFunction(node) || ts.isFunctionExpression(node)

/** Every function written in place inside an argument: the bodies a call runs, not its caller. */
const functionsIn = (node: ts.Node): ts.Node[] => {
  if (isAFunction(node)) return [node]
  const found: ts.Node[] = []
  ts.forEachChild(node, (child) => {
    found.push(...functionsIn(child))
  })
  return found
}

/** What a function taken in runs, or undefined for a call that is not taken in. */
type Inlined = (name: string) => string[] | undefined

/** The names of the calls `node` runs, in the order they run. In a call's arguments a function runs later, not now. */
function callsIn(node: ts.Node, inlined: Inlined, inArguments = false): string[] {
  if (inArguments && isAFunction(node)) return []
  if (!ts.isCallExpression(node)) {
    const calls: string[] = []
    ts.forEachChild(node, (child) => {
      calls.push(...callsIn(child, inlined, inArguments))
    })
    return calls
  }
  const name = calleeName(node.expression)
  const before = [...callsIn(node.expression, inlined), ...node.arguments.flatMap((argument) => callsIn(argument, inlined, true))]
  const during = node.arguments.flatMap(functionsIn).flatMap((fn) => callsIn(fn, inlined))
  const itself = name === undefined ? [] : (inlined(name) ?? [name])
  return [...before, ...itself, ...during]
}

/** The body of the function declared as `name` at the top of `file`; refused when there is none. */
function bodyOf(file: ts.SourceFile, name: string): ts.Block {
  const declared = file.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
  if (declared?.body === undefined) throw new Error(`no function ${name} is declared in ${file.fileName}`)
  return declared.body
}

/**
 * The names of the calls the function `name` declared in `text` runs, in the order they run, with each function named
 * in `inline` (declared in the same text) replaced by its own order. A function that is not declared there is refused,
 * so a renamed function is never read as one that calls nothing.
 */
export function callOrderIn(text: string, path: string, name: string, inline: readonly string[] = []): string[] {
  const { file } = parseSource(text, path)
  const inlined: Inlined = (called) => (inline.includes(called) ? callsIn(bodyOf(file, called), inlined) : undefined)
  return callsIn(bodyOf(file, name), inlined)
}

/** Every name `text` imports from a module whose specifier starts with `from`, in the order the source holds them. */
export function namesImportedFrom(text: string, path: string, from: string): string[] {
  const { file } = parseSource(text, path)
  return file.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    if (!statement.moduleSpecifier.text.startsWith(from)) return []
    const bindings = statement.importClause?.namedBindings
    return bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements.map((element) => (element.propertyName ?? element.name).text) : []
  })
}

/** The names in `order` that are in `steps`, each at its first call: the order of the steps alone. */
export const stepsIn = (order: readonly string[], steps: readonly string[]): string[] => [...new Set(order.filter((name) => steps.includes(name)))]
