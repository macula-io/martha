// The restart tool a member calls (martha#312): `restart_a_member` asks the member's own launcher through the crew's
// lifecycle place, and the slice (../stop_and_restart_a_member/restart_a_member) decides who may, when and whom.
//
// The crew is declared by `martha init`'s own slice, so the table the tool reads is the one a solo crew gets, and the
// table that grants a role is that same file with one grant changed. The lifecycle place is the crew store the host
// composes on a disk, so a request the tool did or did not write is the file a launcher would read.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { claudeCodeToolNames } from '../host_contract/tool_names_for_tests.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, RESTART_MEMBER } from '../declare_crew/declare_crew.ts'
import { openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { refuseExecutionAfterUngatedText, recordIngestion, startFreshSession } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { notRunningToRestart } from '../stop_and_restart_a_member/restart_a_member.ts'
import { LIFECYCLE_PLACE, theRequestOf, type StoppingHost } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import { CREW_TOOL_NAMES, RESTART_A_MEMBER, crewToolsOver } from './a_crews_tools.ts'

const HOST_MODELS = ['opus', 'fable']
const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-restart-tool-'))
after(() => removeTheTree(homeOfAll))
const documents = { read: (path: string) => readFile(path, 'utf8') }

/** A solo crew declared in a checkout of its own, its declaration changed as asked, and the tools `member` calls. */
let crewsSoFar = 0
async function aCrewOfTools(member: string, options: { grant?: readonly string[]; lifecycle?: boolean } = {}) {
  crewsSoFar += 1
  const home = join(homeOfAll, `crew-${crewsSoFar}`)
  const root = join(home, 'checkout')
  const crew = join(home, 'its-crew')
  mkdirSync(root, { recursive: true })
  const state = openState(join(home, 'state'), root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const declared = await declareSoloCrew({ root, owner: 'an owner', state, documents, models: HOST_MODELS })
  assert.ok(declared.declared, `the test could not declare a crew: ${declared.declared ? '' : declared.refusal}`)
  if (options.grant !== undefined) {
    const file = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
    const declaration = JSON.parse(readFileSync(file, 'utf8')) as { mode: { may: Record<string, readonly string[]> } }
    declaration.mode.may[RESTART_MEMBER] = options.grant
    writeFileSync(file, JSON.stringify(declaration))
  }
  mkdirSync(join(home, 'its-rows'), { mode: 0o700 })
  const rows = rowStreamsDirectory(join(home, 'its-rows'))
  const lifecycle = crewFilesDirectory(crew).place(LIFECYCLE_PLACE)
  const host: StoppingHost = {
    stores: { lifecycle, rows },
    launches: () => [],
    processes: { identityOf: () => null, signalGroup: () => assert.fail('the tool never signals') },
    clock: { now: () => 1_000 },
    wait: async () => assert.fail('a member that is not running is not waited for'),
  }
  const tools = crewToolsOver({
    member,
    ledger: { clock: { now: () => 1_000 }, stores: { rows } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew: crewFilesDirectory(crew) },
    ...(options.lifecycle === false ? {} : { lifecycle: host }),
  })
  return { tools, lifecycle }
}

test('#312: the restart tool is one the crew registers', () => {
  assert.ok((CREW_TOOL_NAMES as readonly string[]).includes(RESTART_A_MEMBER))
})

test('#312 test 6: a solo crew grants restart_member to the owner only, so a member\'s call is refused naming the act, and nothing is written', async () => {
  const { tools, lifecycle } = await aCrewOfTools('builder')
  const answered = await tools.answer(RESTART_A_MEMBER, { member: 'reviewer', reason: 'stalled' }, 'a-session')
  assert.ok('refused' in answered, 'a member the table does not grant restarted another')
  assert.match(answered.refused, new RegExp(RESTART_MEMBER))
  assert.ok(!('refusal' in lifecycle))
  assert.deepEqual(theRequestOf(lifecycle, 'reviewer'), { kind: 'none' })
})

test('#312 test 9: a granted member\'s restart of one that is not running starts nothing and names martha wake', async () => {
  const { tools, lifecycle } = await aCrewOfTools('builder', { grant: ['builder'] })
  const answered = await tools.answer(RESTART_A_MEMBER, { member: 'reviewer', reason: 'stalled', fresh: true }, 'a-session')
  assert.deepEqual(answered, { refused: notRunningToRestart('reviewer') })
  assert.ok(!('refusal' in lifecycle))
  assert.deepEqual(theRequestOf(lifecycle, 'reviewer'), { kind: 'none' })
})

test('#312: a restart that says no reason, or a launch given no place to ask in, is refused by name', async () => {
  const granted = await aCrewOfTools('builder', { grant: ['builder'] })
  const silent = await granted.tools.answer(RESTART_A_MEMBER, { member: 'reviewer' }, 'a-session')
  assert.ok('refused' in silent && /says why/.test(silent.refused))
  const placeless = await aCrewOfTools('builder', { grant: ['builder'], lifecycle: false })
  const answered = await placeless.tools.answer(RESTART_A_MEMBER, { member: 'reviewer', reason: 'stalled' }, 'a-session')
  assert.ok('refused' in answered && answered.refused.includes(RESTART_A_MEMBER))
})

test('#312 test 10: under the strict gate, a session holding text it cannot trace may not call the restart tool', () => {
  const tainted = recordIngestion(startFreshSession(), [{ path: 'A1', from_node_id: null }])
  for (const tool of [RESTART_A_MEMBER, `mcp__martha__${RESTART_A_MEMBER}`]) {
    assert.equal(claudeCodeToolNames.ownNameOf(tool), RESTART_A_MEMBER)
    const decision = refuseExecutionAfterUngatedText({ tool, session: tainted, policy: { may_send_executable_text: [] }, strict_gate: true })
    assert.equal(decision.allow, false, tool)
  }
})
