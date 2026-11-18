// What a recorded host's screen says, for a probe that has to read one (martha#693).
//
// The host does not write a line of text: it writes a word, moves the cursor to the column the next word starts at,
// writes that, and goes on, with colour, title and cursor-style sequences between the words. So a phrase the host drew
// is on the screen in pieces joined by moves -- `Enter`, a move to column 9, `to`, a move to column 12, `confirm` --
// and `drawn.includes('Enter to confirm')` is false however long the screen is read.
//
// These read such a screen the way a person does: the moves and titles are taken out, and the spaces are taken out of
// both sides of a comparison, so a phrase is found whichever way the host laid it down.

/** A title the terminal sets (OSC, ended by BEL or by ST). */
const A_TITLE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
/** A move, a colour, or a cursor style the host draws with (CSI). */
const A_MOVE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
/** Every space, tab and line break. */
const SPACES = /\s+/g

/**
 * What a screen says, as one run of characters: every sequence the terminal draws with is taken out, and so is every
 * space, because the host writes the space between two words as a cursor move to where the next one starts.
 */
export const plain = (drawn: string): string =>
  drawn.replace(A_TITLE, '').replace(A_MOVE, '').replace(SPACES, '')

/** Whether the screen says `phrase`, however the host laid it down (plain). */
export const says = (drawn: string, phrase: string): boolean => plain(drawn).includes(plain(phrase))

/**
 * What the host draws when it is at its prompt and has drawn everything it says around it: its own banner line. The
 * tip line under the prompt is not used, because it rotates with each start and this host draws none of the ones a
 * probe could guess; the banner is drawn with the prompt every time, the first one and the one after a clear.
 */
export const AT_ITS_PROMPT = 'Claude Code v'
