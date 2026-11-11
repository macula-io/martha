// The stand-in model keeps its own record of what it read and what it answered (martha#264).
//
// A stalled recorded-host run used to read as one thing, "the host showed nothing new", which is true of two different
// defects: a host that never sent the request, and a stand-in that received it and never answered. Only the stand-in
// knows which, so it records the two times the red is read by: when it had the request whole, and when its reply went
// out. These cases post to it over HTTP, as the host does, on the real server and with no recorded host behind it.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { theStandInModel, type ModelRequest, type ScriptedTurn } from './drive_the_recorded_host.ts'

/** A model request that offers the model tools: the kind that is counted, and answered by the script. */
const OFFERS_TOOLS = { model: 'the-stand-in', tools: [{ name: 'Write' }], messages: [] }

/** A request the host's own side makes — a title, a summary: it offers no tools, so it is answered and not counted. */
const OFFERS_NONE = { model: 'the-stand-in', messages: [] }

/** Posts a request to the stand-in the way the host does, and reads its reply whole. */
async function ask(url: string, body: Readonly<Record<string, unknown>>): Promise<string> {
  const answered = await fetch(`${url}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return answered.text()
}

/** A scripted turn the test releases itself, so a reply can be held back and then sent. */
function aTurnHeldBack(): { readonly turn: Promise<ScriptedTurn>; readonly release: (turn: ScriptedTurn) => void } {
  let release: (turn: ScriptedTurn) => void = () => {}
  const turn = new Promise<ScriptedTurn>((resolve) => void (release = resolve))
  return { turn, release: (said) => release(said) }
}

test('#264: the stand-in records when it read a request and when its reply went out', async () => {
  const heard: ModelRequest[] = []
  const stand = await theStandInModel(() => ({ text: 'Done.' }), heard, () => {})
  try {
    assert.match(await ask(stand.url, OFFERS_TOOLS), /"type":"text_delta"/, 'the stand-in answered the request, and not as the model does')
    assert.equal(heard.length, 1, 'a request that offers tools was not recorded, so a stall could never be pinned on a side')
    const one = heard[0]!
    assert.equal(one.number, 1, 'the request was recorded under another number than the host counts it by')
    assert.ok(Number.isFinite(one.received_at), 'the stand-in read the request and recorded no time for it')
    assert.ok(
      one.answered_at !== undefined && one.answered_at >= one.received_at,
      'the stand-in sent its reply and recorded no answer, so a stall after it would be blamed on the stand-in rather than the host',
    )
  } finally {
    await stand.close()
  }
})

test('#264: a request that offers no tools is answered and never counted, so it names no side', async () => {
  const heard: ModelRequest[] = []
  const stand = await theStandInModel(() => ({ text: 'Done.' }), heard, () => {})
  try {
    await ask(stand.url, OFFERS_NONE)
    assert.deepEqual(heard, [], 'the host\'s own side request was counted as a model request, so the red would name a request the run never waited for')
  } finally {
    await stand.close()
  }
})

test('#264: a scripted turn still owed is a request the stand-in read and has not answered', async () => {
  const heard: ModelRequest[] = []
  const held = aTurnHeldBack()
  const stand = await theStandInModel(() => held.turn, heard, () => {})
  try {
    const asked = ask(stand.url, OFFERS_TOOLS)
    // The request has been read by now: the stand-in records it before it waits on the script.
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(heard.length, 1, 'the stand-in did not record a request it had read, so a stall while its script was owed would read as a host that sent nothing')
    assert.equal(
      heard[0]?.answered_at,
      undefined,
      'a request no reply has gone out for was recorded as answered, so the red would blame the host for the stand-in\'s own silence',
    )
    held.release({ text: 'Done.' })
    await asked
    assert.ok(heard[0]?.answered_at !== undefined, 'the reply went out and the stand-in still says it never answered')
  } finally {
    await stand.close()
  }
})
