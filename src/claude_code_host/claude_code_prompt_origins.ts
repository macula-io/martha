// The origin kinds the Claude Code host stamps on a prompt, derived from the
// host's own code rather than typed by hand (#41, threats T1 and T5).
//
// A plugin's `prompt.submit` hook reads `origin.kind`. The engine builds that
// origin in two functions of its bundle: a mapper that turns the ingress origin
// into the plugin-facing one (a `human` message becomes `composer`, or `bridge`
// when it came through Remote Control; a `task-notification` whose subkind is in
// one set is promoted to that subkind), and a fallback for a prompt with no
// ingress origin (`sdk`, `scheduled-trigger`, `unclassified`). Both are recorded
// from the binary, with the subkind set, into recorded_claude_code_host.json
// (npm run record:claude-code-host), and the kinds are parsed from that record
// (recorded_claude_code_host.ts).
//
// The coverage check (../check_every_path_is_gated, gapsInPromptOrigins) runs
// these kinds against the host's declaration
// (../name_the_source_of_a_prompt), so a kind the host adds fails CI by name.

import type { RecordedHost } from './recorded_claude_code_host.ts'

/** The engine's code that names a prompt's origin, as recorded from the binary. */
export type RecordedPromptOrigins = Pick<RecordedHost, 'prompt_origin_mapper' | 'prompt_origin_fallback' | 'prompt_origin_subkinds'>

// The minifier's names change between builds, so identifiers are matched by
// shape only; the literals and the control flow are what is recorded.
const NAME = '[\\w$]+'

/** The mapper: it starts on the `human` case, which splits into bridge and composer. */
const MAPPER = new RegExp(
  `function ${NAME}\\(${NAME},${NAME}\\)\\{switch\\(${NAME}\\.kind\\)\\{case"human":return ${NAME}===!0\\?\\{kind:"bridge"\\}:\\{kind:"composer"\\};.*?return\\{kind:${NAME}\\.kind\\}\\}\\}`,
  'g',
)

/** The fallback for a prompt with no ingress origin: it hands one to the mapper first. */
const FALLBACK = new RegExp(
  `function ${NAME}\\(\\{origin:${NAME},bridgeOrigin:${NAME},wakeupSource:${NAME},mode:${NAME},promptSource:${NAME}\\}\\)\\{.*?\\}\\}\\}`,
  'g',
)

/** The task-notification subkinds the mapper promotes to a kind of their own. */
const SUBKINDS = new RegExp(
  `var ${NAME}=new Set\\((\\["scheduled-trigger"[^\\]]*\\])\\);var ${NAME}=\\(${NAME}\\)=>${NAME}\\.has\\(${NAME}\\)`,
  'g',
)

/** A kind written out as a literal. */
const KIND_LITERAL = /kind:"([a-z-]+)"/g
/** The cases that pass the ingress kind through unchanged. */
const PASSED_THROUGH = new RegExp(`((?:case"[a-z-]+":)+)return\\{kind:${NAME}\\.kind\\}`)
/** The promotion of a subkind: `{kind:<subkind>}` when the set has it, else task-notification. */
const PROMOTION = new RegExp(`\\?\\{kind:${NAME}\\}:\\{kind:"task-notification"\\}`)

/** The one match of a pattern in a host's text; refuses none, or two that differ. */
function oneIn(text: string, pattern: RegExp, what: string): string {
  const found = [...new Set([...text.matchAll(pattern)].map((match) => match[0]))]
  if (found.length === 0) throw new Error(`No ${what} was found in the host: its prompt origins cannot be derived.`)
  if (found.length > 1) throw new Error(`The host holds two different ${what}s: ${found.join(' | ')}`)
  return found[0] ?? ''
}

/** The engine's prompt-origin code in a host's text. */
export function promptOriginsIn(text: string): RecordedPromptOrigins {
  return {
    prompt_origin_mapper: oneIn(text, MAPPER, 'prompt origin mapper'),
    prompt_origin_fallback: oneIn(text, FALLBACK, 'prompt origin fallback'),
    prompt_origin_subkinds: oneIn(text, SUBKINDS, 'set of promoted subkinds'),
  }
}

/** Every origin kind the recorded code can hand a `prompt.submit` hook. */
export function promptOriginKindsOf(recorded: RecordedPromptOrigins): readonly string[] {
  const { mapper, fallback, subkinds_list, passed } = recordedParts(recorded)
  const subkinds = subkindsIn(subkinds_list, recorded.prompt_origin_subkinds)
  const kinds = [
    ...[...mapper.matchAll(KIND_LITERAL)].map((match) => match[1] ?? ''),
    ...[...passed.matchAll(/case"([a-z-]+)":/g)].map((match) => match[1] ?? ''),
    ...subkinds,
    ...[...fallback.matchAll(KIND_LITERAL)].map((match) => match[1] ?? ''),
  ]
  return [...new Set(kinds)]
}

/** The mapper, the fallback, the subkind list and the passed-through cases of a recording; refuses one missing. */
function recordedParts(recorded: RecordedPromptOrigins): { mapper: string; fallback: string; subkinds_list: string; passed: string } {
  const mapper = firstMatch(MAPPER, recorded.prompt_origin_mapper, 0)
  const fallback = firstMatch(FALLBACK, recorded.prompt_origin_fallback, 0)
  const subkinds_list = firstMatch(SUBKINDS, recorded.prompt_origin_subkinds, 1)
  const passed = passedThroughIn(mapper)
  if (mapper === undefined || fallback === undefined || subkinds_list === undefined || passed === undefined || !PROMOTION.test(mapper)) {
    throw new Error('Not a recording of the engine\'s prompt origins: the mapper, its promotion, the fallback or the subkind set is missing.')
  }
  return { mapper, fallback, subkinds_list, passed }
}

/** One group of the first match of a pattern, matched afresh so a global pattern's position is never shared. */
function firstMatch(pattern: RegExp, text: string, group: number): string | undefined {
  return new RegExp(pattern.source).exec(text)?.[group]
}

/** The cases the mapper passes through unchanged, when there is a mapper. */
function passedThroughIn(mapper: string | undefined): string | undefined {
  return mapper === undefined ? undefined : PASSED_THROUGH.exec(mapper)?.[1]
}

/** The promoted subkinds in their recorded list; refuses anything but non-empty strings, at least one. */
function subkindsIn(subkinds_list: string, recorded_subkinds: string): string[] {
  const subkinds: unknown = JSON.parse(subkinds_list)
  if (!Array.isArray(subkinds) || subkinds.length === 0 || !subkinds.every(isSubkind)) {
    throw new Error(`Not a set of subkinds: ${recorded_subkinds}`)
  }
  return subkinds as string[]
}

function isSubkind(kind: unknown): boolean {
  return typeof kind === 'string' && kind !== ''
}
