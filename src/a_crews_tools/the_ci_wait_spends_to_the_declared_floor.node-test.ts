// The crew's GitHub floor reaches the CI wait (martha#931 B): wait_for_ci is answered through the crew's tools, and the
// spender it builds holds the declaration's github.budget_floor. With GitHub saying fewer calls are left than the
// default floor but more than the declared one, a crew that declares none is refused at its floor, and a crew that
// declares the lower floor makes the call.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OWNER, SOLO_MODE, ACTS } from '../declare_crew/declare_crew.ts'
import { GITHUB, GITHUB_WHEN_UNNAMED } from '../declare_crew/the_crews_github.ts'
import { CLOCK_ZONE } from '../declare_crew/the_crews_clock_zone.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { WAIT_FOR_CI_TOOL } from '../wait_for_ci/the_ci_wait_tool.ts'
import { crewToolsOver } from './a_crews_tools.ts'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const MEMBER = 'Builder'
const SHA = 'a'.repeat(40)

/** GitHub's answers: what is left when asked, and an empty list of runs for anything else; every call is counted. */
function aGithub(remaining: number): { readonly reads: () => number; readonly run: (request: ProcessRequest) => Promise<ProcessOutcome> } {
  let reads = 0
  return {
    reads: () => reads,
    run: async (request) => {
      if (request.args[1] === 'rate_limit') {
        return { exit_code: 0, stderr: '', stdout: JSON.stringify({ resources: { core: { remaining, reset: Math.trunc((NOW + 3_600_000) / 1000) } } }) }
      }
      reads += 1
      return { exit_code: 0, stderr: '', stdout: JSON.stringify({ workflow_runs: [] }) }
    },
  }
}

/** Asks the CI wait once, through the crew's tools, for a solo crew with whatever top-level fields the test declares. */
async function theWaitAsked(t: TestContext, remaining: number, declared: Readonly<Record<string, unknown>> = {}): Promise<{ readonly answer: unknown; readonly reads: number }> {
  const home = mkdtempSync(join(tmpdir(), 'martha-931-floor-'))
  t.after(() => removeTheTree(home))
  const root = join(home, 'checkout')
  mkdirSync(join(root, DECLARATION_DIRECTORY), { recursive: true })
  writeFileSync(
    join(root, DECLARATION_DIRECTORY, DECLARATION_FILE),
    JSON.stringify({
      version: DECLARATION_VERSION,
      owner: 'Ann',
      members: [{ name: MEMBER, role: 'builder' }],
      mode: { name: SOLO_MODE, roles: ['builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER]])) },
      ...declared,
    }),
  )
  for (const place of ['crew-store', 'row-streams', 'row']) mkdirSync(join(home, place), { recursive: true, mode: 0o700 })
  const gh = aGithub(remaining)
  const started = hostForTests({ now: NOW, run: gh.run })
  const tools = crewToolsOver({
    member: MEMBER,
    ledger: { clock: started.host.clock, stores: { rows: rowStreamsDirectory(join(home, 'row-streams')) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents: { read: (path: string) => readFile(path, 'utf8') },
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, 'crew-store')) },
    processes: started.host.processes,
  })
  const answer = await tools.answer(WAIT_FOR_CI_TOOL.name, { repo: 'macula-io/martha', sha: SHA }, 's')
  return { answer, reads: gh.reads() }
}

test('#931 B: the CI wait spends to the declared github.budget_floor, not the default', async (t) => {
  const declared = Math.floor(GITHUB_WHEN_UNNAMED.budget_floor / 5)
  const between = Math.floor(GITHUB_WHEN_UNNAMED.budget_floor / 2)
  const byDefault = await theWaitAsked(t, between)
  assert.equal(byDefault.reads, 0, `a crew declaring no floor spent a call with ${between} left: ${JSON.stringify(byDefault.answer)}`)
  assert.match(JSON.stringify(byDefault.answer), /at its floor/, 'and the refusal does not say it is the floor')
  const lowered = await theWaitAsked(t, between, { [GITHUB]: { budget_floor: declared } })
  assert.ok(lowered.reads > 0, `a crew declaring a floor of ${declared} did not spend a call with ${between} left: ${JSON.stringify(lowered.answer)}`)
  assert.doesNotMatch(JSON.stringify(lowered.answer), /at its floor/)
})

test('#931 C: the CI wait\'s refusal names its time in the crew\'s declared clock_zone', async (t) => {
  // GitHub's window resets an hour after NOW, 13:00 UTC; Asia/Kolkata is UTC+05:30 all year.
  const atTheFloor = await theWaitAsked(t, GITHUB_WHEN_UNNAMED.budget_floor, { [CLOCK_ZONE]: 'Asia/Kolkata' })
  assert.match(JSON.stringify(atTheFloor.answer), /which resets at 18:30 Asia\/Kolkata\./, `the refusal's time is not in the declared zone: ${JSON.stringify(atTheFloor.answer)}`)
  const byDefault = await theWaitAsked(t, GITHUB_WHEN_UNNAMED.budget_floor)
  assert.match(JSON.stringify(byDefault.answer), /which resets at 13:00 UTC\./, 'a crew that declares no zone does not read UTC')
})
