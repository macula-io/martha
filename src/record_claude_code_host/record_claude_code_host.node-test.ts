// The drift check bites (martha#139): `--check` passes on a host that says what
// the committed recording says, and fails, naming the field, on one that does
// not. CI runs this file in its own job on every PR, with no host installed: the
// host is a text made of the recording's own parts, so the checker is proven on
// every tip and only the scheduled comparison depends on a release.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'

const RECORDER = fileURLToPath(new URL('./record_claude_code_host.ts', import.meta.url))
const RECORDING = new URL('../claude_code_host/recorded_claude_code_host.json', import.meta.url)
const CHECK = '--check'

/**
 * The committed recording's parts as a host binary holds them, by field. Each
 * text part is the host's own code as recorded; the managed settings place,
 * which is recorded as values, is written back in the shapes the host spells it.
 */
const RECORDED_PARTS: Readonly<Record<string, string>> = {
  session_start_schema: RECORDED_HOST.session_start_schema,
  prompt_origin_mapper: RECORDED_HOST.prompt_origin_mapper,
  prompt_origin_fallback: RECORDED_HOST.prompt_origin_fallback,
  prompt_origin_subkinds: RECORDED_HOST.prompt_origin_subkinds,
  hooks_switches: RECORDED_HOST.hooks_switches,
  hooks_switch_calls: RECORDED_HOST.hooks_switch_calls.join(';'),
  managed_settings: [
    `switch(P()){case"windows":return"C:\\\\ClaudeCode";default:return"${RECORDED_HOST.managed_settings.dir}"}`,
    `getDropInDir(){return this.dropInDir??=qC(LS(),"${RECORDED_HOST.managed_settings.drop_in}")`,
    `function jw(){return Ce(LS(),"${RECORDED_HOST.managed_settings.file}")}`,
  ].join(';'),
}

/** A host text holding `parts`, written to a scratch file the test removes. */
function hostHolding(t: TestContext, parts: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'martha-host-drift-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const host = join(root, 'claude')
  writeFileSync(host, `#!junk\n${Object.values(parts).join(';other code;')}\n`, 'latin1')
  return host
}

/** `--check` run on a host text, as the drift job runs it. */
function check(host: string, version: string): { status: number | null; stdout: string } {
  const run = spawnSync(process.execPath, [RECORDER, CHECK, host, version], { encoding: 'utf8' })
  return { status: run.status, stdout: run.stdout }
}

/** A version that differs from the recorded one in its patch number. */
function anotherVersion(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number)
  return [major, minor, (patch ?? 0) + 1].join('.')
}

test('a host that says what the recording says passes the check, and the recording is left as it was', (t) => {
  const before = readFileSync(RECORDING)
  const run = check(hostHolding(t, RECORDED_PARTS), RECORDED_HOST.host_version)
  assert.equal(run.status, 0, run.stdout)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\n`)
  assert.deepEqual(readFileSync(RECORDING), before)
})

test('a host whose code differs fails the check, naming the field and nothing of the host\'s code', (t) => {
  const planted = RECORDED_HOST.prompt_origin_subkinds.replace('"projects-relay"', '"projects-relay","session-inbox"')
  assert.notEqual(planted, RECORDED_HOST.prompt_origin_subkinds, 'the planted set differs')
  const run = check(hostHolding(t, { ...RECORDED_PARTS, prompt_origin_subkinds: planted }), RECORDED_HOST.host_version)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\ndiffers: prompt_origin_subkinds\n`)
})

test('a host of another version fails the check by its version alone, even when its code is the same', (t) => {
  const other = anotherVersion(RECORDED_HOST.host_version)
  const run = check(hostHolding(t, RECORDED_PARTS), other)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${other}\ndiffers: host_version\n`)
})

test('a host the recorder cannot read fails the check, naming the part', (t) => {
  const { prompt_origin_mapper: _mapper, ...withoutMapper } = RECORDED_PARTS
  const run = check(hostHolding(t, withoutMapper), RECORDED_HOST.host_version)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, `recorded ${RECORDED_HOST.host_version}, host ${RECORDED_HOST.host_version}\nunreadable: prompt origins\n`)
})
