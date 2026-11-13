// What the launcher answers with, read where the reading can be proved (martha#255 r=2, R1 and R2).
//
// These two parsers sat inside the hooks module, and nothing could reach them there: the host installs the relay as a
// copy of its own folder, so no test imports the module the host loads, and the words on either end of the wire were
// checked against nothing. A launcher answering `submit` where the mod read `prompt` submits no handover at all, and
// every test passed. They are plain functions in their own file here — imported by ./crew.tsx, which is the one module
// the host loads — and ./crew_answers.node-test.ts drives them with the launcher's own answers, so a reworded order or
// a pane that stopped carrying its rows is red by name.

/**
 * The order a session is given (martha#255): submit this text, clear the session, or nothing at all.
 *
 * The same shape the launcher answers in, ../../refresh_a_member/the_refresh_flow.ts `TheOrder`, which this copy
 * cannot import. The two are held together by ./crew_answers.node-test.ts, which puts the launcher's real answer
 * through `orderIn` and the mod's real order through it too.
 */
export type TheOrder = { readonly carry: 'submit'; readonly text: string } | { readonly carry: 'clear' } | { readonly carry: 'none' }

/** What the pane draws, as the launcher answers it (martha#254): its header, one line per member, and how it opens. */
export interface ThePaneShown {
  readonly header: string
  readonly lines: readonly string[]
  readonly open_at_start: boolean
  readonly rows: number
  readonly redraw_ms: number | null
}

/**
 * The pane's own chrome, for an answer that does not say how many rows it wants (martha#254).
 *
 * The launcher's count of the same thing is `PANE_CHROME_ROWS` in ../see_the_crew/see_the_crew.ts, which a hooks
 * module cannot reach; ./crew_answers.node-test.ts holds the two to the same number, so a revalue on either side is
 * red by name (r=2 R2).
 */
export const PANE_CHROME_ROWS = 3

/** The order the launcher's answer carries, or null when it is not one this mod knows. */
export function orderIn(said: string): TheOrder | null {
  try {
    const parsed = JSON.parse(said) as { readonly carry?: unknown; readonly text?: unknown }
    if (parsed.carry === 'clear' || parsed.carry === 'none') return { carry: parsed.carry }
    if (parsed.carry === 'submit' && typeof parsed.text === 'string' && parsed.text !== '') return { carry: 'submit', text: parsed.text }
    return null
  } catch {
    return null
  }
}

/** What the pane draws, from the answer the launcher gives, or null when the answer is not one it can draw. */
export function paneIn(said: string): ThePaneShown | null {
  try {
    const parsed = JSON.parse(said) as Partial<ThePaneShown>
    if (typeof parsed.header !== 'string' || !Array.isArray(parsed.lines)) return null
    const { header, lines, rows, redraw_ms } = parsed
    return { header, lines, open_at_start: parsed.open_at_start === true, rows: rows ?? PANE_CHROME_ROWS, redraw_ms: redraw_ms ?? null }
  } catch {
    return null
  }
}

/**
 * The owner's to-do list as the pane draws it (martha#316): the launcher's `TodoPane` in
 * ../../keep_the_owners_todo_list, which this copy cannot import. Only the focused row is revealed, and only a
 * revealed row carries the text a copy puts on the clipboard; ./crew_answers.node-test.ts holds the two shapes together.
 */
export interface TheOwnersListShown {
  readonly heading: string
  readonly claim: string
  readonly focus: string
  readonly next: string
  readonly rows: readonly TheOwnersRowShown[]
  /** The Supervisor's standing items under the list (martha#317): a heading and one line each, or none. */
  readonly standing: readonly string[]
  readonly lines: number
}

/** One row of the owner's list as the pane draws it. */
export interface TheOwnersRowShown {
  readonly id: string
  readonly heading: string
  readonly goal: string
  readonly revealed: boolean
  readonly acts: readonly { readonly does: string; readonly line: string }[]
  readonly copy: string
}

/** The owner's list from the launcher's answer, or null when it is not one the pane can draw. */
export function theOwnersListIn(said: string): TheOwnersListShown | null {
  try {
    const parsed = JSON.parse(said) as Partial<TheOwnersListShown>
    const { heading, claim, focus, next, rows, standing, lines } = parsed
    if (typeof heading !== 'string' || typeof claim !== 'string' || typeof focus !== 'string' || typeof next !== 'string') return null
    if (!Array.isArray(standing) || standing.some((line) => typeof line !== 'string')) return null
    return Array.isArray(rows) && typeof lines === 'number' ? { heading, claim, focus, next, rows, standing, lines } : null
  } catch {
    return null
  }
}
