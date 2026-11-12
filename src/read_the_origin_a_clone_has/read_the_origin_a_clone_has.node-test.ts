// The origin a clone has (martha#256, slices 1 and 2).
//
// What is pinned here: that an origin URL is read in each of the four forms git writes one in, and that a URL which
// names no repository is refused rather than shortened into one — a package of another repository must never pass for
// one of this clone's. The rest is read from a throwaway origin and a clone of it, so the answer is what git really
// says: the repository and the default branch, and, when the clone cannot say, the command that fixes it.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { readTheOriginACloneHas, repoOfTheOrigin } from './read_the_origin_a_clone_has.ts'

const ORG_AND_NAME = 'acme/widget'

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync(GIT, [...args], { cwd, encoding: 'utf8' }).trim()

/** A real git, so a test sees what git does rather than what a stand-in is told to say. */
const runReal = async (request: ProcessRequest): Promise<ProcessOutcome> => {
  const outcome = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
  return { exit_code: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr }
}

/** A bare origin at `<root>/acme/widget.git`, and a clone of it at `<root>/clone`. */
function aClone(t: TestContext): { readonly origin: string; readonly clone: string } {
  const root = mkdtempSync(join(tmpdir(), 'martha-256-origin-'))
  t.after(() => removeTheTree(root))
  const origin = join(root, ORG_AND_NAME.concat('.git'))
  mkdirSync(join(origin, '..'), { recursive: true })
  execFileSync(GIT, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  const seed = join(root, 'seed')
  mkdirSync(seed)
  gitIn(seed, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(seed, 'README.md'), '# widget\n')
  gitIn(seed, 'add', '-A')
  gitIn(seed, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '-m', 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  const clone = join(root, 'clone')
  execFileSync(GIT, ['clone', '--quiet', origin, clone])
  return { origin, clone }
}

const toldBy = async (clone: string) => readTheOriginACloneHas(hostForTests({ run: runReal }).host, clone)

test('#256: an origin URL is read in each of the four forms git writes one in', () => {
  const forms = [
    `git@github.com:${ORG_AND_NAME}.git`,
    `ssh://git@github.com/${ORG_AND_NAME}.git`,
    `https://github.com/${ORG_AND_NAME}.git`,
    `file:///clones/${ORG_AND_NAME}`,
    `/clones/${ORG_AND_NAME}`,
  ]
  for (const form of forms) assert.equal(repoOfTheOrigin(form), ORG_AND_NAME, `${form} was not read as ${ORG_AND_NAME}`)
})

test('#256: a URL that names no repository is refused rather than shortened into one', () => {
  const nameless = ['', 'nonsense', 'https://github.com/acme', 'https://github.com/acme/..', 'nonsense/acme wid']
  for (const url of nameless) assert.equal(repoOfTheOrigin(url), undefined, `${JSON.stringify(url)} was taken for a repository`)
})

test('#256: a clone is of the repository and the default branch its origin names', async (t) => {
  const { clone } = aClone(t)
  assert.deepEqual(await toldBy(clone), { origin: { repo: ORG_AND_NAME, default_branch: 'origin/main' } })
})

test('#256: a clone with no origin remote is refused, with the command that gives it one', async (t) => {
  const { clone } = aClone(t)
  gitIn(clone, 'remote', 'remove', 'origin')
  const told = await toldBy(clone)
  assert.ok('refused' in told, `a clone with no origin was read as one: ${JSON.stringify(told)}`)
  assert.match(told.refused, /names no origin remote/)
  assert.match(told.refused, /git remote add origin/)
})

test('#256: an origin that names no repository is refused, naming what it says', async (t) => {
  const { clone } = aClone(t)
  const nameless = 'https://github.com/acme'
  gitIn(clone, 'remote', 'set-url', 'origin', nameless)
  const told = await toldBy(clone)
  assert.ok('refused' in told, `an origin that names no repository was taken for one: ${JSON.stringify(told)}`)
  assert.match(told.refused, /names no repository as org\/name/)
  assert.match(told.refused, new RegExp(nameless.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('#256: a clone that keeps no ref for its origin\'s head is refused, with the command that sets it', async (t) => {
  const { clone } = aClone(t)
  gitIn(clone, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
  const told = await toldBy(clone)
  assert.ok('refused' in told, `a clone with no origin head was read as one: ${JSON.stringify(told)}`)
  assert.match(told.refused, /cannot say which branch its origin's default is/)
  assert.match(told.refused, /git remote set-head origin -a/)
})
