// A member's model record: switched for one package, and returned home (martha#315).
//
// The record is a file in the crew store, so what one session wrote is what the next session and the owner read. These
// tests use the same reader and writer the tool does, and the declaration reader the launcher uses, so what they hold
// is what a member's next session finds.
//
// The mutant each test kills is named in its title.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, declareCrew, OWNER, REVIEW_MODEL, type CrewSettings } from '../declare_crew/declare_crew.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import {
  homeModelOf,
  modelPlace,
  modelsTheDeclarationNames,
  returnAMemberHome,
  switchAMembersModel,
  theModelMarker,
  theModelOf,
  theSwitchACallAsks,
  theSwitchDirected,
  type ModelMarker,
} from './switch_a_members_model.ts'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-model-switch-'))
after(() => removeTheTree(homeOfAll))

const documents = { read: (path: string) => readFile(path, 'utf8') }

/** The models this test's host runs (martha#315): the vocabulary a declaration's `review_model` is read against. */
const HOST_MODELS = ['opus', 'fable']

/** The crew every test works on: builder and reviewer, a declared model each, and a reviewer model for reviews. */
interface ADeclaredCrew {
  readonly settings: CrewSettings
  readonly crew: string
}

let crewsSoFar = 0
async function aDeclaredCrewOfModels(): Promise<ADeclaredCrew> {
  crewsSoFar += 1
  const home = join(homeOfAll, `crew-${crewsSoFar}`)
  const root = join(home, 'checkout')
  const crew = join(home, 'crew')
  const declaration = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  mkdirSync(join(root, DECLARATION_DIRECTORY), { recursive: true })
  mkdirSync(crew, { recursive: true })
  const declared = {
    version: DECLARATION_VERSION,
    owner: 'an owner',
    members: [
      { name: 'builder', role: 'builder', model: 'opus' },
      { name: 'reviewer', role: 'reviewer' },
    ],
    mode: {
      name: 'solo',
      roles: ['builder', 'reviewer'],
      may: Object.fromEntries(ACTS.map((act) => [act, [OWNER]])),
    },
    house_rules: { [REVIEW_MODEL]: 'fable' },
    channel_read_seconds: 30,
  }
  writeFileSync(declaration, `${JSON.stringify(declared, null, 2)}\n`)
  return { settings: await declareCrew(documents, root, HOST_MODELS), crew }
}

/** The crew's store, as a tool and the owner's own reading both reach it. */
const theStore = (crew: string) => ({ stores: { crew: crewFilesDirectory(crew) } })

/** What `member`'s record says, read the way the tool reads it. */
function whatTheStoreSays(crew: string, member: string) {
  const place = modelPlace(theStore(crew))
  assert.ok(!('refusal' in place), `the crew's store refused its model place: ${'refusal' in place ? place.refusal : ''}`)
  return theModelOf(place, member)
}

test('#315: the declaration names this member its own model and the crew its reviewer model, and nothing else', async () => {
  const { settings } = await aDeclaredCrewOfModels()
  assert.deepEqual(modelsTheDeclarationNames(settings, 'builder'), ['opus', 'fable'], 'the models a switch may name are not the two the declaration names')
  assert.deepEqual(modelsTheDeclarationNames(settings, 'reviewer'), ['fable'], 'a member with no declared model is offered a model the declaration does not name')
  assert.equal(homeModelOf(settings, 'builder'), 'opus', 'the member\'s home is not the model the declaration gives it')
  assert.equal(homeModelOf(settings, 'reviewer'), '', 'a member the declaration gives no model has a home model, which the host — not this slice — decides')
})

test('#315: a switch to a declared model is kept, with its package and why (mutant: allow-list removed)', async () => {
  const { settings, crew } = await aDeclaredCrewOfModels()
  const asked = theSwitchACallAsks({ model: 'fable', package: 'macula-io/martha#315', why: 'the review is on Opus' }, settings, 'builder')
  assert.ok(typeof asked !== 'string', `a declared model was refused: ${asked}`)
  const kept = switchAMembersModel(theStore(crew), { ...(asked as Exclude<typeof asked, string>), member: 'builder', home: homeModelOf(settings, 'builder'), at: new Date(1_000) })
  assert.ok(!('refusal' in kept), `the switch was refused: ${'refusal' in kept ? kept.refusal : ''}`)
  assert.deepEqual(whatTheStoreSays(crew, 'builder'), {
    kind: 'switched',
    marker: { switched: true, model: 'fable', home: 'opus', package: 'macula-io/martha#315', why: 'the review is on Opus', since: new Date(1_000).toISOString(), directed: false },
  }, 'the record a later session reads is not the switch that was made')
})

test('#315: a switch to a model the declaration does not name is refused by name, and nothing is written', async () => {
  const { settings, crew } = await aDeclaredCrewOfModels()
  for (const model of ['claude-fable-5-1', 'haiku', ' ']) {
    const asked = theSwitchACallAsks({ model, package: 'macula-io/martha#315', why: 'a reason' }, settings, 'builder')
    assert.ok(typeof asked === 'string', `a switch to ${JSON.stringify(model)}, which the declaration does not name, was let through`)
    assert.match(asked, /opus, fable/, `the refusal for ${JSON.stringify(model)} does not name the models the declaration does`)
  }
  assert.deepEqual(whatTheStoreSays(crew, 'builder'), { kind: 'home', last_marker: null }, 'a refused switch left a record behind')
})

test('#315: a switch with no reason, or no package, is refused rather than kept as a line the owner cannot read', async () => {
  const { settings } = await aDeclaredCrewOfModels()
  const noReason = theSwitchACallAsks({ model: 'fable', package: 'macula-io/martha#315', why: '   ' }, settings, 'builder')
  assert.ok(typeof noReason === 'string' && /says why in one line/.test(noReason), 'a switch with no reason was kept')
  const noPackage = theSwitchACallAsks({ model: 'fable', package: '', why: 'a reason' }, settings, 'builder')
  assert.ok(typeof noPackage === 'string' && /names the package/.test(noPackage), 'a switch naming no package was kept, so the ledger cannot say what it cost')
})

test('#315: a return writes the record with switched false, and keeps what the package ran on', async () => {
  const { crew } = await aDeclaredCrewOfModels()
  const switched = switchAMembersModel(theStore(crew), { member: 'builder', model: 'fable', home: 'opus', package: 'macula-io/martha#315', why: 'a reason', at: new Date(1_000) })
  assert.ok(!('refusal' in switched), 'the test could not switch the member first')
  const back = returnAMemberHome(theStore(crew), { member: 'builder', marker: switched as ModelMarker, why: 'the package is done', at: new Date(2_000) })
  assert.ok(!('refusal' in back), `the return was refused: ${'refusal' in back ? back.refusal : ''}`)
  const read = whatTheStoreSays(crew, 'builder')
  assert.equal(read.kind, 'home', 'a returned member still reads as switched, so the model it runs on is not the record\'s own')
  // This switch was never directed, so the return carries that: no order goes out for a session that never moved.
  assert.deepEqual(read.kind === 'home' ? read.last_marker : null, {
    switched: false, model: 'fable', home: 'opus', package: 'macula-io/martha#315', why: 'the package is done', since: new Date(2_000).toISOString(), directed: true,
  }, 'the return lost what the package ran on, or why it came back')
})

test('#315: a return from a switch the session was told about is itself not directed yet (mutant: the return always directed)', async () => {
  const { crew } = await aDeclaredCrewOfModels()
  const switched = switchAMembersModel(theStore(crew), { member: 'builder', model: 'fable', home: 'opus', package: 'macula-io/martha#315', why: 'a reason', at: new Date(1_000) })
  assert.ok(!('refusal' in switched), 'the test could not switch the member first')
  const directed = theSwitchDirected(theStore(crew), 'builder', switched as ModelMarker)
  assert.ok(!('refusal' in directed), 'the test could not direct the switch')
  const back = returnAMemberHome(theStore(crew), { member: 'builder', marker: directed as ModelMarker, why: 'the package is done', at: new Date(2_000) })
  assert.ok(!('refusal' in back), `the return was refused: ${'refusal' in back ? back.refusal : ''}`)
  const read = whatTheStoreSays(crew, 'builder')
  assert.equal(read.kind === 'home' ? read.last_marker?.directed : null, false, 'the return of a switch the session was told about reads as already told, so the session is never brought home')
})

test('#315: a record the store cannot hand over is not read as "no switch"', async () => {
  const { crew } = await aDeclaredCrewOfModels()
  const place = modelPlace(theStore(crew))
  assert.ok(!('refusal' in place), 'the crew store refused its model place')
  const path = (place as { path: string }).path
  // A file this user keeps to itself, holding no record: the store hands it over and this slice cannot read it.
  writeFileSync(join(path, theModelMarker('builder')), 'not a record\n', { mode: 0o600 })
  const read = whatTheStoreSays(crew, 'builder')
  assert.equal(read.kind, 'unreadable', 'a record holding no marker was read as a member at home, so a member could stay on the expensive model unseen')
  assert.match(read.kind === 'unreadable' ? read.refusal : '', /holds no model record/, 'the refusal does not say what is wrong with the file')
  // And one the store itself will not vouch for is `unreadable` too, never "no switch".
  writeFileSync(join(path, theModelMarker('reviewer')), `${JSON.stringify({ switched: true })}\n`, { mode: 0o644 })
  const theirs = whatTheStoreSays(crew, 'reviewer')
  assert.equal(theirs.kind, 'unreadable', 'a record the store will not vouch for was read as a member at home')
})
