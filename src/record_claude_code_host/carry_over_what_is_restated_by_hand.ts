// What a re-recording keeps from the committed recording rather than deriving it
// from the host's binary (martha#136).
//
// Two fields are written by hand: the recording's own note on where it comes
// from, and memory_off, which a person re-reads from a host version's code and
// restates. Deriving them would let a re-record drop the memory guard silently;
// carrying them over keeps it until someone restates it, and the memory_off test
// fails the re-recorded version until then. --check does not compare them with a
// derived value, since none is derived; it holds memory_off to the host's code
// instead: every text it quotes must still be there, or --check names it
// (martha#412). What the file-mode guard it quotes calls is derived, and
// recorded for drift alone (martha#438).

import type { MemoryOff, RecordedHost } from '../claude_code_host/recorded_claude_code_host.ts'
import type { GuardCalls } from '../compare_two_host_recordings/what_a_recorded_text_calls.ts'
import { normalized, Renaming, Unreadable } from '../compare_two_host_recordings/compare_under_renaming.ts'

/** The recording's own note on where it comes from. */
export const NOTE = '_why'
/** How the host keeps memory off, restated by hand for a version (martha#136). */
export const MEMORY_OFF = 'memory_off'
/** The fields carried over from the committed recording, which --check compares with no derived value. */
export const CARRIED: readonly string[] = [NOTE, MEMORY_OFF]

/**
 * What the recording holds for host drift alone, which no gate reads: the functions the markdown loader's
 * managed-folder guard reaches (martha#412) and those the file-mode memory guard reaches (martha#438), so a change
 * inside one of them fails --check by name.
 */
export interface RecordedForDriftAlone {
  readonly managed_folder_guard_calls: GuardCalls
  readonly file_mode_guard_calls: GuardCalls
}

/** What each code field's texts call, followed through the bundle, by the field that holds it (martha#811, R6). */
export type Callees = Readonly<Record<string, GuardCalls>>

/** What the recorder derives from a host's binary: everything but the version and what is carried over. */
export type Derived = Omit<RecordedHost, 'host_version' | typeof MEMORY_OFF> & RecordedForDriftAlone

/** The committed recording, as the recorder reads it. */
export type Committed = RecordedHost & RecordedForDriftAlone & { readonly [NOTE]: string }

/** Whether two texts of code say the same once the minifier's names are taken out of each (martha#811). */
function sameUnderRenaming(one: string, other: string): boolean {
  try {
    return normalized(one, 'program', new Renaming()) === normalized(other, 'program', new Renaming())
  } catch (error) {
    if (error instanceof Unreadable) return false
    throw error
  }
}

/**
 * Whether the memory guard restated by hand still holds of a host's code (martha#412): the host's file-mode guard is
 * the one it quotes, the on check it quotes is among the functions that guard reaches, and the hosted-mode variable it
 * names is still in the code. The guard and the on check are code, so they hold under the minifier's renaming
 * (martha#811); the variable is the host's own word and must be there as written. A host that changed any of them
 * fails --check by the field's name, rather than passing because nothing derived it.
 */
export const memoryOffHoldsOf = (memory_off: MemoryOff, text: string, guard: string, reached: GuardCalls): boolean =>
  text.includes(memory_off.hosted_mode_variable) &&
  sameUnderRenaming(memory_off.file_mode_guard, guard) &&
  reached.functions.some((entry) => sameUnderRenaming(memory_off.on_check, entry.function))

/** The recording to write: the carried fields from the committed one, the version given, the rest derived, and what the code fields call. */
export function recordingFrom(committed: Committed, host_version: string, derived: Derived, callees: Callees): Committed {
  return { [NOTE]: committed[NOTE], host_version, [MEMORY_OFF]: committed[MEMORY_OFF], ...derived, ...callees }
}
