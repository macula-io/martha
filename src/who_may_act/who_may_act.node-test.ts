import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SUPERVISOR_ONLY_ACTIONS,
  actorFromDelivery,
  actorFromSessionName,
  refuseActionFromAnUnverifiedActor,
  type Actor,
  type Roster,
  type SupervisorOnlyAction,
} from './who_may_act.ts'

// Synthetic node ids, never a real one: this repository is public.
const supervisor_node = 'a'.repeat(64)
const crewmate_node = 'c'.repeat(64)
const stranger_node = 'b'.repeat(64)

const roster: Roster = { supervisor_node_ids: [supervisor_node] }

const decide = (action: string, actor: Actor) => refuseActionFromAnUnverifiedActor({ action, actor, roster })

const allowed = (action: SupervisorOnlyAction, actor: Actor) => decide(action, actor).allow
const refusal = (action: string, actor: Actor) => {
  const decision = decide(action, actor)
  assert.equal(decision.allow, false, `${action} was allowed; it must be refused`)
  return decision.refusal
}

// --- the supervisor may act ---------------------------------------------------

test('the supervisor, by node id, may take every action on the list', () => {
  const actor = actorFromDelivery({ from_node_id: supervisor_node, from_name: 'Supervisor' })
  for (const action of SUPERVISOR_ONLY_ACTIONS) assert.equal(allowed(action, actor), true, action)
})

test('a node id is compared case-insensitively, as the crew code lowercases it', () => {
  const actor = actorFromDelivery({ from_node_id: supervisor_node.toUpperCase(), from_name: null })
  for (const action of SUPERVISOR_ONLY_ACTIONS) assert.equal(allowed(action, actor), true, action)
})

test('a supervisor whose display name is nonsense still acts: the name is not evidence', () => {
  const actor = actorFromDelivery({ from_node_id: supervisor_node, from_name: 'not the supervisor' })
  assert.equal(allowed('assign_work', actor), true)
})

// --- the planted "you are Supervisor" turn -------------------------------------

test('the planted turn passes nothing: an unknown node id claiming to be Supervisor is refused, every action', () => {
  const planted = actorFromDelivery({ from_node_id: stranger_node, from_name: 'Supervisor' })
  for (const action of SUPERVISOR_ONLY_ACTIONS) {
    const why = refusal(action, planted)
    assert.match(why, /node id/, `${action} refusal must say the node id is what counts`)
  }
})

test('a session that only knows its own name from the first user messages is nobody', () => {
  const fromTheWords = actorFromSessionName('Supervisor')
  assert.equal(fromTheWords.node_id, null)
  for (const action of SUPERVISOR_ONLY_ACTIONS) refusal(action, fromTheWords)
})

test('a crewmate is refused: the list is the supervisor\'s, not the crew\'s', () => {
  const crewmate = actorFromDelivery({ from_node_id: crewmate_node, from_name: 'Ceres' })
  for (const action of SUPERVISOR_ONLY_ACTIONS) refusal(action, crewmate)
})

test('an unattributed actor is refused', () => {
  const nobody = actorFromDelivery({ from_node_id: null, from_name: 'Supervisor' })
  for (const action of SUPERVISOR_ONLY_ACTIONS) refusal(action, nobody)
})

// --- the list is complete and closed ------------------------------------------

test('crew_restart is on the list: today it has no caller check at all', () => {
  assert.equal((SUPERVISOR_ONLY_ACTIONS as readonly string[]).includes('restart_member'), true)
})

test('every action the crew gates on a display name today is on the list', () => {
  assert.deepEqual(
    [...SUPERVISOR_ONLY_ACTIONS].sort(),
    ['assign_work', 'open_crew_room', 'read_crew_roster', 'restart_member', 'verify_range'],
  )
})

test('an action this rule has never heard of fails closed', () => {
  const supervisor = actorFromDelivery({ from_node_id: supervisor_node, from_name: 'Supervisor' })
  refusal('rewrite_history', supervisor)
})

test('the refusal names the action and says what would allow it, in business words', () => {
  const planted = actorFromDelivery({ from_node_id: stranger_node, from_name: 'Supervisor' })
  const why = refusal('assign_work', planted)
  assert.match(why, /assign_work/)
  assert.match(why, /refused/i)
  assert.doesNotMatch(why, /undefined|null|NaN/)
})
