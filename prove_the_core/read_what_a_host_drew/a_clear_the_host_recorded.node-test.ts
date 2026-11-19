// What the host's own record says about its clear (martha#693 R1). The shapes here are the ones host 2.1.327 wrote in a
// run where the clear landed: a session file opening with the clear's own command, and a prompt history whose line after
// `/clear` carries the session the clear moved the host to. A run where the clear was never typed writes neither.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { theClearRan } from './a_clear_the_host_recorded.ts'

const THE_SESSION_IT_STARTED_IN = 'a2f7d52c-0000-4000-8000-000000000000'
const THE_SESSION_THE_CLEAR_MOVED_TO = 'b46863fe-0000-4000-8000-000000000001'
const THE_PROJECT_FOLDER = '-build-checkout'

/** A host's home holding the files given, removed with everything the test put in it. */
const aHomeHolding = (t: TestContext, files: Readonly<Record<string, string>>): string => {
  const home = mkdtempSync(join(tmpdir(), 'martha-693-clear-record-'))
  t.after(() => removeTheTree(home))
  for (const [at, body] of Object.entries(files)) {
    const file = join(home, at)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body)
  }
  return home
}

/** One line of the host's prompt history, as it writes it. */
const aTypedLine = (display: string, sessionId: string): string =>
  `${JSON.stringify({ display, pastedContents: {}, timestamp: 1795036552452, project: '/build/checkout', sessionId })}\n`

test('a session the host started, whose entries hold the clear, is a clear that ran', (t) => {
  const home = aHomeHolding(t, {
    [join('.claude', 'projects', THE_PROJECT_FOLDER, `${THE_SESSION_THE_CLEAR_MOVED_TO}.jsonl`)]:
      `${JSON.stringify({ type: 'user', sessionId: THE_SESSION_THE_CLEAR_MOVED_TO, message: { content: '<command-name>/clear</command-name>' } })}\n`,
  })
  assert.ok(theClearRan(home))
})

test('a history whose line after /clear carries a sessionId it did not start in is a clear that ran', (t) => {
  const history = aTypedLine('run the probe command', THE_SESSION_IT_STARTED_IN) +
    aTypedLine('/clear', THE_SESSION_IT_STARTED_IN) +
    aTypedLine('/exit', THE_SESSION_THE_CLEAR_MOVED_TO)
  const home = aHomeHolding(t, { [join('.claude', 'history.jsonl')]: history })
  assert.ok(history.includes('"/clear"'), 'the history this test builds holds no clear, so it could not find one')
  assert.ok(theClearRan(home))
})

test('a /clear with no session after it to move the host to is not a clear that ran', (t) => {
  const home = aHomeHolding(t, {
    [join('.claude', 'history.jsonl')]: aTypedLine('run the probe command', THE_SESSION_IT_STARTED_IN) +
      aTypedLine('/clear', THE_SESSION_IT_STARTED_IN),
  })
  assert.ok(!theClearRan(home))
})

test('a home where the clear was never typed holds no clear at all', (t) => {
  const home = aHomeHolding(t, {
    [join('.claude', 'history.jsonl')]: aTypedLine('run the probe command', THE_SESSION_IT_STARTED_IN) +
      aTypedLine('/exit', THE_SESSION_THE_CLEAR_MOVED_TO),
    [join('.claude', 'projects', THE_PROJECT_FOLDER, `${THE_SESSION_IT_STARTED_IN}.jsonl`)]:
      `${JSON.stringify({ type: 'user', sessionId: THE_SESSION_IT_STARTED_IN, message: { content: 'run the probe command' } })}\n`,
  })
  assert.ok(!theClearRan(home))
})

test('a home the host has written nothing in holds no clear', (t) => {
  assert.ok(!theClearRan(aHomeHolding(t, {})))
})
