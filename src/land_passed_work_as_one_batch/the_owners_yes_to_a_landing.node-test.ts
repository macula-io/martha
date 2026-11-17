// The yes a landing stands on (martha#605): who the declaration lets approve, and an owner's yes counted only for the
// landing it was asked about. The fast-forward that stands on it is driven with git in
// ./land_passed_work_as_one_batch.node-test.ts; this file holds the rule itself, over an ask queue kept in memory.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { APPROVE_LANDING, OWNER } from '../declare_crew/declare_crew.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { ASK_QUEUED, ASKS_SETTLED, MAX_ASK, OWNER_ASKS_STREAM, QUEUE_ASK } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import {
  OWNER_YES,
  aQuestionTooLong,
  branchOf,
  theLandingQuestion,
  theYesALandingStandsOn,
  type ALandingAskedAbout,
  type TheApprovingDeclaration,
  type TheYes,
} from './the_owners_yes_to_a_landing.ts'
import { theFastForwardACallNames } from './land_passed_work_as_one_batch.ts'

const MEMBER = 'Ceres'
const BUILDER = 'builder'
const SUPERVISOR = 'supervisor'
const REPO = 'synthetic-owner/widget'
const TIP = 'c'.repeat(40)
const OTHER_TIP = 'd'.repeat(40)
const FIRST = `${REPO}#1`
const SECOND = `${REPO}#2`

/** The landing these tests ask about: two packages onto the origin's main. */
const LANDING: ALandingAskedAbout = { repo: REPO, default_branch: 'origin/main', tip: TIP, packages: [FIRST, SECOND] }

/** A crew of one builder, its table granting approve_landing to `granted`, or leaving the act out when undefined. */
const aCrew = (granted: readonly string[] | undefined): TheApprovingDeclaration => ({
  members: [{ name: MEMBER, role: BUILDER }],
  mode: { may: granted === undefined ? {} : { [APPROVE_LANDING]: granted } },
})

/** An ask queued with `question`, and, when `said_yes`, the settle that ticks it. Answers the ask's id. */
async function anAsk(host: LedgerHost, question: string, said_yes = true): Promise<number> {
  const ask = await host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASK_QUEUED, question, asked_by: MEMBER, since: 0 })
  if (said_yes) await host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASKS_SETTLED, batch: 0, yes: [ask] })
  return ask
}

/** The yes a call standing on `owner_yes` gets, under `declaration`, for `landing`. */
const theYesFor = (host: LedgerHost, declaration: TheApprovingDeclaration, owner_yes: number | undefined, landing = LANDING): Promise<TheYes> =>
  theYesALandingStandsOn(host, { member: MEMBER, declaration, owner_yes, landing: async () => ({ ok: landing }) })

/** What a refused yes said, failing the test when it was given. */
const refusalOf = (yes: TheYes): string => ('refused' in yes ? yes.refused : assert.fail(`the landing stood on ${yes.stood_on}`))

test('#605: the landing question names the repository, the branch, the full tip and every package, in one order', () => {
  assert.equal(theLandingQuestion(LANDING), `Land ${FIRST}, ${SECOND} on ${REPO} main at ${TIP}?`)
  assert.equal(theLandingQuestion({ ...LANDING, packages: [SECOND, FIRST] }), theLandingQuestion(LANDING), 'the same packages in another order asked another question')
  assert.equal(branchOf('origin/main'), 'main')
  assert.equal(branchOf('trunk'), 'trunk')
})

test('#605: a landing whose question is longer than an ask keeps is said so, and one that fits is not', () => {
  assert.equal(aQuestionTooLong(LANDING), undefined)
  const many = Array.from({ length: MAX_ASK }, (_, n) => `${REPO}#${String(n)}`)
  assert.match(aQuestionTooLong({ ...LANDING, packages: many }) ?? '', new RegExp(`an ask keeps ${String(MAX_ASK)}: land fewer packages at once`))
})

test('#605: under a table granting approve_landing to the owner, a landing with no ask named is refused, naming the question to queue', async () => {
  const { host } = hostForTests()
  const said = refusalOf(await theYesFor(host, aCrew([OWNER]), undefined))
  assert.equal(
    said,
    `a landing needs the owner's yes, because the declaration grants ${APPROVE_LANDING} to the owner: queue ${JSON.stringify(theLandingQuestion(LANDING))} ` +
      `with ${QUEUE_ASK}, word for word, have it offered and settled, then name that ask's id as ${OWNER_YES}. Nothing was pushed.`,
  )
})

test('#605: a table that leaves approve_landing out makes it the owner\'s alone, so the landing needs their yes', async () => {
  const { host } = hostForTests()
  assert.match(refusalOf(await theYesFor(host, aCrew(undefined), undefined)), /a landing needs the owner's yes/)
})

test('#605: an ask the owner never answered, or one nobody queued, is no yes', async () => {
  const { host } = hostForTests()
  const waiting = await anAsk(host, theLandingQuestion(LANDING), false)
  assert.equal(refusalOf(await theYesFor(host, aCrew([OWNER]), waiting)), `the owner has not said yes to ask ${String(waiting)}, and only the owner's yes lands on this crew. Nothing was pushed.`)
  assert.match(refusalOf(await theYesFor(host, aCrew([OWNER]), waiting + 7)), new RegExp(`the owner has not said yes to ask ${String(waiting + 7)}`))
})

test('#605: a yes to another landing is no yes to this one: another tip, a package fewer or more, another repository, or a question that only names the tip', async () => {
  const { host } = hostForTests()
  const others: readonly string[] = [
    theLandingQuestion({ ...LANDING, tip: OTHER_TIP }),
    theLandingQuestion({ ...LANDING, packages: [FIRST] }),
    theLandingQuestion({ ...LANDING, packages: [FIRST, SECOND, `${REPO}#3`] }),
    theLandingQuestion({ ...LANDING, repo: 'synthetic-owner/other' }),
    `may I land ${TIP}?`,
  ]
  for (const question of others) {
    const ask = await anAsk(host, question)
    assert.equal(
      refusalOf(await theYesFor(host, aCrew([OWNER]), ask)),
      `the owner said yes to ask ${String(ask)}, which asked ${JSON.stringify(question)}; this landing asks ` +
        `${JSON.stringify(theLandingQuestion(LANDING))}, and a yes counts only for the landing it was asked about. Nothing was pushed.`,
      question,
    )
  }
})

test('#605: the owner\'s yes to this landing\'s own question is what it stands on', async () => {
  const { host } = hostForTests()
  const ask = await anAsk(host, theLandingQuestion({ ...LANDING, packages: [SECOND, FIRST] }))
  assert.deepEqual(await theYesFor(host, aCrew([OWNER]), ask), { stood_on: `the owner's yes to ask ${String(ask)}` })
})

test('#605: a table granting approve_landing to neither the owner nor the caller\'s role refuses, naming the grant', async () => {
  const { host } = hostForTests()
  const ask = await anAsk(host, theLandingQuestion(LANDING))
  assert.equal(
    refusalOf(await theYesFor(host, aCrew([SUPERVISOR]), ask)),
    `${MEMBER} may not land: the declaration grants ${APPROVE_LANDING} to ${SUPERVISOR}, and ${MEMBER}'s role is ${BUILDER}. Nothing was pushed.`,
  )
})

test('#605: a member whose role the table grants approve_landing gives the yes by landing, and no clone is read for it', async () => {
  const { host } = hostForTests()
  const yes = await theYesALandingStandsOn(host, {
    member: MEMBER,
    declaration: aCrew([BUILDER]),
    owner_yes: undefined,
    landing: async () => assert.fail('the landing was read for a yes the caller\'s role gives'),
  })
  assert.deepEqual(yes, { stood_on: `${MEMBER}'s own yes, as a ${BUILDER}: the declaration grants ${APPROVE_LANDING} to that role` })
})

test('#605: a clone that cannot say what it is of refuses the owner\'s yes, in its own words', async () => {
  const { host } = hostForTests()
  const yes = await theYesALandingStandsOn(host, { member: MEMBER, declaration: aCrew([OWNER]), owner_yes: 0, landing: async () => ({ refused: 'the clone names no origin.' }) })
  assert.equal(refusalOf(yes), 'the clone names no origin. Nothing was pushed.')
})

test('#605: a fast-forward reads owner_yes as a whole number, takes none as none, and refuses anything else', () => {
  const call = { path: '/a/clone', base: 'a', tip: TIP, packages: [FIRST] }
  assert.deepEqual(theFastForwardACallNames({ ...call, [OWNER_YES]: 4 }), { ok: { ...call, owner_yes: 4 } })
  assert.deepEqual(theFastForwardACallNames(call), { ok: call })
  for (const wrong of ['4', 4.5, -1, null]) {
    assert.deepEqual(theFastForwardACallNames({ ...call, [OWNER_YES]: wrong }), { refused: `${OWNER_YES} is the id of the ask the owner said yes to, a whole number.` }, String(wrong))
  }
})
