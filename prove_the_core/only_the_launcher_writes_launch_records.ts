// Only the launcher writes the launcher's records (#42, D1).
//
// The binder names a member's node id from a launch record, so whoever can write
// a record can have a delivery from its own pid attributed to another member.
// Before #42 only code that imported the directory store could write one. Now the
// store is part of the host contract, which every slice is handed whole, so this
// check proves that no slice but the binder's own writes through it.
//
// A write is any reference to one of these, however it is reached:
//
//   - `keep` or `drop` of the contract's KeyedRowStore, by property access,
//     element access, destructuring or a renamed destructuring;
//   - the binder's own writers, `recordMemberLaunch` and `recordMemberStopped`,
//     including an import of them under another name.
//
// It resolves names with TypeScript's type checker rather than by matching text,
// so an alias (`const s = host.stores.launches; s.keep(...)`) is still a write.
// What it cannot see is code that throws its types away (`as any`); the strict
// compiler options make that a deliberate act, and review reads it.
//
// Who may write: the binder's slice, the host contract (its test host implements
// the store), and the host glue package.json declares, which implements the store
// on a real machine and tests it there.

import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import ts from 'typescript'

/** The slices under src/ that may write launch records, besides the host glue. */
export const LAUNCH_RECORD_WRITERS = ['attribute_a_cross_session_sender', 'host_contract'] as const

/** The contract file that declares the store, and the store's writing members. */
const CONTRACT = join('host_contract', 'host_contract.ts')
const STORE = 'KeyedRowStore'
const STORE_WRITES = ['keep', 'drop']

/** The binder's file, and its exported writers. */
const BINDER = join('attribute_a_cross_session_sender', 'attribute_a_cross_session_sender.ts')
const BINDER_WRITES = ['recordMemberLaunch', 'recordMemberStopped']

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

/** Every script under a directory, as absolute paths. */
function scriptsUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
}

function compilerOptions(repository: string): ts.CompilerOptions {
  const config = ts.readConfigFile(join(repository, 'tsconfig.json'), ts.sys.readFile)
  if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  return ts.parseJsonConfigFileContent(config.config, ts.sys, repository).options
}

/** A program over src/, with planted sources added as if they were files there. */
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

  return ts.createProgram([...scriptsUnder(src), ...virtual.keys()], options, host)
}

/** The declarations a write refers to. */
function writeDeclarations(program: ts.Program, src: string): Set<ts.Declaration> {
  const declarations = new Set<ts.Declaration>()
  const contract = program.getSourceFile(join(src, CONTRACT))
  const binder = program.getSourceFile(join(src, BINDER))
  if (contract === undefined || binder === undefined) throw new Error('The check could not find the contract or the binder.')

  for (const statement of contract.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== STORE) continue
    for (const member of statement.members) {
      if (member.name !== undefined && ts.isIdentifier(member.name) && STORE_WRITES.includes(member.name.text)) {
        declarations.add(member)
      }
    }
  }
  for (const statement of binder.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && BINDER_WRITES.includes(statement.name.text)) {
      declarations.add(statement)
    }
  }
  if (declarations.size !== STORE_WRITES.length + BINDER_WRITES.length) {
    throw new Error('The check did not find every write it guards: a writer was renamed or moved.')
  }
  return declarations
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

function isAllowed(path: string, host_glue: readonly string[]): boolean {
  const slice = path.split(sep)[0] ?? ''
  return (LAUNCH_RECORD_WRITERS as readonly string[]).includes(slice) || host_glue.includes(slice)
}

/**
 * Every write to the launcher's records outside the slices allowed to make one.
 * `host_glue` names directories directly under src/ (package.json's martha.hostGlue).
 */
export function launchRecordWritesOutsideTheLauncher(
  repository: string,
  host_glue: readonly string[],
  planted: readonly PlantedSource[] = [],
): LaunchRecordWrite[] {
  const src = join(repository, 'src')
  const program = programOver(src, compilerOptions(repository), planted)
  const checker = program.getTypeChecker()
  const writes = writeDeclarations(program, src)
  const found: LaunchRecordWrite[] = []

  for (const file of program.getSourceFiles()) {
    const path = relative(src, file.fileName)
    if (path.startsWith('..') || isAllowed(path, host_glue)) continue

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
        const symbol = referredSymbol(checker, node)
        if (symbol?.declarations?.some((declaration) => writes.has(declaration))) {
          found.push({ path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, name: node.text })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return found
}
