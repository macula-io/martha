// The models a Claude Code release accepts in a subagent's own `model` field, read from the declaration it ships
// (martha#811). recorded_claude_code_models.json was re-taken by hand (martha#315); --check now re-reads the field from
// the release's `sdk-tools.d.ts`, so a release that adds, drops or renames a model fails host drift naming it.
//
// The declaration is a type file, so a plain read is enough: the TypeScript parser finds `export interface AgentInput`
// and its `model` member, which must be a union of string literals (the recording's kind, names_listed). Any other
// shape is unreadable, never an empty list.

import ts from 'typescript'

import { Unreadable } from '../compare_two_host_recordings/compare_under_renaming.ts'

/** The interface and member the host declares a subagent's model in. */
const AGENT_INPUT = 'AgentInput'
const MODEL = 'model'

/** The model names a release's `sdk-tools.d.ts` accepts in `AgentInput.model`, in the order it lists them. */
export function modelsTheHostAccepts(declaration: string): string[] {
  const file = ts.createSourceFile('sdk-tools.d.ts', declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const agents = file.statements.filter((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === AGENT_INPUT)
  if (agents.length !== 1) throw new Unreadable(`the declaration holds ${String(agents.length)} ${AGENT_INPUT} interfaces, not one`)
  const members = agents[0]?.members.filter((member): member is ts.PropertySignature => ts.isPropertySignature(member) && ts.isIdentifier(member.name) && member.name.text === MODEL) ?? []
  const type = members.length === 1 ? members[0]?.type : undefined
  const literals = membersOf(type)
  const names = literals.map((literal) => (ts.isLiteralTypeNode(literal) && ts.isStringLiteral(literal.literal) ? literal.literal.text : undefined))
  if (names.length === 0 || names.some((name) => name === undefined)) throw new Unreadable(`${AGENT_INPUT}.${MODEL} is not one union of model names`)
  return names as string[]
}

/** The types a union lists, the one type when it is no union, and none when there is no type. */
function membersOf(type: ts.TypeNode | undefined): readonly ts.TypeNode[] {
  if (type === undefined) return []
  return ts.isUnionTypeNode(type) ? type.types : [type]
}
