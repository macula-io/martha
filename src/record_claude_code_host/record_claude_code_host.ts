// Re-records what the Claude Code host says about itself, from its binary, or
// checks that the committed recording is still what that binary says.
//
//   npm run record:claude-code-host -- <claude binary> <version>
//   npm run record:claude-code-host -- --check <claude binary> <version>
//
// Run the first when the host is upgraded; the coverage check then names any
// session start source and any prompt origin kind the new host sends that its
// declaration does not cover, and a test names any change to the settings keys
// that turn Martha's relay off (martha#122).
//
// The second writes nothing (martha#139). It derives a recording from the binary
// in memory and compares it with the committed one, field by field. It exits 0
// when they are the same and 1 when the binary cannot be read or any field
// differs, the version included: members run whatever the binary is, so a
// recording of another version describes a host nobody runs. Its standard output
// carries only versions and the names of fields and parts, which is what the
// drift job's public log shows as the reason a run is red; a reader's own
// error, which can quote the host's code, goes to standard error.

import { readFileSync, writeFileSync } from 'node:fs'
import { argv, exit, stderr, stdout } from 'node:process'

import { promptOriginsIn } from '../claude_code_host/claude_code_prompt_origins.ts'
import { sessionStartSchemaIn } from '../claude_code_host/claude_code_session_events.ts'
import { markdownTheHostLoadsIn } from '../claude_code_host/markdown_the_host_loads.ts'
import { hookExitCallsIn, hookSwitchesSourceIn, managedFolderFunctionIn, managedSettingsPlaceIn } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import type { RecordedHost } from '../claude_code_host/recorded_claude_code_host.ts'
import { CARRIED, recordingFrom, type Committed, type Derived } from './carry_over_what_is_restated_by_hand.ts'

const RECORDING = new URL('../claude_code_host/recorded_claude_code_host.json', import.meta.url)
const VERSION = /^\d+\.\d+\.\d+$/
const CHECK = '--check'
/** Each part the recorder reads from a host's text, by the name a failed read reports. */
const PARTS: ReadonlyArray<{ readonly part: string; readonly read: (text: string) => Partial<Derived> }> = [
  { part: 'session start schema', read: (text) => ({ session_start_schema: sessionStartSchemaIn(text) }) },
  { part: 'prompt origins', read: promptOriginsIn },
  { part: 'hook switches', read: hookSwitchesIn },
  { part: 'managed settings place', read: (text) => ({ managed_settings: managedSettingsPlaceIn(text) }) },
  { part: 'markdown the host loads', read: (text) => markdownTheHostLoadsIn(text, managedFolderFunctionIn(text)) },
]

/** The function that builds the hook set, and each function an exit of it calls (martha#122). */
function hookSwitchesIn(text: string): Pick<Derived, 'hooks_switches' | 'hooks_switch_calls'> {
  const hooks_switches = hookSwitchesSourceIn(text)
  return { hooks_switches, hooks_switch_calls: hookExitCallsIn(text, hooks_switches) }
}

/** What a host's text says, part by part, and the parts that could not be read. */
function readHost(text: string): { derived: Partial<Derived>; unreadable: readonly string[] } {
  const read = PARTS.map(({ part, read: readPart }) => {
    try {
      return { part, fields: readPart(text) }
    } catch (error) {
      stderr.write(`${part}: ${error instanceof Error ? error.message : String(error)}\n`)
      return { part, fields: undefined }
    }
  })
  return {
    derived: Object.assign({}, ...read.map(({ fields }) => fields ?? {})) as Partial<Derived>,
    unreadable: read.filter(({ fields }) => fields === undefined).map(({ part }) => part),
  }
}

/** The fields, besides those carried over, whose values differ between two recordings, in a stable order. */
function fieldsThatDiffer(committed: Readonly<Record<string, unknown>>, derived: Readonly<Record<string, unknown>>): readonly string[] {
  const fields = new Set([...Object.keys(committed), ...Object.keys(derived)].filter((field) => !CARRIED.includes(field)))
  return [...fields].filter((field) => JSON.stringify(committed[field]) !== JSON.stringify(derived[field])).sort()
}

const checking = argv[2] === CHECK
const [binary, host_version] = argv.slice(checking ? 3 : 2)
if (binary === undefined || host_version === undefined || !VERSION.test(host_version)) {
  stderr.write(`usage: record_claude_code_host.ts [${CHECK}] <claude binary> <version, as claude --version prints it>\n`)
  exit(2)
}

const committed = JSON.parse(readFileSync(RECORDING, 'utf8')) as Committed
const { derived, unreadable } = readHost(readFileSync(binary, 'latin1'))

if (checking) {
  const differing = unreadable.length > 0 ? [] : fieldsThatDiffer(committed as unknown as Record<string, unknown>, { host_version, ...derived })
  stdout.write(`recorded ${committed.host_version}, host ${host_version}\n`)
  if (unreadable.length > 0) stdout.write(`unreadable: ${unreadable.join(', ')}\n`)
  if (differing.length > 0) stdout.write(`differs: ${differing.join(', ')}\n`)
  exit(unreadable.length > 0 || differing.length > 0 ? 1 : 0)
}

if (unreadable.length > 0) {
  stderr.write(`record_claude_code_host: not recorded, unreadable: ${unreadable.join(', ')}\n`)
  exit(1)
}
const recorded = recordingFrom(committed, host_version, derived as Derived)
writeFileSync(RECORDING, `${JSON.stringify(recorded, null, 2)}\n`)
