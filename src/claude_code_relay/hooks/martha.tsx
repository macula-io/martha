// The hooks module the host loads for Martha's relay (martha#254).
//
// This exists because the host loads one hooks module per plugin: the relay's gates (./register.ts) and the crew's
// tools and pane (./crew.tsx) are two files beside this one, and a hooks.json that listed both was refused outright
// ("modules" that is not a list of at most one string), which would have left every gate a member has off.
//
// So this file is the one entry, and it only hands the host's registration to both. It decides nothing.
//
// It is a .tsx like the crew's module beside it, and for the same reason: the pane is drawn as the host draws one. The
// host compiles both when it loads the plugin, which is the check that matters for them (CI's "the relay loads in the
// recorded host"); this repository's own compiler reads the .ts files only.

import { register as registerTheCrew } from './crew.tsx'
import { register as registerTheRelay } from './register.ts'

/** Every hook this plugin registers: the relay's, then the crew's. */
export const register = (on: unknown): void => {
  registerTheRelay(on as Parameters<typeof registerTheRelay>[0])
  registerTheCrew(on as never)
}
