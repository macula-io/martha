// The owner's change to one member of the crew's declaration (martha#307): `martha crew add`, `remove`, `set-model` and
// `set-host`.
//
// This exists so the owner changes the crew with one verb, instead of editing `.martha/martha.json` by hand, and the
// declaration stays one the crew reads. The change is made to the file's own fields, in their order, and only the named
// member is touched. Then, before anything is handed out, the changed text is read back through this slice's own reader,
// and the changed member through the rule `martha start` holds a reviewer's model to (martha#541 6b). A change either
// refuses is refused with that rule's own words, and nothing is handed out. Those two are the only rules a change is
// held to: these verbs add none of their own, and refuse no change a start would accept. A member's provider choice
// stays with martha#257: this writes the model's name only.
//
// Nothing here writes: the caller writes the text this hands out (../declare_a_solo_crew/write_a_changed_declaration.ts).

import { join } from 'node:path'

import type { DocumentStore } from '../host_contract/host_contract.ts'
import {
  DECLARATION_DIRECTORY,
  DECLARATION_FILE,
  DeclarationRefused,
  declareCrewOnHosts,
  HOST,
  MODEL,
  type CrewSettings,
  type Member,
  type TheVocabulariesOfHost,
} from './declare_crew.ts'
import { sameMemberName } from './member_names.ts'
import { notOnTheCrew } from '../see_who_is_free/see_who_is_free.ts'
import { aReviewerMembersModelRefusal } from '../run_reviews_on_the_review_model/run_reviews_on_the_review_model.ts'

/** The verbs, as the owner types them after `martha crew`. */
export const ADD = 'add'
export const REMOVE = 'remove'
export const SET_MODEL = 'set-model'
export const SET_HOST = 'set-host'

/** One change to one member. A null model is the host's own; a null host is the crew's. */
export type CrewChange =
  | { readonly kind: typeof ADD; readonly member: string; readonly role: string; readonly model: string | null; readonly host: string | null }
  | { readonly kind: typeof REMOVE; readonly member: string }
  | { readonly kind: typeof SET_MODEL; readonly member: string; readonly model: string | null }
  | { readonly kind: typeof SET_HOST; readonly member: string; readonly host: string | null }

/**
 * The declaration's text before and after the change, and the crew the reader makes of the text after it; or why
 * there is no change to write. `reformatted` says the file read was not in the format init writes, which the changed
 * text is in.
 */
export type TheChange =
  | { readonly before: string; readonly after: string; readonly reformatted: boolean; readonly settings: CrewSettings }
  | { readonly refusal: string }

type Fields = Record<string, unknown>

/** The text init writes for a declaration's fields (../declare_a_solo_crew): two spaces, and a newline at the end. */
export const declarationText = (fields: unknown): string => `${JSON.stringify(fields, null, 2)}\n`

/** A store that reads `text` for the declaration and everything else from `documents`. */
const holdingTheCandidate = (documents: DocumentStore, declaration: string, text: string): DocumentStore => ({
  read: (path: string) => (path === declaration ? Promise.resolve(text) : documents.read(path)),
})

/** The crew the reader makes of `documents`, or its refusal's words. */
async function readBy(documents: DocumentStore, root: string, vocabularies: TheVocabulariesOfHost): Promise<CrewSettings | string> {
  try {
    return await declareCrewOnHosts(documents, root, vocabularies)
  } catch (error) {
    if (error instanceof DeclarationRefused) return error.message
    throw error
  }
}

/** The member's own fields with `key` set to `value`, or taken away when `value` is undefined; the key keeps its place. */
function withField(member: Fields, key: string, value: unknown): Fields {
  if (value === undefined) return Object.fromEntries(Object.entries(member).filter(([name]) => name !== key))
  return { ...member, [key]: value }
}

/** The members after the change; or why the member it names is not on the crew. */
function membersAfter(members: readonly Fields[], change: CrewChange): readonly Fields[] | string {
  if (change.kind === ADD) {
    const optional = { ...(change.model === null ? {} : { [MODEL]: change.model }), ...(change.host === null ? {} : { [HOST]: change.host }) }
    return [...members, { name: change.member, role: change.role, ...optional }]
  }
  const at = members.findIndex((member) => typeof member['name'] === 'string' && sameMemberName(member['name'], change.member))
  if (at === -1) return `${notOnTheCrew(change.member, members.map((member) => String(member['name'])))}.`
  if (change.kind === REMOVE) return members.filter((_, i) => i !== at)
  const changed = change.kind === SET_MODEL ? withField(members[at]!, MODEL, change.model) : withField(members[at]!, HOST, change.host ?? undefined)
  return members.map((member, i) => (i === at ? changed : member))
}

/**
 * The declaration under `root` with `change` made to it, read back through the reader against each host's models; or
 * why not. A declaration the reader already refuses is refused before anything is changed.
 */
export async function aChangedDeclaration(documents: DocumentStore, root: string, vocabularies: TheVocabulariesOfHost, change: CrewChange): Promise<TheChange> {
  const declaration = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  // The text is read once, and that text is both the one checked and the one changed: a second read could see another.
  const before = await documents.read(declaration).catch(() => undefined)
  const read = await readBy(before === undefined ? documents : holdingTheCandidate(documents, declaration, before), root, vocabularies)
  if (typeof read === 'string' || before === undefined) return { refusal: typeof read === 'string' ? read : `${declaration} could not be read.` }
  const fields = JSON.parse(before) as Fields
  const members = membersAfter(fields['members'] as readonly Fields[], change)
  if (typeof members === 'string') return { refusal: members }
  const after = declarationText({ ...fields, members })
  const settings = await readBy(holdingTheCandidate(documents, declaration, after), root, vocabularies)
  if (typeof settings === 'string') return { refusal: settings }
  const held = theMemberChanged(settings, change)
  const off_the_review_model = held === undefined ? undefined : aReviewerMembersModelRefusal(held, settings)
  if (off_the_review_model !== undefined) return { refusal: off_the_review_model }
  return { before, after, reformatted: before !== declarationText(fields), settings }
}

/**
 * The member a change leaves on the crew, as the reader read it; undefined for a removal (martha#307 R1). The start
 * holds this member to the crew's review model (../run_reviews_on_the_review_model), so the change is held to it too.
 */
function theMemberChanged(settings: CrewSettings, change: CrewChange): Member | undefined {
  if (change.kind === REMOVE) return undefined
  return settings.members.find((member) => sameMemberName(member.name, change.member))
}
