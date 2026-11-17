// The contract a member is held to, as the crew answers it for the gate (martha#513 slice 2).
//
// The rule is the slice's (../refuse_calls_outside_the_package_contract); this file pins the wiring: which package's
// contract is answered, which version of it, and that a package with no contract answers nothing at all — so the gate
// refuses nothing for a member that holds none, slice 1's rule that such a package is told so rather than refused.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OFFER_OWNER_ASKS } from '../declare_crew/declare_crew.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { keepThePackageContract } from '../keep_the_package_contract/keep_the_package_contract.ts'
import { ASK_QUEUED, ASKS_SETTLED, OWNER_ASKS_STREAM } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { REPORT_WHERE_THE_WORK_STANDS } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { crewToolsOver, type CrewTools } from './a_crews_tools.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-contract-in-force-'))
after(() => removeTheTree(home))
mkdirSync(join(home, 'row'))
mkdirSync(join(home, CREW_ROWS_PLACE), { mode: STREAM_DIRECTORY_MODE })

// A made-up project root: this repository is public, so no real path appears here.
const root = '/martha-project'
const BUILDER = 'Builder1'
const PACKAGE = 'synthetic-owner/repo#7'

const team = {
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [
    { name: SUPERVISOR, role: SUPERVISOR },
    { name: BUILDER, role: 'builder' },
  ],
  mode: {
    name: 'team',
    roles: [SUPERVISOR, 'builder'],
    may: { ...Object.fromEntries(ACTS.map((act) => [act, [SUPERVISOR]])), [OFFER_OWNER_ASKS]: [SUPERVISOR], assign_work: [SUPERVISOR] },
  },
  channel_read_seconds: 30,
}
const documents = {
  read: async (path: string): Promise<string> => {
    if (path === join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)) return JSON.stringify(team)
    throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
  },
}

/** The ledger the crew reads and a test keeps contracts in: one store, so the crew sees what the test kept. */
const ledger = { clock: { now: () => 1_000 }, stores: { rows: rowStreamsDirectory(join(home, CREW_ROWS_PLACE)) } }
const beats = dashboardRowsIn(join(home, 'row'))

const theToolsOf = (member: string): CrewTools =>
  crewToolsOver({
    member,
    ledger,
    beats,
    root,
    documents,
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, `store-${member}`)) },
  })

/** A brief whose package-contract block says these `allowed`, and nothing else about them. */
const aBriefAllowing = (allowed: string, extra: readonly string[] = []): string =>
  [
    '# Brief 2026-11-17 — a member',
    '',
    '```package-contract',
    'goal: the work the package names',
    'acceptance: the work is at the tip | document: work.txt',
    `allowed: ${allowed}`,
    'budget: 30 minutes',
    'done: the reviewer passed the tip',
    ...extra,
    '```',
  ].join('\n')

test('the crew answers the contract of the package its member holds: its newest version, in the gate\'s own words', async () => {
  const tools = theToolsOf(BUILDER)
  // A member holding no package is held to nothing, so the gate refuses nothing for it.
  assert.equal(await tools.theContractInForce(), undefined)

  // It reports the package it works on, and still holds no contract: nothing is refused yet.
  await tools.answer(REPORT_WHERE_THE_WORK_STANDS, { task: 'the work', step: 0, of: 1, package: PACKAGE }, 'session-builder')
  assert.equal(await tools.theContractInForce(), undefined)

  const first = await keepThePackageContract(ledger, { package: PACKAGE, member: SUPERVISOR, brief: aBriefAllowing('push, land') })
  assert.ok('answer' in first, 'refused' in first ? first.refused : '')
  assert.deepEqual(await tools.theContractInForce(), { package: PACKAGE, version: 1, kind: 'bounded', allowed: ['push', 'land'] })

  // A change is a new version, and the new version is the one in force.
  const second = await keepThePackageContract(ledger, { package: PACKAGE, member: SUPERVISOR, brief: aBriefAllowing('handoff') })
  assert.ok('answer' in second, 'refused' in second ? second.refused : '')
  assert.deepEqual(await tools.theContractInForce(), { package: PACKAGE, version: 2, kind: 'bounded', allowed: ['handoff'] })

  // A member that holds another package is held to that one's contract, not to this one's.
  await theToolsOf(SUPERVISOR).answer(REPORT_WHERE_THE_WORK_STANDS, { task: 'other work', step: 0, of: 1, package: 'synthetic-owner/other#9' }, 'session-lead')
  assert.equal(await theToolsOf(SUPERVISOR).theContractInForce(), undefined)
})

test('a package the owner called unbounded answers an unbounded contract, which refuses no act at all', async () => {
  const tools = theToolsOf(BUILDER)
  await tools.answer(REPORT_WHERE_THE_WORK_STANDS, { task: 'the work', step: 0, of: 1, package: PACKAGE }, 'session-builder')
  const ask = await ledger.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASK_QUEUED, question: `is ${PACKAGE} unbounded?`, asked_by: SUPERVISOR, since: 0 })
  await ledger.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASKS_SETTLED, batch: 0, yes: [ask] })
  const kept = await keepThePackageContract(ledger, {
    package: PACKAGE,
    member: SUPERVISOR,
    brief: ['```package-contract', 'unbounded: the owner asked for a spike', `owner_yes: ${String(ask)}`, '```'].join('\n'),
  })
  assert.ok('answer' in kept, 'refused' in kept ? kept.refused : '')
  const in_force = await tools.theContractInForce()
  assert.equal(in_force?.kind, 'unbounded')
  assert.deepEqual(in_force?.allowed, [])
})
