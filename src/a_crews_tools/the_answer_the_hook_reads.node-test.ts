// The tools the launcher really answers are the tools the mod really reads (martha#254 part 2 r=4).
//
// At r=3 these two disagreed and nothing joined them: the launcher answered a bare array, the mod's parser read
// `parsed.tools`, so a started member registered no crew tools at all — and every test passed, because each one
// built its own copy of an answer in the shape it happened to expect. This test takes the launcher's own answer,
// from the real function the launcher calls, and puts it through the real parser the mod reads it with.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { crewToolsIn } from '../claude_code_relay/hooks/crew_tools_answer.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { CREW_TOOL_NAMES, crewToolsOver, THE_TOOLS_ASK } from './a_crews_tools.ts'

/** The crew's tools over a place of the test's own, which it removes. */
function crewOverAFreshPlace(t: { after(fn: () => void): void }): ReturnType<typeof crewToolsOver> {
  const home = mkdtempSync(join(tmpdir(), 'martha-254-tools-answer-'))
  t.after(() => removeTheTree(home))
  return crewToolsOver({
    member: 'Pallas',
    ledger: { clock: { now: () => 1_000 }, stores: { rows: rowStreamsDirectory(join(home, 'rows')) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root: home,
    documents: { read: async () => '{}' },
  })
}

test('the crew tools the launcher answers are the ones the mod reads (martha#254 part 2 r=4)', async (t) => {
  const crew = crewOverAFreshPlace(t)
  const answered = await crew.answer(THE_TOOLS_ASK, {}, 'session-254')
  assert.ok('answer' in answered, 'the launcher answers the ask with the tools')

  const read = crewToolsIn(answered.answer)
  assert.ok(read !== null, `the mod reads the answer the launcher really gives: ${answered.answer.slice(0, 200)}`)
  assert.deepEqual(
    read.map((tool) => tool.name),
    [...CREW_TOOL_NAMES],
    'every tool the launcher names is a tool the mod registers, in the launcher\'s own order',
  )
})
