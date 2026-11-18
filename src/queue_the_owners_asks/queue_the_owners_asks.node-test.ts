// The owner's ask queue (martha#313, the queue half): what a member may queue, who may take and settle it, the claim
// window, and the one thing a settle stands on — a menu the host closed.
//
// Each test names the mutant of the design that it kills.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { OFFER_OWNER_ASKS, OWNER } from '../declare_crew/declare_crew.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { MENU_TOOL } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'
import {
  ASK_CLAIM_MS,
  ASK_QUEUED,
  ASKS_TAKEN,
  MAX_ASK,
  OWNER_ASKS_STREAM,
  PICK_JOINER,
  admitsAnAskToTheOwner,
  listTheAsks,
  mayOfferTheOwnersAsks,
  menusTheLauncherKeeps,
  queueAnAsk,
  settleTheAsks,
  takeTheAsks,
  theOptionOf,
  thePicksIn,
  theQueueIn,
  type AnAsk,
  type APostedOption,
  type AskAnswer,
  type TheDeclaration,
  type TheOwnersMenus,
} from './queue_the_owners_asks.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-owner-asks-'))
after(() => removeTheTree(homeOfAll))

const START = 5_000_000
const LEAD = 'Lead'
const BUILDER = 'Builder1'

/** The declaration a team crew is answered from: two roles, and the table that names who may offer the asks. */
const team = (granted: readonly string[]): TheDeclaration => ({
  members: [
    { name: LEAD, role: SUPERVISOR },
    { name: BUILDER, role: 'builder' },
  ],
  mode: { may: { [OFFER_OWNER_ASKS]: granted } },
})

const SUPERVISED = team([SUPERVISOR])

/** A host over a row store of its own, in a directory no other test shares, with a clock the test moves. */
let storesSoFar = 0
interface AHost {
  readonly host: LedgerHost
  at: number
  readonly menus: TheOwnersMenus
}
function aHost(): AHost {
  storesSoFar += 1
  const rows = join(homeOfAll, `rows-${storesSoFar}`)
  mkdirSync(rows, { mode: STREAM_DIRECTORY_MODE })
  const held = { at: START }
  return {
    host: { clock: { now: () => held.at }, stores: { rows: rowStreamsDirectory(rows) } },
    get at() {
      return held.at
    },
    set at(now: number) {
      held.at = now
    },
    menus: menusTheLauncherKeeps({ now: () => held.at }),
  }
}

const TOLD = (said: AskAnswer): string => ('told' in said ? said.told : assert.fail(`refused: ${said.refused}`))
const REFUSED = (said: AskAnswer): string => ('refused' in said ? said.refused : assert.fail(`told: ${said.told}`))

/** The asks waiting in `host`, read the way the queue reads them. */
async function waitingIn(host: AHost): Promise<readonly AnAsk[]> {
  return theQueueIn(await host.host.stores.rows.read(OWNER_ASKS_STREAM), host.at).waiting
}

const taking = (host: AHost, member: string, session: string, declaration: TheDeclaration = SUPERVISED) =>
  takeTheAsks(host.host, { member, session, declaration })
const settling = (host: AHost, member: string, batch: number, yes: readonly number[], declaration: TheDeclaration = SUPERVISED) =>
  settleTheAsks(host.host, { member, declaration, menus: host.menus }, { batch, yes })

/** The one question the tests' menus ask: the asks are its options. */
const QUESTION = 'Which of these may go ahead?'

/** The host's answer to a menu, in the shape the recording shows (./recorded_menu_answers.json). */
const theHostsAnswer = (questions: unknown, answers: Readonly<Record<string, string>>) => ({ ref: 1, result: { questions, answers, annotations: {} }, text: '', isReadOnly: true })

/** The owner answers one question offering `options` in `session`, ticking the `picked` labels in that order. */
function theOwnerPicks(host: AHost, session: string, options: readonly APostedOption[], picked: readonly string[]): void {
  const questions = [{ question: QUESTION, header: 'Asks', multiSelect: true, options }]
  host.menus.noteTheCallsAnswer({ tool: MENU_TOOL, input: { questions }, answer: theHostsAnswer(questions, { [QUESTION]: picked.join(PICK_JOINER) }) }, session)
}

/** The owner is offered `asks` as the take tells the member to post them, and ticks those with the ids `ticked`. */
function theOwnerTicks(host: AHost, session: string, asks: readonly AnAsk[], ticked: readonly number[]): void {
  const options = asks.map(theOptionOf)
  theOwnerPicks(host, session, options, ticked.map((id) => options[asks.findIndex((ask) => ask.id === id)]?.label ?? `no ask ${String(id)}`))
}

// --- what a member queues, and what the queue keeps -------------------------------

test('an ask is stamped with the launcher\'s member, and a text that would repaint a row is stripped and capped', async () => {
  const host = aHost()
  const told = TOLD(await queueAnAsk(host.host, { ask: 'Delete the merged \u0007branch \u001bvesta/313-old?', asked_by: 'a name in the text' }, BUILDER))
  assert.equal(told, 'Queued for the owner; 1 ask waiting. Do not open a menu for it; carry on.', 'the member is told to carry on, never to open a menu')
  const [ask] = await waitingIn(host)
  assert.equal(ask?.asked_by, BUILDER, 'the asker is the member the launcher started, never the name the call carried')
  assert.equal(ask?.question, 'Delete the merged branch vesta/313-old?', 'the control characters are gone')

  TOLD(await queueAnAsk(host.host, { ask: 'a'.repeat(MAX_ASK * 2) }, BUILDER))
  assert.equal((await waitingIn(host))[1]?.question.length, MAX_ASK, 'a long ask is capped, never kept whole')
})

test('an ask with no text is refused, so nothing empty reaches a menu', async () => {
  const host = aHost()
  assert.match(REFUSED(await queueAnAsk(host.host, { ask: '   ' }, BUILDER)), /ask is empty/)
  assert.deepEqual(await waitingIn(host), [])
})

test('see_the_owners_asks shows what waits and takes nothing', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  const told = TOLD(await listTheAsks(host.host))
  assert.match(told, /^1 waiting, oldest first:\n- 0 \(from Builder1\): Remove the stale worktree\?$/)
  assert.equal((await waitingIn(host)).length, 1, 'listing the queue leaves it as it was')
})

// --- an ask that removes a branch (martha#391) -------------------------------------

/** The branch of the owner's second ask: the clone a commit ahead of origin, and the two tips the yes has to cover. */
const THE_TWO_TIPS = { branch: 'vesta/313-old', local_tip: '72081ee', origin_tip: 'e8c127a' } as const
const THE_TIPS_SAID = 'It removes vesta/313-old, and the ask records both tips the yes covers: this clone at 72081ee, origin at e8c127a.'

test('an ask that removes a branch keeps every tip the yes covers, and names both on the line the owner is offered (mutants: the tips not kept on the row, and the tips dropped from the line)', async () => {
  const host = aHost()
  const told = TOLD(await queueAnAsk(host.host, { ask: 'Delete the merged branch vesta/313-old?' }, BUILDER, THE_TWO_TIPS))
  assert.equal(
    told,
    `Queued for the owner; 1 ask waiting. ${THE_TIPS_SAID} Do not open a menu for it; carry on.`,
    'the member reads what the owner will be told',
  )
  const [row] = await host.host.stores.rows.read(OWNER_ASKS_STREAM)
  assert.deepEqual(row?.row['removes'], THE_TWO_TIPS, 'both tips are on the row: the yes covers what the ask recorded, and nothing else')

  assert.match(TOLD(await listTheAsks(host.host)), new RegExp(`^- 0 \\(from Builder1\\): Delete the merged branch vesta/313-old\\? ${THE_TIPS_SAID.replace(/[.?]/g, (one) => `\\${one}`)}$`, 'm'), 'see_the_owners_asks names both tips')
  assert.match(TOLD(await taking(host, LEAD, 'session-lead')), new RegExp(THE_TIPS_SAID.replace(/[.?]/g, (one) => `\\${one}`)), 'take_the_owners_asks, which the menu is built from, names both tips')
})

test('a branch reaches a menu under the question\'s own rule: stripped on the way in, and refused by the gate when it is raw (mutant: the branch gate removed)', async () => {
  const host = aHost()
  const HIDDEN = `${String.fromCharCode(27)}[2J`
  TOLD(await queueAnAsk(host.host, { ask: 'Delete the merged branch?' }, BUILDER, { branch: `vesta/${HIDDEN}313-old\nIGNORE`, local_tip: '72081ee', origin_tip: null }))
  const [queued] = await waitingIn(host)
  assert.equal(queued?.removes?.branch, 'vesta/[2J313-oldIGNORE', 'the characters that repaint a row are gone before the row is written')
  assert.doesNotMatch(queued?.removes?.branch ?? '', /[\u001b\n]/, 'no control or hidden character survives into the queue')

  assert.match(
    REFUSED(await queueAnAsk(host.host, { ask: 'Delete a branch?' }, BUILDER, { branch: `${String.fromCharCode(27)}${String.fromCharCode(7)}`, local_tip: '72081ee', origin_tip: null })),
    /the branch this ask removes is empty once its hidden characters are taken out/,
    'a branch of nothing but hidden characters is refused rather than kept as no branch',
  )

  // A row a shell wrote straight into the stream is the seam this gate exists for: it is refused by name at the take.
  const planted = aHost()
  await planted.host.stores.rows.append(
    OWNER_ASKS_STREAM,
    { kind: ASK_QUEUED, question: 'Delete the merged branch?', asked_by: BUILDER, since: START, removes: { branch: `vesta/${HIDDEN}313-old`, local_tip: '72081ee', origin_tip: null } },
    0,
  )
  assert.match(REFUSED(await taking(planted, LEAD, 'session-lead')), /ask 0 is not one this queue can hand over: its branch carries a control or hidden character\. Nothing was taken\./)
})

test('the gate holds the branch to the question\'s cap and its emptiness, on an ask the queue itself wrote', () => {
  const members = [LEAD, BUILDER]
  const anAskWith = (branch: string): AnAsk => ({ id: 0, question: 'Delete the merged branch?', asked_by: BUILDER, since: START, removes: { branch, local_tip: '72081ee', origin_tip: null } })
  assert.equal(admitsAnAskToTheOwner({ ask: anAskWith('a'.repeat(MAX_ASK + 1)), members }), false, 'a branch past the cap is never offered')
  assert.equal(admitsAnAskToTheOwner({ ask: anAskWith(''), members }), false, 'a branch of nothing is never offered')
  assert.equal(admitsAnAskToTheOwner({ ask: anAskWith('vesta/313-old'), members }), true, 'the ordinary branch is offered')
})

test('a row whose removal is not one this queue wrote is no ask of the queue, so no menu ever reads a tip the launcher did not read', async () => {
  const host = aHost()
  const shapes: readonly unknown[] = [
    { branch: 'vesta/313-old', local_tip: 'not-a-commit', origin_tip: null },
    { branch: 'vesta/313-old', origin_tip: null },
    { branch: 7, local_tip: null, origin_tip: 'e8c127a' },
    { branch: 'vesta/313-old', local_tip: null, origin_tip: null },
    { branch: 'vesta/313-old', local_tip: '72081ee', origin_tip: 7 },
  ]
  let written = 0
  for (const removes of shapes) {
    await host.host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASK_QUEUED, question: 'Delete the merged branch?', asked_by: BUILDER, since: START, removes }, written)
    written += 1
  }
  assert.deepEqual(await waitingIn(host), [], 'none of them is an ask: each names a tip, or a branch, this launcher never read')
  assert.equal(TOLD(await listTheAsks(host.host)), 'No asks are waiting for the owner.')

  TOLD(await queueAnAsk(host.host, { ask: 'Delete the merged branch vesta/313-new?' }, BUILDER, { branch: 'vesta/313-new', local_tip: null, origin_tip: 'e8c127a' }))
  assert.deepEqual((await waitingIn(host)).map((ask) => ask.removes?.branch), ['vesta/313-new'], 'a removal the launcher read is an ask, with the one copy origin holds')
})

// --- who may take and settle ------------------------------------------------------

test('a member whose role the table does not name is refused, and nothing is claimed (mutant: the role check removed)', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  assert.match(REFUSED(await taking(host, BUILDER, 'session-builder')), /Builder1 may not take or settle the owner's asks: this crew's table grants offer_owner_asks to supervisor/)
  assert.match(REFUSED(await settling(host, BUILDER, 1, [0])), /Builder1 may not take or settle the owner's asks/)
  assert.equal((await waitingIn(host)).length, 1, 'a refused take claims nothing')
})

test('a table that grants the act to the owner alone lets a member take, as a solo crew is written (martha#316)', () => {
  assert.equal(mayOfferTheOwnersAsks(team([OWNER]), BUILDER), true)
  assert.equal(mayOfferTheOwnersAsks(team([]), BUILDER), false, 'a table that names nobody lets nobody')
  assert.equal(mayOfferTheOwnersAsks(team(['reviewer']), BUILDER), false, 'a table naming a role no member holds lets no other role')
})

test('a table that does not name the act at all lets the members offer the asks, as a crew file written before the act still declares (mutant: the missing-act rule read as nobody)', () => {
  const unnamed: TheDeclaration = { members: team([OWNER]).members, mode: { may: {} } }
  assert.equal(mayOfferTheOwnersAsks(unnamed, BUILDER), true, 'an act the table does not name reaches the owner, whose own sessions the members act as')
  assert.equal(mayOfferTheOwnersAsks(team([]), BUILDER), false, 'an act that is there and names nobody still lets nobody')
})

// --- take, take again, and the window ---------------------------------------------

test('a batch taken twice offers nothing the second time, and the asks wait again once the window has passed', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  const first = TOLD(await taking(host, LEAD, 'session-lead'))
  assert.match(first, /^1 queued ask, oldest first\..*Then settle batch 1 with the ids the owner ticked: .*\n- 0 \(from Builder1\): Remove the stale worktree\?\n  label: "0\. Remove the stale worktree\?"\n  description: "- 0 \(from Builder1\): Remove the stale worktree\?"$/)
  assert.deepEqual(await waitingIn(host), [], 'an ask in a live batch is not waiting')

  assert.match(REFUSED(await taking(host, LEAD, 'session-lead')), /batch 1 was taken 0 minute\(s\) ago and is not settled/)

  host.at = START + ASK_CLAIM_MS + 1
  assert.equal((await waitingIn(host)).length, 1, 'the window has passed, so the ask waits again')
  assert.match(TOLD(await taking(host, LEAD, 'session-lead')), /Then settle batch 2 with the ids the owner ticked/)
})

test('a settle after the window still removes the asks the owner ticked, and puts the rest back', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  TOLD(await queueAnAsk(host.host, { ask: 'Delete the merged branch?' }, LEAD))
  const asks = await waitingIn(host)
  const taken = TOLD(await taking(host, LEAD, 'session-lead'))
  const batch = Number(/settle batch (\d+)/.exec(taken)?.[1])

  host.at = START + 1
  theOwnerTicks(host, 'session-lead', asks, [0])
  host.at = START + ASK_CLAIM_MS + 1
  assert.equal(TOLD(await settling(host, LEAD, batch, [0])), `Batch ${String(batch)} settled: 1 the owner ticked, 1 back in the queue.`)
  const waiting = await waitingIn(host)
  assert.deepEqual(waiting.map((ask) => ask.question), ['Delete the merged branch?'], 'the ask the owner did not tick waits again')
})

// --- settle stands on a menu the host closed --------------------------------------

test('a settle with no menu closed since the take is refused (mutant: the menu check removed)', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  const asks = await waitingIn(host)
  const batch = Number(/settle batch (\d+)/.exec(TOLD(await taking(host, LEAD, 'session-lead')))?.[1])
  assert.match(REFUSED(await settling(host, LEAD, batch, [0])), /no menu has closed in the session that took batch \d+/)

  host.menus.noteTheCallsAnswer({ tool: 'a tool that is not the menu' }, 'session-lead')
  assert.match(REFUSED(await settling(host, LEAD, batch, [0])), /no menu has closed/, 'another tool\'s answer is not a menu')

  theOwnerTicks(host, 'another-session', asks, [0])
  assert.match(REFUSED(await settling(host, LEAD, batch, [0])), /no menu has closed/, 'a menu in another session is not this one')

  host.at = START + 1
  theOwnerTicks(host, 'session-lead', asks, [0])
  assert.match(TOLD(await settling(host, LEAD, batch, [0])), /^Batch \d+ settled: 1 the owner ticked, 0 back in the queue\.$/)
})

test('a launch that keeps no record of menus settles nothing, and says so', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  const batch = Number(/settle batch (\d+)/.exec(TOLD(await taking(host, LEAD, 'session-lead')))?.[1])
  const said = await settleTheAsks(host.host, { member: LEAD, declaration: SUPERVISED, menus: undefined }, { batch, yes: [0] })
  assert.match(REFUSED(said), /this launch keeps no record of menus/)
})

test('a yes that names no ask of the batch is refused, and nothing is settled', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  const batch = Number(/settle batch (\d+)/.exec(TOLD(await taking(host, LEAD, 'session-lead')))?.[1])
  host.at = START + 1
  theOwnerTicks(host, 'session-lead', [], [])
  assert.match(REFUSED(await settling(host, LEAD, batch, [77])), /^77 is not an ask of batch \d+$/)
})

test('a batch a settle already names is not settled again, so a stale id cannot remove an ask the owner has not answered where it waits now (mutant: the already-settled check removed)', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  TOLD(await queueAnAsk(host.host, { ask: 'Delete the merged branch?' }, BUILDER))
  const asks = await waitingIn(host)
  const first = Number(/settle batch (\d+)/.exec(TOLD(await taking(host, LEAD, 'session-lead')))?.[1])

  host.at = START + 1
  theOwnerTicks(host, 'session-lead', asks, [0])
  TOLD(await settling(host, LEAD, first, [0]))
  host.at = START + 2
  const second = Number(/settle batch (\d+)/.exec(TOLD(await taking(host, LEAD, 'session-lead')))?.[1])

  host.at = START + 3
  theOwnerTicks(host, 'session-lead', asks, [1])
  assert.match(
    REFUSED(await settling(host, LEAD, first, [1])),
    new RegExp(`^batch ${String(first)} was already settled, so it stands once: take the asks again for a new batch\\. Nothing was settled\\.$`),
    'a settle stands once per batch, so a stale id writes no second one',
  )
  assert.equal(TOLD(await settling(host, LEAD, second, [1])), `Batch ${String(second)} settled: 1 the owner ticked, 0 back in the queue.`, 'the batch the ask now waits in settles as usual')
})

// --- a settle stands on what the owner picked, read from the host's own answer (martha#608) ---

/** Two asks queued and taken as one batch in the lead's session: the asks, the batch, and the stream's length after the take. */
async function twoAsksTaken(host: AHost): Promise<{ readonly asks: readonly AnAsk[]; readonly batch: number; readonly rows: number }> {
  TOLD(await queueAnAsk(host.host, { ask: 'Land the docs?' }, BUILDER))
  TOLD(await queueAnAsk(host.host, { ask: 'Publish the tag?' }, BUILDER))
  const asks = await waitingIn(host)
  const batch = Number(/settle batch (\d+)/.exec(TOLD(await taking(host, LEAD, 'session-lead')))?.[1])
  host.at = START + 1
  return { asks, batch, rows: (await host.host.stores.rows.read(OWNER_ASKS_STREAM)).length }
}

/** How many rows the queue's stream holds: a refused settle leaves it as it was. */
const rowsIn = async (host: AHost): Promise<number> => (await host.host.stores.rows.read(OWNER_ASKS_STREAM)).length

test('#608: a settle naming an ask the owner did not tick is refused, naming it, and writes nothing (mutant: the picks rule removed)', async () => {
  const host = aHost()
  const { asks, batch, rows } = await twoAsksTaken(host)
  theOwnerTicks(host, 'session-lead', asks, [0])
  assert.equal(REFUSED(await settling(host, LEAD, batch, [0, 1])), '1 is not an option the owner picked in the menu. Nothing was settled.')
  assert.equal(await rowsIn(host), rows, 'a refused settle grew the stream')
  assert.equal(TOLD(await settling(host, LEAD, batch, [0])), `Batch ${String(batch)} settled: 1 the owner ticked, 1 back in the queue.`, 'the ask the owner did tick settles')
})

test('#608: two asks ticked in an order other than the one they were posted in settle, as the host reports click order (mutant: posted order only)', async () => {
  const host = aHost()
  const { asks, batch } = await twoAsksTaken(host)
  theOwnerTicks(host, 'session-lead', asks, [1, 0])
  assert.equal(TOLD(await settling(host, LEAD, batch, [0, 1])), `Batch ${String(batch)} settled: 2 the owner ticked, 0 back in the queue.`)
})

test('#608: one option whose label stands for two asks settles neither, and the refusal names the label (mutant: the two-ask label rule removed)', async () => {
  const host = aHost()
  const { asks, batch, rows } = await twoAsksTaken(host)
  const [docs, tag] = asks.map(theOptionOf)
  const both = { label: `${docs?.label ?? ''}${PICK_JOINER}${tag?.label ?? ''}`, description: docs?.description ?? '' }
  theOwnerPicks(host, 'session-lead', [both], [both.label])
  assert.equal(REFUSED(await settling(host, LEAD, batch, [0, 1])), `the owner picked ${JSON.stringify(both.label)}, which stands for more than one ask, so it settles none. Nothing was settled.`)
  assert.equal(await rowsIn(host), rows)
})

test('#608: an empty pick refuses a yes and settles a no, with every ask back in the queue (mutant: an empty pick read as every ask)', async () => {
  const host = aHost()
  const { asks, batch, rows } = await twoAsksTaken(host)
  theOwnerTicks(host, 'session-lead', asks, [])
  assert.equal(REFUSED(await settling(host, LEAD, batch, [1])), '1 is not an option the owner picked in the menu. Nothing was settled.')
  assert.equal(await rowsIn(host), rows)
  assert.equal(TOLD(await settling(host, LEAD, batch, [])), `Batch ${String(batch)} settled: 0 the owner ticked, 2 back in the queue.`, 'the owner\'s honest no settles')
  assert.equal((await waitingIn(host)).length, 2)
})

test('#608: an answer the launcher could not keep refuses every settle, an empty yes included (mutant: not kept read as no pick)', async () => {
  const host = aHost()
  const { asks, batch, rows } = await twoAsksTaken(host)
  const questions = [{ question: QUESTION, header: 'Asks', multiSelect: true, options: asks.map(theOptionOf) }]
  host.menus.noteTheCallsAnswer({ tool: MENU_TOOL, input: { questions } }, 'session-lead')
  const not_kept = /^settle_the_owners_asks is refused: the host's answer to the last menu in the session that took batch \d+ was not kept/
  assert.match(REFUSED(await settling(host, LEAD, batch, [])), not_kept)
  assert.match(REFUSED(await settling(host, LEAD, batch, [0])), not_kept)
  assert.equal(await rowsIn(host), rows)
})

test('#608: words the owner typed instead of a tick pick nothing: a yes is refused and a no settles (Other)', async () => {
  const host = aHost()
  const { asks, batch } = await twoAsksTaken(host)
  theOwnerPicks(host, 'session-lead', asks.map(theOptionOf), ['0. Land the docs? and 1. Publish the tag?'])
  assert.equal(REFUSED(await settling(host, LEAD, batch, [0])), '0 is not an option the owner picked in the menu. Nothing was settled.')
  assert.equal(TOLD(await settling(host, LEAD, batch, [])), `Batch ${String(batch)} settled: 0 the owner ticked, 2 back in the queue.`)
})

test('#608: a ticked option whose description is not its ask\'s own line is not that ask (mutant: the description rule removed)', async () => {
  const host = aHost()
  const { asks, batch, rows } = await twoAsksTaken(host)
  const options = asks.map(theOptionOf)
  const [docs] = options
  const relabelled = { label: docs?.label ?? '', description: 'Publish the tag?' }
  theOwnerPicks(host, 'session-lead', [relabelled, ...options.slice(1)], [relabelled.label])
  assert.equal(REFUSED(await settling(host, LEAD, batch, [0])), "the option the owner picked for 0 does not carry ask 0's own line as its description, so it is not that ask. Nothing was settled.")
  assert.equal(await rowsIn(host), rows)
})

test('#608: an ask whose option would stand for two asks is skipped at the take, naming its label (mutant: the take-time rule removed)', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Land the docs, then publish?' }, BUILDER))
  TOLD(await queueAnAsk(host.host, { ask: 'Land step 2. Then stop?' }, BUILDER))
  TOLD(await queueAnAsk(host.host, { ask: 'Publish the tag?' }, BUILDER))
  const taken = TOLD(await taking(host, LEAD, 'session-lead'))
  assert.match(taken, /^- 0 \(from Builder1\): Land the docs, then publish\? — its menu option "0\. Land the docs, then publish\?" would read as more than one ask/mu)
  assert.match(taken, /^- 1 \(from Builder1\): Land step 2\. Then stop\? — its menu option "1\. Land step 2\. Then stop\?" would read as more than one ask/mu)
  assert.match(taken, /^1 queued ask, oldest first\./u, 'only the ask whose option stands for one ask is offered')
})

// --- the reader, on the recording (martha#608 step 0) ------------------------------

const RECORDED = JSON.parse(readFileSync(new URL('./recorded_menu_answers.json', import.meta.url), 'utf8')) as {
  readonly input: { readonly questions: readonly { readonly question: string; readonly options: readonly APostedOption[] }[] }
  readonly ticked: { readonly answer: { readonly result: { readonly answers: Readonly<Record<string, string>> } } }
  readonly cancelled: { readonly answer: unknown }
}

/** The recorded options with these labels, in the order named. */
const recordedOptions = (...labels: readonly string[]): APostedOption[] =>
  labels.map((label) => RECORDED.input.questions.flatMap((one) => one.options).find((option) => option.label === label) ?? assert.fail(`no recorded option ${label}`))

test('#608: on the recording, the picks are the ticked options in click order, and the typed Other answer picks nothing', () => {
  assert.equal(RECORDED.ticked.answer.result.answers['Which fruits?'], ['Plum', 'Apple'].join(PICK_JOINER), 'the joiner is not the one the host wrote')
  assert.deepEqual(thePicksIn(RECORDED.input, RECORDED.ticked.answer), recordedOptions('Green', 'Plum', 'Apple'))
})

test('#608: an answer that cannot be kept is undefined: a cancelled menu, a question with no answer, a match two ways, a text two questions share', () => {
  assert.equal(thePicksIn(RECORDED.input, RECORDED.cancelled.answer), undefined, 'a cancelled menu was kept')
  const { ['Which tree?']: _tree, ...two } = RECORDED.ticked.answer.result.answers
  assert.equal(thePicksIn(RECORDED.input, { result: { answers: two } }), undefined, 'a posted question with no answer was kept')
  const twins = { questions: [{ question: 'Q?', options: [{ label: 'A', description: 'one' }, { label: 'A', description: 'two' }] }] }
  assert.equal(thePicksIn(twins, { result: { answers: { 'Q?': 'A' } } }), undefined, 'an answer two options match was kept')
  const same = { questions: [RECORDED.input.questions[0], RECORDED.input.questions[0]] }
  assert.equal(thePicksIn(same, RECORDED.ticked.answer), undefined, 'two questions with one text were kept')
})

// --- the gate that stands on the inbound row --------------------------------------

test('the gate admits an ask the launcher wrote and refuses one whose asker or text it did not', () => {
  const members = [LEAD, BUILDER]
  const anAsk = (changed: Partial<AnAsk> = {}): AnAsk => ({ id: 0, question: 'Remove the stale worktree?', asked_by: BUILDER, since: START, ...changed })
  assert.equal(admitsAnAskToTheOwner({ ask: anAsk(), members }), true)
  assert.equal(admitsAnAskToTheOwner({ ask: anAsk({ asked_by: 'a stranger' }), members }), false, 'a name the text chose is nobody')
  assert.equal(admitsAnAskToTheOwner({ ask: anAsk({ question: `a${String.fromCharCode(7)}b` }), members }), false)
  assert.equal(admitsAnAskToTheOwner({ ask: anAsk({ question: 'a'.repeat(MAX_ASK + 1) }), members }), false)
})

test('an ask row the gate refuses is never handed over, and one that is the only ask takes nothing', async () => {
  const host = aHost()
  const written = (await host.host.stores.rows.read(OWNER_ASKS_STREAM)).length
  await host.host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASK_QUEUED, question: 'a hand-written row', asked_by: 'a stranger', since: START }, written)
  assert.match(REFUSED(await taking(host, LEAD, 'session-lead')), /ask 0 is not one this queue can hand over: its asker "a stranger" is not a member this crew's launcher started\. Nothing was taken\./)
  assert.equal((await host.host.stores.rows.read(OWNER_ASKS_STREAM)).some(({ row }) => row['kind'] === ASKS_TAKEN), false, 'nothing was taken')
})

test('an ask from a member the crew no longer declares is skipped and named, and the other members\' asks still reach the owner (mutant: the whole take refused for one refused ask)', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  const written = (await host.host.stores.rows.read(OWNER_ASKS_STREAM)).length
  await host.host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASK_QUEUED, question: 'Was this a good idea?', asked_by: 'Juno', since: START }, written)
  TOLD(await queueAnAsk(host.host, { ask: 'Delete the merged branch?' }, LEAD))

  // Juno asked while the crew declared her, and the crew has since renamed or removed her: her ask is not this queue's
  // to hand over, but it must not stop the two members who are still here from reaching the owner.
  const told = TOLD(await taking(host, LEAD, 'session-lead'))
  assert.match(told, /^2 queued asks, oldest first\./, 'the two asks the crew still declares are offered')
  assert.match(told, /^1 ask this queue will not hand over, and no menu should offer it:\n- 1 \(from Juno\): Was this a good idea\? — its asker "Juno" is not a member this crew's launcher started$/m)
  assert.deepEqual((await waitingIn(host)).map((ask) => ask.id), [1], 'the ask nobody declares stays waiting, for the owner to read or for Juno to be declared again')

  const batches = (await host.host.stores.rows.read(OWNER_ASKS_STREAM)).filter(({ row }) => row['kind'] === ASKS_TAKEN)
  assert.deepEqual(batches.map(({ row }) => row['asks']), [[0, 2]], 'the batch holds the declared members\' asks only, never the retired member\'s')
})
