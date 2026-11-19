// The switch that keeps Claude Code's own auto-updater off, cut from the host's binary (martha#637).
//
// A launch hands the host a home of its own, so the host starts with the updater's default, which is on: the owner's own
// answer lives in their `~/.claude.json`, which a run never reads. A host a release behind npm's latest then updates
// itself with `npm install --global`, which npm resolves against the NODE prefix and not against HOME, so the install
// meant for the run lands over the owner's own Claude Code (martha#460). Every launch therefore sets the variable the
// host's updater checks. Until #637 Martha restated that variable's name and value by hand, so a release that renamed
// or dropped it would have left every launch updating itself with host drift green.
//
// The variable is cut from the one place the host decides by it, never typed here: a function whose whole body returns a
// call on a call on the environment's own read of it — `function F(){return O(I(process.env.V))}` on 2.1.328, where `F`
// is the updater's own question, `O` says which source turns it off (the switch among them), and `I` is the check that
// reads the value. A host that reads it nowhere, or in more than one place, cannot be told, and the recording fails by
// the part's name.
//
// All three are recorded whole, so a host that changes how it decides differs by the field: `F`'s own body, `O`'s answer
// for the switch, and the values `I` reads as off. They are taken by their binding in `F`'s module, never walked deeper:
// `O` asks other sources too (a settings key, another variable), and those are not this switch's decision.
//
// The value is cut the same way: the host's own code gives that variable a value in the environment it hands its child
// runs (`...,DISABLE_AUTOUPDATER:"1",...` on 2.1.328), and that is the value a launch sets. A host whose own code gives
// two values for it cannot be told, and is refused.

import { closingBrace } from '../cut_the_rules_from_the_host_binary/the_rules_a_hosts_binary_carries.ts'
import type { AutoUpdaterSwitch } from '../know_claude_codes_own_facts/the_recorded_auto_updater_switch.ts'
import { theFunctionCalledFromIn } from './what_the_hosts_guards_call.ts'

/** The one function whose whole body returns a call on a call on the environment's own switch. */
const A_SWITCH_READ = /function ([\w$]+)\(\)\{return ([\w$]+)\(([\w$]+)\(process\.env\.([A-Z][A-Z0-9_]*)\)\)\}/g

/** A place the host's code gives `variable` a value, as an object literal spells it; not the tail of a longer name. */
const A_VALUE_OF = (variable: string): RegExp => new RegExp(`(?<![\\w$])${variable}:"([^"]*)"`, 'g')

const WHAT = 'auto-updater switch'

/** The one place the host decides by a switch this way, or a refusal naming how many it reads. */
function theOneReadIn(text: string): readonly [number, string, string, string] {
  const reads = [...text.matchAll(A_SWITCH_READ)]
  const [read] = reads
  if (reads.length !== 1 || read?.index === undefined) {
    throw new Error(`The host decides by an ${WHAT} in ${String(reads.length)} places, not one, so the switch a launch must set cannot be told.`)
  }
  return [read.index, read[4] ?? '', read[2] ?? '', read[3] ?? '']
}

/** The one value the host's own code gives `variable`, or a refusal naming how many it gives. */
function theOneValueIn(text: string, variable: string): string {
  const values = new Set([...text.matchAll(A_VALUE_OF(variable))].map((match) => match[1] ?? ''))
  if (values.size !== 1) {
    throw new Error(`The host's own code gives ${variable} ${String(values.size)} values, not one, so the value that turns its auto-updater off cannot be told.`)
  }
  return [...values][0] ?? ''
}

/** The switch, as the host's text holds it (martha#637). Throws, by what cannot be told, when the host reads it in no place or in more than one, gives it two values, or names a function no module declares. */
export function autoUpdaterSwitchIn(text: string): { readonly auto_updater_switch: AutoUpdaterSwitch } {
  const [at, variable, decision, check] = theOneReadIn(text)
  return {
    auto_updater_switch: {
      variable,
      guard: text.slice(at, closingBrace(text, text.indexOf('{', at))),
      decision: theFunctionCalledFromIn(text, at, decision, WHAT),
      check: theFunctionCalledFromIn(text, at, check, WHAT),
      off_value: theOneValueIn(text, variable),
    },
  }
}
