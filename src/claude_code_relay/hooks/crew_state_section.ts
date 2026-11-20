// The crew's state as one section of the member's system prompt (martha#984, gap 5 of martha#957).
//
// This exists so the member who assigns work reads the crew's live state on every request, not only at its start. The
// host fires `prompt.compose` for each request it renders; the mod asks the launcher for the text and adds it here as
// one `session` section with a stable id, after every section the host composed, so the host replaces it on each
// render and no stale copy stays in the conversation (Terra's design review R1).
//
// The mod decides nothing: the launcher builds the text for its own member and takes it into the session's record
// before it answers. Here only three things are ruled:
//
//   - A launcher that is not heard within CREW_STATE_WAIT_MS, says nothing, or says why it could not answer adds no
//     section, and never the one an earlier render had: nothing is kept between renders.
//   - The section goes last, on the `session` side, so no `shared` section follows it (the host skips a list that
//     puts one there).
//   - Whatever the host composed is handed back unchanged otherwise, and a composition this cannot read is left alone.

import type { Heard } from './crew_command.ts'

/** The section's id: a plugin's own is `<plugin>:<name>` in the host's words, and a hook above finds it by this. */
export const CREW_STATE_SECTION = 'martha:crew-state'

/**
 * How long a render waits for the launcher's answer before it goes on without the section (martha#984). Every request
 * the member's model makes waits on it, so it is short: the launcher answers from its own disk and asks no one.
 */
export const CREW_STATE_WAIT_MS = 2_000

/** One section of the system prompt as the host composes it. */
interface ASection {
  readonly id: string
  readonly text: string
  readonly scope: 'shared' | 'session'
}

/**
 * The launcher's text, or null when it was not heard in time, said nothing, or said why not. `after` is the host's
 * timer; the wait it starts is cancelled once the launcher answers.
 */
export async function theCrewStateHeardWithin(
  hear: () => Promise<Heard>,
  after: (ms: number, fn: () => void) => { cancel(): void },
  ms: number = CREW_STATE_WAIT_MS,
): Promise<string | null> {
  let timer: { cancel(): void } | undefined
  const late = new Promise<null>((resolve) => {
    timer = after(ms, () => resolve(null))
  })
  const heard = await Promise.race([hear().catch((): null => null), late])
  timer?.cancel()
  if (heard === null || !('said' in heard) || heard.said === '') return null
  return heard.said
}

/**
 * What the host composed, with the crew's state added last as a `session` section; unchanged when there is no text or
 * the composition holds no list of sections.
 */
export function withTheCrewState(composed: unknown, text: string | null): unknown {
  if (text === null || typeof composed !== 'object' || composed === null) return composed
  const sections = (composed as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return composed
  const section: ASection = { id: CREW_STATE_SECTION, text, scope: 'session' }
  return { ...composed, sections: [...(sections as unknown[]), section] }
}
