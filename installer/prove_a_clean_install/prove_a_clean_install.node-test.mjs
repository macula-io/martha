// The clean-install proof's install-and-tear-down half (martha#69), against a local release of the committed tree:
// it installs on a box that starts empty, checks what landed on disk, and leaves nothing behind, whether the install
// passed or was refused.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { removeEvenReadOnly } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { proveACleanInstall } from './prove_a_clean_install.mjs'

const SCRIPT = fileURLToPath(new URL('./prove_a_clean_install.mjs', import.meta.url))

/** @param {string} base */
const stillListening = (base) => new Promise((resolve) => {
  const { hostname, port } = new URL(base)
  const socket = connect(Number(port), hostname)
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})

/** @param {import('node:test').TestContext} t */
const scratch = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-clean-install-test-'))
  t.after(() => removeEvenReadOnly(dir))
  return dir
}

test('installs the committed tree on an empty box, checks the disk, then removes the box and stops the registry', async () => {
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({ log: (line) => lines.push(line) })
  assert.equal(result.passed, true, lines.join('\n'))
  assert.ok(!existsSync(result.box), 'the box is gone')
  assert.equal(await stillListening(result.registry), false, 'the registry no longer answers')
  for (const step of ['pack', 'serve', 'install', 'on disk', 'tear down']) {
    assert.ok(lines.some((l) => l.includes(`ok ${step}:`)), `the log has a passed "${step}" step\n${lines.join('\n')}`)
  }
  assert.match(lines.join('\n'), /stood in/, 'the log says the signature check was stood in')
})

test('a refused install fails the run and still leaves nothing behind', async () => {
  /** @type {string[]} */
  const lines = []
  const result = await proveACleanInstall({ log: (line) => lines.push(line), signedFor: 'refs/heads/main' })
  assert.equal(result.passed, false)
  assert.ok(lines.some((l) => /^FAIL install: .*refs\/heads\/main/.test(l)), lines.join('\n'))
  assert.ok(!lines.some((l) => l.includes('ok on disk:')), 'nothing is checked on disk after a refusal')
  assert.ok(lines.some((l) => l.includes('ok tear down:')), lines.join('\n'))
  assert.ok(!existsSync(result.box), 'the box is gone')
  assert.equal(await stillListening(result.registry), false, 'the registry no longer answers')
})

test('run as a command, it writes the log where it is told and exits 0 on a pass', (t) => {
  const log = join(scratch(t), 'clean-install.log')
  const run = spawnSync(process.execPath, [SCRIPT, '--log', log], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const written = readFileSync(log, 'utf8')
  assert.match(written, /^ok tear down:/m)
  assert.match(written, /^passed$/m)
})

test('run as a command, it refuses an option it does not know with exit 2 and starts nothing', () => {
  const run = spawnSync(process.execPath, [SCRIPT, '--cloud'], { encoding: 'utf8' })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /^prove_a_clean_install: unknown option '--cloud'/)
})
