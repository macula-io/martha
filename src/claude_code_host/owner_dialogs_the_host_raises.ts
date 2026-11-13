// The dialogs the Claude Code host raises for its owner, and the notifications it sends, derived from the host's own
// text rather than typed by hand (martha#313, threat T7).
//
// This exists so the row can say what the host is asking, and so a host that adds a notification fails the coverage
// check by name instead of being read as one this build knows. A list typed by hand cannot see the host add one, which
// is how `fork` was missed among the session start sources (martha#41). So the host's two lists are cut from its bundle
// (recorded_claude_code_host.json, re-recorded by npm run record:claude-code-host) and read from that record
// (recorded_claude_code_host.ts).
//
// What is cut is the list itself, never its entries one by one: a name the host adds appears here the first time the
// recording is re-taken, and the coverage check then says which of its names this build does not know.

/** An array of quoted names the host writes as lowercase words (its notification types). */
const LOWERCASE_NAMES_IN_A_LIST = /\[(?:"[a-z][a-z0-9_]*",)*"[a-z][a-z0-9_]*"\]/g

/** The lowercase list that is the host's notification types: the one holding at least these two of them. */
export const NOTIFICATIONS_THAT_NAME_THEIR_LIST: readonly string[] = ['permission_prompt', 'idle_prompt']

/** The one list in `host` matching `lists` and holding every one of `words`, cut whole; refuses none, or two that differ. */
function theOneListHolding(host: string, lists: RegExp, words: readonly string[], what: string): string {
  const found = [...new Set([...host.matchAll(lists)].map((match) => match[0]).filter((list) => holds(list, words)))]
  if (found.length === 0) throw new Error(`No list of ${what} was found in the host: its names cannot be derived.`)
  if (found.length > 1) throw new Error(`The host holds two different lists of ${what}: ${found.join(' | ')}`)
  return found[0] ?? ''
}

/** Whether the list cut as `list` holds every one of `words`. */
function holds(list: string, words: readonly string[]): boolean {
  const names: unknown = JSON.parse(list)
  return Array.isArray(names) && words.every((word) => names.includes(word))
}

/** The names in one cut list, each checked as a name and each named once. */
function namesOf(list: string, what: string): readonly string[] {
  const names: unknown = JSON.parse(list)
  const aName = /^[A-Za-z][A-Za-z0-9_]*$/
  if (!Array.isArray(names) || names.length === 0 || !names.every((name) => typeof name === 'string' && aName.test(name))) {
    throw new Error(`Not a list of ${what}: ${list}`)
  }
  return [...new Set(names as string[])]
}

/** Every notification type the host can send, from the list its bundle holds. */
export function notificationTypesIn(host: string): readonly string[] {
  return namesOf(theOneListHolding(host, LOWERCASE_NAMES_IN_A_LIST, NOTIFICATIONS_THAT_NAME_THEIR_LIST, 'notification types'), 'notification types')
}

/**
 * Every hook event the host offers a module, from the list its bundle holds. A module subscribes to one under the
 * `classic.` prefix the host gives it (`classic.PermissionRequest`), which is the name the relay registers.
 *
 * The list is found by what the host does with it and not by what it holds: the host maps one list to its module events
 * (`.map((e) => \`classic.${e}\`)`), through one alias, and that list is the one cut here. A list of hook names that is
 * never mapped this way is a list of something else, however many known names it happens to hold.
 */
export function classicHookEventsIn(host: string): readonly string[] {
  const mapper = theOneNameIn(host, CLASSIC_MAPPER, 'the map the host builds its module events with')
  const source = theOneNameIn(host, new RegExp(`(?:var |,)${escapeForRegExp(mapper)}=([A-Za-z_$][\\w$]*)[,;]`, 'g'), `the list ${mapper} is`)
  const cut = theOneNameIn(host, new RegExp(`(?:var |,)${escapeForRegExp(source)}=(\\[(?:"[A-Za-z][A-Za-z0-9]*",)*"[A-Za-z][A-Za-z0-9]*"\\])`, 'g'), `the list named ${source}`)
  return namesOf(cut, 'hook events')
}

/** The one place the host builds a module's event name from a hook's: the variable it maps, and the name it gives each. */
const CLASSIC_MAPPER = /([A-Za-z_$][\w$]*)\.map\(\((\w+)\)=>`classic\.\$\{\2\}`\)/g

/** What one capture of `pattern` in `host` is: exactly one, or the refusal that says what was looked for. */
function theOneNameIn(host: string, pattern: RegExp, what: string): string {
  const found = [...new Set([...host.matchAll(pattern)].map((match) => match[1] ?? ''))]
  if (found.length !== 1) {
    throw new Error(`The host's text holds ${found.length} of ${what}, so which one is meant cannot be told: ${found.join(' | ')}`)
  }
  return found[0] ?? ''
}

/** `text` as a pattern that matches it and nothing but it. */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
