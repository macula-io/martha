// No setting outside the declaration.
//
// A setting read in two places can disagree: one place reads the environment,
// another a home-relative path, and the crew behaves differently depending on
// which slice asked. So a slice of the running crew takes its settings from
// CrewSettings (src/declare_crew/) and from nowhere else, and it reaches the
// machine only through the host contract: files through host.stores, programs
// through host.processes.
//
// This check judges each slice's syntax tree (parse_a_source.ts), so a string, a
// comment, a regular expression or a line break does not decide what it sees. In a
// slice:
//
// - a module may be imported only when it is another slice (a relative path whose
//   target the caller's isSlice accepts) or a Node module on the allow-list
//   below. Anything else, and any module whose name is computed, is named. An
//   allow-list, because a deny-list misses the next way in (createRequire,
//   reading /proc, running a shell, or importing the host glue or a program,
//   which may do all of those). An import that is only a type is erased, so it is
//   not judged;
// - the globals through which a slice could reach the environment, the network,
//   or run text as code are named wherever they are used as a value;
// - the name `constructor`, as a property, an element key or a destructured
//   field, is named: every function's constructor is Function, so
//   `[].constructor.constructor('return process')()` reaches the environment
//   without naming a global. A class's own `constructor() {}` declaration is
//   not a use of the name, so it stays allowed;
// - a string that is a path from the home directory (`~` alone or `~/...`) is
//   named;
// - a file the parser cannot read is named, since nothing in it can be judged.
//
// What it catches is mistakes and plain reaches, not a slice written to get past
// it; reviewed code guards against that. A key computed at run time
// (`constru${''}ctor`, or a string put together by concatenation) or Function
// found by listing a prototype's own properties
// (Object.getOwnPropertyDescriptors(Object.getPrototypeOf(() => 0))) reaches
// Function without the name ever appearing in the tree. And the node:* the host
// glue may import includes node:module, whose createRequire loads any module: the
// glue's reverse rule keeps it from importing slices, not from reaching further.
//
// Which files are slices is the caller's to say: the test derives the files that
// are not (tests, the programs CI runs, and the host glue that implements the
// contract on one machine) from package.json, where they are declared.
//
// Two kinds of code that are no slice get their own rules, both declared in
// package.json. Machine glue (martha.hostGlue) implements parts of the contract
// on one machine; it may import the host contract, Node's own modules and files
// in its own directory, and nothing else, so it cannot become the door through
// which a slice's code runs (glueReachesBeyondTheContract). A host adapter
// (martha.hostAdapters) composes the contract for one coding tool from glue and
// slices; it may import those, the contract and Node's own modules, but never a
// test or a program (adapterReachesBeyondItsKind).

import { dirname, join, normalize, sep } from 'node:path'

import ts from 'typescript'

import { lineOf, moduleReferencesIn, nodesOf, parseSource } from './parse_a_source.ts'

/** The Node modules a slice may import: pure computation that reads no setting and no machine state. */
export const NODE_MODULES_A_SLICE_MAY_IMPORT = ['node:path', 'node:crypto'] as const

/** The globals a slice may not use as a value. */
export const GLOBALS_A_SLICE_MAY_NOT_USE = [
  'process', 'globalThis', 'global', 'require', 'eval', 'Function',
  'fetch', 'WebSocket', 'EventSource',
] as const

/** The property every function carries, whose own constructor is Function. */
export const REACHES_FUNCTION = 'constructor'

/** The prefix of Node's own modules, the only modules besides the contract that host glue may import. */
export const NODE_MODULE_PREFIX = 'node:'

/** A path whose first segment is the home directory: `~` alone, or `~/...`. */
export const STARTS_AT_HOME = /^~(?:\/|$)/

export interface Source {
  /** Path relative to src/. */
  readonly path: string
  readonly text: string
}

export interface Finding {
  readonly path: string
  readonly line: number
  readonly why: string
}

const isAllowedNodeModule = (specifier: string) =>
  (NODE_MODULES_A_SLICE_MAY_IMPORT as readonly string[]).includes(specifier)

/** Says whether a path relative to src/ is a slice of the core. */
export type IsSlice = (path: string) => boolean

const isRelative = (specifier: string) => specifier.startsWith('./') || specifier.startsWith('../')

// Where a relative specifier lands, relative to src/; null when it leaves src/.
const targetOf = (path: string, specifier: string): string | null => {
  const target = normalize(join(dirname(path), specifier))
  return target === '..' || target.startsWith(`..${sep}`) ? null : target
}

function importFindings(path: string, file: ts.SourceFile, isSlice: IsSlice): Finding[] {
  return moduleReferencesIn(file)
    .filter(reference => !reference.type_only)
    .flatMap(({ specifier, line }) => {
      if (specifier === null) return [{ path, line, why: 'imports a module whose name is computed' }]
      if (isRelative(specifier)) {
        const target = targetOf(path, specifier)
        if (target === null) return [{ path, line, why: `imports ${specifier}, outside the core` }]
        return isSlice(target) ? [] : [{ path, line, why: `imports ${specifier}, which is not a slice` }]
      }
      return isAllowedNodeModule(specifier) ? [] : [{ path, line, why: `imports ${specifier}, which a slice may not` }]
    })
}

// Whether an identifier names a value here, rather than a property, a
// declaration, a label or a type.
function isUsedAsAValue(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isShorthandPropertyAssignment(parent)) return true
  if (ts.isQualifiedName(parent) && parent.right === node) return false
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false
  // A declaration, a property assignment or a member names its own name: not a use of a global.
  if ('name' in parent && parent.name === node) return false
  return !isInAType(node)
}

function globalFindings(path: string, file: ts.SourceFile, nodes: readonly ts.Node[]): Finding[] {
  return nodes
    .filter((node): node is ts.Identifier => ts.isIdentifier(node))
    .filter(node => (GLOBALS_A_SLICE_MAY_NOT_USE as readonly string[]).includes(node.text) && isUsedAsAValue(node))
    .map(node => ({ path, line: lineOf(file, node), why: `uses the global ${node.text}` }))
}

const isInAType = (node: ts.Node): boolean => {
  for (let at: ts.Node = node.parent; !ts.isSourceFile(at); at = at.parent) if (ts.isTypeNode(at)) return true
  return false
}

// The name as an identifier (`.constructor`, `{ constructor }`) or as a key
// (`['constructor']`, `{ 'constructor': c }`). A class's constructor declaration
// carries no such node.
const namesConstructor = (node: ts.Node): boolean =>
  ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && node.text === REACHES_FUNCTION && !isInAType(node)) ||
  ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === REACHES_FUNCTION)

function constructorFindings(path: string, file: ts.SourceFile, nodes: readonly ts.Node[]): Finding[] {
  return nodes
    .filter(namesConstructor)
    .map(node => ({ path, line: lineOf(file, node), why: `names ${REACHES_FUNCTION}, a way to Function` }))
}

const isPathText = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)

function homeFindings(path: string, file: ts.SourceFile, nodes: readonly ts.Node[]): Finding[] {
  return nodes
    .filter(isPathText)
    .filter(node => STARTS_AT_HOME.test(node.text))
    .map(node => ({ path, line: lineOf(file, node), why: 'writes a path that starts at the home directory' }))
}

const parseFindings = (path: string, errors: ReturnType<typeof parseSource>['errors']): Finding[] =>
  errors.map(error => ({ path, line: error.line, why: `does not parse: ${error.message}` }))

function findingsIn(source: Source, isSlice: IsSlice): Finding[] {
  const { file, errors } = parseSource(source.text, source.path)
  const nodes = nodesOf(file)
  return [
    ...parseFindings(source.path, errors),
    ...importFindings(source.path, file, isSlice),
    ...globalFindings(source.path, file, nodes),
    ...constructorFindings(source.path, file, nodes),
    ...homeFindings(source.path, file, nodes),
  ].sort((a, b) => a.line - b.line)
}

/**
 * Every place in these slices that reaches for a setting other than through the
 * declaration. `isSlice` says which paths under src/ are slices; a relative
 * import of anything else is named.
 */
export function settingsReadOutsideTheDeclaration(slices: readonly Source[], isSlice: IsSlice): Finding[] {
  return slices.flatMap(source => findingsIn(source, isSlice))
}

const topOf = (path: string) => path.split(sep)[0]

// Every import of one source, judged: `admits` says whether a relative target
// (relative to src/) may be imported, and `rule` names the rule in a finding.
// Types count too: code that leans on another's types is coupled to it.
function judgedImports(source: Source, admits: (target: string) => boolean, rule: string): Finding[] {
  const { file, errors } = parseSource(source.text, source.path)
  const path = source.path
  return [
    ...parseFindings(path, errors),
    ...moduleReferencesIn(file).flatMap(({ specifier, line }) => {
      if (specifier === null) return [{ path, line, why: 'imports a module whose name is computed' }]
      if (specifier.startsWith(NODE_MODULE_PREFIX)) return []
      const target = isRelative(specifier) ? targetOf(path, specifier) : null
      if (target !== null && admits(target)) return []
      return [{ path, line, why: `imports ${specifier}; ${rule}` }]
    }),
  ].sort((a, b) => a.line - b.line)
}

/**
 * Every import from a slice into a directory holding a program package.json
 * runs (`programs`, directories under src/). A directory is a slice or a
 * program, never both: a program reaches the machine as it likes, so a slice
 * that shares its directory, or imports from it, is judged by the wrong rule.
 */
export function slicesImportingPrograms(slices: readonly Source[], programs: readonly string[]): Finding[] {
  return slices.flatMap(source => {
    const { file } = parseSource(source.text, source.path)
    return moduleReferencesIn(file).flatMap(({ specifier, line }) => {
      const top = specifier !== null && isRelative(specifier) ? targetOf(source.path, specifier)?.split(sep)[0] : undefined
      return top !== undefined && programs.includes(top)
        ? [{ path: source.path, line, why: `imports ${specifier}, from ${top}, a directory package.json runs as a program` }]
        : []
    })
  })
}

/**
 * Every import in this machine glue beyond the host contract (`contract`, a
 * directory under src/), Node's own modules and files in the glue's own directory.
 */
export function glueReachesBeyondTheContract(glue: readonly Source[], contract: string): Finding[] {
  return glue.flatMap(source => {
    const own = topOf(source.path)
    return judgedImports(
      source,
      target => [contract, own].includes(topOf(target)),
      'machine glue may import only the host contract, node:* and its own directory',
    )
  })
}

/**
 * Every import in these host adapters of what an adapter may not compose: a test
 * or a program (`isTestOrProgram`, a path under src/), anything outside src/, or
 * a package that is not Node's own.
 */
export function adapterReachesBeyondItsKind(adapters: readonly Source[], isTestOrProgram: (path: string) => boolean): Finding[] {
  return adapters.flatMap(source =>
    judgedImports(source, target => !isTestOrProgram(target), 'a host adapter may not import a test, a program or a package'),
  )
}
