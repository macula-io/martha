// A key package.json declares more than once (martha#753), read with the compiler's own JSON parser.
//
// This is its own module, apart from declared_in_package_json.ts, because that file is copied into a throwaway
// repository with no node_modules by #723's single-file run: it must import nothing but node's own modules.

import ts from 'typescript'

import { MANIFEST } from './declared_in_package_json.ts'

/**
 * A key one object of the manifest declares more than once (martha#753): its path from the root, dotted, with an
 * array's index in brackets, and each declaration's line and spelling, in the order the file holds them.
 */
export interface KeyDeclaredTwice {
  readonly key: string
  readonly lines: readonly number[]
  readonly spellings: readonly string[]
}

/**
 * Every key some object of `text` declares more than once, at any depth, arrays included (martha#753). `JSON.parse`
 * keeps the last declaration and drops the others without a word, so this reads the text with the compiler's own JSON
 * parser, which keeps them all. Names are compared decoded, as `JSON.parse` compares them: `"a"` and `"\u0061"` are one.
 */
export function keysDeclaredTwice(text: string): KeyDeclaredTwice[] {
  const file = ts.parseJsonText(MANIFEST, text)
  const root = file.statements[0]?.expression
  return root === undefined ? [] : twiceUnder(root, '', file)
}

/** The keys declared twice in `node` and everything under it, `path` being where `node` stands. */
function twiceUnder(node: ts.Expression, path: string, file: ts.JsonSourceFile): KeyDeclaredTwice[] {
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element, at) => twiceUnder(element, `${path}[${String(at)}]`, file))
  }
  if (!ts.isObjectLiteralExpression(node)) return []
  const named = node.properties.filter(ts.isPropertyAssignment)
  const under = named.flatMap((property) => twiceUnder(property.initializer, keyAt(path, nameOf(property, file)), file))
  return [...twiceIn(named, path, file), ...under]
}

/** The keys one object declares twice, each with every line and spelling it is declared at. */
function twiceIn(named: readonly ts.PropertyAssignment[], path: string, file: ts.JsonSourceFile): KeyDeclaredTwice[] {
  const by_name = new Map<string, ts.PropertyAssignment[]>()
  for (const property of named) by_name.set(nameOf(property, file), [...(by_name.get(nameOf(property, file)) ?? []), property])
  return [...by_name]
    .filter(([, declared]) => declared.length > 1)
    .map(([name, declared]) => ({
      key: keyAt(path, name),
      lines: declared.map((property) => file.getLineAndCharacterOfPosition(property.name.getStart(file)).line + 1),
      spellings: declared.map((property) => property.name.getText(file)),
    }))
}

/** A property's name decoded, as `JSON.parse` reads it; a name JSON cannot hold is kept as written. */
const nameOf = (property: ts.PropertyAssignment, file: ts.JsonSourceFile): string =>
  ts.isStringLiteral(property.name) || ts.isIdentifier(property.name) || ts.isNumericLiteral(property.name)
    ? property.name.text
    : property.name.getText(file)

/** The dotted path of `name` inside the object at `path`. */
const keyAt = (path: string, name: string): string => (path === '' ? name : `${path}.${name}`)

/** One key declared twice, in the words a check prints and a writer refuses with. */
export const aKeyDeclaredTwiceInWords = (twice: KeyDeclaredTwice): string =>
  `${MANIFEST} declares ${twice.key} ${String(twice.lines.length)} times, at ` +
  `${twice.lines.map((line, at) => `line ${String(line)} (${twice.spellings[at] ?? ''})`).join(' and ')}: ` +
  'JSON.parse keeps the last and hides the rest'

/** Refuses a manifest text that declares a key twice, naming each one: a writer that parsed it would drop one unseen. */
export function refuseKeysDeclaredTwice(text: string): void {
  const twice = keysDeclaredTwice(text)
  if (twice.length > 0) throw new Error(twice.map(aKeyDeclaredTwiceInWords).join('\n'))
}
