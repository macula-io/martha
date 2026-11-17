// A member's tab title (martha#572 part 2): who the member is, the state the crew's reader shows, how far it is, and a
// mark when it needs the owner.
//
// This exists so the tab bar shows the whole crew, one member per tab, in the words the crew's reader answered and in
// nothing else: the title is made from a `CrewRow` alone, so a tab can never call a member working while the pane calls
// it offline. Setting the title is the host's (kitty's `set-tab-title`, through remote control, #547 S6); this slice
// answers the text, and answers it only when it changed, so an unchanged crew retitles nothing.

import type { CrewRow } from '../see_the_crew/see_the_crew.ts'
import { TERMINAL_CONTROL } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'

/** What opens the title of a member that needs the owner, so that tab stands out in the bar. */
export const NEEDS_YOU_MARK = '(!) '

/** Between the parts of a title. */
const TITLE_PART = ' · '

/**
 * `text` with every character a terminal would act on removed (the same set the owner's lines escape): a member writes
 * its own task, and a title has no room for an escape written out.
 */
export function withoutControls(text: string): string {
  return text.replace(TERMINAL_CONTROL, '')
}

/** One member's tab title: the mark when it needs the owner, its name, its shown state, step/of, and its task. */
export function theTabTitle(row: CrewRow): string {
  const mark = row.state === 'needs-you' ? NEEDS_YOU_MARK : ''
  const parts = [withoutControls(row.member), row.state, `${row.progress.step}/${row.progress.of}`]
  const task = withoutControls(row.task)
  return `${mark}${(task === '' ? parts : [...parts, task]).join(TITLE_PART)}`
}

/**
 * The title to set for `member` in the reader's `rows`, or undefined when it is the one last set (`last`) or when the
 * member is not on the crew: a title is set once per change, never once per redraw.
 */
export function theTitleToSet(rows: readonly CrewRow[], member: string, last: string | undefined): string | undefined {
  const row = rows.find((one) => one.member === member)
  if (row === undefined) return undefined
  const title = theTabTitle(row)
  return title === last ? undefined : title
}
