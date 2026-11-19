// What bare `martha start` hands kitty (#547 S6, design: martha#547 issuecomment-7009954570): the session file, the
// checker that judges the strip's remote-control line, kitty's own arguments, and the refusals made before anything
// opens. Everything here is text from values; nothing reads or writes, so each piece is tested exactly.
//
// Two things kitty does to a session line decide how each value is written (kitty 0.50.0, session.py):
// - `new_tab` and `cd`: the rest of the line, stripped, then `$VAR` and `${VAR}` expanded; `$$` is a literal `$`.
// - `launch`: shlex-split; the options before the arguments are then expanded, the arguments after `--` never are.
// So a value is written for the place it lands, by one function per place, and a value that would start a new line
// (or lose white space kitty strips) is refused by name rather than written.

/** The oldest kitty this was read against and proven on (#547 S6). */
export const KITTY_FLOOR = '0.50.0'

/** The only remote-control actions the strip's line allows: the title of its own tab, and the size of its own window. */
export const THE_STRIPS_ACTIONS: readonly string[] = ['set-tab-title', 'resize-window']

/** The share of a member's tab the strip opens with, in percent, before it sizes itself to the rows it draws. */
export const THE_STRIPS_FIRST_SHARE = 20

/** The prefix of every variable kitty sets for the programs it starts; a member is handed none of them (#572 T6). */
export const KITTY_VARIABLE_PREFIX = 'KITTY_'

/** The switch that runs `martha crew` as the strip of one member's tab. */
export const TAB_OF = '--tab-of'

/** The two acts a tab runs: the member held, and the crew strip under it. */
export const THE_ACTS_A_TAB_RUNS = { held: 'start', strip: 'crew' } as const

/** kitty, and the kitten that speaks its remote control. */
export const KITTY = 'kitty'
export const KITTEN = 'kitten'

/** Why a value cannot be written into the session file, or undefined when it can. */
export function whyNotWritten(value: string): string | undefined {
  if (/[\n\r\0]/.test(value)) return `${JSON.stringify(value)} holds a line break or a NUL, which would start a line of its own in kitty's session file`
  if (value !== value.trim() || value === '') return `${JSON.stringify(value)} is empty or starts or ends with white space, which kitty strips from a session line`
  return undefined
}

/** `value` quoted for a shlex split: as it is when nothing in it is special, else in single quotes. */
export function shlexQuoted(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`
}

/** A value kitty expands but never splits (`new_tab`, `cd`): each `$` doubled. */
export const asLineRest = (value: string): string => value.replaceAll('$', '$$$$')

/** A `launch` option's value, split and then expanded: quoted, and each `$` doubled. */
export const asLaunchOption = (value: string): string => asLineRest(shlexQuoted(value))

/** A `launch` argument after `--`, split and never expanded: quoted only, since a doubled `$` would arrive doubled. */
export const asLaunchArgument = (value: string): string => shlexQuoted(value)

/** What the session is made of. */
export interface TheCrewsTabs {
  /** The project's root, where every member starts. */
  readonly root: string
  /** The members to open, in the crew's order. */
  readonly members: readonly string[]
  /** The command that is this release of `martha`: the program and its arguments before the act. */
  readonly martha: readonly string[]
  /** The checker file kitty runs for the strip's line, an absolute path. */
  readonly checker: string
}

/** Each value the session writes, so every one is refused before any is written. */
const theValuesOf = (tabs: TheCrewsTabs): readonly string[] => [tabs.root, tabs.checker, ...tabs.members, ...tabs.martha]

/** The lines of one member's tab: the member held at the root, focused, and its strip below it. */
function theTabOf(tabs: TheCrewsTabs, member: string): readonly string[] {
  const martha = tabs.martha.map(asLaunchArgument).join(' ')
  const name = asLaunchArgument(member)
  const checker = asLaunchOption(`"" ${shlexQuoted(tabs.checker)}`)
  return [
    `new_tab ${asLineRest(member)}`,
    'layout splits',
    `cd ${asLineRest(tabs.root)}`,
    `launch --hold --title ${asLaunchOption(member)} -- ${martha} ${THE_ACTS_A_TAB_RUNS.held} ${name}`,
    'focus',
    `launch --location=hsplit --bias=${THE_STRIPS_FIRST_SHARE} --allow-remote-control --remote-control-password ${asLaunchOption('!')} --remote-control-password ${checker} -- ${martha} ${THE_ACTS_A_TAB_RUNS.strip} ${TAB_OF} ${name}`,
  ]
}

/** kitty's session text for `tabs`, one tab per member; or why a value of it cannot be written. */
export function theSessionText(tabs: TheCrewsTabs): { readonly text: string } | { readonly refusal: string } {
  const unwritten = theValuesOf(tabs).map(whyNotWritten).find((why) => why !== undefined)
  if (unwritten !== undefined) return { refusal: `martha start cannot open the crew in kitty: ${unwritten}.` }
  return { text: `${tabs.members.flatMap((member) => theTabOf(tabs, member)).join('\n')}\n` }
}

/**
 * The checker kitty runs for every request on a strip's line (kitty.conf's `remote_control_password` with a `.py`
 * path). It allows a request only when all of these hold:
 * - it came over the strip's own fd: kitty passes `window` as None then, and the strip's window for a request written
 *   to the strip's terminal, which any process of the owner's uid can write to;
 * - its action is one of THE_STRIPS_ACTIONS;
 * - it names no other tab or window (`match`, `all`) and does not turn `self` off.
 * "Its own tab" holds because the strip's `kitten` sends its own KITTY_WINDOW_ID as `self`: the checker cannot tie
 * `self_window` to the fd's owner, and only Martha's strip, and the `kitten` it runs, hold that fd.
 */
export function theCheckerSource(actions: readonly string[]): string {
  return [
    '# Written by martha start (#547 S6): the only remote-control requests a strip may make.',
    `THE_STRIPS_ACTIONS = frozenset(${JSON.stringify(actions)})`,
    '',
    'def is_cmd_allowed(pcmd, window, from_socket, extra_data):',
    '    if window is not None:',
    '        return False',
    '    payload = pcmd.get("payload") or {}',
    '    if pcmd.get("cmd") not in THE_STRIPS_ACTIONS:',
    '        return False',
    '    if payload.get("match") or payload.get("all") or payload.get("self") not in (None, True):',
    '        return False',
    '    self_window = extra_data.get("self_window")',
    '    return bool(self_window is not None and self_window.allow_remote_control)',
    '',
  ].join('\n')
}

/** kitty's own arguments: its own instance, remote control off and no socket, whatever the owner's kitty.conf says. */
export const theKittyArguments = (session: string): readonly string[] => ['-o', 'allow_remote_control=no', '-o', 'listen_on=none', '--session', session]

/** The environment kitty is started with: the owner's, with no variable of the kitty this may run inside. */
export function withoutKittysVariables(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith(KITTY_VARIABLE_PREFIX)))
}

/** The version `kitty --version` names (`kitty 0.50.0 created by …`), or undefined when it names none. */
export function theKittyVersionIn(said: string): string | undefined {
  return /^kitty (\d+\.\d+\.\d+)\b/.exec(said.trim())?.[1]
}

/** Whether version `found` is below `floor`, both dotted numbers. */
export function isBelow(found: string, floor: string): boolean {
  const a = found.split('.').map(Number)
  const b = floor.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0)
  }
  return false
}

/** What the machine answers before anything opens. */
export interface WhatTheMachineHas {
  /** What `kitty --version` said, or undefined when kitty or kitten is not on the PATH. */
  readonly kitty: string | undefined
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Why bare `martha start` opens nothing where there is no desktop session for kitty's windows. */
export const NO_DESKTOP_SESSION =
  'martha start opens the crew in kitty windows, and there is no desktop session here (no WAYLAND_DISPLAY or DISPLAY). Over ssh, run martha start <member> in a terminal of its own per member; tmux comes later.'

/** Why the crew cannot be opened in kitty here, naming the fix; or undefined. */
export function whyKittyCannotOpen(machine: WhatTheMachineHas): string | undefined {
  if (machine.kitty === undefined) return 'martha start opens the crew in kitty, and kitty (with its kitten) is not on your PATH. Install kitty: https://sw.kovidgoyal.net/kitty/binary/'
  const found = theKittyVersionIn(machine.kitty)
  if (found === undefined || isBelow(found, KITTY_FLOOR)) return `martha start needs kitty ${KITTY_FLOOR} or newer, and this kitty is ${found ?? `one that says ${JSON.stringify(machine.kitty.trim())}`}. Update kitty.`
  if (!machine.env['WAYLAND_DISPLAY'] && !machine.env['DISPLAY']) return NO_DESKTOP_SESSION
  return undefined
}
