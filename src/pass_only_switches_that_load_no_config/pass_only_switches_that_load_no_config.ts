// The owner's words for the host after `martha start <member> --`: which pass (martha#98, martha#2 row A15).
//
// This exists so nothing the owner types on the command line loads config, code or a permission the launch gate
// never judged. The host acts on its arguments after the gate has judged the launch: --settings, --mcp-config and
// --plugin-dir load config and code nobody approved, --setting-sources and --strict-mcp-config undo the switches
// the gate passes, the permission switches let a tool past the shell gate's hook, --resume and --continue bring
// back a session whose record the launch does not hold, and a prompt on the command line is a turn no host stamped
// as the owner's.
//
// So it is an allow-list. Each switch on it loads no file, starts nothing and changes no permission. Every other
// word, a bare word and a `--switch=value` spelling included, is refused by name, and so is a switch a later host
// adds, until someone reads what it does. A switch that takes a value refuses a missing value or one that starts
// with `-`, so `--model --settings x` cannot carry the second switch through.

/** The host switches an owner may pass, and whether each takes one value: none loads config, starts code or changes a permission. */
export const SWITCHES_THAT_LOAD_NO_CONFIG: Readonly<Record<string, 'flag' | 'value'>> = {
  '--model': 'value',
  '--effort': 'value',
  '--verbose': 'flag',
}

/** An argument gate: may these words reach the host? */
export type ArgumentGate = (args: readonly string[]) => boolean

const PASSED_SWITCHES = Object.keys(SWITCHES_THAT_LOAD_NO_CONFIG).join(', ')

const refused = (arg: string, why: string): string =>
  `${arg} ${why}. martha start passes only ${PASSED_SWITCHES} to the host, since any other can load config, code or a permission you did not approve.`

/** Why the owner's words may not reach the host, naming the first that may not; undefined when every one may. */
export function unpassedOwnerArgument(args: readonly string[]): string | undefined {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!
    const takes = Object.hasOwn(SWITCHES_THAT_LOAD_NO_CONFIG, arg) ? SWITCHES_THAT_LOAD_NO_CONFIG[arg] : undefined
    if (takes === undefined) return refused(arg, 'is not a switch martha start passes')
    if (takes === 'flag') continue
    const value = args[at + 1]
    if (value === undefined || value.startsWith('-')) return refused(arg, 'needs a value of its own after it')
    at += 1
  }
  return undefined
}

/** The argument gate the registry names: true only when every word may reach the host. */
export const passesOnlySwitchesThatLoadNoConfig: ArgumentGate = (args) => unpassedOwnerArgument(args) === undefined
