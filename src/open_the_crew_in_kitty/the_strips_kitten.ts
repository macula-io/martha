// The strip's two remote-control calls (#547 S6): `martha crew --tab-of <member>`, run by kitty as the split under a
// member, retitles that member's tab and sizes its own window through `kitten @`, over the private line kitty gave
// it (KITTY_LISTEN_ON=fd:N). Nothing else is sent on it, and the checker kitty runs for the line refuses anything
// else (./the_session_kitty_reads's theCheckerSource).
//
// Neither call names a tab or window: `kitten` sends this window's own KITTY_WINDOW_ID as `self`, so each acts on the
// strip's own tab and window, and `resize-window` is asked with `--self`, since it acts on the active window without.

import { spawnSync } from 'node:child_process'

import { KITTEN, THE_STRIPS_ACTIONS } from './the_session_kitty_reads.ts'

const [SET_TAB_TITLE, RESIZE_WINDOW] = THE_STRIPS_ACTIONS as readonly [string, string]

/** One `kitten @` call: the action and its arguments. */
export type AKittenCall = readonly [action: string, ...args: string[]]

/** The call that titles the strip's own tab `title`; the title is an argument, never an escape sequence (#572). */
export const theTitleCall = (title: string): AKittenCall => [SET_TAB_TITLE, title]

/** The call that grows (or shrinks) the strip's own window by `rows`, or undefined when it already fits. */
export function theResizeCall(rows: number): AKittenCall | undefined {
  return rows === 0 ? undefined : [RESIZE_WINDOW, '--self', '--axis=vertical', `--increment=${rows}`]
}

/** The strip's side of kitty: a title setter and a sizer, each one `kitten @` call through `call`. */
export interface TheStripsKitten {
  readonly title: { readonly member: string; readonly set: (text: string) => void }
  /** Sizes the strip's window to `wanted` rows from the `has` it has now. */
  readonly fit: (wanted: number, has: number | undefined) => void
}

/** The strip of `member`'s tab, calling `kitten @` through `call`. */
export function theStripsKitten(member: string, call: (kitten: AKittenCall) => void): TheStripsKitten {
  return {
    title: { member, set: (text) => call(theTitleCall(text)) },
    fit: (wanted, has) => {
      const resize = has === undefined ? undefined : theResizeCall(wanted - has)
      if (resize !== undefined) call(resize)
    },
  }
}

/** `kitten @ <call>` on this machine; a refused call leaves the strip drawing, so its answer is not read. */
export function kittenOnThisMachine(kitten: AKittenCall): void {
  spawnSync(KITTEN, ['@', ...kitten], { stdio: 'ignore' })
}
