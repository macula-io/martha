// A message crosses a worktree and its clone, because the crew's rows are one place (martha#253, test 9).
//
// A builder works in a worktree and a reviewer in the clone; before #254 the row store was keyed by each checkout, so
// the two never shared a stream and a hand-off never arrived. These cases place both members through
// `launcherPlacesOf`, as a real launch does, and drive the channel, the carrier and the receipts through those places:
// A says something to B from the worktree, B is handed it in the clone, and A reads that B took it in.

import { OWNER, RESTART_MEMBER } from '../declare_crew/declare_crew.ts'
import { SOLO_MODE } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { crewToolsOver } from '../a_crews_tools/a_crews_tools.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { carryingTo } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { turnsRaised } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { launcherPlacesOf } from './start_a_member.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { READ_THE_RECEIPTS } from '../show_what_a_message_became/show_what_a_message_became.ts'

const MEMBERS = ['Builder', 'Reviewer'] as const

const DECLARATION = JSON.stringify({
  version: 1,
  owner: 'Ann',
  members: MEMBERS.map((name) => ({ name, role: name === 'Builder' ? 'builder' : 'reviewer' })),
  mode: { name: SOLO_MODE, roles: ['builder', 'reviewer'], may: { assign_work: [OWNER], approve_landing: [OWNER], resume_parked_work: [OWNER], [RESTART_MEMBER]: [OWNER] } },
  channel_read_seconds: 30,
})

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

test('#253: a message a member sends in a worktree reaches its reviewer in the clone, and the sender reads it taken in', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'martha-253-roots-'))
  t.after(() => removeTheTree(home))
  const clone = join(home, 'project')
  mkdirSync(join(clone, '.crew'), { recursive: true })
  writeFileSync(join(clone, '.crew', 'crew.json'), DECLARATION)
  writeFileSync(join(clone, 'README.md'), 'a project\n')
  git(clone, 'init', '-q', '.')
  git(clone, 'add', '--all')
  git(clone, 'commit', '-q', '-m', 'start')
  const worktree = join(home, 'worktree')
  git(clone, 'worktree', 'add', '-q', '--detach', worktree)

  const state = openState(join(home, '.local', 'state', 'martha'), clone)
  assert.ok('directory' in state, 'the state opens')
  const inTheClone = launcherPlacesOf(state, join(home, 'relay'), clone)
  const inTheWorktree = launcherPlacesOf(state, join(home, 'relay'), worktree)
  assert.ok('rows' in inTheClone && 'rows' in inTheWorktree)
  assert.equal(inTheWorktree.rows, inTheClone.rows, 'a worktree and its clone were given different row stores, so no message can cross them')

  // Both members read and write the one store the two places name, as their launchers do.
  const declaredAt = (root: string): string => join(root, '.crew', 'crew.json')
  const { host } = hostForTests({ now: 1_000, documents: { [declaredAt(clone)]: DECLARATION, [declaredAt(worktree)]: DECLARATION } })
  const channel = { clock: host.clock, stores: { rows: rowStreamsDirectory(inTheClone.rows) } }
  const turns = turnsRaised()
  const crewOf = (member: string, root: string): ReturnType<typeof crewToolsOver> =>
    crewToolsOver({ member, ledger: channel, beats: dashboardRowsIn(join(home, `row-${member}`)), root, documents: host.stores.documents, stores: { crew: crewFilesDirectory(join(home, 'crew')) }, carrier: carryingTo({ member, host: channel, turns }) })

  const sent = await crewOf('Builder', worktree).answer(SAY_TO_THE_CREW, { to: ['Reviewer'], text: 'a hand-off, in words' }, 'session-a')
  assert.ok('answer' in sent, `the send from the worktree was not answered: ${JSON.stringify(sent)}`)

  const handed = await crewOf('Reviewer', clone).answer('take_a_crew_message', {}, 'session-b')
  assert.ok('answer' in handed)
  assert.equal(handed.answer, '[crew #0] Builder: a hand-off, in words')

  turns.prompted(handed.answer, 'plugin', { command: false, meta: false })
  await new Promise((resolve) => setImmediate(resolve))

  const receipts = await crewOf('Builder', worktree).answer(READ_THE_RECEIPTS, {}, 'session-a')
  assert.ok('answer' in receipts)
  assert.match(receipts.answer, /taken in by Reviewer/, `the sender's receipts do not read the reviewer's taken-in row: ${receipts.answer}`)
})
