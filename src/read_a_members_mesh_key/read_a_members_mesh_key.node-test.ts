// A team member's mesh key (martha#1016): where it is declared, and every key that is refused, each for the harm the
// design names (T1 to T4), with a solo crew reading none.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SOLO_MODE } from '../declare_crew/declare_crew.ts'
import { NO_MESH_KEYS } from '../declare_crew/the_crews_workspace.ts'
import { keyFileNameOf, theMeshKeyOf, type AKeyFileSeen, type TheKeysAsked } from './read_a_members_mesh_key.ts'

const HOME = '/planted/owners/home'
const OWNER_UID = 1234
const ANOTHER_UID = 4321
const KEYS_WRITTEN = 'keys'
const KEYS = `${HOME}/keys`
const OWNERS_ONLY = 0o100600

/** A disk of key files by path; every path not on it is absent. */
function aDisk(files: Readonly<Record<string, Partial<AKeyFileSeen>>>): TheKeysAsked['see'] {
  return (path) => {
    const file = files[path]
    return file === undefined ? null : { kind: 'file', uid: OWNER_UID, mode: OWNERS_ONLY, real: path, ...file }
  }
}

function asked(overrides: Partial<TheKeysAsked>): TheKeysAsked {
  return { team: true, keys: { folder: KEYS_WRITTEN, named: {} }, members: ['Venus', 'Terra'], placeOf: (written) => (written.startsWith('/') ? written : `${HOME}/${written}`), uid: OWNER_UID, see: aDisk({}), ...overrides }
}

const VENUS_KEY = `${KEYS}/agent-venus.key`
const TERRA_KEY = `${KEYS}/agent-terra.key`
const BOTH = { [VENUS_KEY]: {}, [TERRA_KEY]: {} }

test('#1016: the key sits in the keys folder as agent-<name>.key, the name folded as member names are', () => {
  assert.equal(keyFileNameOf('Venus'), 'agent-venus.key')
  assert.deepEqual(theMeshKeyOf('Venus', asked({ see: aDisk(BOTH) })), { path: VENUS_KEY })
})

test("#1016: a member's own mesh_key wins over the folder, found by its name key whatever the case", () => {
  const own = '/elsewhere/venus.key'
  const keys = { folder: KEYS_WRITTEN, named: { venus: own } }
  assert.deepEqual(theMeshKeyOf('VENUS', asked({ keys, members: ['VENUS', 'Terra'], see: aDisk({ [own]: {}, [TERRA_KEY]: {} }) })), { path: own })
})

test('#1016 T1: a team crew that names no place for a key is refused by name, never given a default identity', () => {
  const refused = theMeshKeyOf('Venus', asked({ keys: NO_MESH_KEYS, see: aDisk(BOTH) }))
  assert.deepEqual(refused, { refusal: "Venus's mesh key has no place: the declaration names neither mesh.keys nor a mesh_key for Venus" })
})

test('#1016 T4: a missing key is refused, and nothing is made in its place', () => {
  const seen: string[] = []
  const disk = aDisk({ [TERRA_KEY]: {} })
  const refused = theMeshKeyOf('Venus', asked({ see: (path) => (seen.push(path), disk(path)) }))
  assert.deepEqual(refused, { refusal: `Venus's mesh key: there is no key at ${VENUS_KEY}; Martha makes none, so make it or name the member's own mesh_key` })
  assert.deepEqual(seen, [VENUS_KEY])
})

test('#1016 T2/T3: a link, something not a file, another owner and every group or other bit are refused', () => {
  const refusedFor = (file: Partial<AKeyFileSeen>) => theMeshKeyOf('Venus', asked({ see: aDisk({ ...BOTH, [VENUS_KEY]: file }) }))
  assert.deepEqual(refusedFor({ kind: 'link' }), { refusal: `Venus's mesh key: ${VENUS_KEY} is a link, and a key must be the file itself` })
  assert.deepEqual(refusedFor({ kind: 'other' }), { refusal: `Venus's mesh key: ${VENUS_KEY} is not a file` })
  assert.deepEqual(refusedFor({ uid: ANOTHER_UID }), { refusal: `Venus's mesh key: ${VENUS_KEY} belongs to another user` })
  for (const bit of [0o040, 0o020, 0o010, 0o004, 0o002, 0o001]) {
    const mode = OWNERS_ONLY | bit
    assert.deepEqual(refusedFor({ mode }), { refusal: `Venus's mesh key: ${VENUS_KEY} can be read by others (mode ${(mode & 0o777).toString(8)}); a key must be the owner's alone (chmod 600)` }, bit.toString(8))
  }
  assert.deepEqual(refusedFor({ mode: 0o100400 }), { path: VENUS_KEY })
})

test('#1016 T2: two members whose keys are one real file are both refused, each naming the other', () => {
  const one = { real: '/real/shared.key' }
  const disk = aDisk({ [VENUS_KEY]: one, [TERRA_KEY]: one })
  const tail = 'two members on one key share one node id, and the station drops one whenever the other connects'
  assert.deepEqual(theMeshKeyOf('Venus', asked({ see: disk })), { refusal: `Venus's mesh key ${VENUS_KEY} is also Terra's: ${tail}` })
  assert.deepEqual(theMeshKeyOf('Terra', asked({ see: disk })), { refusal: `Terra's mesh key ${TERRA_KEY} is also Venus's: ${tail}` })
})

test("#1016 T2: another member's unreadable key does not refuse this one", () => {
  assert.deepEqual(theMeshKeyOf('Venus', asked({ see: aDisk({ [VENUS_KEY]: {} }) })), { path: VENUS_KEY })
})

test('#1016: a solo crew reads no key and looks at no path', () => {
  const seen: string[] = []
  assert.deepEqual(theMeshKeyOf('Venus', asked({ team: false, see: (path) => (seen.push(path), null) })), { none: SOLO_MODE })
  assert.deepEqual(seen, [])
})
