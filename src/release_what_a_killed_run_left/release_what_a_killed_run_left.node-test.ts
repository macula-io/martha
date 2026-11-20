// The way out of a leftover's notice (martha#719 A1, martha#693, martha#601).
//
// A record now names its tree on every leftover, so both notices print a path as `<worktree>: <path>`, and the act
// tells the member to name each path "as the telling named it". This file holds the act to that: a release taken with
// exactly the name the hand-off notice printed is the release the notice reads, so the next hand-off says nothing.
//
// The test builds the crew the way a launch does and asks the real seam, so a release that kept the path but matched
// nothing is red here and nowhere else.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { crewToolsOver, type CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { whatTheCrewRefusesOfACall } from '../answer_a_tool_call/answer_a_tool_call.ts'
import { MINUTE_MS, WORKTREES } from '../declare_crew/declare_crew.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { theGitGuardPlacesOf } from '../guard_the_git_a_member_runs/the_git_guard_places_of_a_crew.ts'
import type { TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import type { CrewStore } from '../host_contract/host_contract.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theDigestOf, type WhatAKilledRunLeft } from '../tell_a_member_what_its_relaunch_killed/tell_a_member_what_its_relaunch_killed.ts'
import { keepTheLeftoverRecordOf } from '../tell_a_member_what_its_relaunch_killed/the_telling_on_every_start.ts'
import { releaseTheFilesAKilledRunLeft } from './release_what_a_killed_run_left.ts'

const THE_MEMBER = 'a_member'
const A_PATH = 'src/a_slice/a_file.ts'
const KEPT = 'if (false) return\n'
const THE_COMMAND = 'node run_the_mutants.mjs src/'
const ENDED_AT = 1_794_998_400_000
const STARTED_AT = ENDED_AT - MINUTE_MS
const A_HAND_OFF = 'HANDOFF macula-io/martha#719 doc=https://github.com/macula-io/martha/issues/719#issuecomment-1 r=1'

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

/** A record over one tree holding one leftover that kept `KEPT`. */
const aRecordOver = (tree: string): WhatAKilledRunLeft => {
  const digest = theDigestOf(bytesOf(KEPT))
  return {
    member: THE_MEMBER,
    at_ms: ENDED_AT,
    running: [{ command_line: THE_COMMAND, started_at_ms: STARTED_AT }],
    dirty: [{ path: A_PATH, worktree: tree, digest }],
    leftovers: [{ path: A_PATH, worktree: tree, digest, mtime_ms: STARTED_AT, command_line: THE_COMMAND, started_at_ms: STARTED_AT }],
    dropped: { commands: 0, files: 0, leftovers: 0 },
  }
}

/** The crew's tools, built the way a launch builds them: the guard's four places, spread in. */
function crewOf(crew: CrewStore, home: string): CrewTools {
  const workspace: TheWorkspace = { clones: null, worktrees: null, members: [THE_MEMBER] }
  return crewToolsOver({
    ...theGitGuardPlacesOf(workspace, THE_MEMBER, thisMachine, crew),
    member: THE_MEMBER,
    ledger: { clock: { now: () => ENDED_AT }, stores: { rows: rowStreamsDirectory(join(home, 'row-streams')) } },
    beats: dashboardRowsIn(join(home, CREW_ROWS_PLACE)),
    root: home,
    documents: { read: async () => '{}' },
    stores: { crew },
  })
}

/** The answer, and everything written to the process's own error output while the act is judged (martha#601). */
async function theNoticeWhile(act: () => Promise<string | undefined>): Promise<{ readonly answer: string | undefined; readonly notice: string }> {
  const written: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    return { answer: await act(), notice: written.join('') }
  } finally {
    process.stderr.write = original
  }
}

test('a member releases by the exact name the hand-off notice printed, and the next hand-off says nothing (martha#719 A1, martha#601)', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'martha-719-release-'))
  t.after(() => removeTheTree(home))
  const tree = join(home, WORKTREES, 'a-tree')
  mkdirSync(dirname(join(tree, A_PATH)), { recursive: true })
  writeFileSync(join(tree, A_PATH), KEPT)
  const crew = keepTheCrewsFilesAsDirectories(join(home, 'crew-files'))
  const record = aRecordOver(tree)
  keepTheLeftoverRecordOf(crew, record)
  const tools = crewOf(crew, home)

  const first = await theNoticeWhile(() => whatTheCrewRefusesOfACall(tools, { tool: SAY_TO_THE_CREW, input: { to: ['Supervisor'], text: A_HAND_OFF } }, 'a-session'))
  assert.equal(first.answer, undefined, 'the hand-off stands refused before the release')
  assert.match(first.notice, /this hand-off comes while what a killed run left stands/, 'the hand-off was sent without a notice')
  // The name is taken from the sentence the notice said, quotes and all, never composed here: a test that spelled its
  // own name would stay green while the two spellings drifted apart.
  const printed = first.notice.slice(first.notice.indexOf('stands: "') + 'stands: "'.length, first.notice.indexOf('" (the bytes'))
  assert.notEqual(printed, '', 'the notice named no path')

  const released = releaseTheFilesAKilledRunLeft({ crew, member: THE_MEMBER, paths: [printed] })
  assert.ok('answer' in released, `the name the notice printed is a name the act keeps: ${JSON.stringify(released)}`)
  const next = await theNoticeWhile(() => whatTheCrewRefusesOfACall(tools, { tool: SAY_TO_THE_CREW, input: { to: ['Supervisor'], text: A_HAND_OFF } }, 'a-session'))
  assert.equal(next.answer, undefined, 'the hand-off after the release was refused')
  assert.equal(next.notice, '', 'the hand-off after the release still said one line')
})
