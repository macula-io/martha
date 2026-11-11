// The installer's package.json overrides glob and minimatch under the bundled sigstore to their first patched releases
// (martha#110). Their only callers are cacache, which globs its cache, and @tufjs/models, which matches a delegated
// role's paths. This calls both through the installed tree, offline, so a bump that changes either call shape fails
// here rather than in an owner's install.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { removeTheTree } from '../../src/launch_a_claude_code_member/relay_copy.ts'

const require = createRequire(import.meta.url)
// The two call sites, resolved from the installer the way the bundled sigstore resolves them. DelegatedRole is not in
// @tufjs/models' index, so its own module is loaded; the ids are held in names so they load as the untyped CommonJS
// they are.
const CACACHE_GLOB = 'cacache/lib/util/glob.js'
const TUF_ROLE = '@tufjs/models/dist/role.js'
const cacacheGlob = require(CACACHE_GLOB)
const { DelegatedRole } = require(TUF_ROLE)

/**
 * What cacache needs of glob: an awaited call with a pattern and options gives the matching paths as an array.
 * @param {(pattern: string, options: object) => unknown} glob
 */
async function globKeepsItsShape (glob) {
  const dir = mkdtempSync(join(tmpdir(), 'martha-bundled-glob-'))
  try {
    writeFileSync(join(dir, 'index-a.json'), '{}')
    writeFileSync(join(dir, 'content-b.txt'), '')
    const found = await glob(join(dir, '*.json'), {})
    assert.ok(Array.isArray(found), 'glob(pattern, options) resolves to an array')
    assert.deepEqual(found, [join(dir, 'index-a.json')])
  } finally {
    removeTheTree(dir)
  }
}

/**
 * What @tufjs/models needs of minimatch: a delegated role's path pattern matches a target, and refuses another.
 * @param {new (opts: object) => { isDelegatedPath: (target: string) => boolean }} Role
 */
function delegatedPathsKeepTheirShape (Role) {
  const role = new Role({ name: 'targets-json', keyIDs: ['k'], threshold: 1, terminating: false, paths: ['targets/*.json'] })
  assert.equal(role.isDelegatedPath('targets/a.json'), true, 'a target matching the pattern is delegated')
  assert.equal(role.isDelegatedPath('targets/a.txt'), false, 'a target outside the pattern is not')
  assert.equal(role.isDelegatedPath('other/a.json'), false, 'a target in another folder is not')
}

test("cacache's glob, through the bundled glob, gives the matching paths", async () => {
  await globKeepsItsShape(cacacheGlob)
})

test("a delegated role's paths, through the bundled minimatch, match and refuse", () => {
  delegatedPathsKeepTheirShape(DelegatedRole)
})

test('the checks bite on the old call shapes', async () => {
  // glob 7 answered a call without a callback with a Glob emitter, not a promise of the paths.
  const oldGlob = () => ({ on: () => undefined })
  await assert.rejects(globKeepsItsShape(oldGlob), /resolves to an array/)
  // minimatch 3 exported the function itself, with no named minimatch, so the role's match throws.
  class OldRole {
    /** @param {string} target */
    isDelegatedPath (target) { return /** @type {any} */ ({}).minimatch(target, '') }
  }
  assert.throws(() => delegatedPathsKeepTheirShape(OldRole), TypeError)
})
