// The hand-off refused while a killed run's leftover stands (martha#719).
//
// Every case builds the crew the way a launch does — the guard's own places from theGitGuardPlacesOf, spread into
// crewToolsOver — and asks the crew through whatTheCrewRefusesOfACall, the seam a tool call really takes. A slice
// tested only through its own function would stay green with the wiring line gone, which is #710's hole.
//
// The record is made over the member's own worktree, never over the crew's checkout (martha#719 N1): a record that
// names one tree names a worktree, and the refusal reads the bytes there. A record that names no tree — one kept
// before every record did — is not judged, and is not read at the checkout instead.
//
// The repositories and folders are the test's own, removed when it ends, whatever it found.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { whatTheCrewRefusesOfACall } from '../answer_a_tool_call/answer_a_tool_call.ts'
import { crewToolsOver, type CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { MINUTE_MS, WORKTREES } from '../declare_crew/declare_crew.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { theGitGuardPlacesOf } from '../guard_the_git_a_member_runs/the_git_guard_places_of_a_crew.ts'
import type { TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import type { CrewStore } from '../host_contract/host_contract.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { LOG_A_MILESTONE } from '../keep_the_ledger/keep_the_ledger.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  theDigestOf,
  THE_RELEASE_ACT,
  type WhatAKilledRunLeft,
} from '../tell_a_member_what_its_relaunch_killed/tell_a_member_what_its_relaunch_killed.ts'
import { keepTheLeftoverRecordOf, LEFTOVER_RECORDS_PLACE, theRecordFileNameOf } from '../tell_a_member_what_its_relaunch_killed/the_telling_on_every_start.ts'

const THE_MEMBER = 'a_member'
const A_PATH = 'src/a_slice/a_file.ts'
const KEPT = 'if (false) return\n'
const CHANGED = 'if (true) return\n'
const THE_COMMAND = 'node run_the_mutants.mjs src/'
const ENDED_AT = 1_794_998_400_000
const STARTED_AT = ENDED_AT - MINUTE_MS
/** A design's HANDOFF line: the shape the reader accepts, and nothing else. */
const A_HAND_OFF = 'HANDOFF macula-io/martha#719 doc=https://github.com/macula-io/martha/issues/719#issuecomment-1 r=1'
/** A design's VERDICT line, which is no hand-off and is never refused. */
const A_VERDICT = 'VERDICT macula-io/martha#719 PASS doc=https://github.com/macula-io/martha/issues/719#issuecomment-2 r=1'

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

/** A record over one tree — `undefined` for one that names no tree — holding one leftover that kept `KEPT`. */
const aRecordOver = (tree: string | undefined): WhatAKilledRunLeft => {
  const place = tree === undefined ? {} : { worktree: tree }
  const digest = theDigestOf(bytesOf(KEPT))
  return {
    member: THE_MEMBER,
    at_ms: ENDED_AT,
    running: [{ command_line: THE_COMMAND, started_at_ms: STARTED_AT }],
    dirty: [{ path: A_PATH, ...place, digest }],
    leftovers: [{ path: A_PATH, ...place, digest, mtime_ms: STARTED_AT, command_line: THE_COMMAND, started_at_ms: STARTED_AT }],
    dropped: { commands: 0, files: 0, leftovers: 0 },
  }
}

/** A folder of the test's own, removed when the test ends. */
const aFolder = (t: TestContext): string => {
  const home = mkdtempSync(join(tmpdir(), 'martha-719-hand-off-'))
  t.after(() => removeTheTree(home))
  return home
}

/** A file written with the folders on the way to it. */
const written = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

/** The crew's own store under `home`, kept as the machine keeps it. */
const crewUnder = (home: string): CrewStore => keepTheCrewsFilesAsDirectories(join(home, 'crew-files'))

/** The crew's tools, built the way a launch builds them: the guard's four places, spread in (martha#719 N2). */
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

/** What the crew refuses of a call carrying `text` under `tool`, through the seam a tool call really takes. */
const refusedFor = (crew: CrewTools, text: string, tool: string = SAY_TO_THE_CREW): Promise<string | undefined> =>
  whatTheCrewRefusesOfACall(crew, { tool, input: { to: ['Supervisor'], text } }, 'a-session')

test("a hand-off is refused while the leftover's bytes stand in the member's one worktree, and sent once they change", async (t) => {
  const home = aFolder(t)
  const tree = join(home, WORKTREES, 'a-tree')
  written(join(tree, A_PATH), KEPT)
  const crew = crewUnder(home)
  keepTheLeftoverRecordOf(crew, aRecordOver(tree))
  const tools = crewOf(crew, home)

  // The whole sentence, opening and closing both: the hand-off's own words, never the commit's (martha#719 N3). What
  // the record chose — the tree, the path, the command — stands in it as data, quoted, as the telling quotes it.
  assert.equal(
    await refusedFor(tools, A_HAND_OFF),
    `this hand-off comes while what a killed run left stands: ${JSON.stringify(`${tree}: ${A_PATH}`)} (the bytes are the ones kept when the launch ended). ` +
      `It was running when the launch ended: ${JSON.stringify(THE_COMMAND)}. ` +
      `Restore what is not yours, or take ${THE_RELEASE_ACT} for the paths that are, and then hand off.`,
  )

  written(join(tree, A_PATH), CHANGED)
  assert.equal(await refusedFor(tools, A_HAND_OFF), undefined)
})

test('a record that names no tree refuses nothing, and is not read at the checkout instead (martha#719 N1)', async (t) => {
  const home = aFolder(t)
  // The checkout holds the kept bytes, so a refusal that fell back on it would refuse this hand-off.
  written(join(home, A_PATH), KEPT)
  const crew = crewUnder(home)
  keepTheLeftoverRecordOf(crew, aRecordOver(undefined))
  assert.equal(await refusedFor(crewOf(crew, home), A_HAND_OFF), undefined)
})

test('a path whose bytes cannot be read is not standing, and refuses nothing', async (t) => {
  const home = aFolder(t)
  const crew = crewUnder(home)
  keepTheLeftoverRecordOf(crew, aRecordOver(join(home, WORKTREES, 'gone')))
  assert.equal(await refusedFor(crewOf(crew, home), A_HAND_OFF), undefined)
})

test('a question is never refused, and neither is a VERDICT', async (t) => {
  const home = aFolder(t)
  const tree = join(home, WORKTREES, 'a-tree')
  written(join(tree, A_PATH), KEPT)
  const crew = crewUnder(home)
  keepTheLeftoverRecordOf(crew, aRecordOver(tree))
  const tools = crewOf(crew, home)
  assert.equal(await refusedFor(tools, 'Can you look at the design before I build it?'), undefined)
  assert.equal(await refusedFor(tools, A_VERDICT), undefined)
})

test('a call that is not say_to_crew is never refused, whatever it carries', async (t) => {
  const home = aFolder(t)
  const tree = join(home, WORKTREES, 'a-tree')
  written(join(tree, A_PATH), KEPT)
  const crew = crewUnder(home)
  keepTheLeftoverRecordOf(crew, aRecordOver(tree))
  assert.equal(await refusedFor(crewOf(crew, home), A_HAND_OFF, LOG_A_MILESTONE), undefined)
})

test('a crew that kept no record for this member refuses nothing', async (t) => {
  const home = aFolder(t)
  assert.equal(await refusedFor(crewOf(crewUnder(home), home), A_HAND_OFF), undefined)
})

test('a record nobody can read refuses nothing: it is not read as "nothing was left"', async (t) => {
  const home = aFolder(t)
  const crew = crewUnder(home)
  const place = crew.place(LEFTOVER_RECORDS_PLACE)
  assert.ok(!('refusal' in place))
  if (!('refusal' in place)) place.keep(theRecordFileNameOf(THE_MEMBER), 'not a record')
  assert.equal(await refusedFor(crewOf(crew, home), A_HAND_OFF), undefined)
})
