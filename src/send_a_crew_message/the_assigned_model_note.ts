// The note an ASSIGN naming a model earns when its receiver is declared on another (martha#980 package 5).
//
// This exists so a supervisor who assigns work "on" a model hears at the send that the receiver runs something else,
// before the work starts on the wrong one. It is a port of crew-code's assignedModelNoteOf and assignedModelNote
// (hooks/register.tsx, core/roster.ts): a mismatch is noted beside the send, never refused, because the brief may ask the
// member to switch. crew-code reads the model off the receiver's beat; Martha reads the one its declaration gives it.
// A `model=` written `<model>@<provider>` is compared by its model alone: the declaration gives a member a model, and
// which provider serves it is the launch's.

import { sameMemberName } from '../declare_crew/declare_crew.ts'
import type { Addressee } from '../keep_the_crew_channel/crew_channel.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'
import type { CrewLineRead } from '../read_a_crew_line/read_a_crew_line.ts'

/** A member as the note reads it: its name, and the model its declaration gives it, null when it gives none. */
export interface ADeclaredModel {
  readonly name: string
  readonly model: string | null
}

const ASSIGN = 'ASSIGN'
const MODEL_KEY = 'model'

/** A model's name without its `claude-` prefix or a `[...]` context suffix, compared ignoring case as crew-code does. */
const bareModel = (model: string): string => model.trim().toLowerCase().replace(/\[[^\]]*\]$/, '').replace(/^claude-/, '')
const familyOf = (model: string): string => model.split('-')[0] ?? ''
/** `opus` names `opus-4-1`: an alias is a family alone. */
const isAliasOf = (alias: string, model: string): boolean => !alias.includes('-') && alias === familyOf(model)

/** Whether a member declared on `declared` runs the model an ASSIGN names (crew-code modelMatches, model part). */
export function modelMatches(wanted: string, declared: string): boolean {
  const want = bareModel(wanted.split('@')[0] ?? '')
  const runs = bareModel(declared)
  if (want === '' || runs === '') return false
  return want === runs || isAliasOf(want, runs) || isAliasOf(runs, want)
}

/** The note for one receiver and one named model, or '' when its declared model is that model. */
function noteFor(members: readonly ADeclaredModel[], name: string, wanted: string): string {
  const member = members.find((candidate) => sameMemberName(candidate.name, name))
  if (member === undefined || member.model === null) {
    return `Assigned with model=${wanted}, but the declaration gives ${name} no model to check it against: confirm the model before the work starts.`
  }
  if (modelMatches(wanted, member.model)) return ''
  return `Assigned with model=${wanted}, but ${member.name} is declared on ${member.model}. Ask for the switch in the brief, or assign the work to a member on that model.`
}

/**
 * The notes a message's ASSIGN lines earn, one per receiver and named model that do not match, each said once. A
 * message to the whole crew is checked against every member but its sender.
 */
export function assignedModelNotes(lines: readonly CrewLineRead[], to: Addressee, sender: string, members: readonly ADeclaredModel[]): readonly string[] {
  const wanted = lines.flatMap((line) => (line.verb === ASSIGN && (line.keys[MODEL_KEY] ?? '') !== '' ? [line.keys[MODEL_KEY] ?? ''] : []))
  if (wanted.length === 0) return []
  const receivers = to === THE_WHOLE_CREW ? members.map((member) => member.name).filter((name) => !sameMemberName(name, sender)) : to
  return [...new Set(receivers.flatMap((name) => wanted.map((model) => noteFor(members, name, model))).filter((note) => note !== ''))]
}
