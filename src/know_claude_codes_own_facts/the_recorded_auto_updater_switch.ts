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
// The recording is this slice's own file and not the host adapter's ../claude_code_host/recorded_claude_code_host.json:
// a slice takes no setting outside the declaration and reaches the machine only through the host contract
// (prove_the_core/no_setting_outside_the_declaration), so the recorder writes the switch here, where the one reader
// that is a slice can load it. The recorder writes it from the same read of the binary that fills the adapter's
// recording, and --check holds both to the host.

import recording from './recorded_auto_updater_switch.json' with { type: 'json' }

/** How one host keeps its own auto-updater off (martha#637). */
export interface AutoUpdaterSwitch {
  /** The variable the host reads: set to the value below, the updater stays off. */
  readonly variable: string
  /** The function that asks the updater's question, whole. */
  readonly guard: string
  /** The function it asks, whole: which source turns the updater off, the switch among them. */
  readonly decision: string
  /** The function that decides the switch's value, whole: the values it reads as off. */
  readonly check: string
  /** The value the host's own code gives that variable, which is the value every launch sets. */
  readonly off_value: string
}

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

/** The switch this slice's recording holds, for the drift check and for a case that reads it. */
export const RECORDED_AUTO_UPDATER_SWITCH: AutoUpdaterSwitch = theRecordedSwitch(recording)

/** The switch every Claude Code launch sets, as the committed recording holds it. */
export const CLAUDE_AUTO_UPDATER_OFF: Readonly<Record<string, string>> = theAutoUpdaterSwitchOf(RECORDED_AUTO_UPDATER_SWITCH)
