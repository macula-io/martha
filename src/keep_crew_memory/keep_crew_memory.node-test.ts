// Crew memory (martha#1016, M1-M7 on issuecomment-7054673284): off in each of M6's cases with nothing ordered; a note
// carrying a private class refused by its class (M1); the topic, the source label and the cap; the roster filter (M2);
// the number of notes clamped; and a failure answered in Martha's words, never the provider's (M7).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import { SOLO_MODE } from '../declare_crew/declare_crew.ts'
import { NO_MESH, WHERE_A_CREW_OPENS_WHEN_UNNAMED } from '../declare_crew/the_crews_workspace.ts'
import {
  answerCrewMemory,
  FIND_PROCEDURE,
  HITS_ASKED,
  KEEP_PROCEDURE,
  MEMORY_CALL_TIMEOUT_MS,
  MEMORY_SERVICE,
  MOST_NOTE_CHARACTERS,
  MOST_NOTES_SHOWN,
  NOTES_SHOWN_WHEN_UNNAMED,
  RECALL_WHAT_THE_CREW_KEPT,
  REMEMBER_FOR_THE_CREW,
  THE_NOTE_WAS_KEPT,
  THE_NOTES_WERE_FOUND,
  type TheMemoryAsked,
} from './keep_crew_memory.ts'

const REALM = 'ab'.repeat(32)
const CREW_ID = 'A-Crew'
const MAKER_ID = 'cd'.repeat(32)
const CHECKER_ID = 'ef'.repeat(32)
const STRANGER_ID = '12'.repeat(32)

/** A team crew whose memory is on, with `over` changed. */
const aCrew = (over: Partial<Record<'mode' | 'mesh_realm' | 'mesh_services' | 'opens', unknown>> = {}): CrewSettings =>
  ({
    mode: { name: 'team' },
    mesh_realm: REALM,
    mesh_services: { memory: { service: MEMORY_SERVICE, on: true } },
    opens: { ...WHERE_A_CREW_OPENS_WHEN_UNNAMED, id: CREW_ID },
    ...over,
  }) as unknown as CrewSettings

const asked = (settings: CrewSettings | { refused: string } = aCrew(), roster: () => Readonly<Record<string, string>> = () => ({ Maker: MAKER_ID, Checker: CHECKER_ID.toUpperCase() })): TheMemoryAsked => ({
  member: 'Maker',
  settings: () => Promise.resolve(settings),
  host: { roster },
})

const said = async (memory: TheMemoryAsked, name: string, args: Record<string, unknown>): Promise<string> => {
  const answer = await answerCrewMemory(memory, name, args)
  assert.ok(answer !== undefined, `${name} is not answered`)
  return answer.answer
}

const orderIn = (words: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(words) as { mesh_order?: Record<string, unknown> }
    return parsed.mesh_order
  } catch {
    return undefined
  }
}

test('#1016 M6: memory is off in each case the header names, and nothing is ordered', async () => {
  const offs: [string, TheMemoryAsked][] = [
    ['a host that carries no order', { member: 'Maker', settings: () => Promise.resolve(aCrew()) }],
    ['a solo crew', asked(aCrew({ mode: { name: SOLO_MODE } }))],
    ['no memory service', asked(aCrew({ mesh_services: NO_MESH.mesh_services }))],
    ['another provider', asked(aCrew({ mesh_services: { memory: { service: 'another-rag', on: true } } }))],
    ['memory switched off', asked(aCrew({ mesh_services: { memory: { service: MEMORY_SERVICE, on: false } } }))],
    ['no realm', asked(aCrew({ mesh_realm: null }))],
    ['no crew id', asked(aCrew({ opens: WHERE_A_CREW_OPENS_WHEN_UNNAMED }))],
    ['an unreadable declaration', asked({ refused: 'the declaration could not be read' })],
  ]
  for (const [why, memory] of offs) {
    for (const [tool, args] of [[REMEMBER_FOR_THE_CREW, { text: 'a note' }], [RECALL_WHAT_THE_CREW_KEPT, { query: 'a note' }]] as const) {
      const words = await said(memory, tool, args)
      assert.equal(orderIn(words), undefined, `${why}: ${tool} ordered a call`)
      assert.match(words, /^Crew memory is off: /, why)
    }
  }
})

test('#1016 M1: a note carrying a private class is refused by its class, its value never said, and nothing is ordered', async () => {
  const notes: [string, string][] = [
    ['a lab hostname', 'see box-synthetic.lab for it'],
    ['a home directory', 'it sits in /home/synthetic now'],
    ['a private address', 'reach it at 192.168.255.7'],
    ['an email address', 'write to someone@synthetic.invalid'],
    ['a 64-hex id', `the key is ${'9a'.repeat(32)}`],
  ]
  for (const [what, text] of notes) {
    const words = await said(asked(), REMEMBER_FOR_THE_CREW, { text })
    assert.equal(orderIn(words), undefined, `${what} was ordered`)
    assert.ok(words.startsWith(`Not remembered: the note carries ${what}`), words)
    for (const piece of text.split(' ').filter((word) => word.length > 4)) assert.ok(!words.includes(piece), `${what}: the answer says ${piece}`)
  }
})

test("#1016: a note is ordered under the crew's topic and the member's label, sealed by the relay, and an empty or long one is not", async () => {
  const order = orderIn(await said(asked(), REMEMBER_FOR_THE_CREW, { text: '  the build needs the second runner  ' }))
  assert.deepEqual(order, {
    procedure: KEEP_PROCEDURE,
    args: { text: 'the build needs the second runner', source_label: 'crew:a-crew/maker', topics: ['crew:a-crew'] },
    realm: REALM,
    timeout_ms: MEMORY_CALL_TIMEOUT_MS,
    then: THE_NOTE_WAS_KEPT,
    keep: { topic: 'crew:a-crew' },
  })
  assert.match(await said(asked(), REMEMBER_FOR_THE_CREW, { text: ' ' }), /^Not remembered: text is/)
  assert.equal(orderIn(await said(asked(), REMEMBER_FOR_THE_CREW, { text: 'x'.repeat(MOST_NOTE_CHARACTERS) })) === undefined, false)
  assert.match(await said(asked(), REMEMBER_FOR_THE_CREW, { text: 'x'.repeat(MOST_NOTE_CHARACTERS + 1) }), /^Not remembered: a note is at most/)
})

test('#1016: a recall asks for every hit mcl-rag serves within the topic, and the notes shown are clamped', async () => {
  const order = orderIn(await said(asked(), RECALL_WHAT_THE_CREW_KEPT, { query: ' the runner ', top_k: 3 }))
  assert.deepEqual(order, {
    procedure: FIND_PROCEDURE,
    args: { query_text: 'the runner', top_k: HITS_ASKED, topics: ['crew:a-crew'] },
    realm: REALM,
    timeout_ms: MEMORY_CALL_TIMEOUT_MS,
    then: THE_NOTES_WERE_FOUND,
    keep: { wanted: 3 },
  })
  for (const [top_k, wanted] of [[undefined, NOTES_SHOWN_WHEN_UNNAMED], [0, NOTES_SHOWN_WHEN_UNNAMED], [2.5, NOTES_SHOWN_WHEN_UNNAMED], ['7', NOTES_SHOWN_WHEN_UNNAMED], [MOST_NOTES_SHOWN + 1, MOST_NOTES_SHOWN], [1, 1]] as const) {
    assert.deepEqual(orderIn(await said(asked(), RECALL_WHAT_THE_CREW_KEPT, { query: 'q', top_k }))?.['keep'], { wanted }, String(top_k))
  }
  assert.match(await said(asked(), RECALL_WHAT_THE_CREW_KEPT, { query: '' }), /^Nothing recalled: query is/)
})

const aHit = (content: string, deposited_by: unknown): Record<string, unknown> => ({ content, score: 0.5, provenance: { deposited_by } })

test("#1016 M2: a recalled hit counts only when its depositor is on the roster, ids compared lowercased; every other hit is left out and counted", async () => {
  const hits = [aHit('a stranger ranks first', STRANGER_ID), aHit('the maker kept this', MAKER_ID.toUpperCase()), aHit('no provenance at all', undefined), aHit('the checker kept this', CHECKER_ID), aHit('the maker again', MAKER_ID)]
  const words = await said(asked(), THE_NOTES_WERE_FOUND, { keep: { wanted: 2 }, answer: { result: { hits } } })
  assert.ok(words.startsWith("From crew memory (2), notes the crew's members kept:\n- Maker: the maker kept this\n- Checker: the checker kept this\n2 hits not kept by a member of this crew were left out."), words)
  assert.ok(!words.includes('stranger'))
  const none = await said(asked(aCrew(), () => ({})), THE_NOTES_WERE_FOUND, { keep: { wanted: 5 }, answer: { result: { hits } } })
  assert.ok(none.startsWith('Nothing in crew memory matches. 5 hits not kept by a member of this crew were left out.'), none)
})

test("#1016 M7: a failed call is answered in Martha's words, never the provider's, and a kept note names its topic", async () => {
  const providers = `${KEEP_PROCEDURE}: {"code":"internal","detail":"the store at some-host refused"}`
  for (const [refusal, fault] of [[providers, 'the call failed'], ['x: no answer within 20 ms', 'no answer in time'], ['x: the answer came back unsealed, so it is not used', 'the answer came back unsealed']] as const) {
    const kept = await said(asked(), THE_NOTE_WAS_KEPT, { keep: { topic: 'crew:a-crew' }, answer: { refusal } })
    assert.ok(kept.startsWith(`Crew memory is unreachable (${fault}): nothing was remembered.`), kept)
    assert.ok(!kept.includes('some-host'))
    assert.ok((await said(asked(), THE_NOTES_WERE_FOUND, { keep: { wanted: 1 }, answer: { refusal } })).startsWith(`Crew memory is unreachable (${fault}): nothing was recalled.`))
  }
  assert.ok((await said(asked(), THE_NOTE_WAS_KEPT, { keep: { topic: 'crew:a-crew' }, answer: { result: { id: 'n1' } } })).startsWith(`Remembered under crew:a-crew: the crew's ${RECALL_WHAT_THE_CREW_KEPT} finds it.`))
  assert.equal(answerCrewMemory(asked(), 'another_tool', {}), undefined)
})
