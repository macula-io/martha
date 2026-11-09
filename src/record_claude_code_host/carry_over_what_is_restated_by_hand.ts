// What a re-recording keeps from the committed recording rather than deriving it
// from the host's binary (martha#136).
//
// Two fields are written by hand: the recording's own note on where it comes
// from, and memory_off, which a person re-reads from a host version's code and
// restates. Deriving them would let a re-record drop the memory guard silently;
// carrying them over keeps it until someone restates it, and the memory_off test
// fails the re-recorded version until then. --check leaves both out.

import type { RecordedHost } from '../claude_code_host/recorded_claude_code_host.ts'

/** The recording's own note on where it comes from. */
export const NOTE = '_why'
/** How the host keeps memory off, restated by hand for a version (martha#136). */
export const MEMORY_OFF = 'memory_off'
/** The fields carried over from the committed recording, which --check leaves out. */
export const CARRIED: readonly string[] = [NOTE, MEMORY_OFF]

/** What the recorder derives from a host's binary: everything but the version and what is carried over. */
export type Derived = Omit<RecordedHost, 'host_version' | typeof MEMORY_OFF>

/** The committed recording, as the recorder reads it. */
export type Committed = RecordedHost & { readonly [NOTE]: string }

/** The recording to write: the carried fields from the committed one, the version given, the rest derived. */
export function recordingFrom(committed: Committed, host_version: string, derived: Derived): Committed {
  return { [NOTE]: committed[NOTE], host_version, [MEMORY_OFF]: committed[MEMORY_OFF], ...derived }
}
