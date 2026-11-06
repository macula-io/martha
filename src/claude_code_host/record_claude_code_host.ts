// Re-records what the Claude Code host says about itself, from its binary.
//
//   node src/claude_code_host/record_claude_code_host.ts <claude binary> <version>
//
// Run it when the host is upgraded; the coverage check then names any session
// start source the new host sends that the declaration does not cover.

import { readFileSync, writeFileSync } from 'node:fs'
import { argv, exit, stderr } from 'node:process'

import { sessionStartSchemaIn, type RecordedHost } from './claude_code_session_events.ts'

const RECORDING = new URL('./recorded_claude_code_host.json', import.meta.url)
const VERSION = /^\d+\.\d+\.\d+$/

const [binary, host_version] = argv.slice(2)
if (binary === undefined || host_version === undefined || !VERSION.test(host_version)) {
  stderr.write('usage: record_claude_code_host.ts <claude binary> <version, as claude --version prints it>\n')
  exit(2)
}

const previous = JSON.parse(readFileSync(RECORDING, 'utf8')) as { _why: string }
const recorded: RecordedHost & { _why: string } = {
  _why: previous._why,
  host_version,
  session_start_schema: sessionStartSchemaIn(readFileSync(binary, 'latin1')),
}
writeFileSync(RECORDING, `${JSON.stringify(recorded, null, 2)}\n`)
