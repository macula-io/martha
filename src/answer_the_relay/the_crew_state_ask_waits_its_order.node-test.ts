// The crew state of a turn (martha#984) is taken in on A28 before it is answered, so on Claude Code its ask waits behind
// the host's events already asked for, as an engine launch's crew call does (the_engines_relay.ts).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ACrewToolAsked } from '../host_contract/host_contract.ts'
import { THE_CREW_STATE_ASK } from '../hand_a_member_its_crew_text/the_crew_state_of_a_turn.ts'
import { answerAToolAndHearItsTurn, type RelayState } from './answer_the_relay.ts'

/** A launch whose order is held shut until the test opens it, and that records each crew call it answers. */
function aLaunchHeldShut() {
  const asked: string[] = []
  let open: () => void = () => undefined
  let queue: Promise<unknown> = new Promise<void>((settle) => (open = settle))
  const inOrder = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work)
    queue = next.catch(() => undefined)
    return next
  }
  const state = {
    place: { crew: {} },
    answers: { aCrewToolAsked: async (ask: ACrewToolAsked) => (asked.push(ask.tool), { answered: { said: ask.tool } }) },
    everyTurn: { startIn: () => undefined },
  } as unknown as RelayState
  return { asked, open: () => open(), inOrder, state }
}

const HELD = 'held behind the order'

const settled = async (): Promise<void> => new Promise((settle) => setImmediate(settle))

test('martha#984: the crew state ask is answered after the work the order already holds (mutant: the order skipped)', async () => {
  const launch = aLaunchHeldShut()
  const answered = answerAToolAndHearItsTurn(launch.state, { session_id: 's', tool: THE_CREW_STATE_ASK, args: {} }, launch.inOrder)
  await settled()
  assert.deepEqual(launch.asked, [], 'the crew state was taken in ahead of the host events before it')
  launch.open()
  assert.deepEqual(await answered, { answered: { said: THE_CREW_STATE_ASK } })
  assert.deepEqual(launch.asked, [THE_CREW_STATE_ASK])
})

test("martha#984: any other crew tool is answered as before, not held behind the order (mutant: every ask queued)", async () => {
  const launch = aLaunchHeldShut()
  const answered = answerAToolAndHearItsTurn(launch.state, { session_id: 's', tool: 'a_crew_tool', args: {} }, launch.inOrder)
  assert.deepEqual(await Promise.race([answered, settled().then(() => HELD)]), { answered: { said: 'a_crew_tool' } }, 'the crew tool waited behind the order')
  assert.deepEqual(launch.asked, ['a_crew_tool'])
  launch.open()
})
