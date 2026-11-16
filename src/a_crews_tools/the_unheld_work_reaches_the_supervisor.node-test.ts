// The unheld work and the idle nudge reach the Supervisor through the crew's own tools (martha#319, package B).
//
// This exists because the rules have their own tests one call away, and the wiring that joins them does not: the
// declared backlog, the launcher's `gh`, the crew store's backlog place, the park markers and the receivers meet only in
// `theNudgesFor` and in the `unheld_work` handler. So each case here calls the tool the mod registers and reads back
// what the member would read.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { BACKLOG, DECLARATION_DIRECTORY, DECLARATION_FILE, MINUTE_MS, OWNER } from '../declare_crew/declare_crew.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { UNHELD_WORK } from '../find_the_unheld_work/unheld_work_tool.ts'
import { crewToolsOver, PARK_A_MEMBER, type CoreToolAnswer, type CrewTools } from './a_crews_tools.ts'

const NOW = Date.parse('2026-11-16T12:00:00Z')
const IDLE_MINUTES = 30
const WINDOW = IDLE_MINUTES * MINUTE_MS
const RECEIVER = 'Supervisor'
const MEMBER = 'Vesta'

/** A GitHub that answers the backlog search with two open issues, one held by a member and one by a stranger. */
function aGithub(): { readonly calls: () => number; readonly run: (request: ProcessRequest) => Promise<ProcessOutcome> } {
  let calls = 0
  const node = (number: number, holder: string) => ({
    number,
    title: `Issue ${String(number)}`,
    createdAt: '2026-11-10T12:00:00Z',
    body: `Purpose (capability): issue ${String(number)}.`,
    repository: { nameWithOwner: 'macula-io/martha' },
    labels: { nodes: [{ name: 'work-package' }, { name: `crew:${holder}` }] },
    timelineItems: { nodes: [] },
  })
  const page = { data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(1, MEMBER), node(2, 'Stranger')] } } }
  return {
    calls: () => calls,
    run: async (request) => {
      calls += 1
      assert.equal(request.args[1], 'graphql', `the backlog read asked GitHub something else: ${request.args.join(' ')}`)
      return { exit_code: 0, stdout: JSON.stringify(page), stderr: '' }
    },
  }
}

/** A crew a test owns, declared with a backlog and nudges on; `crew` is the store a refreshed launcher reads again. */
function aCrewHome(t: TestContext): { readonly root: string; readonly crew: string; readonly rows: string; readonly beats: string } {
  const home = mkdtempSync(join(tmpdir(), 'martha-319-unheld-'))
  t.after(() => removeTheTree(home))
  const root = join(home, 'checkout')
  mkdirSync(join(root, DECLARATION_DIRECTORY), { recursive: true })
  writeFileSync(
    join(root, DECLARATION_DIRECTORY, DECLARATION_FILE),
    JSON.stringify({
      version: 1,
      owner: 'the-owner',
      members: [
        { name: RECEIVER, role: SUPERVISOR },
        { name: MEMBER, role: 'builder' },
        { name: 'Mars', role: 'builder' },
      ],
      mode: { name: 'team', roles: [SUPERVISOR, 'builder'], may: { assign_work: [SUPERVISOR], approve_landing: [OWNER], resume_parked_work: [SUPERVISOR] } },
      house_rules: { nudges: true, stalled_minutes: 600, review_minutes: 600, person_minutes: 600 },
      [BACKLOG]: { places: ['macula-io'], idle_minutes: IDLE_MINUTES },
    }),
  )
  const paths = { root, crew: join(home, 'crew-store'), rows: join(home, 'row-streams'), beats: join(home, 'row') }
  for (const path of [paths.crew, paths.rows, paths.beats]) mkdirSync(path, { recursive: true, mode: 0o700 })
  return paths
}

/** One launcher of that crew at `now`, as the given member, with `gh` when a GitHub is given. */
function aLauncher(paths: ReturnType<typeof aCrewHome>, now: number, member: string, github?: ReturnType<typeof aGithub>): CrewTools {
  const started = hostForTests({ now, ...(github === undefined ? {} : { run: github.run }) })
  return crewToolsOver({
    member,
    ledger: { clock: started.host.clock, stores: { rows: rowStreamsDirectory(paths.rows) } },
    beats: dashboardRowsIn(paths.beats),
    root: paths.root,
    documents: { read: (path: string) => readFile(path, 'utf8') },
    stores: { crew: keepTheCrewsFilesAsDirectories(paths.crew) },
    ...(github === undefined ? {} : { processes: started.host.processes }),
  })
}

/** Keeps a member's row as idle and fresh at `now`. */
function beatIdle(paths: ReturnType<typeof aCrewHome>, member: string, now: number): void {
  const held: DashboardRow = {
    member,
    session: `session-${member}`,
    at: now,
    state: 'idle',
    holds: '',
    task: '',
    progress: { step: 0, of: 1 },
    waits: null,
    needs: '',
    host: { model: 'opus', provider: '', contextPercent: 10, costUsd: 0 },
  }
  const kept = dashboardRowsIn(paths.beats).change(member, () => held)
  assert.ok(kept.kept, `the test's row for ${member} was not kept`)
}

const theUnheldDrawn = (answer: CoreToolAnswer): readonly string[] => {
  assert.ok('answer' in answer, `the pane was refused: ${'refused' in answer ? answer.refused : ''}`)
  return (JSON.parse(answer.answer) as { readonly lines: readonly string[] }).lines.filter((line) => line.startsWith('- unheld: '))
}

test('#319 B: an idle member beside unheld work reaches the Supervisor\'s pane after the window, and a refreshed launcher keeps its start', async (t) => {
  const paths = aCrewHome(t)
  const github = aGithub()
  beatIdle(paths, MEMBER, NOW)
  assert.deepEqual(theUnheldDrawn(await aLauncher(paths, NOW, RECEIVER, github).answer('see_the_crew', {}, 's')), [], 'the nudge was drawn before the window')
  beatIdle(paths, MEMBER, NOW + WINDOW)
  // A new launcher over the same crew store: nothing in memory carries the clock across.
  const drawn = theUnheldDrawn(await aLauncher(paths, NOW + WINDOW, RECEIVER, github).answer('see_the_crew', {}, 's'))
  assert.deepEqual(drawn, ['- unheld: Vesta idle beside 1 issues nobody holds, since 12:00 UTC'])
  assert.equal(github.calls(), 2, 'GitHub was not asked once per interval')
})

test('#319 B: a member the crew parked is never drawn idle beside unheld work', async (t) => {
  const paths = aCrewHome(t)
  const parked = await aLauncher(paths, NOW, RECEIVER).answer(PARK_A_MEMBER, { reason: 'resting', member: MEMBER }, 's')
  assert.ok('answer' in parked, `the crew could not park a member: ${'refused' in parked ? parked.refused : ''}`)
  beatIdle(paths, MEMBER, NOW)
  await aLauncher(paths, NOW, RECEIVER, aGithub()).answer('see_the_crew', {}, 's')
  beatIdle(paths, MEMBER, NOW + WINDOW)
  assert.deepEqual(theUnheldDrawn(await aLauncher(paths, NOW + WINDOW, RECEIVER, aGithub()).answer('see_the_crew', {}, 's')), [])
})

test('#319 B: the unheld_work tool answers the Supervisor from GitHub, and a builder is refused without a call', async (t) => {
  const paths = aCrewHome(t)
  const github = aGithub()
  const builder = await aLauncher(paths, NOW, MEMBER, github).answer(UNHELD_WORK, {}, 's')
  assert.ok('refused' in builder)
  assert.equal(github.calls(), 0, 'a refused ask still asked GitHub')
  const answer = await aLauncher(paths, NOW, RECEIVER, github).answer(UNHELD_WORK, {}, 's')
  assert.ok('answer' in answer, `the Supervisor was refused: ${'refused' in answer ? answer.refused : ''}`)
  assert.match(answer.answer, /- macula-io\/martha#2, 6 d old: Issue 2\n {2}Purpose \(capability\): issue 2\.\n {2}labelled crew:Stranger, which names nobody in this crew/)
  assert.match(answer.answer, /Held:\n- Vesta: macula-io\/martha#1/)
})
