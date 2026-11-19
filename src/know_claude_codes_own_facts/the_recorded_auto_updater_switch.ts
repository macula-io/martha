// The switch every Claude Code launch hands the host, as the recorded host spells it (martha#637).
//
// A launch gives the host a home of its own, so the host starts with its auto-updater on, and a release behind npm's
// latest updates itself with `npm install --global` over the owner's own Claude Code (martha#460). Every launch sets the
// variable the host's updater reads, to a value it takes as off.
//
// Both are the recording's, never a constant here: they are cut from the host's binary by the recorder
// (../record_claude_code_host/the_auto_updater_switch.ts), so a release that renames the variable, changes how it is
// decided, or gives it another value fails host drift by name, and no launch sets a switch that release no longer reads.
// It stays an environment variable and not a settings key: the settings answer (`autoUpdates`) lives in the owner's
// `~/.claude.json`, which a member's own home never reads.
//
// The recording is read here as its own file and not through ../claude_code_host/recorded_claude_code_host.ts: that
// module loads the refresh's taint table, which a launch's own chain already loads, so a value import of it from here
// closes a loop of imports (check:no-import-cycle). The switch is checked for here, as that module checks the fields it
// reads.

import recording from '../claude_code_host/recorded_claude_code_host.json' with { type: 'json' }
import type { AutoUpdaterSwitch } from '../record_claude_code_host/the_auto_updater_switch.ts'

/** The environment a launch adds for the switch: the recorded variable, at the recorded value, and nothing else. */
export function theAutoUpdaterSwitchOf(recorded: AutoUpdaterSwitch): Readonly<Record<string, string>> {
  return { [recorded.variable]: recorded.off_value }
}

/** The recorded switch, refused when the recording holds none: a launch without it would update the owner's own copy. */
function theRecordedSwitch(held: { readonly auto_updater_switch?: AutoUpdaterSwitch }): AutoUpdaterSwitch {
  const recordedSwitch = held.auto_updater_switch
  if (recordedSwitch === undefined || recordedSwitch.variable === '' || recordedSwitch.off_value === '') {
    throw new Error("The recording does not hold the switch that keeps the host's auto-updater off, so a launch of it would update the owner's own Claude Code (martha#637).")
  }
  return recordedSwitch
}

/** The switch every Claude Code launch sets, as the committed recording holds it. */
export const CLAUDE_AUTO_UPDATER_OFF: Readonly<Record<string, string>> = theAutoUpdaterSwitchOf(theRecordedSwitch(recording))
