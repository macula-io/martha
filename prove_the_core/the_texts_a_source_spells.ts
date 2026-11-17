// The texts a source spells: every string it writes, and every static piece of a template.
//
// A check that holds a name to a place reads what the code says, not what its text looks like. A comment that names a
// word is not code and is never here (martha#468): the parser has no node for a comment. A template is read as the
// pieces between its substitutions, so `crew_channel_taken/${member}` spells the piece `crew_channel_taken/` and a
// check can say what it makes of a name that runs on into a value.
//
// This folder is outside src/, the core, on purpose: it imports the TypeScript compiler, a package the core itself may
// never import.

import ts from 'typescript'

import { lineOf, parseSource } from './parse_a_source.ts'

/** One piece of text a source spells, and the line it is on. */
export interface SpelledText {
  /** What the piece says: a string literal's value, or a template's static piece. */
  readonly text: string
  /** Whether the piece runs on into a substitution, which no string holds. */
  readonly runs_on: boolean
  /** The 1-based line the piece begins on. */
  readonly line: number
}

/** Every text `text` spells, in the order the source holds them. */
export function theTextsASourceSpells(text: string, path: string): readonly SpelledText[] {
  const { file } = parseSource(text, path)
  const texts: SpelledText[] = []
  const take = (node: ts.Node, spelled: string, runs_on: boolean): void => {
    texts.push({ text: spelled, runs_on, line: lineOf(file, node) })
  }
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.StringLiteral) {
      take(node, (node as ts.StringLiteral).text, false)
      return
    }
    if (node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
      take(node, (node as ts.NoSubstitutionTemplateLiteral).text, false)
      return
    }
    if (node.kind === ts.SyntaxKind.TemplateExpression) {
      const template = node as ts.TemplateExpression
      take(template.head, template.head.text, true)
      for (const span of template.templateSpans) take(span.literal, span.literal.text, span.literal.kind === ts.SyntaxKind.TemplateMiddle)
      return
    }
    for (const child of node.getChildren(file)) visit(child)
  }
  visit(file)
  return texts
}
