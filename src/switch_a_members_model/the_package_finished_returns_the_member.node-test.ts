// The return a finished package makes of it (martha#1000, gap 8 of #957): a member switched for one package comes home
// when that package's ledger says it was released or landed, and on nothing else.
//
// These are plain tests: the rule reads the crew's own store and the package's ledger, so each case writes a real record
// and real ledger rows, and reads what a member's next session would find.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, declareCrew, OWNER, SOLO_MODE } from '../declare_crew/declare_crew.ts'
import { CLOSED_VOCABULARY, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { noteMilestone } from '../log_ledger/log_ledger.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { modelPlace, switchAMembersModel, theModelOf, type ModelMarker } from './switch_a_members_model.ts'
import { returnedWhenTheSwitchedPackageFinished, type TheTriggerPlace } from './the_switch_tools.ts'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-1000-return-'))
after(() => removeTheTree(homeOfAll))

const documents = { read: (path: string) => readFile(path, 'utf8') }
const HOST_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: ['opus', 'fable'] }

/** The package the switch is made for, and one it is not. */
const THE_PACKAGE = 'macula-io/martha#308'
const ANOTHER_PACKAGE = 'macula-io/martha#981'

/** What a member switched for a package reads as, from its record: the home it returns to is what a test asserts on. */
interface ASwitchedMember {
  readonly place: TheTriggerPlace
  readonly crew: string
  readonly clock: { at: number }
  /** What the member's record says now. */
  readonly record: () => ReturnType<typeof theModelOf> | { readonly refusal: string }
  /** What the record says the member is, asserted to be readable: the kind a test reads. */
  readonly kindNow: () => string
  /** A ledger row this package keeps, at a moment the test names. */
  readonly keepARowOn: (package_name: string, milestone: 'release_shipped' | 'package_landed' | 'checkpoint_reached', at: number) => Promise<void>
}

let crewsSoFar = 0
async function aMemberSwitchedForAPackage(): Promise<ASwitchedMember> {
  crewsSoFar += 1
  const home = join(homeOfAll, `crew-${crewsSoFar}`)
  const root = join(home, 'checkout')
  const crew = join(home, 'the-crew-files')
  mkdirSync(join(root, DECLARATION_DIRECTORY), { recursive: true })
  mkdirSync(crew, { recursive: true })
  writeFileSync(join(root, DECLARATION_DIRECTORY, DECLARATION_FILE), `${JSON.stringify({
    version: DECLARATION_VERSION,
    owner: 'an owner',
    members: [{ name: 'builder', role: 'builder', model: 'opus' }],
    mode: { name: SOLO_MODE, roles: ['builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER]])) },
    channel_read_seconds: 30,
  }, null, 2)}\n`)
  assert.ok(await declareCrew(documents, root, HOST_MODELS), 'the test could not declare a crew')
  const clock = { at: 1_000 }
  const ledger: LedgerHost = { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(home, CREW_ROWS_PLACE)) } }
  mkdirSync(join(home, CREW_ROWS_PLACE), { recursive: true })
  const place: TheTriggerPlace = { stores: { crew: keepTheCrewsFilesAsDirectories(crew) }, member: 'builder', ledger }
  const switched = switchAMembersModel({ stores: place.stores }, { member: 'builder', model: 'fable', home: 'opus', package: THE_PACKAGE, why: 'the review is on Opus', at: new Date(2_000) })
  assert.ok(!('refusal' in switched), `the test could not switch the member: ${'refusal' in switched ? switched.refusal : ''}`)
  return {
    place,
    crew,
    clock,
    record: () => {
      const model_place = modelPlace({ stores: place.stores })
      return 'refusal' in model_place ? { refusal: model_place.refusal } : theModelOf(model_place, 'builder')
    },
    kindNow: () => {
      const model_place = modelPlace({ stores: place.stores })
      assert.ok(!('refusal' in model_place), 'the crew store refused its model place')
      return theModelOf(model_place as Parameters<typeof theModelOf>[0], 'builder').kind
    },
    keepARowOn: async (package_name, milestone, at) => {
      clock.at = at
      await noteMilestone(ledger, { package: package_name, member: 'builder', milestone, note: 'a row this test kept' })
    },
  }
}

test('#1000: a release the switched package shipped brings the member home', async () => {
  const member = await aMemberSwitchedForAPackage()
  assert.equal(member.kindNow(), 'switched', 'the member is not switched, so the return cannot be read')
  await member.keepARowOn(THE_PACKAGE, 'release_shipped', 3_000)
  const told = await returnedWhenTheSwitchedPackageFinished(member.place, { turn_id: 't-1' })
  assert.ok(told !== null && /release/.test(told), `a release for the switched package did not return the member: ${told}`)
  assert.equal(member.kindNow(), 'home', 'the member still reads as switched after its package shipped a release')
})

test('#1000: the package landing brings the member home too', async () => {
  const member = await aMemberSwitchedForAPackage()
  await member.keepARowOn(THE_PACKAGE, 'package_landed', 3_000)
  const told = await returnedWhenTheSwitchedPackageFinished(member.place, { turn_id: 't-1' })
  assert.ok(told !== null && /landing/.test(told), `a landing for the switched package did not return the member: ${told}`)
  assert.equal(member.kindNow(), 'home', 'the member still reads as switched after its package landed')
})

test('#1000: another package\'s release does not return the member, and neither does a row older than the switch', async () => {
  const member = await aMemberSwitchedForAPackage()
  await member.keepARowOn(ANOTHER_PACKAGE, 'release_shipped', 3_000)
  assert.equal(await returnedWhenTheSwitchedPackageFinished(member.place, { turn_id: 't-1' }), null, 'a release for another package returned the member')
  // A row the switched package keeps from before the switch is not that package finishing under it.
  await member.keepARowOn(THE_PACKAGE, 'release_shipped', 1_500)
  assert.equal(await returnedWhenTheSwitchedPackageFinished(member.place, { turn_id: 't-1' }), null, 'a row older than the switch returned the member')
  assert.equal(member.kindNow(), 'switched', 'the member came home on a row that is no finish of its package')
})

test('#1000: a plain checkpoint on the package is no finish, and a session\'s start returns nothing', async () => {
  const member = await aMemberSwitchedForAPackage()
  await member.keepARowOn(THE_PACKAGE, 'checkpoint_reached', 3_000)
  assert.equal(await returnedWhenTheSwitchedPackageFinished(member.place, { turn_id: 't-1' }), null, 'a checkpoint on the package was read as it finishing')
  await member.keepARowOn(THE_PACKAGE, 'release_shipped', 4_000)
  assert.equal(await returnedWhenTheSwitchedPackageFinished(member.place, { turn_id: '' }), null, 'a session\'s start was read as a turn\'s end, and the member moved before it had a turn')
  assert.equal(member.kindNow(), 'switched', 'a read that should move nothing moved the member home')
})

test('#1000: a member that is not switched is returned by nothing', async () => {
  const member = await aMemberSwitchedForAPackage()
  assert.ok(!('refusal' in member.record()), 'the test could not read the record')
  const back = (member.record() as { readonly kind: string }).kind
  assert.equal(back, 'switched', 'the member is not switched, so the case below proves nothing')
  // The record returns home by the ledger's own row first; a second read finds a member at home and moves nothing.
  await member.keepARowOn(THE_PACKAGE, 'package_landed', 3_000)
  assert.ok((await returnedWhenTheSwitchedPackageFinished(member.place, { turn_id: 't-1' })) !== null, 'the first return did not happen')
  assert.equal(await returnedWhenTheSwitchedPackageFinished(member.place, { turn_id: 't-2' }), null, 'a member already home was returned a second time')
})

/** The marker type is part of the record a switch writes; a compile-time read of it keeps a rename from passing silently. */
const A_MARKER: (marker: ModelMarker) => string = (marker) => marker.package
void A_MARKER
