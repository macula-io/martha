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
// (martha#412).

import type { MemoryOff, RecordedHost } from '../claude_code_host/recorded_claude_code_host.ts'
import type { ManagedFolderGuardCalls } from './what_the_managed_folder_guard_calls.ts'

/** The recording's own note on where it comes from. */
export const NOTE = '_why'
/** How the host keeps memory off, restated by hand for a version (martha#136). */
export const MEMORY_OFF = 'memory_off'
/** The fields carried over from the committed recording, which --check compares with no derived value. */
export const CARRIED: readonly string[] = [NOTE, MEMORY_OFF]

/**
 * What the recording holds for host drift alone, which no gate reads (martha#412): the functions the markdown
 * loader's managed-folder guard reaches, so a change inside one of them fails --check by name.
 */
export interface RecordedForDriftAlone {
  readonly managed_folder_guard_calls: ManagedFolderGuardCalls
}

/** What the recorder derives from a host's binary: everything but the version and what is carried over. */
export type Derived = Omit<RecordedHost, 'host_version' | typeof MEMORY_OFF> & RecordedForDriftAlone

/** The committed recording, as the recorder reads it. */
export type Committed = RecordedHost & RecordedForDriftAlone & { readonly [NOTE]: string }

/**
 * Whether the memory guard restated by hand still holds of a host's code (martha#412): the file-mode guard and the on
 * check it quotes whole are still in it, and so is the hosted-mode variable it names. A host that changed any of them
 * fails --check by the field's name, rather than passing because nothing derived it.
 */
export const memoryOffHoldsOf = (memory_off: MemoryOff, text: string): boolean =>
  [memory_off.file_mode_guard, memory_off.on_check, memory_off.hosted_mode_variable].every((quoted) => text.includes(quoted))

/** The recording to write: the carried fields from the committed one, the version given, the rest derived. */
export function recordingFrom(committed: Committed, host_version: string, derived: Derived): Committed {
  return { [NOTE]: committed[NOTE], host_version, [MEMORY_OFF]: committed[MEMORY_OFF], ...derived }
}
