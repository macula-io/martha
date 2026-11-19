// The time a probe gives the host to draw a screen it needs (martha#313, martha#812), in one place.
//
// The dialog-order probe waits for the host's banner, then for the dialog a typed message raises. The Bash-answers
// harness waits for no screen, but bounds each case by what a probe allows a host to go from launch to the call it
// needs, which is those two waits added. One definition, so a slow machine is given the same time in both, and a change
// to it reaches every probe rather than leaving one stricter than the other.

/** How long the host is given to draw its prompt, from the moment it is started. */
export const WELCOME_WAIT_MS = 60000

/** How long the host is given, from a message typed at its prompt, to draw the dialog that message raises. */
export const DIALOG_WAIT_MS = 45000
