// Where a home's Martha state root is, and the places it keeps (martha#519): the one rule the launcher that writes the
// state, `martha ls` and the reader of the leftovers a run leaves all take, so none of them can drift from the others.
//
// The root's own name and the mode of a directory only its owner may enter stay with the state's keeper
// (keep_martha_state_outside_the_checkout); this slice composes them into where a given home's root is.
//
// The records place is a member of THE_PLACES_A_STATE_ROOT_KEEPS rather than a constant of its own: a constant would
// make every test's scratch directory named 'launches' a restated value, in folders that may not rise, while the
// launcher and the leftovers' reader both take the place from the one record below.

import { isAbsolute, join } from 'node:path'

import { STATE_DIRECTORY_MODE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The state home under a home whose XDG_STATE_HOME names no place: `$HOME/.local/state`. A run that reads back what the
 * launcher kept derives it here rather than spelling the shape a second time. */
export const stateHomeUnder = (home: string): string => join(home, '.local', 'state')

/** The state root a home's own environment names: `$XDG_STATE_HOME/martha`, else `$HOME/.local/state/martha`. An
 * XDG_STATE_HOME that is set but empty or relative names no place, as an unset one does: the XDG spec holds a relative
 * one invalid, and every reader of the environment takes it here, so none reads a root another would not. */
export const stateRootOf = (home: string, xdg_state_home: string | undefined): string =>
  join(xdg_state_home !== undefined && isAbsolute(xdg_state_home) ? xdg_state_home : stateHomeUnder(home), STATE_ROOT_NAME)

/** What a reader of a home's state root keeps to: where that state root is, the place inside a project that holds the
 * launcher's launch records, and the mode of a directory only its owner may enter. The launcher takes the same three,
 * so the writer and the reader cannot disagree about them. */
export const THE_PLACES_A_STATE_ROOT_KEEPS = {
  state_root_of: stateRootOf,
  records_place: 'launches',
  only_its_owner_may_enter: STATE_DIRECTORY_MODE,
} as const
