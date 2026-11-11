import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { OWN_WRITE_MODES } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { buildTheRunDirectory, runInTheSandbox, sandboxRefusal, type RunCopy } from './run_in_a_sandbox.ts'
import { SANDBOX_REQUIRED_VARIABLE, skipWithoutTheSandbox } from './sandbox_under_test.ts'

const [REGULAR] = OWN_WRITE_MODES
const MARKER = 'stranger-marker-129'
const unavailable = skipWithoutTheSandbox()

/** A run directory built from `copy` in a fresh parent; removed after the test. */
function runDirectory(t: { after(fn: () => void): void }, copy: Partial<RunCopy> = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'martha-129-run-'))
  t.after(() => removeTheTree(parent))
  const built = buildTheRunDirectory(parent, { files: [], packages: [], bin_links: [], ...copy })
  if (typeof built === 'string') throw new Error(built)
  return built
}

const file = (path: string, text: string) => ({ path, mode: REGULAR, bytes: Buffer.from(text) })
const text = (ended: Awaited<ReturnType<typeof runInTheSandbox>>) => (typeof ended === 'string' ? ended : ended.output.toString('utf8'))

test('stdout and stderr reach the one stream in the order the run wrote them', { skip: unavailable }, async (t) => {
  const ended = await runInTheSandbox(runDirectory(t), ['/bin/sh', '-c', 'echo a; echo b >&2; echo c'])
  assert.ok(typeof ended !== 'string', String(ended))
  assert.equal(ended.output.toString('utf8'), 'a\nb\nc\n')
  assert.equal(ended.status, 0)
})

test('the run sees its copy and no repository, and ends with its own status', { skip: unavailable }, async (t) => {
  const ended = await runInTheSandbox(runDirectory(t, { files: [file('a.txt', 'mine\n')] }), ['/bin/sh', '-c', 'cat a.txt; ls -a; exit 3'])
  assert.ok(typeof ended !== 'string', String(ended))
  assert.equal(ended.status, 3)
  assert.equal(ended.output.toString('utf8'), 'mine\n.\n..\na.txt\n')
})

test('the network, the real home, /tmp, the launcher environment and anything not copied stay out of the run', { skip: unavailable }, async (t) => {
  const server = createServer((_request, response) => response.end(MARKER))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const port = (server.address() as { port: number }).port
  const outside = mkdtempSync(join(homedir(), '.martha-129-home-'))
  t.after(() => removeTheTree(outside))
  writeFileSync(join(outside, 'secret'), MARKER)
  const in_tmp = mkdtempSync(join(tmpdir(), 'martha-129-tmp-'))
  t.after(() => removeTheTree(in_tmp))
  writeFileSync(join(in_tmp, 'secret'), MARKER)
  process.env['MARTHA_129_MARKER'] = MARKER
  t.after(() => delete process.env['MARTHA_129_MARKER'])
  const probe = `
    const net = require('node:net'); const fs = require('node:fs')
    for (const p of [${JSON.stringify(join(outside, 'secret'))}, ${JSON.stringify(join(in_tmp, 'secret'))}, 'node_modules/.cache/secret']) {
      try { process.stdout.write(fs.readFileSync(p, 'utf8')) } catch (e) { console.log('no', e.code) }
    }
    console.log(JSON.stringify(process.env))
    net.connect(${port}, '127.0.0.1').on('data', (d) => console.log(String(d))).on('error', (e) => console.log('no', e.code))`
  const ended = await runInTheSandbox(runDirectory(t, { files: [file('probe.cjs', probe)] }), ['node', 'probe.cjs'])
  const said = text(ended)
  assert.equal(said.includes(MARKER), false, said)
  assert.match(said, /no ENOENT/)
  assert.match(said, /no E(CONNREFUSED|NETUNREACH)/)
})

test('a .npmrc in the tree does not choose the shell npm runs scripts with', { skip: unavailable }, async (t) => {
  const run = runDirectory(t, {
    files: [
      file('package.json', JSON.stringify({ name: 'p', version: '1.0.0', scripts: { test: 'echo tested' } })),
      file('.npmrc', 'script-shell=./evil.sh\n'),
      { path: 'evil.sh', mode: OWN_WRITE_MODES[1], bytes: Buffer.from(`#!/bin/sh\necho ${MARKER}\n`) },
    ],
  })
  const said = text(await runInTheSandbox(run, ['npm', 'test']))
  assert.match(said, /tested/)
  assert.equal(said.includes(MARKER), false, said)
})

test('every bin name gets a link inside its package, and the run calls each one', { skip: unavailable }, async (t) => {
  const tool = (name: string) => ({ path: `node_modules/tool/bin/${name}`, executable: false, bytes: Buffer.from(`#!/bin/sh\necho ${name}-ran\n`) })
  const run = runDirectory(t, {
    packages: [tool('one'), tool('two')],
    bin_links: [
      { link: 'node_modules/.bin/one', target: 'node_modules/tool/bin/one', points_at: '../tool/bin/one' },
      { link: 'node_modules/.bin/two', target: 'node_modules/tool/bin/two', points_at: '../tool/bin/two' },
    ],
  })
  const ended = await runInTheSandbox(run, ['/bin/sh', '-c', 'node_modules/.bin/one && node_modules/.bin/two'])
  assert.ok(typeof ended !== 'string', String(ended))
  assert.equal(ended.output.toString('utf8'), 'one-ran\ntwo-ran\n')
  assert.equal(ended.status, 0)
})

test('a bin link whose target was not copied builds no run directory', (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'martha-129-run-'))
  t.after(() => removeTheTree(parent))
  mkdirSync(join(parent, 'x'))
  const built = buildTheRunDirectory(parent, { files: [], packages: [], bin_links: [{ link: 'node_modules/.bin/x', target: 'node_modules/x/cli', points_at: '../x/cli' }] })
  assert.match(String(built), /not a file of its package/)
})

test('a run past its deadline is killed, and its status says so', { skip: unavailable }, async (t) => {
  const ended = await runInTheSandbox(runDirectory(t), ['/bin/sh', '-c', 'sleep 30'], 200)
  assert.ok(typeof ended !== 'string', String(ended))
  assert.equal(ended.status, 137)
})

test('where the sandbox is required, it is there: a run is never skipped in silence', { skip: process.env[SANDBOX_REQUIRED_VARIABLE] === '1' ? false : 'the sandbox is not required here' }, () => {
  assert.equal(sandboxRefusal(), undefined)
})
