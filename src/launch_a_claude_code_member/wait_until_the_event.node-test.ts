// A wait that never ends is named in the log (martha#90).
//
// The harness ends a hung test itself: it reports its own --test-timeout as the
// failure and prints nothing an `until` throws, so the only thing that can name
// the wait is a diagnostic written before the abort. Both halves are pinned
// here, in a child run whose test really does hang.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { until } from './wait_until_the_event.ts'

/** The wait's name, and the state it is watching, as the log must carry them. */
const WHAT = 'the member to stop by itself'
const SHOWN = 'the terminal has said nothing at all'
/** The bound the child run gives its hung test: short, so this test is cheap. */
const HUNG_TEST_TIMEOUT_MS = 1200
const HUNG_TEST_TIMEOUT_FLAG = '--test-timeout'
/** The variable node --test sets in each test file's process. */
const TEST_CONTEXT_VARIABLE = 'NODE_TEST_CONTEXT'

test('a wait that never ends is named in the log, with what it was watching, though the harness reports only its timeout', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-90-wait-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const planted = join(dir, 'a_hung_wait.node-test.ts')
  writeFileSync(
    planted,
    [
      "import { test } from 'node:test'",
      `import { until } from ${JSON.stringify(new URL('./wait_until_the_event.ts', import.meta.url).href)}`,
      '',
      "test('a wait that never ends', async (t) => {",
      `  await until(${JSON.stringify(WHAT)}, () => false, t, () => ${JSON.stringify(SHOWN)})`,
      '})',
      '',
    ].join('\n'),
  )
  const run = spawnSync(process.execPath, ['--test', `${HUNG_TEST_TIMEOUT_FLAG}=${String(HUNG_TEST_TIMEOUT_MS)}`, planted], {
    encoding: 'utf8',
    // Without the variable node --test sets in each file's process: with it, a
    // nested node --test reports to this run instead of running at all.
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== TEST_CONTEXT_VARIABLE)),
  })
  const said = `${run.stdout}${run.stderr}`
  assert.notEqual(run.status, 0, `the hung test fails the run: ${said}`)
  assert.match(said, /test timed out/, 'the harness reports its own timeout, not what the wait threw')
  assert.ok(said.includes(`waiting for ${WHAT}`), `the wait is named: ${said}`)
  assert.ok(said.includes(SHOWN), `what it was watching is there too: ${said}`)
})

test('a wait returns as soon as the event it means has happened, however long that takes', async (t) => {
  let happened = false
  setTimeout(() => void (happened = true), 300)
  await until('the event this test plants', () => happened, t)
  assert.ok(happened)
})

/** What ends the planted wait before its event: the line a launcher prints when it refuses (martha#94). */
const ENDED_BY = 'refused: A launch of Mercury is not recorded: no process 4242 is running.'

test('a wait whose event can no longer come fails at once, naming why, instead of hanging to the harness timeout (#94)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-94-wait-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const planted = join(dir, 'an_ended_wait.node-test.ts')
  writeFileSync(
    planted,
    [
      "import { test } from 'node:test'",
      `import { until } from ${JSON.stringify(new URL('./wait_until_the_event.ts', import.meta.url).href)}`,
      '',
      "test('a wait the launcher has ended', async (t) => {",
      `  await until(${JSON.stringify(WHAT)}, () => false, t, () => ${JSON.stringify(SHOWN)}, () => ${JSON.stringify(ENDED_BY)})`,
      '})',
      '',
    ].join('\n'),
  )
  const run = spawnSync(process.execPath, ['--test', `${HUNG_TEST_TIMEOUT_FLAG}=${String(HUNG_TEST_TIMEOUT_MS)}`, planted], {
    encoding: 'utf8',
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== TEST_CONTEXT_VARIABLE)),
  })
  const said = `${run.stdout}${run.stderr}`
  assert.notEqual(run.status, 0, `the ended wait fails the run: ${said}`)
  assert.doesNotMatch(said, /test timed out/, 'it fails before the harness timeout')
  assert.ok(said.includes(`${WHAT} cannot happen: ${ENDED_BY}`), `the failure names the wait and why it ended: ${said}`)
})

test('a wait whose event has happened returns, though what would end it has happened too', async (t) => {
  await until('the event this test plants', () => true, t, undefined, () => ENDED_BY)
})
