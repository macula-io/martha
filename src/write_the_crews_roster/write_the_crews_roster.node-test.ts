// The crew's roster (martha#1016 (d)): each team member's node id from its own key, a member whose key is refused left
// out by name with the bin never started on its path (T4), a bad id left out, and a solo crew with none.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SOLO_MODE } from '../declare_crew/declare_crew.ts'
import type { AKeyFileSeen } from '../read_a_members_mesh_key/read_a_members_mesh_key.ts'
import { rosterText, theCrewsRoster, type TheRosterAsked } from './write_the_crews_roster.ts'

const KEYS = '/planted/keys'
const OWNER_UID = 1234
const AN_ID = 'ab'.repeat(32)
const ANOTHER_ID = 'cd'.repeat(32)

/** A disk holding an owner-only key file at each path given. */
const aDisk = (paths: readonly string[]) => (path: string): AKeyFileSeen | null => (paths.includes(path) ? { kind: 'file', uid: OWNER_UID, mode: 0o100600, real: path } : null)

function asked(overrides: Partial<TheRosterAsked>): TheRosterAsked {
  return {
    team: true,
    keys: { folder: KEYS, named: {} },
    members: ['Venus', 'Terra'],
    placeOf: (written) => written,
    uid: OWNER_UID,
    see: aDisk([`${KEYS}/agent-venus.key`, `${KEYS}/agent-terra.key`]),
    nodeIdOf: (path) => ({ id: path.endsWith('agent-venus.key') ? AN_ID : ANOTHER_ID }),
    ...overrides,
  }
}

test('#1016: a team crew has each member on its roster by the node id its own key gives', () => {
  assert.deepEqual(theCrewsRoster(asked({})), { ids: { Venus: AN_ID, Terra: ANOTHER_ID }, left_out: [] })
  assert.equal(rosterText({ Venus: AN_ID }), `{\n  "Venus": "${AN_ID}"\n}\n`)
})

test('#1016 T4: a member whose key is missing is left out by name, and the bin is never started on its path', () => {
  const started: string[] = []
  const roster = theCrewsRoster(asked({ see: aDisk([`${KEYS}/agent-venus.key`]), nodeIdOf: (path) => (started.push(path), { id: AN_ID }) }))
  assert.deepEqual(started, [`${KEYS}/agent-venus.key`])
  assert.ok('ids' in roster)
  assert.deepEqual(roster.ids, { Venus: AN_ID })
  assert.equal(roster.left_out.length, 1)
  assert.ok(roster.left_out[0]!.startsWith(`Terra is left out of the roster: Terra's mesh key: there is no key at ${KEYS}/agent-terra.key`), String(roster.left_out[0]))
})

test('#1016: an id the bin gives is kept lowercased, and an answer that is no node id leaves the member out', () => {
  const roster = theCrewsRoster(asked({ nodeIdOf: (path) => (path.endsWith('agent-venus.key') ? { id: `${AN_ID.toUpperCase()}\n` } : { id: 'not an id' }) }))
  assert.ok('ids' in roster)
  assert.deepEqual(roster.ids, { Venus: AN_ID })
  assert.deepEqual(roster.left_out, ['Terra is left out of the roster: the key gave no node id ("not an id")'])
  const refused = theCrewsRoster(asked({ nodeIdOf: () => ({ refusal: 'the bin failed' }) }))
  assert.ok('ids' in refused)
  assert.deepEqual(refused.left_out, ['Venus is left out of the roster: the bin failed', 'Terra is left out of the roster: the bin failed'])
})

test('#1016: a solo crew has no roster, and no key is looked at for it', () => {
  const seen: string[] = []
  assert.deepEqual(theCrewsRoster(asked({ team: false, see: (path) => (seen.push(path), null) })), { none: SOLO_MODE })
  assert.deepEqual(seen, [])
})
