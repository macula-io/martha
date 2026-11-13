// The owner's ask queue (martha#313, the queue half): what a member may queue, who may take and settle it, the claim
// window, and the one thing a settle stands on — a menu the host closed.
//
// Each test names the mutant of the design that it kills.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { OFFER_OWNER_ASKS, OWNER } from '../declare_crew/declare_crew.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { MENU_TOOL } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'
import {
  ASK_CLAIM_MS,
  ASK_QUEUED,
  ASKS_TAKEN,
  MAX_ASK,
  OWNER_ASKS_STREAM,
  admitsAnAskToTheOwner,
  listTheAsks,
  mayOfferTheOwnersAsks,
  menusTheLauncherKeeps,
  queueAnAsk,
  settleTheAsks,
  takeTheAsks,
  theQueueIn,
  type AnAsk,
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

test('list_asks shows what waits and takes nothing', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  const told = TOLD(await listTheAsks(host.host))
  assert.match(told, /^1 waiting, oldest first:\n- 0 \(from Builder1\): Remove the stale worktree\?$/)
  assert.equal((await waitingIn(host)).length, 1, 'listing the queue leaves it as it was')
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
  assert.match(first, /^1 queued ask, oldest first\..*Then settle batch 1 with the ids the owner ticked\.\n- 0 \(from Builder1\): Remove the stale worktree\?$/)
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
  const taken = TOLD(await taking(host, LEAD, 'session-lead'))
  const batch = Number(/settle batch (\d+)/.exec(taken)?.[1])

  host.at = START + 1
  host.menus.noteTheCallsAnswer({ tool: MENU_TOOL }, 'session-lead')
  host.at = START + ASK_CLAIM_MS + 1
  assert.equal(TOLD(await settling(host, LEAD, batch, [0])), `Batch ${String(batch)} settled: 1 the owner ticked, 1 back in the queue.`)
  const waiting = await waitingIn(host)
  assert.deepEqual(waiting.map((ask) => ask.question), ['Delete the merged branch?'], 'the ask the owner did not tick waits again')
})

// --- settle stands on a menu the host closed --------------------------------------

test('a settle with no menu closed since the take is refused (mutant: the menu check removed)', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  const batch = Number(/settle batch (\d+)/.exec(TOLD(await taking(host, LEAD, 'session-lead')))?.[1])
  assert.match(REFUSED(await settling(host, LEAD, batch, [0])), /no menu has closed in the session that took batch \d+/)

  host.menus.noteTheCallsAnswer({ tool: 'a tool that is not the menu' }, 'session-lead')
  assert.match(REFUSED(await settling(host, LEAD, batch, [0])), /no menu has closed/, 'another tool\'s answer is not a menu')

  host.menus.noteTheCallsAnswer({ tool: MENU_TOOL }, 'another-session')
  assert.match(REFUSED(await settling(host, LEAD, batch, [0])), /no menu has closed/, 'a menu in another session is not this one')

  host.at = START + 1
  host.menus.noteTheCallsAnswer({ tool: MENU_TOOL }, 'session-lead')
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
  host.menus.noteTheCallsAnswer({ tool: MENU_TOOL }, 'session-lead')
  assert.match(REFUSED(await settling(host, LEAD, batch, [77])), /^77 is not an ask of batch \d+$/)
})

test('a batch a settle already names is not settled again, so a stale id cannot remove an ask the owner has not answered where it waits now (mutant: the already-settled check removed)', async () => {
  const host = aHost()
  TOLD(await queueAnAsk(host.host, { ask: 'Remove the stale worktree?' }, BUILDER))
  TOLD(await queueAnAsk(host.host, { ask: 'Delete the merged branch?' }, BUILDER))
  const first = Number(/settle batch (\d+)/.exec(TOLD(await taking(host, LEAD, 'session-lead')))?.[1])

  host.at = START + 1
  host.menus.noteTheCallsAnswer({ tool: MENU_TOOL }, 'session-lead')
  TOLD(await settling(host, LEAD, first, [0]))
  host.at = START + 2
  host.menus.noteTheCallsAnswer({ tool: MENU_TOOL }, 'session-lead')
  const second = Number(/settle batch (\d+)/.exec(TOLD(await taking(host, LEAD, 'session-lead')))?.[1])

  host.at = START + 3
  host.menus.noteTheCallsAnswer({ tool: MENU_TOOL }, 'session-lead')
  assert.match(
    REFUSED(await settling(host, LEAD, first, [1])),
    new RegExp(`^batch ${String(first)} was already settled, so it stands once: take the asks again for a new batch\\. Nothing was settled\\.$`),
    'a settle stands once per batch, so a stale id writes no second one',
  )
  assert.equal(TOLD(await settling(host, LEAD, second, [1])), `Batch ${String(second)} settled: 1 the owner ticked, 0 back in the queue.`, 'the batch the ask now waits in settles as usual')
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
