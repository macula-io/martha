// The `switch_your_model` and `return_to_your_own_model` tools (martha#315, #443 part 5): their names, what each is for,
// the schema of what each takes, and what a switch and a return move.
//
// A member's model, switched for one package and returned home: the record in the crew store (./switch_a_members_model),
// the ledger's checkpoint row for each, and the three return triggers. What the member is TOLD is decided here; what the
// host does about it is one order (../refresh_a_member/the_refresh_flow.ts `CARRY_A_MODEL`) the mod carries out at the end
// of the turn, because a host command cannot run inside a turn that is waiting on the tool that asked for it. The tools
// slice (../a_crews_tools) keeps only the table that calls this.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { A_PACKAGE } from '../keep_the_ledger/the_ledger_tools.ts'
import { noteMilestone, type LedgerHost } from '../log_ledger/log_ledger.ts'
import {
  homeModelOf,
  modelPlace,
  returnAMemberHome,
  switchAMembersModel,
  theModelOf,
  theSwitchACallAsks,
  type ModelMarker,
} from './switch_a_members_model.ts'

/**
 * The name the model switch is registered under (martha#315). A verb, as the nine tools beside it are: the owner's
 * decision of 2026-11-13 took the `crew_` prefix off every tool, and the design's `crew_model` predates that by hours.
 */
export const SWITCH_YOUR_MODEL = 'switch_your_model'

/** The name the return is registered under (martha#315): one act each, as `park_a_member` and `wake_a_member` are. */
export const RETURN_TO_YOUR_OWN_MODEL = 'return_to_your_own_model'

/** What `switch_your_model` says it is for: one package, one model the declaration names, and when it happens. */
export const SWITCH_YOUR_MODEL_DESCRIPTION =
  'Run on another model for one work package. The model must be one this crew\'s declaration names for you: your own ' +
  'model, or the crew\'s review_model — anything else is refused by name. The switch happens at the end of this turn, ' +
  'and you return to your own model when you park, report progress on another package, or call ' + '`return_to_your_own_model`.'

/** What `return_to_your_own_model` says it is for: the other half of the switch, and when it happens. */
export const RETURN_TO_YOUR_OWN_MODEL_DESCRIPTION =
  'Return to your own model now, ending a switch made with `switch_your_model`. The record of what the package ran on ' +
  'is kept. You would be returned automatically when you park or report progress on another package; this is for ending ' +
  'a switch while you still hold the package.'

/** The model a switch names (martha#315): one the declaration names for this member. */
const A_MODEL: Readonly<Record<string, unknown>> = {
  type: 'string',
  description: 'The model to run on: one this crew\'s declaration names for you (your own model, or its review_model)',
}

/** What `switch_your_model` takes, as the mod registers it. */
export const SWITCH_YOUR_MODEL_TOOL = {
  name: SWITCH_YOUR_MODEL,
  description: SWITCH_YOUR_MODEL_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      model: A_MODEL,
      package: A_PACKAGE,
      reason: { type: 'string', description: 'Why you switch, in one line: the ledger and the row read it' },
    },
    required: ['model', 'package', 'reason'],
  },
}

/** What `return_to_your_own_model` takes, as the mod registers it. */
export const RETURN_TO_YOUR_OWN_MODEL_TOOL = {
  name: RETURN_TO_YOUR_OWN_MODEL,
  description: RETURN_TO_YOUR_OWN_MODEL_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: { reason: { type: 'string', description: 'Why you come back, in one line: the ledger and the row read it' } },
    required: ['reason'],
  },
}

/**
 * Where a switch is recorded, whose row and ledger its checkpoints are written to: the crew's own store, this member,
 * and the streams its record and its checkpoint rows live in.
 */
export interface TheTriggerPlace {
  readonly stores: TheCrewFilesStores
  readonly member: string
  readonly ledger: LedgerHost
}

/** What a switch is asked over: where its record goes, and the declaration whose named models it is checked against. */
export interface ASwitchToolAsked extends TheTriggerPlace {
  readonly settings: CrewSettings
}

/** What the tools answer: the line the member is told, or why nothing moved. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/** `switch_your_model`: a model the declaration names, for one package, recorded and told. */
export async function switchTheModelOver(asked: ASwitchToolAsked, args: Readonly<Record<string, unknown>>): Promise<AToolAnswer> {
  const place = modelPlace(asked)
  if ('refusal' in place) return { refused: place.refusal }
  const current = theModelOf(place, asked.member)
  if (current.kind === 'unreadable') return { refused: current.refusal }
  // The tool's own argument is `reason`, as a park's and a wake's are; the record calls it why.
  const switching = theSwitchACallAsks({ model: args['model'], package: args['package'], why: args['reason'] }, asked.settings, asked.member)
  if (typeof switching === 'string') return { refused: switching }
  const home = homeModelOf(asked.settings, asked.member)
  const switched = switchAMembersModel(asked, { ...switching, member: asked.member, home, at: new Date(asked.ledger.clock.now()) })
  if ('refusal' in switched) return { refused: switched.refusal }
  const notKept = await keepTheModelCheckpoint(asked, switched.package, `switched to ${switching.model} for the package: ${switching.why}`)
  return { answer: `${whatASwitchTells(switching, home)}${notKept}` }
}

/** `return_to_your_own_model`: a switched member comes home, and nothing is directed when it is home already. */
export async function returnToYourOwnModelOver(asked: TheTriggerPlace, args: Readonly<Record<string, unknown>>): Promise<AToolAnswer> {
  const reason = textOf(args['reason'])
  if (reason === '') return { refused: 'a return says why in one line, and this one says nothing' }
  const place = modelPlace(asked)
  if ('refusal' in place) return { refused: place.refusal }
  const current = theModelOf(place, asked.member)
  if (current.kind === 'unreadable') return { refused: current.refusal }
  // A switch recorded and not yet directed is still a switch: the member asked for the other model and has changed its
  // mind before the end of the turn, so the record goes home and no order follows it (the switch never moved the
  // session). Reading this as "no switch is recorded" would keep the record switched and move the member anyway.
  if (current.kind !== 'switched') {
    return { answer: `${asked.member} is on its own model already: no switch is recorded, so there is nothing to direct.` }
  }
  return { answer: await returnedHome(asked, current.marker, reason) }
}

/**
 * What a switch tells the member: the model, the package, and every way it comes back — so the member never has to ask
 * when the switch ends. The home is always one the declaration names (martha#315 r=2 refuses a switch for a member
 * that declares none), so it is named here as the member will read it.
 */
function whatASwitchTells(switching: { readonly model: string; readonly package: string }, home: string): string {
  return (
    `Switching to ${switching.model} for ${switching.package} at the end of this turn; back to ${home} when you park, ` +
    `report progress on another package, or call ${RETURN_TO_YOUR_OWN_MODEL}.`
  )
}

/** A member returned home: the record written, the ledger told, and the member told what happens next. */
async function returnedHome(asked: TheTriggerPlace, marker: ModelMarker, why: string): Promise<string> {
  const returned = returnAMemberHome(asked, { member: asked.member, marker, why, at: new Date(asked.ledger.clock.now()) })
  if ('refusal' in returned) return `Not recorded: ${returned.refusal}.`
  const notKept = await keepTheModelCheckpoint(asked, marker.package, `back from ${marker.model}: ${why}`)
  return `Back to ${marker.home} at the end of this turn: ${why}.${notKept}`
}

/** The return a park or a return tool makes of it, or null when this member is not switched. */
export async function returnedForTrigger(asked: TheTriggerPlace, why: string): Promise<string | null> {
  const place = modelPlace(asked)
  if ('refusal' in place) return null
  const current = theModelOf(place, asked.member)
  if (current.kind !== 'switched') return null
  return await returnedHome(asked, current.marker, why)
}

/**
 * The return a report makes of it when it names another package: a member that moves on to new work is back on its own
 * model, unless the switch was made for the package it now holds (then it keeps the switch for that work).
 */
export async function returnedForAnotherPackage(asked: TheTriggerPlace, holds: string): Promise<string | null> {
  const place = modelPlace(asked)
  if ('refusal' in place) return null
  const current = theModelOf(place, asked.member)
  if (current.kind !== 'switched' || holds === '' || holds === current.marker.package) return null
  return await returnedHome(asked, current.marker, `you reported progress on ${holds}`)
}

/**
 * The ledger's checkpoint row for a switch or a return (martha#315): one line on the package, so the owner can see what
 * a package cost on which model. The record in the crew store is what the return is decided by, so a row the ledger
 * would not keep is said to the member and changes nothing else.
 */
export async function keepTheModelCheckpoint(asked: TheTriggerPlace, package_name: string, note: string): Promise<string> {
  if (package_name === '') return ''
  try {
    await noteMilestone(asked.ledger, { package: package_name, member: asked.member, milestone: 'checkpoint_reached', note })
    return ''
  } catch (error) {
    return ` Note: the ledger did not keep this row (${error instanceof Error ? error.message : String(error)}), so the package's history is missing it.`
  }
}

/** A field of a call as text, trimmed; '' when it names none. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
