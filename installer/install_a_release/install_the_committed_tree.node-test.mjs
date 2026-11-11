// The installer links the command the committed tree carries (martha#98): the release layer here is the tree
// pack_a_release.sh packs, `git archive` of HEAD under martha/, so the command linked is the real bin/martha, and
// running it through the link answers with the version that tree's package.json carries.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'

import { removeTheTree } from '../../src/launch_a_claude_code_member/relay_copy.ts'
import { SIGNER, release, scratchMachine, serveRegistry, sigstoreStandIn } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { installRelease } from './install_a_release.mjs'

const REPOSITORY = join(import.meta.dirname, '..', '..')
const VERSION = '1.2.0'

/**
 * The committed tree as a release layer: what pack_a_release.sh copies into the image, export-ignore honoured. It is
 * unpacked and packed again because git archive opens with a pax global header, which a COPY into an image never has.
 * @param {string} scratch
 */
const committedTree = (scratch) => {
  execFileSync('git', ['archive', '--format=tar', '--prefix=martha/', `--output=${join(scratch, 'tree.tar')}`, 'HEAD'], { cwd: REPOSITORY })
  execFileSync('tar', ['-x', '-f', 'tree.tar'], { cwd: scratch })
  return gzipSync(execFileSync('tar', ['--format=gnu', '-c', '-f', '-', 'martha'], { cwd: scratch, maxBuffer: 1 << 28 }))
}

test('the committed tree carries martha/bin/martha, and the command linked from it runs', async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-committed-tree-'))
  t.after(() => removeTheTree(scratch))
  const r = release({ version: VERSION, gzipped: committedTree(scratch) })
  const registry = await serveRegistry([r])
  const machine = scratchMachine()
  t.after(async () => { await registry.close(); machine.close() })
  const signed = new Map([[r.digest, { ref: `refs/tags/v${VERSION}` }]])
  await installRelease({ places: machine.places, base: registry.base, signers: [SIGNER], makeVerifier: sigstoreStandIn(signed), log: () => {}, version: VERSION })

  const command = join(machine.places.binDir, 'martha')
  assert.equal(realpathSync(command), realpathSync(join(machine.places.current, 'martha', 'bin', 'martha')))
  const committed = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { cwd: REPOSITORY, encoding: 'utf8' }))
  const run = spawnSync(process.execPath, [command, '--version'], { encoding: 'utf8', env: { PATH: process.env['PATH'] } })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, `${committed.version}\n`)
})
