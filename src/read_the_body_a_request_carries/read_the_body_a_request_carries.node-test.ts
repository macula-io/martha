// What a request to the launcher carries, and what is no body at all (martha#41, martha#562).

import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { test } from 'node:test'

import { LARGEST_RELAY_BODY, theBodyOf } from './read_the_body_a_request_carries.ts'

/** A request whose stream carries `chunks`, which is all `theBodyOf` reads of one. */
const aRequestCarrying = (chunks: readonly Buffer[]): IncomingMessage =>
  ({ async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk } }) as unknown as IncomingMessage

test('a body in pieces is read whole, as the JSON it is', async () => {
  const body = await theBodyOf(aRequestCarrying([Buffer.from('{"cwd":"/a/clone",'), Buffer.from('"args":["status"]}')]))

  assert.deepEqual(body, { cwd: '/a/clone', args: ['status'] })
})

test('text that is not JSON is no body at all', async () => {
  assert.equal(await theBodyOf(aRequestCarrying([Buffer.from('not json at all')])), undefined)
})

test('a body past the largest the launcher reads is no body at all, and is not read to its end', async () => {
  let read = 0
  const over = Buffer.alloc(LARGEST_RELAY_BODY + 1)
  const request = {
    async *[Symbol.asyncIterator]() {
      for (let at = 0; at <= over.length; at += 1024) {
        const chunk = over.subarray(at, Math.min(at + 1024, over.length))
        read += chunk.length
        yield chunk
      }
    },
  } as unknown as IncomingMessage

  assert.equal(await theBodyOf(request), undefined)
  assert.ok(read > LARGEST_RELAY_BODY, 'the reader stopped at the largest it reads, rather than reading the whole body')
  assert.ok(read < over.length + 1024, 'the reader kept reading past the largest it reads')
})
