// The Bash-answers harness bites (martha#812): the comparison names every difference, and the live mode never passes on
// cases it did not take. No host and no npm run here — CI's drift-bites job runs this file on every pull request, and
// the live mode is planted with a stand-in `claude`, which is only a path to the harness.
//
// Every test in this file must run and pass; `prove_the_bash_answers_bites.sh` says so, so a check that cannot bite
// cannot go green by being skipped.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { CLAUDE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { RECORDED_BASH_RESULTS, type RecordedBashCase } from './claude_code_bash_results.ts'

/** The checkout this test runs in, resolved, so a symlinked temp directory cannot make two paths of one folder. */
const THE_CHECKOUT = realpathSync(join(import.meta.dirname, '..', '..'))

/** The harness, as CI runs it: the program, never one of its functions. */
const THE_HARNESS = join(THE_CHECKOUT, 'prove_the_relay_loads', 'prove_the_bash_answers.mjs')

/** A case of the recording's own shape: the recorded first case answers every fixture unless a test changes it. */
const A_RECORDED_CASE: RecordedBashCase = RECORDED_BASH_RESULTS.cases[0] as RecordedBashCase

/** `n` copies of the recorded case, so a fixture is a recording the comparison can judge. */
const casesOf = (...answers: readonly unknown[]): RecordedBashCase[] =>
  answers.length === 0 ? [{ ...A_RECORDED_CASE }] : answers.map((answer) => ({ ...A_RECORDED_CASE, answer }))

/** What the recorded first case answers, as an object a fixture can change one field of. */
const theRecordedAnswer = A_RECORDED_CASE.answer as { readonly result: Readonly<Record<string, unknown>>; readonly text: string }

/** A recording file of the shape the committed one has, written where the test may read it. */
function aRecording(t: TestContext, cases: readonly RecordedBashCase[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'bash-answers-bite-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'a-recording.json')
  writeFileSync(path, `${JSON.stringify({ host_version: RECORDED_BASH_RESULTS.host_version, mark: RECORDED_BASH_RESULTS.mark, cases })}\n`)
  return path
}

/** The harness, run and done: its exit code and what it said on each stream. */
function theRun(args: readonly string[], env: Record<string, string> = {}): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const run = spawnSync(process.execPath, [THE_HARNESS, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

/** A `claude` that is only a path: a shell script that does what the script says and never loads a plugin. */
function aStandInHost(t: TestContext, script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'bash-answers-stand-in-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, CLAUDE)
  writeFileSync(path, `#!/bin/sh\n${script}\n`)
  chmodSync(path, 0o755)
  return path
}

test('a taken recording that answers as the recording does passes', (t) => {
  const recording = aRecording(t, casesOf())
  const taken = aRecording(t, casesOf())
  const run = theRun(['--compare', recording, taken])
  assert.equal(run.status, 0, `the comparison failed on two equal recordings: ${run.stderr}`)
})

test('a change to the last case is named, so a comparison of the first case only cannot pass', (t) => {
  const held = casesOf(theRecordedAnswer, theRecordedAnswer, theRecordedAnswer)
  const changed = { ...theRecordedAnswer, text: 'a text the recording does not hold' }
  const recording = aRecording(t, held)
  const taken = aRecording(t, [...held.slice(0, -1), { ...A_RECORDED_CASE, answer: changed }])
  const run = theRun(['--compare', recording, taken])
  assert.equal(run.status, 1, 'a changed answer passed the comparison')
  assert.match(run.stderr, /case 3 \(status 0, printed "RUN-OUTPUT-MARK\\n"\): the answers differ/)
})

test('a change inside the answer’s result is named, so a text-only comparison cannot pass', (t) => {
  const changed = { ...theRecordedAnswer, result: { ...theRecordedAnswer.result, stdout: 'a stdout the recording does not hold' } }
  const recording = aRecording(t, casesOf())
  const taken = aRecording(t, casesOf(changed))
  const run = theRun(['--compare', recording, taken])
  assert.equal(run.status, 1, 'a changed result passed a comparison that read only the text')
  assert.match(run.stderr, /case 1 \(status 0, printed "RUN-OUTPUT-MARK\\n"\): the answers differ/)
})

test('a case the taken file lacks is named, and never counted as equal', (t) => {
  const recording = aRecording(t, casesOf(theRecordedAnswer, theRecordedAnswer))
  const taken = aRecording(t, casesOf())
  const run = theRun(['--compare', recording, taken])
  assert.equal(run.status, 1, 'a case that was never taken passed the comparison')
  assert.match(run.stderr, /case 2 \(status 0, printed "RUN-OUTPUT-MARK\\n"\): the recording holds it and the taken file does not/)
})

test('a case the recording does not hold is named', (t) => {
  const recording = aRecording(t, casesOf())
  const taken = aRecording(t, casesOf(theRecordedAnswer, theRecordedAnswer))
  const run = theRun(['--compare', recording, taken])
  assert.equal(run.status, 1, 'a case the recording does not hold passed the comparison')
  assert.match(run.stderr, /case 2 \(status 0, printed "RUN-OUTPUT-MARK\\n"\): the taken file holds it and the recording does not/)
})

test('a recording with no cases could not be compared, whatever the taken file holds', (t) => {
  const recording = aRecording(t, [])
  const taken = aRecording(t, casesOf())
  const run = theRun(['--compare', recording, taken])
  assert.equal(run.status, 2, 'nothing was compared and the run passed')
  assert.match(run.stderr, /nothing was compared/)
})

test('the live mode against a host that exits without answering takes no case and says which', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'bash-answers-live-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  const standIn = aStandInHost(t, 'exit 0')
  const run = theRun([out], { MARTHA_RECORDED_HOST: standIn })
  assert.equal(run.status, 2, `a host that answered nothing was counted: ${run.stdout}`)
  assert.match(run.stderr, /case 1 \(status 0, printed "RUN-OUTPUT-MARK\\n"\): not taken/)
  assert.match(run.stderr, /the tool\.call was never logged/)
  assert.doesNotMatch(run.stdout, /answer as recorded/, 'the run said its cases hold although it took none')
})

test('the live mode takes the same road when the host says a word and fails', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'bash-answers-live-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  const standIn = aStandInHost(t, 'echo "a word from the host"\nexit 1')
  const run = theRun([out], { MARTHA_RECORDED_HOST: standIn })
  assert.equal(run.status, 2, 'a host that answered nothing was counted')
  assert.match(run.stderr, /case 1 .*: not taken/)
  assert.match(run.stderr, /a word from the host/)
})

test('an out-dir inside the checkout is refused before anything is made, and the tree stays clean', (t) => {
  const inside = join(THE_CHECKOUT, 'an-out-dir-a-run-must-refuse')
  t.after(() => rmSync(inside, { recursive: true, force: true }))
  assert.equal(existsSync(inside), false, 'the path this case plants existed before the run')
  const standIn = aStandInHost(t, 'exit 0')
  const run = theRun([inside], { MARTHA_RECORDED_HOST: standIn })
  assert.equal(run.status, 2, 'an out-dir inside the checkout was accepted')
  assert.match(run.stderr, /inside the checkout/)
  assert.equal(existsSync(inside), false, 'the refused run made the out-dir anyway')
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: THE_CHECKOUT, encoding: 'utf8' }).trim(), '', 'the refused run wrote into the tree')
})
