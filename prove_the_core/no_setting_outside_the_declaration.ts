// No setting outside the declaration.
//
// A setting read in two places can disagree: one place reads the environment,
// another a home-relative path, and the crew behaves differently depending on
// which slice asked. So a slice of the running crew takes its settings from
// CrewSettings (src/declare_crew/) and from nowhere else, and it reaches the
// machine only through the host contract: files through host.stores, programs
// through host.processes.
//
// This check proves that on each slice's syntax tree (parse_a_source.ts), so a
// string, a comment, a regular expression or a line break can neither hide code
// nor pass for it. In a slice:
//
// - a module may be imported only when it is another slice (a relative path that
//   stays inside src/) or a Node module on the allow-list below. Anything else,
//   and any module whose name is computed, is named. An allow-list, because a
//   deny-list misses the next way in (createRequire, reading /proc, running a
//   shell). An import that is only a type is erased, so it is not judged;
// - the globals through which a slice could reach the environment or run text as
//   code are named wherever they are used as a value;
// - a string that is a path from the home directory (`~` alone or `~/...`) is
//   named;
// - a file the parser cannot read is named, since nothing in it can be proved.
//
// Which files are slices is the caller's to say: the test derives the files that
// are not (tests, the programs CI runs, and the host glue that implements the
// contract on one machine) from package.json, where they are declared.

import { dirname, join, normalize, sep } from 'node:path'

import ts from 'typescript'

import { lineOf, moduleReferencesIn, nodesOf, parseSource } from './parse_a_source.ts'

/** The Node modules a slice may import: pure computation that reads no setting and no machine state. */
export const NODE_MODULES_A_SLICE_MAY_IMPORT = ['node:path', 'node:crypto'] as const

/** The globals a slice may not use as a value. */
export const GLOBALS_A_SLICE_MAY_NOT_USE = ['process', 'globalThis', 'global', 'require', 'eval', 'Function'] as const

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

// A relative specifier names another slice only while it stays inside src/.
const staysInsideTheCore = (path: string, specifier: string) => {
  const target = normalize(join(dirname(path), specifier))
  return target !== '..' && !target.startsWith(`..${sep}`)
}

function importFindings(path: string, file: ts.SourceFile): Finding[] {
  return moduleReferencesIn(file)
    .filter(reference => !reference.type_only)
    .flatMap(({ specifier, line }) => {
      if (specifier === null) return [{ path, line, why: 'imports a module whose name is computed' }]
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        return staysInsideTheCore(path, specifier) ? [] : [{ path, line, why: `imports ${specifier}, outside the core` }]
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
  for (let at: ts.Node = parent; !ts.isSourceFile(at); at = at.parent) if (ts.isTypeNode(at)) return false
  return true
}

function globalFindings(path: string, file: ts.SourceFile, nodes: readonly ts.Node[]): Finding[] {
  return nodes
    .filter((node): node is ts.Identifier => ts.isIdentifier(node))
    .filter(node => (GLOBALS_A_SLICE_MAY_NOT_USE as readonly string[]).includes(node.text) && isUsedAsAValue(node))
    .map(node => ({ path, line: lineOf(file, node), why: `uses the global ${node.text}` }))
}

const isPathText = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)

function homeFindings(path: string, file: ts.SourceFile, nodes: readonly ts.Node[]): Finding[] {
  return nodes
    .filter(isPathText)
    .filter(node => STARTS_AT_HOME.test(node.text))
    .map(node => ({ path, line: lineOf(file, node), why: 'writes a path that starts at the home directory' }))
}

function findingsIn(source: Source): Finding[] {
  const { file, errors } = parseSource(source.text, source.path)
  const nodes = nodesOf(file)
  return [
    ...errors.map(error => ({ path: source.path, line: error.line, why: `does not parse: ${error.message}` })),
    ...importFindings(source.path, file),
    ...globalFindings(source.path, file, nodes),
    ...homeFindings(source.path, file, nodes),
  ].sort((a, b) => a.line - b.line)
}

/** Every place in these slices that reaches for a setting other than through the declaration. */
export function settingsReadOutsideTheDeclaration(slices: readonly Source[]): Finding[] {
  return slices.flatMap(findingsIn)
}
