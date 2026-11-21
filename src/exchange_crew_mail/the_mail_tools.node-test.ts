// The mail tools over the relay's real carry (martha#1016): each order the launcher answers is carried by
// carryAMeshOrder through a stand-in mesh server, and each answer comes back to the mail step, as a member's session runs it.

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'

import { SOLO_MODE } from '../declare_crew/declare_crew.ts'
import { carryAMeshOrder, MOST_MESH_CALLS_PER_TOOL_CALL } from '../claude_code_relay/hooks/carry_a_mesh_order.ts'
import type { MeshCallEngine } from '../claude_code_relay/hooks/call_the_mesh_as_the_member.ts'
import { AT_REST, EMPTY_MAILBOX, LETTERS_HEADER } from './exchange_crew_mail.ts'
import { READ_CREW_MAIL, SEND_CREW_MAIL, THE_MAIL_STEP_ASK, theMailPlaceOf, theMailStepAnswer, theMailToolAnswer, type TheMailPlace } from './the_mail_tools.ts'

const aNodeId = (): string => randomBytes(32).toString('hex')
const CERES = aNodeId()
const REALM = aNodeId()
/** The mail service as a declaration names it: not crew-code's spelling, so nothing here leans on a default. */
const SERVICE = 'planted-mail'
const A_TEAM = { name: 'team', roles: [], may: {} } as never
const A_SOLO = { name: SOLO_MODE, roles: [], may: {} } as never
const MAIL_ON = { mail: { service: SERVICE, on: true } }
const CARRIER = { roster: () => ({ Ceres: CERES }) }

const placeOf = (): TheMailPlace => theMailPlaceOf({ mode: A_TEAM, mesh_realm: REALM, mesh_services: MAIL_ON }, CARRIER)

/** A stand-in member's mesh server: each call answered by `reply` for its procedure, sealed unless it says otherwise. */
function aMeshServer(reply: (procedure: string, args: Record<string, unknown>) => { result: Record<string, unknown>; sealed?: number }): { $: MeshCallEngine; asked: Record<string, unknown>[] } {
  const asked: Record<string, unknown>[] = []
  return {
    asked,
    $: {
      mcp: {
        call: async (_server, _tool, args) => {
          asked.push(args ?? {})
          const answer = reply(String(args?.['procedure']), (args?.['args'] ?? {}) as Record<string, unknown>)
          return { content: [{ type: 'text', text: JSON.stringify({ result: answer.result, seal: { sealed: answer.sealed ?? 1 } }) }] }
        },
      },
      clock: { after: (ms, fn) => { const timer = setTimeout(fn, ms); return { cancel: () => clearTimeout(timer) } } },
    },
  }
}

/** One tool call as the member's session runs it: the launcher's first answer, carried on, each step asked of the mail step. */
const aToolCall = (place: TheMailPlace, $: MeshCallEngine, tool: string, args: Record<string, unknown>): Promise<string> =>
  carryAMeshOrder($, theMailToolAnswer(place, tool, args), async (then, asked) => {
    assert.equal(then, THE_MAIL_STEP_ASK)
    return theMailStepAnswer(place, asked)
  })

test('#1016 mail: off for a solo crew, a crew naming no mail service or one switched off, and a host that carries no order', () => {
  const off = (place: TheMailPlace, says: string): void => assert.ok('off' in place && place.off.includes(says), JSON.stringify(place))
  off(theMailPlaceOf({ mode: A_SOLO, mesh_realm: null, mesh_services: MAIL_ON }, CARRIER), 'this crew is solo')
  off(theMailPlaceOf({ mode: A_TEAM, mesh_realm: null, mesh_services: {} }, CARRIER), 'names no mail service that is on')
  off(theMailPlaceOf({ mode: A_TEAM, mesh_realm: null, mesh_services: { mail: { service: SERVICE, on: false } } }, CARRIER), 'names no mail service that is on')
  off(theMailPlaceOf({ mode: A_TEAM, mesh_realm: null, mesh_services: MAIL_ON }, undefined), 'cannot carry a mesh call')
  const solo = theMailPlaceOf({ mode: A_SOLO, mesh_realm: null, mesh_services: MAIL_ON }, CARRIER)
  assert.equal(theMailToolAnswer(solo, SEND_CREW_MAIL, { to: 'Ceres', subject: 's', body: 'b' }), 'off' in solo ? solo.off : '')
})

test('#1016 mail: a send is one sealed call in the realm, to the roster name\'s node id, answered in the crew\'s words', async () => {
  const server = aMeshServer(() => ({ result: { letter_id: 'l-5' } }))
  const said = await aToolCall(placeOf(), server.$, SEND_CREW_MAIL, { to: 'ceres', subject: 's', body: 'b' })
  assert.equal(said, `Sent, sealed: letter l-5 to ceres. ${AT_REST}`)
  assert.equal(server.asked.length, 1)
  assert.deepEqual(server.asked[0], { procedure: `${SERVICE}/deposit_letter`, args: { to_citizen_did: CERES, subject: 's', body: 'b' }, confidential: 'required', timeout_ms: server.asked[0]!['timeout_ms'], realm: REALM })
})

test('#1016 mail: a read opens the mailbox in three sealed calls, within the carry\'s bound, and shows the letters as data', async () => {
  const server = aMeshServer((procedure) =>
    procedure.endsWith('/initiate_mailbox') ? { result: { error: 'already_initiated' } }
    : procedure.endsWith('/get_mailbox') ? { result: { letters: [{ letter_id: 'l-1', from_did: CERES, subject: 's', body: 'b', deposited_at: 1, read: 0, replied: 0 }] } }
    : { result: {} })
  const said = await aToolCall(placeOf(), server.$, READ_CREW_MAIL, {})
  assert.deepEqual(server.asked.map((call) => call['procedure']), [`${SERVICE}/initiate_mailbox`, `${SERVICE}/open_mailbox`, `${SERVICE}/get_mailbox`])
  assert.ok(server.asked.length < MOST_MESH_CALLS_PER_TOOL_CALL)
  assert.ok(said.startsWith(`${LETTERS_HEADER}\n`), said)
  assert.equal((JSON.parse(said.slice(LETTERS_HEADER.length + 1)) as { letters: { from_name: string }[] }).letters[0]!.from_name, 'Ceres')
  const empty = aMeshServer((procedure) => (procedure.endsWith('/get_letter') ? { result: {} } : { result: {} }))
  assert.equal(await aToolCall(placeOf(), empty.$, READ_CREW_MAIL, { letter_id: 'l-9' }), EMPTY_MAILBOX)
  assert.deepEqual(empty.asked.at(-1)?.['args'], { letter_id: 'l-9' })
})

test('#1016 mail T1: an unsealed answer stops a read at that step, and the model is shown no letter from it', async () => {
  const server = aMeshServer((procedure) => (procedure.endsWith('/open_mailbox') ? { result: { letters: [{ body: 'forged' }] }, sealed: 0 } : { result: {} }))
  const said = await aToolCall(placeOf(), server.$, READ_CREW_MAIL, {})
  assert.equal(server.asked.length, 2)
  assert.ok(said.startsWith('Not read: crew mail could not be reached') && !said.includes('forged'), said)
})

test('#1016 mail: a step handed back a keep it was not sent with shows nothing, and an order past the last step is never made', () => {
  const place = placeOf()
  const lost = 'Crew mail: the step came back without what it was sent with, so nothing was shown.'
  assert.equal(theMailStepAnswer(place, { keep: { read: {}, step: 3 }, answer: { result: { letters: [{ body: 'x' }] } } }), lost)
  assert.equal(theMailStepAnswer(place, { keep: { read: {}, step: -1 }, answer: { result: {} } }), lost)
  assert.equal(theMailStepAnswer(place, { keep: { send: { to: 'Ceres', subject: '', body: 'b' } }, answer: { result: {} } }), lost)
  assert.equal(theMailStepAnswer(place, { keep: null, answer: { result: {} } }), lost)
  assert.ok(theMailStepAnswer(place, { keep: { read: {}, step: 0 } }).startsWith('Not read: crew mail could not be reached'))
  // An answer that is neither a result nor a refusal is no result: a send is never told it went.
  const send = { send: { to: 'Ceres', subject: 's', body: 'b' } }
  assert.ok(theMailStepAnswer(place, { keep: send, answer: {} }).startsWith('Not sent: crew mail could not be reached'))
  assert.ok(theMailStepAnswer(place, { keep: send, answer: { result: 'sent' } }).startsWith('Not sent: crew mail could not be reached'))
})
