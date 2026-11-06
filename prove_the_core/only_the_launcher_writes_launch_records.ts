// Only the launcher writes the launcher's records (#42, D1).
//
// The binder names a member's node id from a launch record, so whoever can write
// a record can have a delivery from its own pid attributed to another member.
//
// The first line is the type. The contract hands every slice the records as
// KeyedRows, which only reads, and an adapter hands them as `readingOnly(store)`,
// so the object a slice holds has no `keep` or `drop` at run time either: a slice
// that reaches past the type (`Reflect.get`, `Object.values`, a cast) finds
// nothing that writes. The writable KeyedRowStore is the launcher's own seam, held
// by the adapter that launches members, never part of HostContract.
//
// This check is the second line. Outside the slices that may write, it names:
//
//   - `keep` or `drop` of KeyedRowStore, by property access, element access,
//     destructuring or a renamed destructuring;
//   - the binder's own writers, `recordMemberLaunch` and `recordMemberStopped`,
//     including an import of them under another name;
//   - the contract's `stores.launches` reached for anything but reading: a slice
//     may call its `all()` or hand it straight to the binder's readers
//     (`binderOverLaunches`, `launchesIn`), and any other use is named where the
//     store is reached. So an alias of it under a structural type of the
//     slice's own, an element access through a computed key, and handing it to
//     `Reflect.get` or `Object.values` are named, though none of them writes
//     through the reader at run time.
//
// It resolves names with TypeScript's type checker rather than by matching text,
// so an alias (`const s = host.stores.launches; s.keep(...)`) is still caught. It
// walks the core through coreSources, so every file kind that can hold script is
// read, JavaScript included.
//
// Two more rules keep the exemption narrow: no slice imports host glue, so the
// writable store the glue builds cannot reach a slice by import; and a hostGlue
// entry in package.json must be exactly `src/<one directory>`, so a declaration
// cannot exempt a tree, a path outside src/ or nothing at all.
//
// Out of this check's scope: a slice writing the records' files itself with
// node:fs. #26's allow-list of Node modules refuses that once it lands.
//
// Who may write: the binder's slice, the host contract (its test host implements
// the store), and the host glue package.json declares, which implements the store
// on a real machine and tests it there.

import { lstatSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

import ts from 'typescript'

import { coreSources } from './core_sources.ts'
import { moduleReferencesOf } from './parse_a_source.ts'
import { isTestFile } from './declared_in_package_json.ts'

/** The slices under src/ that may write launch records, besides the host glue. */
export const LAUNCH_RECORD_WRITERS = ['attribute_a_cross_session_sender', 'host_contract'] as const

/** The contract file that declares the store, and the store's writing members. */
const CONTRACT = join('host_contract', 'host_contract.ts')
const STORE = 'KeyedRowStore'
const STORE_WRITES = ['keep', 'drop']

/** Where the contract hands slices the records, and the one member that reads them. */
const STORES = 'Stores'
const LAUNCHES = 'launches'
const READS = 'all'

/** The binder's file, its exported writers, and its exported readers of the records. */
const BINDER = join('attribute_a_cross_session_sender', 'attribute_a_cross_session_sender.ts')
const BINDER_WRITES = ['recordMemberLaunch', 'recordMemberStopped']
const BINDER_READS = ['binderOverLaunches', 'launchesIn']

/** Where package.json declares host glue, and the one shape an entry may have. */
const HOST_GLUE_ROOT = 'src'
const HOST_GLUE_ENTRY = new RegExp(`^${HOST_GLUE_ROOT}/([A-Za-z0-9_-]+)$`)

export interface PlantedSource {
  /** Path relative to src/. */
  readonly path: string
  readonly text: string
}

export interface LaunchRecordWrite {
  /** Path relative to src/. */
  readonly path: string
  readonly line: number
  readonly name: string
}

export interface HostGlueImport {
  /** Path relative to src/. */
  readonly path: string
  readonly specifier: string
}

/** The two lists of directories package.json declares that are not slices: machine glue and the host adapters that compose it (#26). */
export type HostGlueKey = 'hostGlue' | 'hostAdapters'

/**
 * The directories package.json declares under `key`, as names under src/.
 * Refuses, with the entry it names, anything but a list of `src/<one
 * directory>` entries, each naming a real directory (not a link) and none twice.
 */
export function hostGlueOf(declared: unknown, isDirectory: (name: string) => boolean, key: HostGlueKey = 'hostGlue'): string[] {
  const list = `package.json martha.${key}`
  if (declared === undefined) return []
  if (!Array.isArray(declared)) throw new Error(`${list} is not a list of directories.`)
  const names = declared.map((entry: unknown) => {
    const name = typeof entry === 'string' ? HOST_GLUE_ENTRY.exec(entry)?.[1] : undefined
    if (name === undefined) {
      throw new Error(`${list} holds ${JSON.stringify(entry)}, which is not exactly ${HOST_GLUE_ROOT}/<one directory>.`)
    }
    if (!isDirectory(name)) throw new Error(`${list} names ${HOST_GLUE_ROOT}/${name}, which is not a directory there.`)
    return name
  })
  const twice = names.find((name, index) => names.indexOf(name) !== index)
  if (twice !== undefined) throw new Error(`${list} names ${HOST_GLUE_ROOT}/${twice} twice.`)
  return names
}

/**
 * What package.json declares under `key` (machine glue by default, or the host
 * adapters), checked by hostGlueOf. Neither is a slice, and no slice may import
 * either: an adapter builds the writable store as glue does.
 */
export function declaredHostGlue(repository: string, key: HostGlueKey = 'hostGlue'): string[] {
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { martha?: Record<HostGlueKey, unknown> }
  const src = join(repository, HOST_GLUE_ROOT)
  return hostGlueOf(manifest.martha?.[key], (name) => {
    try {
      return lstatSync(join(src, name)).isDirectory()
    } catch {
      return false
    }
  })
}

function compilerOptions(repository: string): ts.CompilerOptions {
  const config = ts.readConfigFile(join(repository, 'tsconfig.json'), ts.sys.readFile)
  if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  // allowJs: a writer in a .js or .mjs file is still a writer, and the type
  // checker resolves its names only when it reads the file.
  return { ...ts.parseJsonConfigFileContent(config.config, ts.sys, repository).options, allowJs: true }
}

/** A program over every script in src/, with planted sources added as if they were files there. */
function programOver(src: string, options: ts.CompilerOptions, planted: readonly PlantedSource[]): ts.Program {
  const virtual = new Map(planted.map((source) => [join(src, source.path), source.text]))
  const host = ts.createCompilerHost(options)
  const realGetSourceFile = host.getSourceFile.bind(host)
  const realFileExists = host.fileExists.bind(host)
  const realReadFile = host.readFile.bind(host)

  host.getSourceFile = (fileName, language, ...rest) => {
    const text = virtual.get(fileName)
    return text === undefined ? realGetSourceFile(fileName, language, ...rest) : ts.createSourceFile(fileName, text, language, true)
  }
  host.fileExists = (fileName) => virtual.has(fileName) || realFileExists(fileName)
  host.readFile = (fileName) => virtual.get(fileName) ?? realReadFile(fileName)

  const scripts = coreSources(src).map((source) => join(src, source.path))
  return ts.createProgram([...scripts, ...virtual.keys()], options, host)
}

interface Guarded {
  /** Declarations a reference to which is a write. */
  readonly writes: Set<ts.Declaration>
  /** The contract's `Stores.launches`. */
  readonly launches: ts.Declaration
  /** The binder's readers, which a slice may hand the records to. */
  readonly readers: Set<ts.Declaration>
}

function membersNamed(file: ts.SourceFile, interface_name: string, names: readonly string[]): ts.Declaration[] {
  return file.statements
    .filter((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === interface_name)
    .flatMap((statement) => [...statement.members])
    .filter((member) => member.name !== undefined && ts.isIdentifier(member.name) && names.includes(member.name.text))
}

function functionsNamed(file: ts.SourceFile, names: readonly string[]): ts.Declaration[] {
  return file.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name !== undefined && names.includes(statement.name.text),
  )
}

/** The declarations the check guards, found where the contract and the binder declare them. */
function guarded(program: ts.Program, src: string): Guarded {
  const contract = program.getSourceFile(join(src, CONTRACT))
  const binder = program.getSourceFile(join(src, BINDER))
  if (contract === undefined || binder === undefined) throw new Error('The check could not find the contract or the binder.')

  const writes = [...membersNamed(contract, STORE, STORE_WRITES), ...functionsNamed(binder, BINDER_WRITES)]
  const [launches, ...more] = membersNamed(contract, STORES, [LAUNCHES])
  const readers = functionsNamed(binder, BINDER_READS)
  if (
    writes.length !== STORE_WRITES.length + BINDER_WRITES.length ||
    launches === undefined ||
    more.length > 0 ||
    readers.length !== BINDER_READS.length
  ) {
    throw new Error('The check did not find every name it guards: a writer, a reader or the store was renamed or moved.')
  }
  return { writes: new Set(writes), launches, readers: new Set(readers) }
}

function referredSymbol(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
  // `const { keep } = store` and `const { keep: k } = store`: the name binds a
  // local, so the property is looked up on the type being destructured.
  if (ts.isBindingElement(node.parent) && ts.isObjectBindingPattern(node.parent.parent)) {
    const element = node.parent
    const property = element.propertyName ?? element.name
    if (node === property && (ts.isIdentifier(property) || ts.isStringLiteral(property))) {
      return checker.getTypeAtLocation(element.parent).getProperty(property.text)
    }
  }
  const symbol = checker.getSymbolAtLocation(node)
  return symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

const refersTo = (symbol: ts.Symbol | undefined, declarations: ReadonlySet<ts.Declaration>): boolean =>
  symbol?.declarations?.some((declaration) => declarations.has(declaration)) ?? false

/**
 * Whether this reference to `stores.launches` only reads: the store is the object
 * of a called `.all`, or an argument handed straight to one of the binder's readers.
 */
function onlyReads(checker: ts.TypeChecker, name: ts.Node, readers: ReadonlySet<ts.Declaration>): boolean {
  const reached = name.parent
  const reaches = (ts.isPropertyAccessExpression(reached) && reached.name === name) ||
    (ts.isElementAccessExpression(reached) && reached.argumentExpression === name)
  if (!reaches) return false

  const use = reached.parent
  if (ts.isPropertyAccessExpression(use) && use.expression === reached && use.name.text === READS) {
    return ts.isCallExpression(use.parent) && use.parent.expression === use
  }
  if (ts.isCallExpression(use) && use.arguments.some((argument) => argument === reached)) {
    const callee = ts.isPropertyAccessExpression(use.expression) ? use.expression.name : use.expression
    return refersTo(referredSymbol(checker, callee), readers)
  }
  return false
}

const sliceOf = (path: string): string => path.split(sep)[0] ?? ''

function isAllowed(path: string, host_glue: readonly string[]): boolean {
  const slice = sliceOf(path)
  return (LAUNCH_RECORD_WRITERS as readonly string[]).includes(slice) || host_glue.includes(slice)
}

/**
 * Every write to the launcher's records outside the slices allowed to make one,
 * and every reach of the contract's records for anything but reading.
 * `host_glue` names directories directly under src/ (declaredHostGlue).
 */
export function launchRecordWritesOutsideTheLauncher(
  repository: string,
  host_glue: readonly string[],
  planted: readonly PlantedSource[] = [],
): LaunchRecordWrite[] {
  const src = join(repository, 'src')
  const program = programOver(src, compilerOptions(repository), planted)
  const checker = program.getTypeChecker()
  const { writes, launches, readers } = guarded(program, src)
  const reachesTheStore = new Set([launches])
  const found: LaunchRecordWrite[] = []

  for (const file of program.getSourceFiles()) {
    const path = relative(src, file.fileName)
    if (path.startsWith('..') || isAllowed(path, host_glue)) continue

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
        const symbol = referredSymbol(checker, node)
        const writing = refersTo(symbol, writes)
        const escaping = refersTo(symbol, reachesTheStore) && !onlyReads(checker, node, readers)
        if (writing || escaping) {
          found.push({ path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, name: node.text })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return found
}

/**
 * Every import, in a source outside the host glue, of a module inside it. The
 * glue builds the writable store, so a slice that imported it could write.
 * Paths are relative to src/; `planted` are added as if they were files there.
 */
export function hostGlueImportedBySlices(
  repository: string,
  host_glue: readonly string[],
  test_suffixes: readonly string[],
  programs: readonly string[],
  planted: readonly PlantedSource[] = [],
): HostGlueImport[] {
  const src = join(repository, 'src')
  return [...coreSources(src), ...planted]
    .filter((source) => !host_glue.includes(sliceOf(source.path)))
    // A test or a program package.json runs is no slice: it may drive the real glue (#26).
    .filter((source) => !isTestFile(test_suffixes, source.path) && !programs.includes(sliceOf(source.path)))
    .flatMap((source) =>
      moduleReferencesOf(source.text, source.path)
        .flatMap(({ specifier }) => specifier ?? [])
        .filter((specifier) => specifier.startsWith('./') || specifier.startsWith('../'))
        .filter((specifier) => host_glue.includes(sliceOf(relative(src, join(src, dirname(source.path), specifier)))))
        .map((specifier) => ({ path: source.path, specifier })),
    )
}
