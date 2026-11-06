// The events the Claude Code host emits when a session starts, derived from the
// host's own schema rather than typed by hand (#41, threat T7).
//
// The host's SessionStart hook input carries a `source` whose values its schema
// lists. A list typed by hand cannot see the host add one: `fork` arrived in
// 2.1.318 and the hand list missed it. So the schema text is recorded from the
// host binary (recorded_claude_code_host.json, re-recorded by
// record_claude_code_host.ts) and the list is parsed from that record
// (recorded_claude_code_host.ts). The crew adds one event the host never sends,
// the refresh its own mod runs.
//
// The coverage check (../check_every_path_is_gated, gapsInSessionEvents) runs
// this list against the host's declaration, so a source the host adds fails CI by
// name before it fails closed at run time.

// The SessionStart input schema as the host's bundle spells it: the event name
// literal, then the `source` enum. The minifier's helper names change between
// builds, so only their shape is matched.
const SESSION_START_SCHEMA = /hook_event_name:[\w$]+\("SessionStart"\),source:[\w$]+\((\[[^\]]*\])\)/g

/** The one SessionStart schema in a host's text; refuses none, or two that differ. */
export function sessionStartSchemaIn(text: string): string {
  const found = [...new Set([...text.matchAll(SESSION_START_SCHEMA)].map((match) => match[0]))]
  if (found.length === 0) throw new Error('No SessionStart schema was found in the host: its source list cannot be derived.')
  if (found.length > 1) throw new Error(`The host holds two different SessionStart schemas: ${found.join(' | ')}`)
  return found[0] ?? ''
}

/** The `source` values a recorded SessionStart schema lists. */
export function sessionStartSourcesOf(schema: string): readonly string[] {
  const list = new RegExp(SESSION_START_SCHEMA.source).exec(schema)?.[1]
  const sources: unknown = list === undefined ? undefined : JSON.parse(list)
  if (!Array.isArray(sources) || sources.length === 0 || !sources.every((source) => typeof source === 'string' && source !== '')) {
    throw new Error(`Not a SessionStart schema with a list of sources: ${schema}`)
  }
  return sources as string[]
}
