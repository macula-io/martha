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
  theHostOfMember,
  type CrewSettings,
  type Member,
  type TheVocabulariesOfHost,
} from './declare_crew.ts'
import { sameMemberName } from './member_names.ts'
import { hostRuns } from './a_hosts_model_vocabulary.ts'
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
    const optional = { ...(change.model === null ? {} : { model: change.model }), ...(change.host === null ? {} : { [HOST]: change.host }) }
    return [...members, { name: change.member, role: change.role, ...optional }]
  }
  const at = members.findIndex((member) => typeof member['name'] === 'string' && sameMemberName(member['name'], change.member))
  if (at === -1) return `${notOnTheCrew(change.member, members.map((member) => String(member['name'])))}.`
  if (change.kind === REMOVE) return members.filter((_, i) => i !== at)
  const changed = change.kind === SET_MODEL ? { ...members[at]!, model: change.model } : withField(members[at]!, HOST, change.host ?? undefined)
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

/** The switches `add` takes, and the words that name a default instead of a value. */
export const MODEL_SWITCH = '--model'
export const HOST_SWITCH = '--host'
/** `set-model <member> --host-default`: the member runs the host's own model. */
export const HOST_DEFAULT = '--host-default'
/** `set-host <member> --crew-default`: the member starts on the crew's host. */
export const CREW_DEFAULT = '--crew-default'

/** A word that names a member, a role, a model or a host: not empty, and no switch. */
const aValue = (word: string | undefined): word is string => word !== undefined && word !== '' && !word.startsWith('-')

/** A value, or null when the word is the one that names the default; undefined when it is neither. */
const valueOrDefault = (word: string | undefined, default_word: string): string | null | undefined => (word === default_word ? null : aValue(word) ? word : undefined)

/** `add`'s switches, each at most once with a value after it; undefined when they are no way `add` is used. */
function addSwitches(words: readonly string[]): { model: string | null; host: string | null } | undefined {
  const given: Record<string, string> = {}
  for (let i = 0; i < words.length; i += 2) {
    const [name, value] = [words[i]!, words[i + 1]]
    if ((name !== MODEL_SWITCH && name !== HOST_SWITCH) || Object.hasOwn(given, name) || !aValue(value)) return undefined
    given[name] = value
  }
  return { model: given[MODEL_SWITCH] ?? null, host: given[HOST_SWITCH] ?? null }
}

/** The change the words after `martha crew` ask for, or undefined when they are no way a verb is used. */
export function theCrewChangeAsked(words: readonly string[]): CrewChange | undefined {
  const [verb, member, ...rest] = words
  if (!aValue(member)) return undefined
  if (verb === REMOVE) return rest.length === 0 ? { kind: REMOVE, member } : undefined
  if (verb === ADD) {
    const [role, ...switches] = rest
    const given = aValue(role) ? addSwitches(switches) : undefined
    return given === undefined ? undefined : { kind: ADD, member, role: role!, ...given }
  }
  if (rest.length !== 1) return undefined
  if (verb === SET_MODEL) {
    const model = valueOrDefault(rest[0], HOST_DEFAULT)
    return model === undefined ? undefined : { kind: SET_MODEL, member, model }
  }
  if (verb !== SET_HOST) return undefined
  const host = valueOrDefault(rest[0], CREW_DEFAULT)
  return host === undefined ? undefined : { kind: SET_HOST, member, host }
}

/** What the changed member is now, in one line. */
function theChangeInALine(change: CrewChange, settings: CrewSettings): string {
  if (change.kind === ADD) return `${change.member} is on the crew now, as ${change.role}.`
  if (change.kind === REMOVE) return `${change.member} is off the crew now. Its node id stays in Martha's state, so adding ${change.member} again keeps it.`
  if (change.kind === SET_MODEL) return `${change.member}'s model is ${change.model ?? "the host's own"} now.`
  return `${change.member}'s host is ${change.host ?? `the crew's, ${settings.host},`} now.`
}

/**
 * When a member's model is one its host does not run, which the host's models it does (DECIDED 2026-11-19: no new
 * check, so the change is written and the owner is told).
 */
function theModelsItsHostRuns(change: CrewChange, settings: CrewSettings, vocabularies: TheVocabulariesOfHost): readonly string[] {
  const member = change.kind === REMOVE ? undefined : theMemberChanged(settings, change)
  if (member === undefined || member.model === null) return []
  const host = theHostOfMember(settings, member), vocabulary = vocabularies.get(host)
  if (vocabulary === undefined || hostRuns(vocabulary, member.model)) return []
  return [`${host} runs ${vocabulary.names.join(', ')}, and ${member.model} is not one of them, so ${member.name} may not start on it.`]
}

/** The lines the owner is told once the change is written. */
export function theChangeTold(change: CrewChange, outcome: Extract<TheChange, { readonly after: string }>, vocabularies: TheVocabulariesOfHost): readonly string[] {
  const declaration = outcome.settings.paths.declaration
  return [
    theChangeInALine(change, outcome.settings),
    ...theModelsItsHostRuns(change, outcome.settings, vocabularies),
    ...(change.kind === SET_MODEL || change.kind === SET_HOST ? [`A running ${change.member} takes it at its next restart.`] : []),
    ...(outcome.reformatted ? [`${declaration} was not in the format martha init writes, and is written in it now.`] : []),
    `${declaration} is a file of the checkout: commit it when you are ready.`,
  ]
}
