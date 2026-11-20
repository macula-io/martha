// The owner's words for the host after `martha start <member> --`: which pass (martha#98, martha#2 row A15).
//
// This exists so nothing the owner types on the command line loads config, code or a permission the launch gate
// never judged. The host acts on its arguments after the gate has judged the launch: --settings, --mcp-config and
// --plugin-dir load config and code nobody approved, --setting-sources and --strict-mcp-config undo the switches
// the gate passes, and the permission switches let a tool past the shell gate's hook.
//
// So it is an allow-list. Each switch on it loads no file, starts nothing and changes no permission. Every other
// switch, a `--switch=value` spelling included, is refused by name, and so is a switch a later host adds, until
// someone reads what it does. A switch that takes a value refuses a missing value or one that starts with `-`, so
// `--model --settings x` cannot carry the second switch through.
//
// Two more pass since martha#511 (#601 row 62, DECIDED 2026-11-20 "no buts, no caveats"): a first prompt, a word that
// is no switch, so the owner can hand a member its first turn on the command line; and --resume, with or without the
// session it names, so a member can be started back into a session. Neither loads config or changes a permission.
// The permission bypass is still refused by name.

/**
 * The host's switch that names the model a session runs on (martha#541 package 6b): one spelling, used by the table
 * below and by a start that has to know whether the owner asked for a model of their own.
 */
export const THE_MODELS_SWITCH = '--model'

/** The host switches an owner may pass, and whether each takes one value: none loads config, starts code or changes a permission. */
export const SWITCHES_THAT_LOAD_NO_CONFIG: Readonly<Record<string, 'flag' | 'value'>> = {
  [THE_MODELS_SWITCH]: 'value',
  '--effort': 'value',
  '--verbose': 'flag',
}

/**
 * The values the owner gave one switch, in order: none for a switch this table does not hold or one that takes no
 * value. One reading of what a switch means, so the gate above and a start that must know the owner's model ask it
 * here rather than each parsing the words again (martha#541 package 6b).
 */
export function theValuesGivenTo(switch_name: string, args: readonly string[]): readonly string[] {
  if (SWITCHES_THAT_LOAD_NO_CONFIG[switch_name] !== 'value') return []
  const values: string[] = []
  for (let at = 0; at < args.length; at += 1) {
    if (args[at] !== switch_name) continue
    const value = args[at + 1]
    if (value !== undefined) values.push(value)
    at += 1
  }
  return values
}

/** An argument gate: may these words reach the host? */
export type ArgumentGate = (args: readonly string[]) => boolean

/** The switch that starts a member back into a session; the session's id after it is optional (martha#511). */
export const THE_RESUME_SWITCH = '--resume'

/** Whether `word` is a value and not a switch. */
const isAValue = (word: string | undefined): word is string => word !== undefined && !word.startsWith('-')

const PASSED_SWITCHES = [...Object.keys(SWITCHES_THAT_LOAD_NO_CONFIG), THE_RESUME_SWITCH].join(', ')

const refused = (arg: string, why: string): string =>
  `${arg} ${why}. martha start passes only ${PASSED_SWITCHES} to the host, beside a first prompt, since any other can load config, code or a permission you did not approve.`

/** Why the owner's words may not reach the host, naming the first that may not; undefined when every one may. */
export function unpassedOwnerArgument(args: readonly string[]): string | undefined {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!
    if (isAValue(arg)) continue
    if (arg === THE_RESUME_SWITCH) {
      at += isAValue(args[at + 1]) ? 1 : 0
      continue
    }
    const takes = Object.hasOwn(SWITCHES_THAT_LOAD_NO_CONFIG, arg) ? SWITCHES_THAT_LOAD_NO_CONFIG[arg] : undefined
    if (takes === undefined) return refused(arg, 'is not a switch martha start passes')
    if (takes === 'flag') continue
    const value = args[at + 1]
    if (!isAValue(value)) return refused(arg, 'needs a value of its own after it')
    at += 1
  }
  return undefined
}

/** The argument gate the registry names: true only when every word may reach the host. */
export const passesOnlySwitchesThatLoadNoConfig: ArgumentGate = (args) => unpassedOwnerArgument(args) === undefined
