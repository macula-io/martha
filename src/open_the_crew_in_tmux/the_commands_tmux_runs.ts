// What `martha up` and `martha attach` hand tmux (martha#932): Martha's own server and its config, the commands that
// open one window per member, and the refusals made before anything opens. Everything here is words from values;
// nothing runs, reads or writes, so each piece is tested exactly.
//
// Martha runs its own tmux server (`tmux -L martha`, DECIDED 2026-11-20 by the Supervisor on #932), never the owner's:
// `-f` is read only when a server starts, so on the owner's server Martha's config would be skipped, or, had Martha
// started that server, would replace the owner's ~/.tmux.conf for their own sessions. With a server of its own, the
// owner's tmux and their ~/.tmux.conf are never read, written or stopped.
//
// tmux runs a command given as more than one word without a shell, word for word, so no value is quoted here. A name
// tmux cannot take as a target (`.` and `:` part one; a control byte or white space at either end) is refused by name,
// and so is a `#`: tmux expands a format in a name, and `#(...)` there runs a shell command.
//
// A member can reach this server's socket: it runs as the owner's own user, as every member does, and could type into
// another member's window. That is a speed bump, not a boundary, as kitty's files are (martha#1 decision 2). Other
// users cannot: tmux keeps its socket in a folder only the owner may enter, and checks the user of every client.

import { THE_FIRST_PROMPT_SWITCH } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { THE_TMUX_VARIABLE } from '../ring_the_owner/ring_the_owner.ts'

/** tmux, and the name of Martha's own server beside the owner's: kept here, so the words are said once. */
const TMUX = 'tmux'
const MARTHAS_SERVER = 'martha'

/** The program run for tmux. */
export const theTmuxProgram = (): string => TMUX

/** Whether a crew's declared terminal is tmux. */
export const opensInTmux = (terminal: string): boolean => terminal === TMUX

/** The oldest tmux Martha's config is read by: `allow-passthrough` came in 3.3, `extended-keys` in 3.2. */
export const TMUX_FLOOR = '3.3'

/** The variables tmux sets for the programs it runs: Martha's server is started with none of them, so it is never nested. */
export const TMUX_VARIABLES: readonly string[] = [THE_TMUX_VARIABLE, `${THE_TMUX_VARIABLE}_PANE`]

/** The share of a member's window the crew strip under it takes, in percent. */
export const THE_STRIPS_SHARE = 20

/** The two acts a window runs: the member held, and the crew strip under it. */
export const THE_ACTS_A_WINDOW_RUNS = { held: 'start', strip: 'crew' } as const

/**
 * Martha's config for its own server, read once when the server starts: Shift+Enter reaches Claude Code (extended
 * keys), a copy reaches the owner's clipboard and an escape reaches the owner's terminal (passthrough), and a member's
 * window stays open after it ends, so its last screen can still be read and the window started again.
 */
export const THE_SERVERS_CONFIG = [
  '# Written by martha up (martha#932): the settings of Martha\'s own tmux server. The owner\'s ~/.tmux.conf is never read.',
  'set -g extended-keys on',
  "set -as terminal-features 'xterm*:extkeys'",
  'set -g set-clipboard on',
  'set -g allow-passthrough on',
  'set -g remain-on-exit on',
  '',
].join('\n')

/** The words before every tmux command Martha runs: its own server, unless a test names one of its own, and its own config when the server starts. */
export const onMarthasServer = (config: string, server: string = MARTHAS_SERVER): readonly string[] => ['-L', server, '-f', config]

/** The exact target of a session, or of a window in it: `=` makes tmux match the name whole, never by its prefix. */
export const theSession = (id: string): string => `=${id}`
export const theWindow = (id: string, member: string): string => `=${id}:=${member}`

/** What opens a format in tmux: in a name it is expanded, never kept as written. */
const A_FORMAT = '#'

/** Why `name` cannot be a tmux session's or window's name, or undefined when it can. */
export function whyNotATarget(name: string): string | undefined {
  if ([...name].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) return `${JSON.stringify(name)} holds a control character, which tmux cannot take in a name`
  if (name !== name.trim() || name === '') return `${JSON.stringify(name)} is empty or starts or ends with white space`
  if (/[.:]/.test(name)) return `${JSON.stringify(name)} holds a . or a :, which tmux reads as a pane or a window`
  // tmux expands a format in a session's and a window's name, and #(...) in one runs a shell command (r=1).
  if (name.includes(A_FORMAT)) return `${JSON.stringify(name)} holds a #, which tmux expands in a name, running a command for #(...)`
  return undefined
}

/** What a member's window is opened with: the crew's root, and this release of `martha`. */
export interface AMembersWindow {
  readonly id: string
  readonly root: string
  readonly member: string
  /** The command that is this release of `martha`: the program and its arguments before the act. */
  readonly martha: readonly string[]
  /** The owner's first prompt for this member, typed in once its session starts (martha#919); none when not given. */
  readonly prompt?: string
}

const theMemberHeld = (window: AMembersWindow): readonly string[] => [
  ...window.martha, THE_ACTS_A_WINDOW_RUNS.held, window.member, ...(window.prompt === undefined ? [] : [THE_FIRST_PROMPT_SWITCH, window.prompt]),
]

/** The command that opens the crew's session, detached, with `window.member`'s window as its first. */
export const theSessionOpened = (window: AMembersWindow): readonly string[] => [
  'new-session', '-d', '-s', window.id, '-n', window.member, '-c', window.root, '--', ...theMemberHeld(window),
]

/** The command that opens `window.member`'s window in the crew's session, without leaving the window shown. */
export const theWindowOpened = (window: AMembersWindow): readonly string[] => [
  'new-window', '-d', '-t', `${theSession(window.id)}:`, '-n', window.member, '-c', window.root, '--', ...theMemberHeld(window),
]

/** The command that splits the crew strip under the member, the member's pane keeping the focus. */
export const theStripSplit = (window: AMembersWindow): readonly string[] => [
  'split-window', '-d', '-v', '-l', `${THE_STRIPS_SHARE}%`, '-t', theWindow(window.id, window.member), '-c', window.root, '--', ...window.martha, THE_ACTS_A_WINDOW_RUNS.strip,
]

/** The command that closes a window whose member has ended, so it is opened again in its place. */
export const theWindowClosed = (id: string, member: string): readonly string[] => ['kill-window', '-t', theWindow(id, member)]

/** Whether the crew's session is on Martha's server: tmux ends 0 when it is. */
export const theSessionAsked = (id: string): readonly string[] => ['has-session', '-t', theSession(id)]

/**
 * The session's windows, one line each: 1 when its member's pane has ended, else 0, a space, and the window's name. The
 * flag comes first, since tmux writes a tab out as `_` when its output is no terminal, and a name may hold a space.
 * The flag is read from the member's own pane, the window's first (r=1): a window's `pane_dead` is its active pane's,
 * and once the owner has looked at the strip under a member, that would be the strip's.
 */
export const theWindowsListed = (id: string): readonly string[] => ['list-windows', '-t', theSession(id), '-F', '#{P:#{?#{==:#{pane_index},0},#{pane_dead},}} #{window_name}']

/** A window as listed: its name, and whether the member in it has ended. */
export interface AWindow {
  readonly name: string
  readonly ended: boolean
}

/** The windows `list-windows` named, from theWindowsListed's lines. */
export function theWindowsIn(listed: string): readonly AWindow[] {
  return listed.split('\n').filter((line) => line !== '').map((line) => ({ name: line.slice(2), ended: line.startsWith('1 ') }))
}

/** The command `martha attach [<member>]` hands to tmux: the crew's session, at that member's window when one is named. */
export const theAttach = (id: string, member: string | undefined): readonly string[] => ['attach-session', '-t', member === undefined ? theSession(id) : theWindow(id, member)]

/** The version `tmux -V` names (`tmux 3.8`, `tmux 3.3a`, `tmux next-3.6`), as a dotted number; or undefined. */
export function theTmuxVersionIn(said: string): string | undefined {
  return /^tmux (?:next-)?(\d+\.\d+)/.exec(said.trim())?.[1]
}

/** Whether dotted version `found` is below `floor`. */
export function isBelow(found: string, floor: string): boolean {
  const [a, b] = [found, floor].map((version) => version.split('.').map(Number))
  for (let i = 0; i < Math.max(a!.length, b!.length); i += 1) {
    if ((a![i] ?? 0) !== (b![i] ?? 0)) return (a![i] ?? 0) < (b![i] ?? 0)
  }
  return false
}

/** Why the crew cannot be opened in tmux here, naming the fix; or undefined. */
export function whyTmuxCannotOpen(tmuxSays: string | undefined, id: string | null): string | undefined {
  if (tmuxSays === undefined) return 'this crew opens in tmux, and tmux is not on your PATH. Install tmux from your system\'s packages.'
  const found = theTmuxVersionIn(tmuxSays)
  if (found === undefined || isBelow(found, TMUX_FLOOR)) return `this crew opens in tmux, which needs tmux ${TMUX_FLOOR} or newer, and this tmux is ${found ?? `one that says ${JSON.stringify(tmuxSays.trim())}`}. Update tmux.`
  if (id === null) return 'this crew opens in tmux, in a session named by the declaration\'s "id", and the declaration names none. Add "id" to .martha/martha.json.'
  const why = whyNotATarget(id)
  return why === undefined ? undefined : `this crew opens in a tmux session named by the declaration's "id", and ${why}.`
}

/**
 * The member's own pane, when this process runs in a window of Martha's own tmux server: tmux names its server's socket
 * in TMUX (`<socket path>,<pid>,<session>`) and the pane in TMUX_PANE (martha#919). Undefined anywhere else.
 */
export function thePaneOnMarthasServer(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const socket = env[THE_TMUX_VARIABLE]?.split(',')[0]
  const pane = env[`${THE_TMUX_VARIABLE}_PANE`]
  return socket !== undefined && socket.split('/').at(-1) === MARTHAS_SERVER && pane !== undefined && /^%\d+$/.test(pane) ? pane : undefined
}

/** What opens a slash command when it starts a turn typed into the host's composer. */
const A_SLASH_COMMAND = '/'

/**
 * Why `text` cannot be typed in as a member's first prompt, or undefined when it can (martha#919). It is typed into the
 * host's composer as the owner's own keys, so a leading `-` is only text; a leading `/` would open a slash command, and a
 * line break would end the turn early and start another, so each is refused by name, as is any other control character.
 */
export function whyNotAFirstPrompt(text: string): string | undefined {
  if (text.trim() === '') return 'a first prompt is empty'
  if ([...text].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) return `the first prompt ${JSON.stringify(text)} holds a line break or another control character, which would end the turn it is typed as and start another`
  if (text.trimStart().startsWith(A_SLASH_COMMAND)) return `the first prompt ${JSON.stringify(text)} starts with ${A_SLASH_COMMAND}, which the member would run as a slash command, not read as your words`
  return undefined
}

/** The command that types `text` into `pane` as keys, each as written: `-l` reads no key name, `--` ends tmux's switches. */
export const theTextTyped = (pane: string, text: string): readonly string[] => ['send-keys', '-t', pane, '-l', '--', text]

/** The command that ends the typed turn: the Enter key, in `pane`. */
export const theTurnSent = (pane: string): readonly string[] => ['send-keys', '-t', pane, 'Enter']

/** The environment Martha's server is started with: the owner's, with no variable of a tmux this may run inside. */
export function outsideAnyTmux(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !TMUX_VARIABLES.includes(entry[0])))
}
