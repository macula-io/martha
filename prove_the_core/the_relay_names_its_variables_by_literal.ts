// The relay names every variable it reads by a literal, as the host demands (#104).
//
// The host reads a hooks module before it runs it, to list the variables it
// reads and writes, and refuses the whole module when `$.env.get`'s first
// argument is anything but a literal name: an imported constant is refused too.
// A refused relay leaves every gate a member has off. This reads the module the
// way the compiler does, so a comment or a string cannot hide a call from it.

import ts from 'typescript'

import { lineOf, nodesOf, parseSource } from './parse_a_source.ts'

/** One `$.env.<call>(...)`: its line, and its first argument when that is a literal name, else null. */
export interface EnvironmentRead {
  readonly line: number
  readonly name: string | null
}

/** Whether a call is `$.env.<something>(...)`. */
function isAnEnvironmentCall(node: ts.Node): node is ts.CallExpression & { readonly expression: ts.PropertyAccessExpression } {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false
  const noun = node.expression.expression
  return ts.isPropertyAccessExpression(noun) && noun.name.text === 'env' && ts.isIdentifier(noun.expression) && noun.expression.text === '$'
}

/** A literal name as the host takes it: a string, or a template with no substitution. */
const literalNameOf = (node: ts.Expression | undefined): string | null =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null

/** Each `$.env` call in a source, in order; throws when the source does not parse. */
export function environmentReadsOf(text: string, path: string): readonly EnvironmentRead[] {
  const { file, errors } = parseSource(text, path)
  if (errors.length > 0) throw new Error(`${path} does not parse: ${errors.map(({ line, message }) => `${line}: ${message}`).join('; ')}`)
  return nodesOf(file)
    .filter(isAnEnvironmentCall)
    .map((call) => ({ line: lineOf(file, call), name: literalNameOf(call.arguments[0]) }))
}
