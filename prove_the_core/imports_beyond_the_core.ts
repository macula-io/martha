// The core reaches a coding tool only through the host contract.
//
// So a file may import three kinds of thing: other code of this repository, by a
// relative path; Node's standard library, by a `node:` specifier; and a package
// package.json allows (martha.packageImports), from inside the one folder it names.
// Anything else is a package, and a package in the core is how a coding tool's API
// would creep in past the contract. Rather than keep a list of tool packages to
// refuse, which goes stale the day a tool renames its SDK, this check allows those
// kinds and names everything else, with its file and line.
//
// The imports come from the syntax tree (parse_a_source.ts), so an import written
// inside a string or a comment is text, and a real import split over lines is
// still an import. Types count: a type-only import, a JSDoc `import('x')` or
// `@import`, and a `/// <reference types="x" />` couple code to a tool as surely
// as a value does.
//
// A module loaded by a name the check cannot read is named too, with specifier
// null: the core has no reason to load a module by a name it builds at runtime.
// That covers an import or require whose name is computed, Node's modules that load
// others by name (module's createRequire, vm) with or without `node:`, any reach
// for process.getBuiltinModule, eval and Function used at all (text they run can
// import anything), and require reached other than by a direct call (held in a
// variable, called through .call, a comma or parentheses, or as module.require). A
// file that does not parse is named, since nothing in it can be judged.
//
// What it catches is mistakes and plain reaches, not code written to get past it;
// review guards against that. A key built at run time (`process[name]` where name
// spells getBuiltinModule) never appears in the tree.

import { sep } from 'node:path'

import ts from 'typescript'

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { isUsedAsAValue, lineOf, moduleReferencesIn, nodesOf, parseSource, type ModuleReference } from './parse_a_source.ts'

export interface ImportBeyondTheCore {
  /** Path relative to the repository. */
  readonly path: string
  readonly line: number
  /** The module as written; null when no module name can be read. */
  readonly specifier: string | null
  readonly why: string
}

export const COMPUTED = 'imports a module whose name is computed'
export const LOADS_BY_NAME = 'which loads any module by a name'
export const RUNS_TEXT = 'which runs text as code'
export const CALLS_REQUIRE_INDIRECTLY = 'reaches require other than by calling it directly'

const NODE_MODULE = 'node:'

/** Node's modules that load another module by a name given at run time. */
export const NODE_MODULES_THAT_LOAD_BY_NAME = ['module', 'vm'] as const

/** The member of process that hands out any of Node's modules by name. */
export const GETS_A_BUILTIN = 'getBuiltinModule'

/** The globals that run text as code. */
export const RUN_TEXT_AS_CODE = ['eval', 'Function'] as const

const REQUIRE = 'require'

const isOwnOrNode = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith(NODE_MODULE)

const loadsByName = (specifier: string): boolean =>
  (NODE_MODULES_THAT_LOAD_BY_NAME as readonly string[]).includes(
    specifier.startsWith(NODE_MODULE) ? specifier.slice(NODE_MODULE.length) : specifier,
  )

const folderOf = (path: string): string => path.split(sep)[0] ?? ''

function referenceFinding(path: string, packages: Readonly<Record<string, string>>, reference: ModuleReference): ImportBeyondTheCore[] {
  const { specifier, line } = reference
  if (specifier === null) return [{ path, line, specifier, why: COMPUTED }]
  if (loadsByName(specifier)) return [{ path, line, specifier, why: `imports ${specifier}, ${LOADS_BY_NAME}` }]
  if (isOwnOrNode(specifier) || packages[specifier] === folderOf(path)) return []
  return [{ path, line, specifier, why: `imports ${specifier}` }]
}

// The name a node gives: an identifier, or a string used as a key
// (`process['getBuiltinModule']`, `{ 'getBuiltinModule': g } = process`).
function nameGiven(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return null
  const parent = node.parent
  const isKey =
    (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node)
  return isKey ? node.text : null
}

// A name that reads a member of an object: `.x`, `['x']`, `{ x: y } = o` or `{ x } = o`.
const readsAMember = (node: ts.Node): boolean => {
  if (!ts.isIdentifier(node)) return true
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node
  return ts.isBindingElement(parent) && ts.isObjectBindingPattern(parent.parent) &&
    (parent.propertyName === node || (parent.propertyName === undefined && parent.name === node))
}

const isCalledDirectly = (node: ts.Node): boolean => ts.isCallExpression(node.parent) && node.parent.expression === node

// Why a node loads a module by a name the check cannot read; null when it does not.
function loaderWhy(node: ts.Node): string | null {
  const name = nameGiven(node)
  if (name === null) return null
  if (name === GETS_A_BUILTIN) return `uses ${GETS_A_BUILTIN}, ${LOADS_BY_NAME}`
  if (!readsAMember(node) && !(ts.isIdentifier(node) && isUsedAsAValue(node))) return null
  if ((RUN_TEXT_AS_CODE as readonly string[]).includes(name)) return `uses ${name}, ${RUNS_TEXT}`
  if (name === REQUIRE && !isCalledDirectly(node)) return CALLS_REQUIRE_INDIRECTLY
  return null
}

function findingsIn(source: CoreSource, packages: Readonly<Record<string, string>>): ImportBeyondTheCore[] {
  const { path } = source
  const { file, errors } = parseSource(source.text, path)
  return [
    ...errors.map(({ line, message }) => ({ path, line, specifier: null, why: `does not parse: ${message}` })),
    ...moduleReferencesIn(file).flatMap(reference => referenceFinding(path, packages, reference)),
    ...nodesOf(file).flatMap(node => {
      const why = loaderWhy(node)
      return why === null ? [] : [{ path, line: lineOf(file, node), specifier: null, why }]
    }),
  ].sort((a, b) => a.line - b.line)
}

/**
 * Every import in these sources (paths relative to the repository) that is not
 * the repository's own code, not Node's, and not a package `packages` allows in
 * the source's folder, and every load of a module by a name that cannot be read.
 */
export function importsBeyondTheCore(
  sources: readonly CoreSource[],
  packages: Readonly<Record<string, string>>,
): ImportBeyondTheCore[] {
  return sources.flatMap(source => findingsIn(source, packages))
}
