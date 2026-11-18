import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, CrewStore } from '../host_contract/host_contract.ts'
import { theResumePrompt as theHandoverPrompt } from '../write_my_handover/write_my_handover.ts'
import { theResumePrompt as theWakePrompt } from '../wake_a_member/wake_a_member.ts'
import {
  LEFTOVER_RECORDS_PLACE,
  keepTheLeftoverRecordOf,
  theLeftoverRecordOf,
  theRecordFileNameOf,
  theTellingOnTheNextStart,
} from './the_telling_on_every_start.ts'
import { theKeptText, type WhatAKilledRunLeft } from './tell_a_member_what_its_relaunch_killed.ts'

/** A crew's place in memory: one name, and what was kept under it, so a test reads what the slice wrote. */
const aPlace = (holding: Map<string, string> = new Map<string, string>()): CrewPlace => ({
  path: `/a/crew/${LEFTOVER_RECORDS_PLACE}`,
  keep: (name, text) => {
    holding.set(name, text)
    return undefined
  },
  read: (name) => {
    const text = holding.get(name)
    return text === undefined ? undefined : { text }
  },
  names: () => [...holding.keys()],
})

/** The crew store holding one place under the name the slice asks for, and the holding it keeps things in. */
const aCrew = (holding: Map<string, string> = new Map<string, string>()): { crew: CrewStore; holding: Map<string, string> } => ({
  crew: { place: (name) => (name === LEFTOVER_RECORDS_PLACE ? aPlace(holding) : { refusal: `no place named ${name}` }) },
  holding,
})

const STARTED_AT = 1_794_998_340_000

const aRecord = (different: Partial<WhatAKilledRunLeft> = {}): WhatAKilledRunLeft => ({
  member: 'a_member',
  at_ms: STARTED_AT + MINUTE_MS,
  running: [{ command_line: 'node run_the_mutants.mjs src/', started_at_ms: STARTED_AT }],
  dirty: [{ path: 'src/a_slice/a_file.ts', digest: 'a7f3' }],
  leftovers: [
    {
      path: 'src/a_slice/a_file.ts',
      digest: 'a7f3',
      mtime_ms: STARTED_AT + 1_000,
      command_line: 'node run_the_mutants.mjs src/',
      started_at_ms: STARTED_AT,
    },
  ],
  dropped: { commands: 0, files: 0, leftovers: 0 },
  ...different,
})

test('a record is kept under the crew place, one file named for its member', () => {
  const { crew, holding } = aCrew()
  assert.equal(keepTheLeftoverRecordOf(crew, aRecord()), undefined)
  assert.deepEqual([...holding.keys()], [theRecordFileNameOf('a_member')])
})

test('nothing kept for a member says nothing on its next start', () => {
  const { crew } = aCrew()
  assert.deepEqual(theTellingOnTheNextStart({ crew, member: 'a_member', now_ms: 1 }), {})
})

test('a kept record is told on the next start, by path and by the command that was killed', () => {
  const { crew } = aCrew()
  keepTheLeftoverRecordOf(crew, aRecord())
  const told = theTellingOnTheNextStart({ crew, member: 'a_member', now_ms: 2 })
  assert.ok(told.telling !== undefined)
  assert.match(told.telling, /"src\/a_slice\/a_file\.ts"/)
  assert.match(told.telling, /"node run_the_mutants\.mjs src\/"/)
  assert.match(told.telling, /release_the_files_a_killed_run_left/)
})

test('a member is told once: the record keeps its telling marked, and the next start says nothing', () => {
  const { crew } = aCrew()
  keepTheLeftoverRecordOf(crew, aRecord())
  assert.ok(theTellingOnTheNextStart({ crew, member: 'a_member', now_ms: 2 }).telling !== undefined)
  assert.deepEqual(theTellingOnTheNextStart({ crew, member: 'a_member', now_ms: 3 }), {})
})

test('being told once does not empty the record: the leftovers still stand for the refusals', () => {
  const { crew } = aCrew()
  keepTheLeftoverRecordOf(crew, aRecord())
  theTellingOnTheNextStart({ crew, member: 'a_member', now_ms: 2 })
  const kept = theLeftoverRecordOf(crew, 'a_member')
  assert.ok(kept !== undefined && 'record' in kept)
  assert.equal(kept.record.leftovers.length, 1)
  assert.equal(kept.record.told_at_ms, 2)
})

test('a record nobody can read says why, never "nothing was left"', () => {
  const { crew, holding } = aCrew()
  holding.set(theRecordFileNameOf('a_member'), '{ not json')
  assert.deepEqual(theTellingOnTheNextStart({ crew, member: 'a_member', now_ms: 2 }), {
    unreadable: 'the kept record does not parse',
  })
})

test('a place that will not answer says why too, never "nothing was left"', () => {
  const crew: CrewStore = { place: () => ({ refusal: 'the crew place is not yours' }) }
  assert.deepEqual(theTellingOnTheNextStart({ crew, member: 'a_member', now_ms: 2 }), {
    unreadable: 'the crew place is not yours',
  })
})

test('a record the store refuses to keep says why, so the caller is not told it was kept', () => {
  const refusing: CrewStore = {
    place: () => ({ path: '/a/crew', keep: () => ({ refusal: 'the disk is full' }), read: () => undefined, names: () => [] }),
  }
  assert.equal(keepTheLeftoverRecordOf(refusing, aRecord()), 'the disk is full')
})

test('both resume prompts carry the one telling, word for word', () => {
  const { crew } = aCrew()
  keepTheLeftoverRecordOf(crew, aRecord())
  const told = theTellingOnTheNextStart({ crew, member: 'a_member', now_ms: 2 }).telling
  assert.ok(told !== undefined)
  const woken = theWakePrompt({ file: '/somewhere/HANDOVER.md', content: '' }, 'a_member', told)
  const refreshed = theHandoverPrompt({ member: 'a_member', file: '/somewhere/HANDOVER.md', acts: [], telling: told })
  assert.ok(woken.includes(told), 'the wake prompt did not carry the telling')
  assert.ok(refreshed.includes(told), 'the refresh prompt did not carry the telling')
})

test('a prompt with no telling is the prompt it was, so nothing is said when nothing was left', () => {
  const woken = theWakePrompt({ file: '/somewhere/HANDOVER.md', content: '' }, 'a_member')
  assert.doesNotMatch(woken, /cut short/)
  const refreshed = theHandoverPrompt({ member: 'a_member', file: '/somewhere/HANDOVER.md', acts: [] })
  assert.doesNotMatch(refreshed, /cut short/)
})

test('a released leftover is not told as holding the run\'s bytes, though the killed command is still named', () => {
  const { crew } = aCrew()
  keepTheLeftoverRecordOf(crew, aRecord({ dirty: [] }))
  const told = theTellingOnTheNextStart({
    crew,
    member: 'a_member',
    now_ms: 2,
    released: [{ path: 'src/a_slice/a_file.ts' }],
  })
  assert.ok(told.telling !== undefined)
  assert.doesNotMatch(told.telling, /still hold what it was writing/)
  assert.match(told.telling, /"node run_the_mutants\.mjs src\/"/)
})

test('a worktree found gone is carried into the telling on the start', () => {
  const { crew } = aCrew()
  keepTheLeftoverRecordOf(crew, aRecord())
  const told = theTellingOnTheNextStart({ crew, member: 'a_member', now_ms: 2, gone: ['/work/worktrees/gone'] })
  assert.ok(told.telling !== undefined)
  assert.match(told.telling, /gone/)
})

test('the kept text is the record read back, so a start reads what the end wrote', () => {
  const { crew, holding } = aCrew()
  const record = aRecord()
  keepTheLeftoverRecordOf(crew, record)
  assert.equal(holding.get(theRecordFileNameOf('a_member')), theKeptText(record))
  const kept = theLeftoverRecordOf(crew, 'a_member')
  assert.deepEqual(kept, { record })
})
