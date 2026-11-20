// Who may ask who is free (martha#319 package A, Uranus's r=1 finding 2): the declaration's table, by the predicate the
// owner's to-do list is kept by (#316), so the two tools of one design answer "may this member assign work?" alike.
//
// A solo crew, as `martha init` writes it, grants every act to the owner alone; its members are the owner's own sessions
// and may ask. A team that grants assign_work to the owner and its Supervisor lets only the Supervisor ask, and a table
// granting it to the owner and a role nobody holds still refuses the builder, so a check that read "the table names the
// owner" in place of "names the owner and nothing else" fails here by name.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { soloDeclaration, SOLO_MEMBERS } from '../declare_crew/declare_crew.ts'
import { ACTS, OWNER } from '../declare_crew/declare_crew.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import type { ThePark } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { whoIsFreeOver } from './who_is_free_tool.ts'
import { THRESHOLDS_WHEN_UNNAMED } from '../declare_crew/the_crews_thresholds.ts'
import { seeTheCrew } from '../see_the_crew/see_the_crew.ts'
import { IDLE, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'

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

test('#931 A: the tool hands the declaration\'s thresholds to the rule: a member past the declared share is not free', () => {
  const declared = { ...THRESHOLDS_WHEN_UNNAMED, handover_percent: THRESHOLDS_WHEN_UNNAMED.handover_percent - 15 }
  const share = THRESHOLDS_WHEN_UNNAMED.handover_percent - 10
  const beat: DashboardRow = {
    member: BUILDER, session: 's', at: 1, state: IDLE, holds: '', task: '', progress: { step: 0, of: 1 }, waits: null, needs: '',
    host: { model: 'opus', provider: 'anthropic', contextPercent: share, costUsd: 1 },
  }
  const settings = { ...aTeamGrantingTheOwnerAndTheSupervisor, thresholds: declared }
  const said = whoIsFreeOver({ settings, asker: LEAD, rows: seeTheCrew(settings, { [BUILDER]: beat }, 1).rows, parkOf: () => NOT_PARKED, now: 1, member: BUILDER })
  assert.ok('answer' in said, 'the Supervisor was refused')
  assert.match(said.answer, new RegExp(`at or past the ${String(declared.handover_percent)}% handover limit`), `the tool did not read the declared share: ${said.answer}`)
})
