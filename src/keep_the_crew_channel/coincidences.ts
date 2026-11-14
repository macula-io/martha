// The coincidences of keep_the_crew_channel: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import type { Addressee } from './crew_channel.ts'

/** The value of OPEN_THE_PANE, which lives in a hooks module (.tsx) that nothing outside the relay can import: the whole-crew
 * word of the Addressee union, kept once here as an alias of that union for every slice that excuses it. */
export const THE_WHOLE_CREW: Extract<Addressee, string> = 'crew'

/** Why this list spells the whole-crew word itself (#289 part b). */
const THE_PANES_CONSTANT_CANNOT_BE_IMPORTED = 'the whole-crew word, held once here for every slice that excuses it: the constant of that value is the pane command in a .tsx hooks module, which nothing outside the relay can import'

/** Why `'crew'` is written by literal where a message is addressed (#289 part b). */
export const THE_WHOLE_CREW_ADDRESSEE = 'the addressee that means every member, a member of the Addressee union compared at run time; the constant of that word is the command that opens the pane'

export const COINCIDENCES: readonly Exception[] = [
  { value: THE_WHOLE_CREW, file: 'keep_the_crew_channel/crew_channel.node-test.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'keep_the_crew_channel/crew_channel.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'keep_the_crew_channel/coincidences.ts', reason: THE_PANES_CONSTANT_CANNOT_BE_IMPORTED },
]
