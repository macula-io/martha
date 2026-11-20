// The crew's state as one section of the system prompt (martha#984): what a render adds, and what it never adds.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Heard } from './crew_command.ts'
import { CREW_STATE_SECTION, CREW_STATE_WAIT_MS, theCrewStateHeardWithin, withTheCrewState } from './crew_state_section.ts'

const THE_STATE = 'Standing items (1): hold the landing for the owner.'
const COMPOSED = { sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }, { id: 'memory', text: 'notes', scope: 'session' }] }

/** A host timer this file runs by hand: `fire` runs every wait started, as a clock past them would. */
function aTimer(): { after: (ms: number, fn: () => void) => { cancel(): void }; fire(): void; asked: number[]; cancelled: () => number } {
  const waits: { fn: () => void; live: boolean }[] = []
  const asked: number[] = []
  return {
    after: (ms, fn) => {
      asked.push(ms)
      const wait = { fn, live: true }
      waits.push(wait)
      return { cancel: () => void (wait.live = false) }
    },
    fire: () => waits.filter((wait) => wait.live).forEach((wait) => wait.fn()),
    asked,
    cancelled: () => waits.filter((wait) => !wait.live).length,
  }
}

test('martha#984: the launcher\'s text is added last, as one session section with its id, after what the host composed', async () => {
  const timer = aTimer()
  const text = await theCrewStateHeardWithin(async (): Promise<Heard> => ({ said: THE_STATE }), timer.after)
  assert.equal(text, THE_STATE)
  assert.deepEqual(timer.asked, [CREW_STATE_WAIT_MS])
  assert.equal(timer.cancelled(), 1, 'the wait was left running after the launcher answered')
  assert.deepEqual(withTheCrewState(COMPOSED, text), { sections: [...COMPOSED.sections, { id: CREW_STATE_SECTION, text: THE_STATE, scope: 'session' }] })
})

test("martha#984 (Terra's build note): a launcher that hangs past the wait adds no section, and the host's sections come back unchanged (mutant: the wait dropped)", async () => {
  const timer = aTimer()
  const hanging = new Promise<Heard>(() => undefined)
  const heard = theCrewStateHeardWithin(() => hanging, timer.after)
  timer.fire()
  const text = await heard
  assert.equal(text, null)
  assert.deepEqual(withTheCrewState(COMPOSED, text), COMPOSED)
})

test('martha#984: a launcher that says why, says nothing, or throws adds no section; a composition with no list is left alone', async () => {
  for (const hear of [async (): Promise<Heard> => ({ why: 'Martha did not launch this session' }), async (): Promise<Heard> => ({ said: '' }), async (): Promise<Heard> => Promise.reject(new Error('the socket is gone'))]) {
    assert.equal(await theCrewStateHeardWithin(hear, aTimer().after), null)
  }
  assert.equal(withTheCrewState(undefined, THE_STATE), undefined)
  assert.deepEqual(withTheCrewState({ text: 'no sections here' }, THE_STATE), { text: 'no sections here' })
})

test('martha#984: nothing is kept between renders, so a render with no answer carries no earlier text', async () => {
  const first = withTheCrewState(COMPOSED, await theCrewStateHeardWithin(async (): Promise<Heard> => ({ said: THE_STATE }), aTimer().after))
  assert.ok(JSON.stringify(first).includes(THE_STATE))
  const second = withTheCrewState(COMPOSED, await theCrewStateHeardWithin(async (): Promise<Heard> => ({ why: 'unheard' }), aTimer().after))
  assert.ok(!JSON.stringify(second).includes(THE_STATE), 'an earlier render\'s text was carried into a render the launcher did not answer')
})
