// One engine member's turns (martha#541 package A, design r=1 step 8): recorded before sent, a refused turn never sent
// and told, one turn at a time, and a failed send does not stop the next.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Arrival, ArrivingTurn, TheAnswerToATurn } from '../host_contract/host_contract.ts'
import { theEngineMembersTurns, theLineOfATurnNotRun, theLineOfNoAct, type WhereTheTurnsGo } from './the_engine_members_turns.ts'

const AN_ARRIVAL: Arrival = { source: 'owner_typed' }
const A_SESSION = 'a-session-a-test-names'

interface Heard {
  readonly said: string[]
  readonly told: string[]
}

/** Where the turns go, as this test hears them: every step said in order; a send for `slow` waits for `release`. */
function aPlace(answerFor: (turn: ArrivingTurn) => TheAnswerToATurn = () => ({ kept: 1 }), sendFor: (text: string) => Promise<void> = async () => undefined): { readonly where: WhereTheTurnsGo; readonly heard: Heard } {
  const heard: Heard = { said: [], told: [] }
  return {
    heard,
    where: {
      session_id: A_SESSION,
      aTurnArrived: async (session_id, turn) => {
        heard.said.push(`arrived ${session_id} ${turn.text} ${'source' in turn.arrival ? turn.arrival.source : 'none'}`)
        return answerFor(turn)
      },
      send: async (session_id, text) => {
        heard.said.push(`send ${session_id} ${text}`)
        await sendFor(text)
        heard.said.push(`ended ${text}`)
      },
      tell: (line) => void heard.told.push(line),
    },
  }
}

test('#541 package A: a turn is recorded with its source before the engine is sent its text', async () => {
  const { where, heard } = aPlace()
  assert.deepEqual(await theEngineMembersTurns('a-member', where).take({ text: 'the start prompt', arrival: AN_ARRIVAL }), { sent: 1 })
  assert.deepEqual(heard.said, [`arrived ${A_SESSION} the start prompt owner_typed`, `send ${A_SESSION} the start prompt`, 'ended the start prompt'])
  assert.deepEqual(heard.told, [])
})

test('#541 package A: a turn the entry refuses is never sent, and the owner is told why', async () => {
  const { where, heard } = aPlace(() => ({ refused: 'a reason the entry gives' }))
  const did = await theEngineMembersTurns('a-member', where).take({ text: 'a turn', arrival: AN_ARRIVAL })
  assert.deepEqual(did, { refused: 'a reason the entry gives' })
  assert.deepEqual(heard.said, [`arrived ${A_SESSION} a turn owner_typed`])
  assert.deepEqual(heard.told, [theLineOfATurnNotRun('a-member', { refused: 'a reason the entry gives' })])
  assert.match(heard.told[0] ?? '', /a-member.*never sent: a reason the entry gives/)
})

test('#541 package A: an entry that throws is a refusal: the turn is never sent', async () => {
  const { where, heard } = aPlace(() => {
    throw new Error('the entry broke')
  })
  const did = await theEngineMembersTurns('a-member', where).take({ text: 'a turn', arrival: AN_ARRIVAL })
  assert.ok('refused' in did && did.refused.includes('the entry broke'), JSON.stringify(did))
  assert.ok(!heard.said.some((line) => line.startsWith('send')), heard.said.join('\n'))
})

test('#541 package A: two turns taken at once are sent one at a time: the second is not even recorded until the first ended', async () => {
  let release = (): void => undefined
  const held = new Promise<void>((settle) => (release = settle))
  const { where, heard } = aPlace(undefined, async (text) => (text === 'first' ? held : undefined))
  const turns = theEngineMembersTurns('a-member', where)
  const first = turns.take({ text: 'first', arrival: AN_ARRIVAL })
  const second = turns.take({ text: 'second', arrival: AN_ARRIVAL })
  await new Promise((settle) => setImmediate(settle))
  assert.deepEqual(heard.said, [`arrived ${A_SESSION} first owner_typed`, `send ${A_SESSION} first`])
  release()
  assert.deepEqual(await Promise.all([first, second]), [{ sent: 1 }, { sent: 1 }])
  assert.deepEqual(heard.said, [
    `arrived ${A_SESSION} first owner_typed`,
    `send ${A_SESSION} first`,
    'ended first',
    `arrived ${A_SESSION} second owner_typed`,
    `send ${A_SESSION} second`,
    'ended second',
  ])
})

test('#541 package A: a send that fails is told, and the next turn still goes', async () => {
  const { where, heard } = aPlace(undefined, async (text) => {
    if (text === 'first') throw new Error('the engine ended')
  })
  const turns = theEngineMembersTurns('a-member', where)
  const first = turns.take({ text: 'first', arrival: AN_ARRIVAL })
  const second = turns.take({ text: 'second', arrival: AN_ARRIVAL })
  assert.deepEqual(await first, { failed: 'the engine ended' })
  assert.deepEqual(await second, { sent: 1 })
  assert.deepEqual(heard.told, [theLineOfATurnNotRun('a-member', { failed: 'the engine ended' })])
})

test('#999 package 5: the turn the launch sends after a turn goes ahead of every turn taken meanwhile, recorded first, and on the session the place names at its send (mutant: the follow-up taken at the back of the queue)', async () => {
  let release: () => void = () => undefined
  const held = new Promise<void>((settle) => (release = settle))
  let session = A_SESSION
  const { where: base, heard } = aPlace(undefined, async (text) => (text === 'first' ? held : undefined))
  const followUps = new Map<string, string>([['first', 'the act after first'], ['the act after first', 'the act after that']])
  const where: WhereTheTurnsGo = {
    ...base,
    get session_id() {
      return session
    },
    after: async (ended) => {
      const text = followUps.get(String(ended))
      if (text === 'the act after that') session = 'a-new-session'
      return text === undefined ? undefined : { text, arrival: { source: 'mcp_result' } }
    },
    send: async (session_id, text) => {
      await base.send(session_id, text)
      return text
    },
  }
  const turns = theEngineMembersTurns('a-member', where)
  const first = turns.take({ text: 'first', arrival: AN_ARRIVAL })
  const second = turns.take({ text: 'second', arrival: AN_ARRIVAL })
  release()
  assert.deepEqual(await first, { sent: 1 })
  assert.deepEqual(await second, { sent: 1 })
  assert.deepEqual(heard.said.filter((line) => line.startsWith('send')), [
    `send ${A_SESSION} first`,
    `send ${A_SESSION} the act after first`,
    'send a-new-session the act after that',
    'send a-new-session second',
  ])
  assert.ok(heard.said.indexOf(`arrived ${A_SESSION} the act after first mcp_result`) < heard.said.indexOf(`send ${A_SESSION} the act after first`))
})

test('#999 package 5: an after that throws is told, and the next turn is still sent (mutant: the throw left to break the queue)', async () => {
  const { where: base, heard } = aPlace()
  const where: WhereTheTurnsGo = {
    ...base,
    after: async () => {
      throw new Error('the refresh could not be asked')
    },
  }
  const turns = theEngineMembersTurns('a-member', where)
  assert.deepEqual(await turns.take({ text: 'one', arrival: AN_ARRIVAL }), { sent: 1 })
  assert.deepEqual(await turns.take({ text: 'two', arrival: AN_ARRIVAL }), { sent: 1 })
  // Asked after each of the two turns, and told each time.
  assert.deepEqual(heard.told, [1, 2].map(() => theLineOfNoAct('a-member', 'the refresh could not be asked')))
  assert.ok(heard.said.includes(`send ${A_SESSION} two`))
})

test('#999 package 5: the queue is settled only once every turn taken, and what the launch asked after it, is done (mutant: settled at once)', async () => {
  let release: () => void = () => undefined
  const held = new Promise<void>((settle) => (release = settle))
  const { where: base } = aPlace()
  let asked = 0
  const where: WhereTheTurnsGo = { ...base, after: async () => void (await held, (asked += 1)) }
  const turns = theEngineMembersTurns('a-member', where)
  void turns.take({ text: 'one', arrival: AN_ARRIVAL })
  let settled = false
  const done = turns.settled().then(() => (settled = true))
  await new Promise((settle) => setImmediate(settle))
  assert.equal(settled, false, 'the queue said it was settled while the question after a turn was still asked')
  release()
  await done
  assert.equal(asked, 1)
})
