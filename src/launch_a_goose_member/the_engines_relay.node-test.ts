// The relay an engine launch serves (#541 package A, design G1): the crew's tool calls answered by the entry, in its
// order; every other question refused by name.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ACrewToolAsked } from '../host_contract/host_contract.ts'
import { A_CREW_CALL_UNREAD } from '../answer_the_relay/answer_the_relay.ts'
import { AN_ENGINE_LAUNCH_ASKS_NO, anEngineRelay } from './the_engines_relay.ts'

/** An entry whose order is held shut until the test opens it, and that records each crew call it answers. */
function anEntryHeldShut() {
  const asked: ACrewToolAsked[] = []
  let open: () => void = () => undefined
  let queue: Promise<unknown> = new Promise<void>((settle) => (open = settle))
  return {
    asked,
    open: () => open(),
    answers: {
      inOrder: <T>(work: () => Promise<T>): Promise<T> => {
        const next = queue.then(work)
        queue = next.catch(() => undefined)
        return next
      },
      aCrewToolAsked: async (ask: ACrewToolAsked) => (asked.push(ask), { answered: { said: ask.tool } }),
    },
  }
}

test("a crew tool call is answered by the entry, after the work its order already holds (#541 package A, design G1; mutant: the order skipped)", async () => {
  const entry = anEntryHeldShut()
  const relay = anEngineRelay(entry.answers as never)
  const answered = relay.answerTool({ session_id: 'a-session', tool: 'a_crew_tool', args: { n: 1 } })
  await new Promise((settle) => setImmediate(settle))
  assert.deepEqual(entry.asked, [], 'the crew call was answered ahead of the work before it')
  entry.open()
  assert.deepEqual(await answered, { answered: { said: 'a_crew_tool' } })
  assert.deepEqual(entry.asked, [{ session_id: 'a-session', tool: 'a_crew_tool', args: { n: 1 } }])
})

test('a crew tool call the relay cannot read is refused by name, and the entry is not asked (#541 package A, design G1)', async () => {
  const entry = anEntryHeldShut()
  entry.open()
  assert.deepEqual(await anEngineRelay(entry.answers as never).answerTool({ tool: 'no session' }), { refused: A_CREW_CALL_UNREAD })
  assert.deepEqual(entry.asked, [])
})

test("a hook's event, a signed run and both git questions are refused by name, never answered as allowed (#541 package A, design G1)", async () => {
  const entry = anEntryHeldShut()
  const relay = anEngineRelay(entry.answers as never)
  assert.deepEqual(await relay.answer('tool_called', { session_id: 's' }), { answered: true, body: { refused: AN_ENGINE_LAUNCH_ASKS_NO('hook') } })
  assert.deepEqual(await relay.run({ name: 'x' }), { refused: AN_ENGINE_LAUNCH_ASKS_NO('signed run') })
  assert.deepEqual(await relay.judgeAGitCall({}), { refused: AN_ENGINE_LAUNCH_ASKS_NO('git shim') })
  assert.deepEqual(await relay.judgeARefTransaction({}), { refused: AN_ENGINE_LAUNCH_ASKS_NO('git hook') })
})
