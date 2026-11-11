// A test file removes a temporary tree only through the one removal that retries (martha#272).
//
// This exists because the same red has now been filed twice. A test that starts a member, a relay or a child has a
// process that may still be writing inside its temporary home when the test ends, and `rmSync(…, { recursive: true,
// force: true })` — which is how temporary trees are cleared all over the suite — can then fail with ENOTEMPTY
// (errno 39): the home gained an entry between the remove reading it and removing it. martha#216 closed one file;
// the next sighting was `start_a_member.node-test.ts`, and a fix that touches only that file leaves the same
// unretried remove in every other one.
//
// So the rule is one line: a test file removes its tree through `removeTheTree`, which retries a bounded number of
// times, and never by calling the filesystem's own remove. This check states the rule over every test file in the
// suite and names each file and line that breaks it, so the drift is answered where it is written rather than by
// another report of a red run.
//
// It reads the syntax tree (parse_a_source.ts), so a `rmSync(` inside a string, a comment or a planted fixture is
// text, and a call split over lines is still a call. It judges by name and by the `recursive: true` that makes the
// removal a tree's: a test that removes one file with `rmSync(path)` is left alone, since no writer can add an entry
// to a file.

import { dirname, join, normalize } from 'node:path'

import ts from 'typescript'

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { lineOf, nodesOf, parseSource } from './parse_a_source.ts'

/** The one removal a test file may use: it opens up a read-only folder and retries while a writer is still there. */
export const THE_REMOVAL_THAT_RETRIES = 'removeTheTree'

/** The filesystem's own removals, which a test file may not call: neither retries. */
export const REMOVALS_WITHOUT_A_RETRY = ['rmSync', 'rm'] as const

/** The module those are taken from, wherever a test file reaches it. */
const NODE_FS = 'node:fs'

/** How a test file is recognised, by the name the suite runs. */
const IS_A_TEST_FILE = /\.node-test\.(?:ts|mts|mjs)$/

export interface RemovalWithoutARetry {
  /** Path relative to the repository. */
  readonly path: string
  readonly line: number
  readonly why: string
}

/** What a call is called, by the rightmost name: `rmSync`, `fs.rmSync` and `fs['rmSync']` are one removal. */
function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
    return expression.argumentExpression.text
  }
  return null
}

/** Whether an argument is an object literal that asks for a tree: `recursive: true`. */
const removesATree = (argument: ts.Expression): boolean =>
  ts.isObjectLiteralExpression(argument) &&
  argument.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) ? property.name.text : '') === 'recursive' &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  )

/** The bindings one import statement declares; none when it binds no names. */
const bindingsOf = (node: ts.ImportDeclaration): readonly ts.ImportSpecifier[] => {
  const bindings = node.importClause?.namedBindings
  return bindings !== undefined && ts.isNamedImports(bindings) ? [...bindings.elements] : []
}

/** Whether an import takes from `node:fs`, or from `node:fs/promises`. */
const takesFromNodeFs = (file: ts.SourceFile, node: ts.ImportDeclaration): boolean =>
  node.moduleSpecifier.getText(file).replaceAll(/['"]/g, '').startsWith(NODE_FS)

const namesOneOfTheRemovals = (element: ts.ImportSpecifier): boolean =>
  (REMOVALS_WITHOUT_A_RETRY as readonly string[]).includes(element.propertyName?.text ?? element.name.text)

/** The names a test file takes from `node:fs`, so an aliased import is judged as what it imports. */
const removalNamesTaken = (file: ts.SourceFile): ReadonlyMap<string, string> =>
  new Map(
    nodesOf(file)
      .filter((node): node is ts.ImportDeclaration => ts.isImportDeclaration(node) && takesFromNodeFs(file, node))
      .flatMap(bindingsOf)
      .filter(namesOneOfTheRemovals)
      .map((element) => [element.name.text, element.propertyName?.text ?? element.name.text] as const),
  )

// A removal whose failure is asserted is an expectation, not a teardown: the test is proving that the plain removal
// does not work on that tree (a read-only relay copy, #117), so it is not asked to.
const isAnExpectedFailure = (node: ts.Node): boolean => {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isCallExpression(at) && calleeName(at.expression) === 'throws') return true
  }
  return false
}

// Why one node removes a tree without a retry; null when it does not.
function removalWhy(node: ts.Node, taken: ReadonlyMap<string, string>): string | null {
  if (!ts.isCallExpression(node)) return null
  const name = calleeName(node.expression)
  if (name === null || name === THE_REMOVAL_THAT_RETRIES) return null
  const imported = taken.get(name) ?? name
  if (!(REMOVALS_WITHOUT_A_RETRY as readonly string[]).includes(imported)) return null
  if (!node.arguments.some((argument) => removesATree(argument))) return null
  if (isAnExpectedFailure(node)) return null
  return `${imported}(…, { recursive: true }) removes a tree with no retry: call ${THE_REMOVAL_THAT_RETRIES}, which retries while something is still writing in it (martha#272)`
}

/** Every removal of a tree in one test source that does not go through the removal that retries. */
function findingsIn(source: CoreSource): RemovalWithoutARetry[] {
  const { file } = parseSource(source.text, source.path)
  const taken = removalNamesTaken(file)
  return nodesOf(file).flatMap((node) => {
    const why = removalWhy(node, taken)
    return why === null ? [] : [{ path: source.path, line: lineOf(file, node), why }]
  })
}

/** Every test file among these sources that removes a tree without the bounded retry, with its line and the call. */
export function removalsWithoutARetry(sources: readonly CoreSource[]): RemovalWithoutARetry[] {
  return sources
    .filter((source) => IS_A_TEST_FILE.test(source.path))
    .flatMap(findingsIn)
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
}

// --- the one removal keeps its retry ---------------------------------------------------

/** Where the one removal is defined, and the constants that bound it. */
export const THE_ONE_REMOVAL = 'src/launch_a_claude_code_member/relay_copy.ts'

/** The removal the whole suite goes through. */
const THE_REMOVAL = 'removeTheTree'

/**
 * The options that removal's own `rmSync` must carry, each naming the constant that bounds it. Named here so a reader of
 * this check and a reader of that file read the same two names, and so losing one is a failure with a name rather than a
 * file that quietly stops retrying.
 */
export const THE_RETRY_OPTIONS: readonly (readonly [string, string])[] = [
  ['maxRetries', 'REMOVAL_ATTEMPTS'],
  ['retryDelay', 'REMOVAL_DELAY_MS'],
]

export interface RemovalWithoutItsRetry {
  readonly path: string
  readonly line: number
  readonly why: string
}

const isPositiveWholeNumber = (node: ts.Expression): boolean =>
  ts.isNumericLiteral(node) && Number.isInteger(Number(node.text)) && Number(node.text) > 0

/** The names one import statement binds, and the module it takes them from. */
const importSpecifiersOf = (file: ts.SourceFile): readonly { readonly name: string; readonly from: string }[] =>
  nodesOf(file)
    .filter((node): node is ts.ImportDeclaration => ts.isImportDeclaration(node))
    .flatMap((node) =>
      bindingsOf(node).map((element) => ({
        name: element.name.text,
        from: node.moduleSpecifier.getText(file).replaceAll(/['"]/g, ''),
      })),
    )

/**
 * The source holding the constant the removal's file uses: that file itself when it declares the constant there, and
 * otherwise the module its own import names. A constant of the same name declared elsewhere is another constant, and is
 * not read (martha#272 r=2).
 */
function declaringSourceOf(
  sources: readonly CoreSource[],
  removalFile: CoreSource,
  name: string,
): { readonly source: CoreSource } | { readonly missing: string } {
  const { file } = parseSource(removalFile.text, removalFile.path)
  const declared = nodesOf(file).some(
    (node) => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name,
  )
  if (declared) return { source: removalFile }
  const imported = importSpecifiersOf(file).find((binding) => binding.name === name)
  if (imported === undefined) {
    return { missing: `${name} is neither declared in ${THE_ONE_REMOVAL} nor imported by it: the retry has no bound to read` }
  }
  const target = normalize(join(dirname(THE_ONE_REMOVAL), imported.from))
  const found = sources.find((candidate) => candidate.path === target || candidate.path === `${target}.ts`)
  return found === undefined
    ? { missing: `${name} is imported from ${imported.from}, which is not among these sources: the retry's bound cannot be read` }
    : { source: found }
}

/** Why a bounding constant does not bound anything, or is not there at all. */
function boundWhy(
  sources: readonly CoreSource[],
  removalFile: CoreSource,
  name: string,
): RemovalWithoutItsRetry[] {
  const where = declaringSourceOf(sources, removalFile, name)
  if ('missing' in where) return [{ path: THE_ONE_REMOVAL, line: 1, why: where.missing }]
  const { source } = where
  const { file } = parseSource(source.text, source.path)
  const declaration = nodesOf(file).find(
    (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name,
  )
  if (declaration === undefined) {
    return [{ path: source.path, line: 1, why: `${name} is not declared here: the retry has no bound to read` }]
  }
  const { initializer } = declaration
  if (initializer !== undefined && isPositiveWholeNumber(initializer)) return []
  return [
    {
      path: source.path,
      line: lineOf(file, declaration),
      why: `${name} is not a positive whole number: a retry bounded by it never retries`,
    },
  ]
}

/** Every `rmSync` the removal's file makes: each one is a removal, and each one must carry the bounded retry. */
const theRemovalFilesCalls = (file: ts.SourceFile): readonly ts.CallExpression[] =>
  nodesOf(file).filter(
    (node): node is ts.CallExpression => ts.isCallExpression(node) && calleeName(node.expression) === 'rmSync',
  )

const namesIt = (property: ts.PropertyAssignment, option: string): boolean =>
  (ts.isIdentifier(property.name) ? property.name.text : '') === option

/** The retry options the removal's own call does not name, or names with something other than its bounding constant. */
const unbounded = (call: ts.CallExpression): readonly (readonly [string, string])[] => {
  const options = call.arguments.find((argument): argument is ts.ObjectLiteralExpression =>
    ts.isObjectLiteralExpression(argument),
  )
  return THE_RETRY_OPTIONS.filter(([option, constant]) => {
    const property = options?.properties.find(
      (candidate): candidate is ts.PropertyAssignment => ts.isPropertyAssignment(candidate) && namesIt(candidate, option),
    )
    return property === undefined || !ts.isIdentifier(property.initializer) || property.initializer.text !== constant
  })
}

/** Every way the one removal fails to keep its bounded retry, with the file and line of the thing that is wrong. */
export function removalsWithoutTheirRetry(sources: readonly CoreSource[]): RemovalWithoutItsRetry[] {
  const source = sources.find((candidate) => candidate.path === THE_ONE_REMOVAL)
  if (source === undefined) {
    return [{ path: THE_ONE_REMOVAL, line: 1, why: `the one removal is not in these sources` }]
  }
  const { file } = parseSource(source.text, source.path)
  const calls = theRemovalFilesCalls(file)
  const findings =
    calls.length === 0
      ? THE_RETRY_OPTIONS.map(([option, constant]) => ({
          path: source.path,
          line: 1,
          why: `${THE_REMOVAL}'s own removal is not in ${THE_ONE_REMOVAL}, so it does not carry ${option}: ${constant}, and never retries (martha#272)`,
        }))
      : calls.flatMap((call) =>
          unbounded(call).map(([option, constant]) => ({
            path: source.path,
            line: lineOf(file, call),
            why: `${THE_REMOVAL}'s own removal does not carry ${option}: ${constant}, so it never retries (martha#272)`,
          })),
        )
  return [...findings, ...THE_RETRY_OPTIONS.flatMap(([, constant]) => boundWhy(sources, source, constant))].sort(
    (a, b) => a.line - b.line,
  )
}
