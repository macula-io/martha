// A verdict nobody can read is not evidence (martha#694).
//
// This exists because line 4 ended "not-observed" twice and the evidence held only the verdict: no exchange,
// no engine request logs, an strace without timestamps. The rule these cases pin: a not-observed line's
// evidence directory carries the ACP transcript, and a launch that kept none fails by name instead of
// handing the next reader a verdict that says nothing.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'
import {
  NOT_OBSERVED, THE_ENGINE_LOGS, THE_TRANSCRIPT, messagesIn, refusalsIn, theRefusalOf, theVerdictKeptWithItsExchange,
} from './the_evidence_says_why.ts'
import { keepTheEngineLogs } from '../drive_the_trial.ts'
import type { Observation } from '../the_nine_lines.ts'

const made: string[] = []

/** A fresh evidence directory for one case, removed when the file's cases are done. */
function anEvidenceDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'martha-694-'))
  made.push(directory)
  return directory
}

after(() => {
  for (const directory of made) removeTheTree(directory)
})

/** What the driver writes for a line: the one field the rule reads, and the verdict's own words. */
function aVerdict(directory: string, verdict: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ verdict, say: 'what the line said' }))
}

/** One message in the transcript, as the driver appends it. */
function anExchange(directory: string, messages = 1): void {
  const lines = Array.from({ length: messages }, (_, index) =>
    JSON.stringify({ at: 1_700_000_000_000 + index, direction: index % 2 === 0 ? 'sent' : 'received', message: { jsonrpc: '2.0' } }))
  writeFileSync(join(directory, THE_TRANSCRIPT), `${lines.join('\n')}\n`)
}

test('a not-observed line with no transcript fails by name, naming the line (martha#694)', () => {
  const evidence = anEvidenceDirectory()
  const line = join(evidence, 'line-4')
  aVerdict(line, NOT_OBSERVED)

  const refusal = theRefusalOf(4, NOT_OBSERVED, line)
  assert.match(refusal ?? '', /^line 4: not-observed, and no ACP transcript was kept/)
  assert.deepEqual(refusalsIn(evidence), [`${refusal} (line-4)`])
})

test('an empty transcript is no transcript: a launch killed before its first message still has to say so (martha#694)', () => {
  const evidence = anEvidenceDirectory()
  const line = join(evidence, 'line-4')
  aVerdict(line, NOT_OBSERVED)
  writeFileSync(join(line, THE_TRANSCRIPT), '')

  assert.equal(messagesIn(line), 0)
  assert.notEqual(theRefusalOf(4, NOT_OBSERVED, line), undefined)
})

test('a not-observed verdict is judged on the verdict handed in, before any result.json exists (martha#694)', () => {
  const evidence = anEvidenceDirectory()
  const line = join(evidence, 'line-4')
  mkdirSync(line, { recursive: true })
  const observation: Observation = { verdict: NOT_OBSERVED, say: 'the line observed nothing: no answer within 240000 ms', evidence: {} }

  // Exactly as runLine calls it: result.json is written AFTER this call, so there is nothing on disk to read.
  const refused = theVerdictKeptWithItsExchange(4, observation, line)
  assert.equal(refused.verdict, 'fail', 'a not-observed verdict with no transcript is never handed on as not-observed')
  assert.match(refused.say, /line 4: not-observed, and no ACP transcript was kept/)

  anExchange(line, 1)
  assert.deepEqual(theVerdictKeptWithItsExchange(4, observation, line), observation, 'the twin: with a transcript beside it, a not-observed verdict stands')
})

test('a not-observed line that kept its exchange is exactly what the rule wants (martha#694)', () => {
  const evidence = anEvidenceDirectory()
  const line = join(evidence, 'line-4')
  aVerdict(line, NOT_OBSERVED)
  anExchange(line, 3)

  assert.equal(messagesIn(line), 3)
  assert.equal(theRefusalOf(4, NOT_OBSERVED, line), undefined)
  assert.deepEqual(refusalsIn(evidence), [])
})

test('every other verdict is left alone, whether or not a transcript was kept (martha#694)', () => {
  const evidence = anEvidenceDirectory()
  aVerdict(join(evidence, 'line-1'), 'pass')
  aVerdict(join(evidence, 'line-2'), 'fail')

  assert.deepEqual(refusalsIn(evidence), [])
})

test('a verdict the runner moved aside is read by the line it belongs to, and the launch is named (martha#694)', () => {
  const evidence = anEvidenceDirectory()
  const first = join(evidence, 'line-4-launch-1')
  aVerdict(first, NOT_OBSERVED)
  const second = join(evidence, 'line-4')
  aVerdict(second, NOT_OBSERVED)
  anExchange(second, 2)

  const refusals = refusalsIn(evidence)
  assert.equal(refusals.length, 1, 'only the launch that kept no exchange is refused')
  assert.match(refusals[0] ?? '', /^line 4: not-observed.*\(line-4-launch-1\)$/)
})

test('the driver keeps a not-observed verdict only when the exchange is beside it, and says why otherwise (martha#694)', () => {
  const evidence = anEvidenceDirectory()
  const line = join(evidence, 'line-4')
  aVerdict(line, NOT_OBSERVED)
  const observation: Observation = { verdict: NOT_OBSERVED, say: 'the line observed nothing: no answer within 240000 ms', evidence: { no_answer_within_ms: 240000 } }

  const refused = theVerdictKeptWithItsExchange(4, observation, line)
  assert.equal(refused.verdict, 'fail', 'a verdict that cannot be read is never handed on as not-observed')
  assert.match(refused.say, /no ACP transcript was kept/)
  assert.deepEqual(refused.evidence, { no_answer_within_ms: 240000 }, 'what the line did observe is still there')

  anExchange(line, 1)
  assert.deepEqual(theVerdictKeptWithItsExchange(4, observation, line), observation, 'with the exchange kept, the verdict stands')
})

test('a directory that holds no evidence says so, rather than passing silently (martha#694)', () => {
  const missing = join(anEvidenceDirectory(), 'not-there')
  assert.deepEqual(refusalsIn(missing), [`${missing} holds no evidence`])
})

test('the engine request logs are copied beside the transcript, and a launch that wrote none keeps none (martha#694)', () => {
  const place = anEvidenceDirectory()
  const root = join(place, 'goose-root')
  mkdirSync(join(root, 'state', 'logs'), { recursive: true })
  writeFileSync(join(root, 'state', 'logs', 'llm_request.1.jsonl'), '{"model":"the named one"}\n')
  writeFileSync(join(root, 'state', 'logs', 'llm_request.2.jsonl'), '{"model":"the named one"}\n')
  // The engine's own tracing log sits a folder down, as `goose acp` writes it: logs/cli/<date>/.
  mkdirSync(join(root, 'state', 'logs', 'cli', '2026-11-18'), { recursive: true })
  writeFileSync(join(root, 'state', 'logs', 'cli', '2026-11-18', 'goose.log'), '{"level":"INFO"}\n')
  writeFileSync(join(root, 'state', 'logs', 'cli', '2026-11-18', 'goose.2.log'), '{"level":"INFO"}\n')
  const into = join(place, 'line-4')
  mkdirSync(into, { recursive: true })

  assert.equal(keepTheEngineLogs(root, into), 4, 'both request logs and the two tracing logs a folder down are kept: the count is of files (4), never of entries (3), and it is what the result records')
  assert.equal(readFileSync(join(into, THE_ENGINE_LOGS, 'llm_request.2.jsonl'), 'utf8'), '{"model":"the named one"}\n')

  const quiet = join(place, 'goose-root-quiet')
  mkdirSync(quiet, { recursive: true })
  assert.equal(keepTheEngineLogs(quiet, into), 0, 'a launch that asked the model nothing keeps nothing')
})

/** The two entries the rule is reached through, run as a run runs them. */
const THE_CHECK = join(import.meta.dirname, 'check_the_trial_evidence.ts')
const THE_DRIVER = join(import.meta.dirname, '..', 'drive_the_trial.ts')

test('the check, through its own entry, refuses a not-observed line with no transcript by name (martha#694)', () => {
  const evidence = anEvidenceDirectory()
  aVerdict(join(evidence, 'line-4'), NOT_OBSERVED)

  const ran = spawnSync(process.execPath, [THE_CHECK, '--dir', evidence], { encoding: 'utf8' })

  assert.equal(ran.status, 1, 'a directory that cannot say why it observed nothing is a red check')
  assert.match(ran.stderr, /line 4: not-observed, and no ACP transcript was kept, so the run cannot say why \(line-4\)/)
})

test('the check passes a not-observed line that kept its transcript, and says what it judged (martha#694)', () => {
  const evidence = anEvidenceDirectory()
  const line = join(evidence, 'line-4')
  aVerdict(line, NOT_OBSERVED)
  anExchange(line)

  const ran = spawnSync(process.execPath, [THE_CHECK, '--dir', evidence], { encoding: 'utf8' })

  assert.equal(ran.status, 0, ran.stderr)
  assert.match(ran.stdout, /holds no line that ended not-observed without its transcript/)
})

test('a directory that is not there is a check that could not be made, never a pass (martha#694)', () => {
  const ran = spawnSync(process.execPath, [THE_CHECK, '--dir', join(anEvidenceDirectory(), 'no-such-line')], { encoding: 'utf8' })

  assert.equal(ran.status, 2)
  assert.match(ran.stderr, /the check could not be made/)
})

test('the check plants the line with no transcript and its twin, and requires both answers (martha#694)', () => {
  const ran = spawnSync(process.execPath, [THE_CHECK, '--self-test'], { encoding: 'utf8' })

  assert.equal(ran.status, 0, ran.stderr)
  assert.match(ran.stdout, /a line with no transcript is refused by name, and one with it passes/)
})

test('the driver judges a whole evidence directory on its own, so a reviewer needs no launch (martha#694)', () => {
  const evidence = anEvidenceDirectory()
  aVerdict(join(evidence, 'line-4'), NOT_OBSERVED)

  const ran = spawnSync(process.execPath, [THE_DRIVER, '--check-evidence', evidence], { encoding: 'utf8' })

  assert.equal(ran.status, 1)
  assert.match(ran.stderr, /line 4: not-observed, and no ACP transcript was kept/)
})
