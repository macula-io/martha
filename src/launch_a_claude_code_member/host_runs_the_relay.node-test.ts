// The host's answers are read strictly: anything but a report of success refuses (#104).

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import {
  firstValidatorError,
  hostVersionLine,
  notACommandThisLauncherCanRun,
  refusalToLoadTheRelay,
  resolvedHostCommand,
  versionIn,
} from './host_runs_the_relay.ts'
import { hostAnswers, LOADS_THE_RELAY, refusesTheRelay } from './host_stand_in.ts'

function placeFor(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-host-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function standIn(dir: string, lines: readonly string[], name = 'claude'): string {
  const file = join(dir, name)
  writeFileSync(file, ['#!/bin/sh', ...lines, 'exit 9', ''].join('\n'), { mode: 0o700 })
  return file
}

const RELAY = '/the/relay'

test('the first error is the manifest\'s, then each content file\'s, then the refusal of the whole plugin', () => {
  const with_ = (manifest: string[], contents: string[][], digestRefusal?: string) => ({
    success: false,
    manifest: { errors: manifest.map((message) => ({ message })) },
    contents: contents.map((errors) => ({ errors: errors.map((message) => ({ message })) })),
    ...(digestRefusal === undefined ? {} : { digestRefusal }),
  })
  assert.equal(firstValidatorError(with_(['m1'], [['c1']], 'd')), 'm1')
  assert.equal(firstValidatorError(with_([], [[], ['c2', 'c3']], 'd')), 'c2')
  assert.equal(firstValidatorError(with_([], [], 'd')), 'd')
  assert.equal(firstValidatorError(with_([], [])), undefined)
  assert.equal(firstValidatorError('not a report'), undefined)
})

test('a version is read only from the start of what --version prints', () => {
  assert.equal(versionIn('2.1.319 (Claude Code)\n'), '2.1.319')
  assert.equal(versionIn('2.1.319\n'), '2.1.319')
  assert.equal(versionIn('Claude Code 2.1.319'), undefined)
  assert.equal(versionIn('2.1.3190x'), undefined)
  assert.equal(versionIn(''), undefined)
})

test('a command resolves once, to the file its link names: first runnable on PATH, empty entry is the directory, a path is that path', (t) => {
  const dir = placeFor(t)
  const real = standIn(dir, [], 'real-claude')
  const notRunnable = join(dir, 'a')
  mkdirSync(notRunnable)
  writeFileSync(join(notRunnable, 'claude'), '#!/bin/sh\n', { mode: 0o600 })
  const linked = join(dir, 'b')
  mkdirSync(linked)
  symlinkSync(real, join(linked, 'claude'))
  assert.deepEqual(resolvedHostCommand('claude', `${notRunnable}:${linked}`, dir), { binary: realpathSync(real) })
  assert.deepEqual(resolvedHostCommand('claude', `:${linked}`, linked), { binary: realpathSync(real) })
  assert.deepEqual(resolvedHostCommand('./real-claude', undefined, dir), { binary: realpathSync(real) })
  assert.deepEqual(resolvedHostCommand('claude', notRunnable, dir), { refusal: notACommandThisLauncherCanRun('claude') })
  assert.deepEqual(resolvedHostCommand('claude', undefined, dir), { refusal: notACommandThisLauncherCanRun('claude') })
  assert.deepEqual(resolvedHostCommand(notRunnable, undefined, dir), { refusal: notACommandThisLauncherCanRun(notRunnable) })
})

test('only a report of success with exit 0 loads the relay; every other answer refuses, naming the relay', async (t) => {
  const dir = placeFor(t)
  const answer = async (lines: readonly string[]) => refusalToLoadTheRelay(standIn(dir, lines), RELAY, {}, dir)
  assert.equal(await answer(hostAnswers()), undefined)
  const cases: [string, readonly string[], RegExp][] = [
    ['a refusal', hostAnswers({ report: refusesTheRelay('the reason') }), /the reason/],
    ['success with a failing exit', hostAnswers({ report: LOADS_THE_RELAY, reportExit: 1 }), /no reason \(exit 1\)/],
    ['no JSON', hostAnswers({ report: 'nope', reportExit: 0 }), /not the JSON report/],
    ['a failure with no reason', hostAnswers({ report: '{"success":false}' }), /no reason \(exit 1\)/],
    ['a host that dies on a signal', ['kill -s KILL $$'], /ended on SIGKILL/],
  ]
  for (const [what, lines, why] of cases) {
    const refusal = (await answer(lines)) ?? ''
    assert.match(refusal, why, what)
    assert.ok(refusal.includes(RELAY), what)
  }
  assert.match((await refusalToLoadTheRelay(join(dir, 'gone'), RELAY, {}, dir)) ?? '', /could not be run/)
})

test('the version line is told only when the host is not the recorded version, naming both', async (t) => {
  const dir = placeFor(t)
  assert.equal(await hostVersionLine(standIn(dir, hostAnswers()), {}, dir), undefined)
  const other = await hostVersionLine(standIn(dir, hostAnswers({ version: '999.0.0' })), {}, dir)
  assert.ok(other?.includes('999.0.0') && other.includes(RECORDED_HOST.host_version), String(other))
  const silent = await hostVersionLine(standIn(dir, []), {}, dir)
  assert.ok(silent?.includes(RECORDED_HOST.host_version) && silent.includes('does not say'), String(silent))
})
