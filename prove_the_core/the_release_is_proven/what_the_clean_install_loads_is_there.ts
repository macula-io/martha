// What the clean-install proof loads out of the installed release is there (martha#496).
//
// This exists so a file or a constant that moves cannot leave the clean-install proof loading a name that is gone.
//
// The proof loads modules out of the release it installed by a name built at runtime:
// `fromTheRelease(installed, '<directory>', '<file>')`, then reads names out of what comes back. Neither half is
// visible to anything else: the path is never written as one string, so no sweep for a full path finds it, and a
// dynamic import of a module that no longer exports a name gives `undefined` rather than an error. The installer job is
// the only place the proof runs, so a move used to be found there, after the push, as a member that would not start.
//
// The release is the committed tree under one top folder, so `<directory>/<file>` is `src/<directory>/<file>` here.
// This reads every installer source as the compiler parses it, finds each call to the loader, and holds it to the
// tree: the file is there, and every name destructured from what it gives is among that file's exports, re-exports
// followed, as the compiler resolves them. A load the check cannot read (a computed path, a result not destructured)
// is a finding too, never a pass, and a proof that loads nothing the check can see is one as well.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

import { lineOf, nodesOf, parseSource } from '../read_a_source/parse_a_source.ts'

/** The proof's loader of a module out of the installed release, as its call is spelled. */
export const LOADER = 'fromTheRelease'

/** The folder of the release the loader's path starts under. */
export const SOURCE_FOLDER = 'src'

/** An installer source, by its path from the repository and its text. */
export interface InstallerSource {
  readonly path: string
  readonly text: string
}

/** One load: where it is written, the module it names under src/, and the names it reads from it. */
export interface ALoad {
  readonly at: string
  readonly module: string
  readonly names: readonly string[]
}

export type Finding =
  | { readonly kind: 'no_such_module'; readonly at: string; readonly module: string }
  | { readonly kind: 'not_exported'; readonly at: string; readonly module: string; readonly name: string }
  | { readonly kind: 'unreadable'; readonly at: string; readonly why: string }
  | { readonly kind: 'nothing_loaded'; readonly scanned: number }

type Read = { readonly load: ALoad } | { readonly unreadable: { readonly at: string; readonly why: string } }

const literalText = (node: ts.Node): string | null =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null

/** The declaration whose value is the call, through an await, parentheses and a type assertion. */
function declarationAround(call: ts.Node): ts.VariableDeclaration | null {
  let at: ts.Node = call.parent
  while (ts.isAwaitExpression(at) || ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at)) at = at.parent
  return ts.isVariableDeclaration(at) ? at : null
}

/** The names a destructuring reads, each by the property it names; null when one is computed or nested. */
function namesRead(pattern: ts.ObjectBindingPattern): string[] | null {
  const names = pattern.elements.map((element) => {
    if (element.dotDotDotToken !== undefined) return null
    const property = element.propertyName ?? element.name
    return ts.isIdentifier(property) || ts.isStringLiteral(property) ? property.text : null
  })
  return names.every((name) => name !== null) ? names : null
}

/** One call to the loader, read: the module it names and the names its result gives up. */
function readALoad(file: ts.SourceFile, path: string, call: ts.CallExpression): Read {
  const at = `${path}:${lineOf(file, call)}`
  const parts = call.arguments.slice(1).map(literalText)
  if (parts.length === 0 || parts.some((part) => part === null)) {
    return { unreadable: { at, why: `the path is not written as string literals, so no check can know the module` } }
  }
  const declaration = declarationAround(call)
  const names = declaration !== null && ts.isObjectBindingPattern(declaration.name) ? namesRead(declaration.name) : null
  if (names === null || names.length === 0) {
    return { unreadable: { at, why: `the result is not destructured into plain names, so no check can know what is read` } }
  }
  return { load: { at, module: [SOURCE_FOLDER, ...(parts as string[])].join('/'), names } }
}

const isALoaderCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === LOADER

/** Every call to the loader in the installer's sources, read or named as unreadable. */
export function theLoadsIn(sources: readonly InstallerSource[]): readonly Read[] {
  return sources.flatMap(({ path, text }) => {
    const { file } = parseSource(text, path)
    return nodesOf(file).filter(isALoaderCall).map((call) => readALoad(file, path, call))
  })
}

/** What a module under the repository exports, as the compiler resolves it; null when there is no such file. */
export type ExportsOf = (module: string) => ReadonlySet<string> | null

/** The exports of modules in a repository, the compiler resolving `export *` and `export { x } from`. */
export function exportsIn(repository: string): ExportsOf {
  return (module) => {
    const path = join(repository, module)
    if (!existsSync(path)) return null
    const program = ts.createProgram([path], {
      allowJs: true,
      allowImportingTsExtensions: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    })
    const file = program.getSourceFile(path)
    const checker = program.getTypeChecker()
    const symbol = file === undefined ? undefined : checker.getSymbolAtLocation(file)
    return new Set(symbol === undefined ? [] : checker.getExportsOfModule(symbol).map((exported) => exported.name))
  }
}

/** A read load held to the tree: the module is there and exports every name read from it. */
function findingsForALoad({ at, module, names }: ALoad, exportsOf: ExportsOf): Finding[] {
  const exported = exportsOf(module)
  if (exported === null) return [{ kind: 'no_such_module', at, module }]
  return names.filter((name) => !exported.has(name)).map((name) => ({ kind: 'not_exported', at, module, name }) as const)
}

/** The findings over the installer's sources; none means every load names a module that gives what is read. */
export function judgeTheLoads(sources: readonly InstallerSource[], exportsOf: ExportsOf): Finding[] {
  const reads = theLoadsIn(sources)
  const loads = reads.flatMap((read) => ('load' in read ? [read.load] : []))
  const unreadable = reads.flatMap((read) => ('unreadable' in read ? [{ kind: 'unreadable', ...read.unreadable } as const] : []))
  const nothing = reads.length === 0 ? [{ kind: 'nothing_loaded', scanned: sources.length } as const] : []
  return [...nothing, ...unreadable, ...loads.flatMap((load) => findingsForALoad(load, exportsOf))]
}

/** A finding in the words a red run prints. */
export function describe(finding: Finding): string {
  switch (finding.kind) {
    case 'no_such_module':
      return `${finding.at}: ${LOADER} loads ${finding.module}, and there is no such file in the tree the release is packed from`
    case 'not_exported':
      return `${finding.at}: reads ${finding.name} from ${finding.module}, which does not export it; the load would give undefined`
    case 'unreadable':
      return `${finding.at}: a ${LOADER} load the check cannot read: ${finding.why}`
    case 'nothing_loaded':
      return `no ${LOADER} load found in ${finding.scanned} installer source(s); the clean-install proof loads its modules through it, so the check would be looking at nothing`
  }
}
