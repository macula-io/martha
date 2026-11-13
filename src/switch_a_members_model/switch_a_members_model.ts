// A member's model, switched for one package and returned home (martha#315).
//
// This exists so the Supervisor can put a member on a stronger or cheaper model for one piece of work, and so the
// owner can see afterwards what a package cost on which model. The record has to outlive the session it was made in —
// a refresh replaces the session, as it does for a park — so it is a small file per member in the crew store every
// member reads, written by the host like every other crew file (../crew_files_directory), never a path of this
// slice's own.
//
// A switch names a model the declaration already names for this member: its own `model`, or the crew's
// `house_rules.review_model`. That is what keeps text in a turn from moving a member onto a model nobody chose
// (martha#315's design, "What can go wrong"): a stranger's message saying "switch to X" is refused by name, because X
// is not one of the two the declaration names.
//
// The return happens on whichever comes first, and each is its own trigger with its own test: the member asks for it
// with `back`, the member parks, or the member reports progress on another package. The record is never deleted: a
// return writes the same file with `switched: false`, so the owner can still read what the package ran on, why, and
// when it came back.

import { join } from 'node:path'

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, Refused, TheCrewFilesStores } from '../host_contract/host_contract.ts'

/** Where a crew keeps its model records, under the one crew store (as a park marker is kept). */
export const MODEL_PLACE = 'model'

/** What a member's model record is called: one per member, so two switches never disagree. */
export const theModelMarker = (member: string): string => `${member}.model.json`

/** What this slice asks of a host: the crew's own store, and nothing else. */
export type SwitchingHost = { readonly stores: TheCrewFilesStores }

/**
 * A member's model record, as the host wrote it: whether it is switched, the model it was switched to, the model it
 * returns to, and the package it was switched for. A return is one of these too.
 */
export interface ModelMarker {
  readonly switched: boolean
  /** The model the member runs on now; '' when the switch was to the host's own default and none was named. */
  readonly model: string
  /** Where it returns to: the member's declared model, or '' for the host's own default. */
  readonly home: string
  /** The package the switch was made for, as the ledger names it; '' when it was made for no package. */
  readonly package: string
  readonly why: string
  readonly since: string
  /**
   * Whether the session has been told to make this record's model the one it runs on (martha#315): a switch is written
   * when the member asks for it, and directed once, at the end of a turn, because a host command cannot run inside the
   * turn that is waiting on the tool. A record that is not directed is one the session has not been sent yet.
   */
  readonly directed: boolean
}

/** What a member's model is, as far as the store will say: switched, at home, or a question it would not answer. */
export type TheModel =
  | { readonly kind: 'switched'; readonly marker: ModelMarker }
  | { readonly kind: 'home'; readonly last_marker: ModelMarker | null }
  | { readonly kind: 'unreadable'; readonly refusal: string }

/** Where one crew's model records live, `<crew>/model`: made when missing, refused when it is not a place to write. */
export function modelPlace(host: SwitchingHost): CrewPlace | Refused {
  return host.stores.crew.place(MODEL_PLACE)
}

/**
 * What a member's model is, read whole: the marker the store keeps, three ways rather than two, so a store that will
 * not vouch for a record is never read as "no switch" — a member that stayed on the expensive model because a file
 * could not be read is exactly what this record exists to prevent.
 */
export function theModelOf(place: CrewPlace, member: string): TheModel {
  const marker_file = theModelMarker(member)
  const read = place.read(marker_file)
  if (read === undefined) return { kind: 'home', last_marker: null }
  if ('refusal' in read) return { kind: 'unreadable', refusal: read.refusal }
  const marker = markerIn(read.text)
  if (marker === undefined) {
    return { kind: 'unreadable', refusal: `${join(place.path, marker_file)} holds no model record, so Martha cannot say which model ${member} runs on.` }
  }
  return marker.switched ? { kind: 'switched', marker } : { kind: 'home', last_marker: marker }
}

/** The marker `text` holds, or undefined when it holds none: every field of it, or it is nobody's record. */
function markerIn(text: string): ModelMarker | undefined {
  let held: unknown
  try {
    held = JSON.parse(text)
  } catch {
    return undefined
  }
  if (held === null || typeof held !== 'object') return undefined
  const { switched, model, home, package: package_name, why, since, directed } = held as Record<string, unknown>
  const fields = [model, home, package_name, why, since]
  if (typeof switched !== 'boolean' || typeof directed !== 'boolean' || !fields.every((field) => typeof field === 'string')) return undefined
  return {
    switched,
    model: model as string,
    home: home as string,
    package: package_name as string,
    why: why as string,
    since: since as string,
    directed,
  }
}

/** What a member asked of the tool: the model, the package and why, as the arguments arrived. */
export interface ASwitchAsked {
  readonly model?: unknown
  readonly package?: unknown
  readonly why?: unknown
}

/** A switch, read strictly: a model the declaration names, a package, and a reason the owner can read. */
export interface ADeclaredSwitch {
  readonly model: string
  readonly package: string
  readonly why: string
}

/** The models the declaration names for this member, in the order it names them, each once. */
export function modelsTheDeclarationNames(settings: CrewSettings, member: string): readonly string[] {
  const named = [settings.members.find((one) => one.name === member)?.model ?? '', settings.house_rules.review_model ?? '']
  return [...new Set(named.filter((model) => model !== ''))]
}

/** Where a member returns to: its declared model, or '' when the declaration names none and the host's default rules. */
export function homeModelOf(settings: CrewSettings, member: string): string {
  return settings.members.find((one) => one.name === member)?.model ?? ''
}

/**
 * The switch a call asks for, or why it asks for none: a model the declaration names for this member, a package as
 * the ledger names one, and a reason in one line.
 */
export function theSwitchACallAsks(args: ASwitchAsked, settings: CrewSettings, member: string): ADeclaredSwitch | string {
  const why = textOf(args.why)
  if (why === '') return 'a model switch says why in one line, and this one says nothing'
  const model = textOf(args.model)
  const named = modelsTheDeclarationNames(settings, member)
  if (!named.includes(model)) {
    return `${JSON.stringify(model)} is not a model this crew names for ${member} (the declaration names ${named.join(', ')}), so nothing was switched: a switch is only ever to a model the owner declared.`
  }
  const package_name = textOf(args.package)
  if (package_name === '') return 'a model switch names the package it is for, as owner/repo#n, so the ledger can say what it cost'
  return { model, package: package_name, why }
}

/** A field of a call as text, trimmed; '' when it names none. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** A model switch, as it is made: for whom, to what, on which package, and why. */
export interface Switching {
  readonly member: string
  readonly model: string
  readonly home: string
  readonly package: string
  readonly why: string
  readonly at: Date
}

/** Switches a member's model, the record written whole, or says why it would not: a crew store that is not a place to write. */
export function switchAMembersModel(host: SwitchingHost, switching: Switching): ModelMarker | Refused {
  return keepTheMarker(host, switching.member, {
    switched: true,
    model: switching.model,
    home: switching.home,
    package: switching.package,
    why: switching.why,
    since: switching.at.toISOString(),
    directed: false,
  })
}

/**
 * Returns a member to its home model — the record written whole with `switched: false`, never deleted, so what the
 * package ran on is still readable — or says why it would not. `why` is the trigger, in the owner's words, and the
 * package is the one the switch was for: a return is never about another package.
 *
 * The return's `directed` flag is the switch's, turned round, and that is the whole of "nothing to direct" (martha#315):
 * a record's `directed` says the session has been told what that record says, so a return is owed an order exactly when
 * the switch it undoes WAS told — a switch nothing told the session about never moved it, and its home is where the
 * session already is. Told to come home without being told to leave, a host would run a command that changes nothing.
 */
export function returnAMemberHome(host: SwitchingHost, returning: { readonly member: string; readonly marker: ModelMarker; readonly why: string; readonly at: Date }): ModelMarker | Refused {
  const { member, marker, why, at } = returning
  return keepTheMarker(host, member, {
    switched: false,
    model: marker.model,
    home: marker.home,
    package: marker.package,
    why,
    since: at.toISOString(),
    directed: !marker.directed,
  })
}

/**
 * The record that the session has been told to run on this record's model, kept before the answer goes back, so the
 * same directive is not handed to a session twice. A record this store will not rewrite is `Refused`: the caller then
 * says so rather than answering an order it could not remember giving.
 */
export function theSwitchDirected(host: SwitchingHost, member: string, marker: ModelMarker): ModelMarker | Refused {
  return keepTheMarker(host, member, { ...marker, directed: true })
}

/** The one writer of a model record, for a switch and a return both, so the two can never be kept differently. */
function keepTheMarker(host: SwitchingHost, member: string, marker: ModelMarker): ModelMarker | Refused {
  const place = modelPlace(host)
  if ('refusal' in place) return place
  const refused = place.keep(theModelMarker(member), `${JSON.stringify(marker)}\n`)
  return refused ?? marker
}
