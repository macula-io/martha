// What the launcher answers with, read where the reading can be proved (martha#255 r=2, R1 and R2).
//
// These two parsers sat inside the hooks module, and nothing could reach them there: the host installs the relay as a
// copy of its own folder, so no test imports the module the host loads, and the words on either end of the wire were
// checked against nothing. A launcher answering `submit` where the mod read `prompt` submits no handover at all, and
// every test passed. They are plain functions in their own file here — imported by ./crew.tsx, which is the one module
// the host loads — and ./crew_answers.node-test.ts drives them with the launcher's own answers, so a reworded order or
// a pane that stopped carrying its rows is red by name.

/**
 * The order a session is given (martha#255, #315): submit this text, clear the session, run the host's model command
 * with this model, or nothing at all.
 *
 * The same shape the launcher answers in, ../../refresh_a_member/the_refresh_flow.ts `TheOrder`, which this copy
 * cannot import. The two are held together by ./crew_answers.node-test.ts, which puts the launcher's real answer
 * through `orderIn` and the mod's real order through it too.
 */
export type TheOrder =
  | { readonly carry: 'submit'; readonly text: string }
  | { readonly carry: 'clear' }
  | { readonly carry: 'model'; readonly model: string }
  | { readonly carry: 'none' }

/**
 * The words an order carries its act under. They are literals because a hooks module imports only its own files, and
 * src/check_no_literal_restates_a_value/exceptions.ts declares each one against the core's constant (martha#255 r=2,
 * #315).
 */
const CARRY_A_TEXT = 'submit'
const CARRY_THE_CLEAR = 'clear'
const CARRY_A_MODEL = 'model'

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
    const parsed = JSON.parse(said) as { readonly carry?: unknown; readonly text?: unknown; readonly model?: unknown }
    return orderOf(parsed)
  } catch {
    return null
  }
}

/** One order, read field by field: the words it carries its act under, and the one field that act needs. */
function orderOf(parsed: { readonly carry?: unknown; readonly text?: unknown; readonly model?: unknown }): TheOrder | null {
  if (parsed.carry === CARRY_THE_CLEAR || parsed.carry === 'none') return { carry: parsed.carry }
  if (parsed.carry === CARRY_A_TEXT && typeof parsed.text === 'string' && parsed.text !== '') return { carry: CARRY_A_TEXT, text: parsed.text }
  // A model order names the model it switches to; one that names none is not an order this mod can carry out.
  if (parsed.carry === CARRY_A_MODEL && typeof parsed.model === 'string' && parsed.model !== '') return { carry: CARRY_A_MODEL, model: parsed.model }
  return null
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
