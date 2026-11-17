// The tool the Supervisor keeps a package's contract with (martha#513, slice 1).
//
// This exists so the contract reaches the package's ledger from the one session that may write it. The Supervisor names
// the brief it already writes, this slice reads that file and keeps the block it carries, and the brief itself is never
// given to a member: what a member is handed is the version the ledger holds, which is why an edited brief does not
// change a package's contract until the Supervisor keeps the change.
//
// Who may call it is the owner's list's own table, not a second one: a contract bounds the work a package was given, so
// the member that may give work is the member that may record what bounds it (martha#316's answer, kept once).

import type { DocumentStore } from '../host_contract/host_contract.ts'
import { A_PACKAGE } from '../keep_the_ledger/the_ledger_tools.ts'
import { mayKeepTheOwnersList } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { KEEP_THE_PACKAGE_CONTRACT, keepThePackageContract } from './keep_the_package_contract.ts'

/** What `keep_the_package_contract` is for, as the crew's mod registers it. */
export const KEEP_THE_CONTRACT_DESCRIPTION =
  'Keep a work package\'s contract as its next version, read from a ```package-contract block in the brief you name. ' +
  'A contract names a goal, each acceptance criterion with where its evidence is found (test, document, ci, owner_yes), ' +
  'the actions the package allows (push, tag, handoff, land), its budget and what done means; a package the owner says ' +
  'needs none is kept as unbounded with their reason and the ask they said it in. The member holding the package is ' +
  'handed the version at its start and after every refresh, and a changed contract is the next version, never an edit.'

/** What the tool takes: the package, and the brief that carries its contract. */
export const KEEP_THE_CONTRACT_TOOL = {
  name: KEEP_THE_PACKAGE_CONTRACT,
  description: KEEP_THE_CONTRACT_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      package: A_PACKAGE,
      brief: { type: 'string', description: `The path of the brief that carries the contract, in one ${'```'}package-contract block` },
    },
    required: ['package', 'brief'],
  },
}

/** The declaration, as much of it as keeping a contract is decided by: the members and the table of who may do what. */
export interface TheDeclaration {
  readonly members: readonly { readonly name: string; readonly role: string }[]
  readonly mode: { readonly may: Readonly<Record<string, readonly string[]>> }
}

/** What this tool is handed: the crew's ledger, the host's own reader, the declaration's table and this member. */
export interface TheContractAsked {
  readonly ledger: LedgerHost
  readonly documents: DocumentStore
  readonly settings: TheDeclaration
  readonly member: string
}

/** What the tool answers: what was kept, or why nothing was. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/** The text an argument holds, or '' when it holds something that is not text. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The brief at `path`, as the host reads it, or why it could not be read: a brief nobody can read is no contract. */
async function theBriefAt(documents: DocumentStore, path: string): Promise<{ readonly ok: string } | { readonly refused: string }> {
  try {
    return { ok: await documents.read(path) }
  } catch (error) {
    return { refused: `the brief at ${path} could not be read (${error instanceof Error ? error.message : String(error)}), so no contract was kept.` }
  }
}

/**
 * `keep_the_package_contract`: the contract the named brief carries, kept as the package's next version — or why not:
 * a member the table does not let assign work, a call that names no brief, a brief the host cannot read, or a block
 * this slice will not read as a contract.
 */
export async function keepTheContract(asked: TheContractAsked, args: Readonly<Record<string, unknown>>): Promise<AToolAnswer> {
  if (!mayKeepTheOwnersList(asked.settings, asked.member)) {
    const granted = asked.settings.mode.may.assign_work ?? []
    return {
      refused:
        `${asked.member} may not record a package's contract: this crew's table lets ${granted.join(', ') || 'nobody'} assign work, ` +
        'and a contract bounds the work a package was given. Nothing was written.',
    }
  }
  const brief = textOf(args['brief']).trim()
  if (brief === '') return { refused: 'a contract is read from a brief, and this call named none: give the path of the brief file as brief.' }
  const read = await theBriefAt(asked.documents, brief)
  if ('refused' in read) return read
  return keepThePackageContract(asked.ledger, { package: textOf(args['package']), member: asked.member, brief: read.ok })
}
