// Who may ask who is free (martha#319 package A, Uranus's r=1 finding 2): the declaration's table, by the predicate the
// owner's to-do list is kept by (#316), so the two tools of one design answer "may this member assign work?" alike.
//
// A solo crew, as `martha init` writes it, grants every act to the owner alone; its members are the owner's own sessions
// and may ask. A team that grants assign_work to the owner and its Supervisor lets only the Supervisor ask, and a table
// granting it to the owner and a role nobody holds still refuses the builder, so a check that read "the table names the
// owner" in place of "names the owner and nothing else" fails here by name.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { soloDeclaration, SOLO_MEMBERS } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { ACTS, OWNER } from '../declare_crew/declare_crew.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import type { ThePark } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { whoIsFreeOver } from './who_is_free_tool.ts'

const NOT_PARKED: ThePark = { kind: 'not_parked', last_marker: null }
const LEAD = 'Lead'
const BUILDER = 'Builder1'

const askedBy = (settings: Parameters<typeof whoIsFreeOver>[0]['settings'], asker: string) =>
  whoIsFreeOver({ settings, asker, rows: [], parkOf: () => NOT_PARKED, now: 1, member: '' })

/** A team whose table grants assign_work to the owner and to its Supervisor both. */
const aTeamGrantingTheOwnerAndTheSupervisor = {
  members: [
    { name: LEAD, role: SUPERVISOR, model: null },
    { name: BUILDER, role: 'builder', model: null },
  ],
  mode: { name: 'team', roles: [SUPERVISOR, 'builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER, SUPERVISOR]])) },
} as unknown as Parameters<typeof whoIsFreeOver>[0]['settings']

test('a solo crew, whose table grants assign_work to the owner alone, lets each of its members ask as the owner\'s session', () => {
  const solo = soloDeclaration('Ann') as unknown as Parameters<typeof whoIsFreeOver>[0]['settings']
  for (const { name } of SOLO_MEMBERS) {
    const said = askedBy(solo, name)
    assert.ok('answer' in said, `${name} of a solo crew was refused: ${'refused' in said ? said.refused : ''}`)
  }
})

test('a team granting assign_work to the owner and its Supervisor refuses its builder and answers its Supervisor', () => {
  const builder = askedBy(aTeamGrantingTheOwnerAndTheSupervisor, BUILDER)
  assert.ok('refused' in builder, 'a builder asked because the table also names the owner')
  assert.match(builder.refused, new RegExp(`${BUILDER} may not ask who is free: the declaration allows assign_work to ${OWNER}, ${SUPERVISOR}, and ${BUILDER}'s role is builder\\.`))
  assert.ok('answer' in askedBy(aTeamGrantingTheOwnerAndTheSupervisor, LEAD), 'the Supervisor the table grants assign_work was refused')
})

test('a name on no member of the crew may not ask, whatever the table grants the owner', () => {
  const said = askedBy(soloDeclaration('Ann') as unknown as Parameters<typeof whoIsFreeOver>[0]['settings'], 'stranger')
  assert.ok('refused' in said, 'a name on no member asked')
  assert.match(said.refused, /stranger's role is none on this crew/)
})

test('a table granting assign_work to the owner and a role no member holds still refuses the builder (#316 r=2 rule)', () => {
  const unfilled = {
    members: [{ name: BUILDER, role: 'builder', model: null }],
    mode: { name: 'team', roles: [SUPERVISOR, 'builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER, SUPERVISOR]])) },
  } as unknown as Parameters<typeof whoIsFreeOver>[0]['settings']
  const said = askedBy(unfilled, BUILDER)
  assert.ok('refused' in said, 'a builder asked because the role the table names besides the owner is held by nobody')
})
