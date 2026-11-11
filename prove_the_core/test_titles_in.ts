// The titles of the tests a source declares (martha#274).
//
// The check that a branch cannot drop a test its base passed compares titles, so it reads them the way the
// compiler does: a call of the plain `test` identifier whose first argument is a string literal or a template.
// A `test('...')` inside a comment or a string is text, not a call, and `test.skip(...)` is a call of a member,
// so neither is a title. A template with a substitution is compared as written, `${...}` and all, because that
// text is what a later copy of the file still holds.

import ts from 'typescript'

import { nodesOf, parseSource } from './parse_a_source.ts'

/** The name node:test is called by, when the test is one. */
const TEST = 'test'

const isTestCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === TEST

/** The title as written: a literal's value, or a template's text between its backticks. */
const titleOf = (file: ts.SourceFile, title: ts.Expression | undefined): string | undefined => {
  if (title === undefined) return undefined
  if (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)) return title.text
  return ts.isTemplateExpression(title) ? file.text.slice(title.getStart(file) + 1, title.getEnd() - 1) : undefined
}

/** Every title the source declares, in the order it declares them, a duplicate kept twice. */
export function testTitlesIn(text: string, path: string): string[] {
  const { file } = parseSource(text, path)
  return nodesOf(file).flatMap((node) => {
    const title = isTestCall(node) ? titleOf(file, node.arguments[0]) : undefined
    return title === undefined ? [] : [title]
  })
}
