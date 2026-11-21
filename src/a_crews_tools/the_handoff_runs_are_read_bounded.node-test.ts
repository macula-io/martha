// A HANDOFF's ci= runs are read through the crew's tools with every gh bounded (martha#980 package 4, T5): say_to_the_crew
// is answered through crewToolsOver, and each gh the send's spender runs carries GH_MS. The test of the runs alone builds
// its own spender, so only this one sees the launch's wiring.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OWNER, SOLO_MODE } from '../declare_crew/declare_crew.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { SAY_TO_THE_CREW_TOOL } from '../send_a_crew_message/say_to_the_crew_tool.ts'
import { GH_MS } from '../send_a_crew_message/the_runs_a_handoff_names.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { GITHUB_CLI } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { crewToolsOver } from './a_crews_tools.ts'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const MEMBER = 'Builder'
const REVIEWER = 'Reviewer'
const TIP = 'c'.repeat(40)
const BASE = 'b'.repeat(40)

test('#980 p4 T5: the runs a HANDOFF names are read through the crew\'s tools with every gh bounded at GH_MS', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'martha-980-p4-'))
  t.after(() => removeTheTree(home))
  const root = join(home, 'checkout')
  mkdirSync(join(root, DECLARATION_DIRECTORY), { recursive: true })
  writeFileSync(
    join(root, DECLARATION_DIRECTORY, DECLARATION_FILE),
    JSON.stringify({
      version: DECLARATION_VERSION,
      owner: 'Ann',
      members: [{ name: MEMBER, role: 'builder' }, { name: REVIEWER, role: 'builder' }],
      mode: { name: SOLO_MODE, roles: ['builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER]])) },
    }),
  )
  for (const place of ['crew-store', 'row-streams', 'row']) mkdirSync(join(home, place), { recursive: true, mode: 0o700 })
  const asked: ProcessRequest[] = []
  const run = async (request: ProcessRequest): Promise<ProcessOutcome> => {
    asked.push(request)
    if (request.args[1] === 'rate_limit') {
      return { exit_code: 0, stderr: '', stdout: JSON.stringify({ resources: { core: { remaining: 4_000, reset: Math.trunc((NOW + 3_600_000) / 1000) } } }) }
    }
    return { exit_code: 0, stderr: '', stdout: JSON.stringify({ total_count: 0, workflow_runs: [] }) }
  }
  const started = hostForTests({ now: NOW, run })
  const tools = crewToolsOver({
    member: MEMBER,
    ledger: { clock: started.host.clock, stores: { rows: rowStreamsDirectory(join(home, 'row-streams')) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents: { read: (path: string) => readFile(path, 'utf8') },
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, 'crew-store')) },
    processes: started.host.processes,
  })
  const text = `HANDOFF synthetic-acme/widget#7 ${BASE}..${TIP} r=1 ci=11`
  const answer = await tools.answer(SAY_TO_THE_CREW_TOOL.name, { to: [REVIEWER], text }, 's')
  const reads = asked.filter((request) => request.command === GITHUB_CLI && request.args[1] !== 'rate_limit')
  assert.ok(reads.length > 0, `the send read no runs: ${JSON.stringify(answer)}`)
  for (const request of asked.filter((each) => each.command === GITHUB_CLI)) {
    assert.equal(request.timeout_ms, GH_MS, `gh ran unbounded through the crew's tools: ${request.args.join(' ')}`)
  }
})
