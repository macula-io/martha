// Re-records what the Claude Code host says about itself, from its binary.
//
//   npm run record:claude-code-host -- <claude binary> <version>
//
// Run it when the host is upgraded; the coverage check then names any session
// start source and any prompt origin kind the new host sends that its
// declaration does not cover.

import { readFileSync, writeFileSync } from 'node:fs'
import { argv, exit, stderr } from 'node:process'

import { promptOriginsIn } from '../claude_code_host/claude_code_prompt_origins.ts'
import { sessionStartSchemaIn } from '../claude_code_host/claude_code_session_events.ts'
import type { RecordedHost } from '../claude_code_host/recorded_claude_code_host.ts'

const RECORDING = new URL('../claude_code_host/recorded_claude_code_host.json', import.meta.url)
const VERSION = /^\d+\.\d+\.\d+$/

const [binary, host_version] = argv.slice(2)
if (binary === undefined || host_version === undefined || !VERSION.test(host_version)) {
  stderr.write('usage: record_claude_code_host.ts <claude binary> <version, as claude --version prints it>\n')
  exit(2)
}

const previous = JSON.parse(readFileSync(RECORDING, 'utf8')) as { _why: string }
const text = readFileSync(binary, 'latin1')
const recorded: RecordedHost & { _why: string } = {
  _why: previous._why,
  host_version,
  session_start_schema: sessionStartSchemaIn(text),
  ...promptOriginsIn(text),
}
writeFileSync(RECORDING, `${JSON.stringify(recorded, null, 2)}\n`)
