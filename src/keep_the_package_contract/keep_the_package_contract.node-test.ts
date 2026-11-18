import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SOLO_MEMBERS, soloDeclaration } from '../declare_crew/declare_crew.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { readLedger, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { OWNER_ASKS_STREAM, ASK_QUEUED, ASKS_SETTLED } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { theRowWithNothingSaid } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theLineToHandAtStart } from '../hand_a_member_its_crew_text/the_start_line.ts'
import { theResumePrompt } from '../write_my_handover/write_my_handover.ts'
import { theAcceptanceOf, theCriteriaChecked } from './the_acceptance_of_a_package.ts'
import {
  CONTRACT_ACTIONS,
  EVIDENCE_KINDS,
  theContractIn,
  theDigestOf,
  type ABoundedContract,
} from './the_contract_in_a_brief.ts'
import {
  KEEP_THE_PACKAGE_CONTRACT,
  keepThePackageContract,
  theContractPart,
  theContractVersionsOf,
  theNewestContractOf,
} from './keep_the_package_contract.ts'
import { keepTheContract } from './the_contract_tools.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'

// Synthetic names, never a real one: this repository is public.
const PACKAGE = 'synthetic-owner/repo#7'

/** The declaration a test keeps a contract under: one role may assign work, the other may not. */
const A_TEAM = {
  members: [
    { name: SUPERVISOR, role: 'lead' },
    { name: 'member-one', role: 'builder' },
  ],
  mode: { may: { assign_work: ['lead'] } },
}

/** The lines a bounded contract's block says, in the order a Supervisor writes them. */
const A_BLOCK: readonly string[] = [
  'goal: a package is handed the contract it is held to',
  'acceptance: a brief with no contract is refused | test: src/keep_the_package_contract/keep_the_package_contract.node-test.ts',
  'acceptance: the contract is handed at every start | ci: CI',
  'acceptance: the owner said the evidence is enough | owner_yes: 12',
  'allowed: push, handoff',
  'budget: 120 minutes, 30 tool calls',
  'done: the reviewer passed the tip and the owner said yes',
]

/** A brief whose block says `block` and nothing else, with prose around it as a real brief has. */
const theBriefWithBlock = (block: readonly string[]): string =>
  ['# Brief 2026-11-17 — a member', '', 'Some prose a brief also carries.', '', '```package-contract', ...block, '```', '', 'More prose after the block.'].join('\n')

/**
 * A brief whose block is A_BLOCK with a part changed in its own place, taken out when the change is null, and `extra`
 * lines added after it. A part is named by its key, so a test says what it means rather than editing a string.
 */
const aBrief = (changed: Readonly<Record<string, string | null>> = {}, extra: readonly string[] = []): string => {
  const block: string[] = []
  for (const line of A_BLOCK) {
    const key = line.slice(0, line.indexOf(':'))
    if (!(key in changed)) {
      block.push(line)
      continue
    }
    const replaced = changed[key]
    if (block.some((kept) => kept.startsWith(`${key}:`)) || replaced === null) continue
    block.push(replaced ?? line)
  }
  return theBriefWithBlock([...block, ...extra])
}

/** The block of a package the owner says needs no contract. */
const anUnboundedBlock = (ask = 4): readonly string[] => ['unbounded: the owner asked for a spike', `owner_yes: ${String(ask)}`]

/**
 * An ask this crew's owner answered yes to, as its own stream holds it: the ask queued with the question it was asked
 * in, then the settle that ticks it. Answers the ask's id, which is the position its row was appended at.
 */
async function anAskSaidYesTo(host: { readonly host: LedgerHost }, question = `does ${PACKAGE} need a contract, or is it unbounded?`): Promise<number> {
  const ask = await host.host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASK_QUEUED, question, asked_by: SUPERVISOR, since: 0 })
  await host.host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASKS_SETTLED, batch: 0, yes: [ask] })
  return ask
}

/** The contract a brief carries, failing the test when it carries none. */
const theContractOf = (brief: string): ABoundedContract => {
  const read = theContractIn(brief)
  assert.ok(!('refused' in read), 'refused' in read ? read.refused : '')
  assert.equal(read.ok.contract.kind, 'bounded')
  return read.ok.contract as ABoundedContract
}

/** What reading a brief refused, failing the test when it was read. */
const refusalOf = (brief: string): string => {
  const read = theContractIn(brief)
  assert.ok('refused' in read, 'the brief was read as a contract')
  return read.refused
}

// --- the block, read and refused -------------------------------------------------

test('a brief\'s block is read whole: its goal, each criterion with its evidence, the actions, the budget and done', () => {
  const contract = theContractOf(aBrief())
  assert.equal(contract.goal, 'a package is handed the contract it is held to')
  assert.deepEqual(contract.acceptance, [
    { criterion: 'a brief with no contract is refused', evidence: { kind: 'test', of: 'src/keep_the_package_contract/keep_the_package_contract.node-test.ts' } },
    { criterion: 'the contract is handed at every start', evidence: { kind: 'ci', of: 'CI' } },
    { criterion: 'the owner said the evidence is enough', evidence: { kind: 'owner_yes', of: '12' } },
  ])
  assert.deepEqual(contract.allowed, ['push', 'handoff'])
  assert.deepEqual(contract.budget, { minutes: 120, 'tool calls': 30 })
  assert.equal(contract.done, 'the reviewer passed the tip and the owner said yes')
})

test('a brief with no block is refused by name, saying which fence it looked for', () => {
  assert.match(refusalOf('# Brief\n\nno block here\n'), /carries no package contract/)
  assert.match(refusalOf('# Brief\n\nno block here\n'), /package-contract/)
})

test('a block never closed is refused rather than read to the end of the brief', () => {
  assert.match(refusalOf('```package-contract\ngoal: a thing\n'), /never closed/)
})

test('a contract missing a part is refused naming every part it left out, not the first one it met', () => {
  const brief = aBrief({ done: null, budget: null })
  assert.match(refusalOf(brief), /leaves out budget, done/)
})

test('a line this tree does not know is refused by name, so a contract cannot carry a word nothing reads', () => {
  assert.match(refusalOf(aBrief({}, ['files: src/some_slice'])), /"files" is not a line of a package contract/)
})

test('a part given twice is refused: one goal, one done, one allowed, one budget', () => {
  assert.match(refusalOf(aBrief({}, ['goal: another goal'])), /goal is given twice/)
  // An acceptance line is the one part that repeats, and three of them were read above.
  assert.equal(theContractOf(aBrief({}, ['acceptance: one more | document: docs/agent-control-loop.md'])).acceptance.length, 4)
})

test('an evidence kind the tree does not read is refused, and so is a criterion that names no evidence', () => {
  assert.match(refusalOf(aBrief({}, ['acceptance: a thing | vibes: it felt right'])), /is not evidence this tree reads/)
  assert.match(refusalOf(aBrief({}, ['acceptance: a thing | test:'])), /names no test to evidence it/)
  assert.match(refusalOf(aBrief({}, ['acceptance: no evidence at all'])), /is not an acceptance line/)
  const detail = { test: 'src/a.ts', document: 'docs/a.md', ci: 'CI', owner_yes: '7' }
  for (const kind of EVIDENCE_KINDS) assert.ok(!('refused' in theContractIn(aBrief({}, [`acceptance: a ${kind} criterion | ${kind}: ${detail[kind]}`]))), kind)
  assert.match(refusalOf(aBrief({}, ['acceptance: an ask criterion | owner_yes: the owner'])), /is evidenced by an ask/)
})

test('an action outside Martha\'s own verbs is refused by name, and every verb in the list is accepted', () => {
  assert.match(refusalOf(aBrief({ allowed: 'allowed: push, deploy' })), /"deploy" is not an action this tree has/)
  assert.match(refusalOf(aBrief({ allowed: 'allowed: ,' })), /names no action/)
  for (const action of CONTRACT_ACTIONS) assert.ok(!('refused' in theContractIn(aBrief({ allowed: `allowed: ${action}` }))), action)
})

test('a budget in a unit the tree does not count is refused, and so is one that spends nothing', () => {
  assert.match(refusalOf(aBrief({ budget: 'budget: 3 hours' })), /"hours" is not a unit this tree counts/)
  assert.match(refusalOf(aBrief({ budget: 'budget: 0 minutes' })), /spends nothing/)
  assert.match(refusalOf(aBrief({ budget: 'budget: plenty' })), /is not what a package may spend/)
})

test('an unbounded contract is the owner\'s word: their reason and the ask they said it in, and nothing else', () => {
  const read = theContractIn(theBriefWithBlock(anUnboundedBlock()))
  assert.ok(!('refused' in read), 'refused' in read ? read.refused : '')
  assert.deepEqual(read.ok.contract, { kind: 'unbounded', reason: 'the owner asked for a spike', owner_yes: 4 })
  assert.match(refusalOf(theBriefWithBlock(['unbounded: the owner asked for a spike'])), /names the ask they said yes to as owner_yes/)
  assert.match(refusalOf(theBriefWithBlock([...anUnboundedBlock(), 'goal: a thing'])), /bounded or unbounded, never both/)
})

test('the digest follows the contract\'s words and not its spacing, so trailing space or an indent is no new version', () => {
  const one = ['goal: a thing', 'allowed: push']
  assert.equal(theDigestOf(one), theDigestOf(['goal: a thing  ', 'allowed: push\t']))
  // A brief that indents its block to sit under a list item says the same contract, so it is the same version.
  assert.equal(theDigestOf(one), theDigestOf(['  goal: a thing', '  allowed: push']))
  assert.notEqual(theDigestOf(one), theDigestOf(['goal: another thing', 'allowed: push']))
})

// --- a version kept in the ledger ------------------------------------------------

/** A host a contract is kept on, and the ledger it writes to. */
const aHostKeeping = () => hostForTests()

test('the first contract a Supervisor keeps is version 1, and the same brief again keeps nothing', async () => {
  const host = aHostKeeping()
  const first = await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: aBrief() })
  assert.ok('answer' in first, 'refused' in first ? first.refused : '')
  assert.match(first.answer, /version 1/)
  const again = await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: aBrief() })
  assert.ok('answer' in again, 'refused' in again ? again.refused : '')
  assert.match(again.answer, /already holds this contract as version 1; nothing was kept/)
  assert.equal((await theContractVersionsOf(host.host, PACKAGE)).length, 1)
})

test('a brief that indents its block says the same contract, so keeping it again records no new version', async () => {
  const host = aHostKeeping()
  await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: aBrief() })
  const indented = theBriefWithBlock(A_BLOCK.map((line) => `  ${line}`))
  const again = await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: indented })
  assert.ok('answer' in again, 'refused' in again ? again.refused : '')
  assert.match(again.answer, /already holds this contract as version 1; nothing was kept/)
  assert.equal((await theContractVersionsOf(host.host, PACKAGE)).length, 1)
})

test('a changed contract is the next version, and the version before it still stands: the store only appends', async () => {
  const host = aHostKeeping()
  await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: aBrief() })
  const changed = await keepThePackageContract(host.host, {
    package: PACKAGE,
    member: SUPERVISOR,
    brief: aBrief({ allowed: 'allowed: push' }),
  })
  assert.ok('answer' in changed, 'refused' in changed ? changed.refused : '')
  const versions = await theContractVersionsOf(host.host, PACKAGE)
  assert.deepEqual(versions.map((one) => one.version), [1, 2])
  assert.deepEqual((versions[0]?.contract as ABoundedContract).allowed, ['push', 'handoff'])
  assert.deepEqual((versions[1]?.contract as ABoundedContract).allowed, ['push'])
  assert.equal((await readLedger(host.host, PACKAGE)).length, 2, 'a version is one row of the package\'s own stream')
})

test('a package name that is not one is refused, and so is a brief this slice cannot read', async () => {
  const host = aHostKeeping()
  assert.match(refusalBy(await keepThePackageContract(host.host, { package: 'not-a-package', member: SUPERVISOR, brief: aBrief() })), /is not a work package/)
  assert.match(
    refusalBy(await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: 'no block' })),
    /carries no package contract/,
  )
})

test('a package is marked unbounded only on the owner\'s yes to the ask it names', async () => {
  const host = aHostKeeping()
  // An ask was put about this package and the owner has not answered it: nothing is kept.
  const unanswered = await host.host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASK_QUEUED, question: `is ${PACKAGE} unbounded?`, asked_by: SUPERVISOR, since: 0 })
  const brief = theBriefWithBlock(anUnboundedBlock(unanswered))
  assert.match(refusalBy(await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief })), new RegExp(`the owner has not said yes to ask ${String(unanswered)}`))

  // Then the owner says yes to that ask, and the same brief is kept as the unbounded contract it says.
  await host.host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASKS_SETTLED, batch: 0, yes: [unanswered] })
  const kept = await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief })
  assert.ok('answer' in kept, 'refused' in kept ? kept.refused : '')
  const newest = await theNewestContractOf(host.host, PACKAGE)
  assert.deepEqual(newest?.contract, { kind: 'unbounded', reason: 'the owner asked for a spike', owner_yes: unanswered })
})

test('a yes to an ask about something else does not mark this package unbounded', async () => {
  const host = aHostKeeping()
  const ask = await anAskSaidYesTo(host, 'may I delete the stale branch a member left on origin?')
  const refused = await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: theBriefWithBlock(anUnboundedBlock(ask)) })
  assert.match(refusalBy(refused), /which asked "may I delete the stale branch a member left on origin\?"/)
  assert.match(refusalBy(refused), new RegExp(`their word about ${PACKAGE.replace('#', '\\#')} is what marks it unbounded`))
  assert.equal((await theContractVersionsOf(host.host, PACKAGE)).length, 0)
})

/** What a call refused, failing the test when it kept something. */
const refusalBy = (answered: { readonly answer: string } | { readonly refused: string }): string => {
  assert.ok('refused' in answered, 'the call was kept')
  return answered.refused
}

test('a yes about another package marks nothing, whether it says "unbounded" or names a package whose name runs on', async () => {
  const host = aHostKeeping()
  // A question saying "unbounded" about a package that is not this one says nothing about this one.
  const another_package = await anAskSaidYesTo(host, 'is synthetic-owner/other#9 unbounded?')
  assert.match(
    refusalBy(await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: theBriefWithBlock(anUnboundedBlock(another_package)) })),
    /did not ask about it/,
  )
  // And a name that merely opens with this package's is another package: the package numbered 70 is not the one
  // numbered 7 (martha#513 r=3).
  const longer_name = await anAskSaidYesTo(host, 'may synthetic-owner/repo#70 skip its contract?')
  assert.match(
    refusalBy(await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: theBriefWithBlock(anUnboundedBlock(longer_name)) })),
    /did not ask about it/,
  )
  assert.equal((await theContractVersionsOf(host.host, PACKAGE)).length, 0)
})

// --- the contract a session is handed --------------------------------------------

test('a package with no contract says so, and names the tool that records one', () => {
  const said = theContractPart(PACKAGE, undefined)
  assert.match(said, /has no package contract recorded/)
  assert.match(said, new RegExp(KEEP_THE_PACKAGE_CONTRACT))
})

test('the part handed names the version, the goal, every criterion with its evidence, the actions, the budget and done', async () => {
  const host = aHostKeeping()
  await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: aBrief() })
  const said = theContractPart(PACKAGE, await theNewestContractOf(host.host, PACKAGE))
  assert.match(said, /version 1, kept by supervisor/)
  assert.match(said, /goal: a package is handed the contract it is held to/)
  assert.match(said, /1\. a brief with no contract is refused — evidenced by the test file src\//)
  assert.match(said, /2\. the contract is handed at every start — evidenced by the CI job or run "CI" green on the tip/)
  assert.match(said, /3\. the owner said the evidence is enough — evidenced by the owner's yes to ask 12/)
  assert.match(said, /allowed: push, handoff/)
  assert.match(said, /budget: 120 minutes, 30 tool calls/)
  assert.match(said, /done: the reviewer passed the tip and the owner said yes/)
})

test('an unbounded package is handed the owner\'s reason and the ask they gave it in', async () => {
  const host = aHostKeeping()
  const ask = await anAskSaidYesTo(host)
  await keepThePackageContract(host.host, {
    package: PACKAGE,
    member: SUPERVISOR,
    brief: theBriefWithBlock(anUnboundedBlock(ask)),
  })
  assert.match(theContractPart(PACKAGE, await theNewestContractOf(host.host, PACKAGE)), new RegExp(`unbounded by the owner's word: the owner asked for a spike \\(ask ${String(ask)}\\)`))
})

test('a start hands the contract the package holds, and the resume prompt hands the same one', async () => {
  const host = aHostKeeping()
  await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: aBrief() })
  const started = await theLineToHandAtStart({
    ledger: host.host,
    member: 'member-one',
    settings: { refused: 'no declaration in this test' },
    held: { ...theRowWithNothingSaid(), member: 'member-one', session: 'a-session', at: 0, holds: PACKAGE },
    now: 0,
  })
  assert.ok(started !== null, 'nothing was handed to the member holding the package')
  assert.match(started.line, /goal: a package is handed the contract it is held to/)
  assert.deepEqual(started.taken_in, ['package_contract'])
  const resumed = theResumePrompt({ member: 'member-one', file: '/somewhere/MARTHA_HANDOVER_2026-11-17_member-one.md', acts: [], contract: started.line })
  assert.ok(resumed.includes(started.line), 'the resume prompt did not carry the contract the start handed')
})

test('a member holding no package is handed nothing of a contract', async () => {
  const host = aHostKeeping()
  await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: aBrief() })
  const started = await theLineToHandAtStart({
    ledger: host.host,
    member: 'member-one',
    settings: { refused: 'no declaration in this test' },
    held: { ...theRowWithNothingSaid(), member: 'member-one', session: 'a-session', at: 0, holds: '' },
    now: 0,
  })
  assert.equal(started, null)
})

// --- the criteria at a revision ---------------------------------------------------

/** What every criterion has at a revision where everything the contract names is there. */
const theEvidence = { revision: 'abcdef1234', ciSucceeded: (what: string) => what === 'CI', fileIsThere: async () => true, ownerSaidYes: async (ask: number) => ask === 12 }

/** A host holding the contract the criteria are read from. */
async function aHostHoldingTheContract() {
  const host = aHostKeeping()
  await keepThePackageContract(host.host, { package: PACKAGE, member: SUPERVISOR, brief: aBrief() })
  return host
}

test('every criterion is met at the revision where the evidence is, and the line counts them', async () => {
  const host = await aHostHoldingTheContract()
  assert.deepEqual((await theCriteriaChecked(theContractOf(aBrief()), theEvidence)).filter((one) => !one.met), [])
  assert.equal(await theAcceptanceOf(host.host, PACKAGE, theEvidence), `acceptance of ${PACKAGE}: 3 of 3 criteria met at abcdef1`)
})

test('a criterion whose evidence is not at this revision is not met, and is named with why', async () => {
  const host = await aHostHoldingTheContract()
  const said = await theAcceptanceOf(host.host, PACKAGE, { ...theEvidence, fileIsThere: async () => false })
  assert.match(said, /2 of 3 criteria met at abcdef1/)
  assert.match(said, /not met: "a brief with no contract is refused" \(src\/keep_the_package_contract\/keep_the_package_contract\.node-test\.ts is not at abcdef1234\)/)
})

test('a CI job that did not succeed there, and an ask the owner never answered, are both named as not met', async () => {
  const host = await aHostHoldingTheContract()
  const said = await theAcceptanceOf(host.host, PACKAGE, { ...theEvidence, ciSucceeded: () => false, ownerSaidYes: async () => false })
  assert.match(said, /1 of 3 criteria met/)
  assert.match(said, /no CI job or run named "CI" was green on abcdef1234/)
  assert.match(said, /the owner has not said yes to ask 12/)
})

test('a package with no contract is said so, never counted as met, and an unbounded one says why it is not checked', async () => {
  const host = aHostKeeping()
  assert.equal(await theAcceptanceOf(host.host, PACKAGE, theEvidence), `acceptance of ${PACKAGE}: no package contract recorded`)
  const ask = await anAskSaidYesTo(host)
  await keepThePackageContract(host.host, {
    package: PACKAGE,
    member: SUPERVISOR,
    brief: theBriefWithBlock(anUnboundedBlock(ask)),
  })
  assert.equal(await theAcceptanceOf(host.host, PACKAGE, theEvidence), `acceptance of ${PACKAGE}: unbounded by the owner's word (ask ${String(ask)})`)
})

// --- the tool ---------------------------------------------------------------------

test('a member the table does not let assign work may not record a contract, and nothing is written', async () => {
  const host = aHostKeeping()
  const refused = await keepTheContract(
    { ledger: host.host, documents: { read: async () => aBrief() }, settings: A_TEAM, member: 'member-one' },
    { package: PACKAGE, brief: '/somewhere/BRIEF.md' },
  )
  assert.match(refusalBy(refused), /may not record a package's contract/)
  assert.equal((await theContractVersionsOf(host.host, PACKAGE)).length, 0)
})

test('the Supervisor records the contract of the brief it names, read through the host\'s own reader', async () => {
  const host = aHostKeeping()
  const kept = await keepTheContract(
    { ledger: host.host, documents: { read: async (path) => { assert.equal(path, '/somewhere/BRIEF.md'); return aBrief() } }, settings: A_TEAM, member: SUPERVISOR },
    { package: PACKAGE, brief: '/somewhere/BRIEF.md' },
  )
  assert.ok('answer' in kept, 'refused' in kept ? kept.refused : '')
  assert.equal((await theNewestContractOf(host.host, PACKAGE))?.contract.kind, 'bounded')
})

test('a call that names no brief, or a brief the host cannot read, keeps nothing and says which', async () => {
  const host = aHostKeeping()
  const nothingNamed = await keepTheContract(
    { ledger: host.host, documents: { read: async () => aBrief() }, settings: A_TEAM, member: SUPERVISOR },
    { package: PACKAGE },
  )
  assert.match(refusalBy(nothingNamed), /named none: give the path of the brief file/)
  const unreadable = await keepTheContract(
    { ledger: host.host, documents: { read: async () => { throw new Error('ENOENT: no such document') } }, settings: A_TEAM, member: SUPERVISOR },
    { package: PACKAGE, brief: '/nowhere/BRIEF.md' },
  )
  assert.match(refusalBy(unreadable), /could not be read/)
})

test('every member of a solo crew keeps a contract, because its table lets the owner alone assign work', async () => {
  const host = aHostKeeping()
  const solo = soloDeclaration('an owner')
  const member = SOLO_MEMBERS[0].name
  const kept = await keepTheContract(
    { ledger: host.host, documents: { read: async () => aBrief() }, settings: solo, member },
    { package: PACKAGE, brief: '/somewhere/BRIEF.md' },
  )
  assert.ok('answer' in kept, 'refused' in kept ? kept.refused : '')
})
