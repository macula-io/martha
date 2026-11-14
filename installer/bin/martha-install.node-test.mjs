// The installer as npm ships it (martha#21): packed, unpacked under a node_modules path, and run from there, as npx
// runs it. Node refuses to strip types under node_modules, so a .ts file in the package would fail only here; the
// package carries sigstore bundled, and nothing the tests use.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { removeEvenReadOnly } from '../serve_a_release_locally/serve_a_release_locally.mjs'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))

test('the packed installer runs from under node_modules, ships .mjs only, and carries sigstore', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-install-packed-'))
  t.after(() => removeEvenReadOnly(scratch))
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratch], { cwd: PACKAGE, encoding: 'utf8' }))
  const files = packed.files.map((/** @type {{ path: string }} */ f) => f.path)
  assert.ok(files.includes('node_modules/sigstore/package.json'), 'sigstore is bundled')
  const own = files.filter((/** @type {string} */ f) => !f.startsWith('node_modules/'))
  assert.deepEqual(own.filter((/** @type {string} */ f) => /\.(c|m)?ts$/.test(f)), [], 'no TypeScript file is shipped')
  assert.deepEqual(own.filter((/** @type {string} */ f) => /node-test|serve_a_release_locally/.test(f)), [], 'no test or fixture is shipped')
  const installed = join(scratch, 'node_modules', '@macula-io', 'martha')
  mkdirSync(installed, { recursive: true })
  execFileSync('tar', ['-xzf', join(scratch, packed.filename), '-C', installed, '--strip-components=1'])
  const bin = join(installed, 'bin', 'martha-install.mjs')
  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /^usage: martha-install \[<version>\]/)
  const refused = spawnSync(process.execPath, [bin, '--latest'], { encoding: 'utf8' })
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /^martha-install: unknown option '--latest'/)
  // The bootstrap line reaches the same floor checks as `martha install` (martha#21): the switch is the installer's own.
  assert.match(help.stdout, /\[--withdrawal-in <version>\]/)
  const unnamed = spawnSync(process.execPath, [bin, '--withdrawal-in', '2.1.0'], { encoding: 'utf8', env: { PATH: process.env['PATH'], HOME: scratch } })
  assert.equal(unnamed.status, 1)
  assert.match(unnamed.stderr, /^martha-install: --withdrawal-in needs the version it withdraws to; name it/)
})
