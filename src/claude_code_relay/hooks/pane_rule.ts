// When the crew pane opens, and how many rows it asks for (martha#254).
//
// This exists as its own file so the one decision the pane makes can be read and tested without the host: the pane
// opens by itself at a session's start only when the crew's declaration switched the dashboard on, which the
// launcher's answer carries; `/crew` opens it either way, and that is the mod's own hook.
//
// The rule lives here, beside the mod that reads it, and the mod decides nothing of its own.

/** How many rows the pane's chrome takes: its status line, and the box's two borders. */
export const PANE_CHROME_ROWS = 3

/** Whether a `see_the_crew` answer says the pane opens at a session's start, as the declaration's switch says. */
export function opensAtStartOf(said: string): boolean {
  try {
    const parsed: unknown = JSON.parse(said)
    return typeof parsed === 'object' && parsed !== null && (parsed as { pane_at_start?: unknown }).pane_at_start === true
  } catch {
    return false
  }
}

/**
 * How many rows the pane asks the host for: one per member, one more for each member that needs the owner (its own
 * block), and the chrome. An answer that is not `see_the_crew`'s asks for the chrome alone.
 */
export function rowsToOpen(said: string): number {
  try {
    const parsed = JSON.parse(said) as { rows?: unknown }
    if (!Array.isArray(parsed.rows)) return PANE_CHROME_ROWS
    const needy = parsed.rows.filter((row) => (row as { state?: unknown }).state === 'needs-you').length
    return parsed.rows.length + needy + PANE_CHROME_ROWS
  } catch {
    return PANE_CHROME_ROWS
  }
}
