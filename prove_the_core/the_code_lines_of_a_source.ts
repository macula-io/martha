// The lines of a source that hold code, as the compiler reads them.
//
// The host-directory ceilings (martha#322) count code, not bytes: a blank line, a
// licence header or a paragraph of commentary spends no budget, so a directory's
// ceiling measures what a decision would cost there rather than how much prose
// explains it. "Comment-only" is the compiler's answer, never a regular
// expression's: the compiler knows a `//` inside a string, a `/*` that opens a
// block, a template that runs over several lines, and a JSX attribute holding
// prose, where a per-line text walk guesses at all of them. One definition of a
// comment, in one place.
//
// The tokens are read from the parsed tree rather than from the bare scanner: a
// scanner driven without a parser cannot tell a template's closing backtick from
// the file's end, and reads the rest of a file that holds one as template text.
// A tree's leaves are its tokens, and a comment is trivia that no leaf is — with
// one exception: a doc comment is a node of the tree, so the walk stops above one.
//
// This folder is outside src/, the core, on purpose: it imports the TypeScript
// compiler, a package the core itself may never import.

import ts from 'typescript'

import { parseSource } from './parse_a_source.ts'

/**
 * How many lines of the source `text`, named `path` so its syntax is read right,
 * hold a token that is not a comment or whitespace. A token that runs over
 * several lines, such as a template, counts every line it runs over: the code is
 * there on each of them.
 */
export function codeLinesOf(text: string, path: string): number {
  const { file } = parseSource(text, path)
  const lines = new Set<number>()
  const mark = (from: number, to: number): void => {
    const last = file.getLineAndCharacterOfPosition(to).line
    for (let line = file.getLineAndCharacterOfPosition(from).line; line <= last; line += 1) lines.add(line)
  }
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return
    const children = node.getChildren(file)
    if (children.length === 0) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken && node.end > node.getStart(file)) mark(node.getStart(file), node.end - 1)
      return
    }
    for (const child of children) visit(child)
  }
  visit(file)
  return lines.size
}
