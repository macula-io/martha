// The entry's answers, read the way a runner reads them: the process spawned, its status, and the words it printed
// (martha#562, package 2). Every case asserts an exact line and the status, never the status alone: `node` on an entry
// that is missing — or one that throws after printing nothing — exits 1, so a status on its own would pass the drift
// cases without the check ever having said a word.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { soloDeclaration } from '../declare_crew/declare_crew.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'

const ENTRY = join(dirname(import.meta.dirname), 'check_the_workspace_matches_its_layout', 'main.ts')
const NAME = 'check_the_workspace_matches_its_layout'

/** A workspace a crew declared: `<root>/clones/acme/widget`, `<root>/worktrees`, and the declaration that names both. */
interface APlantedWorkspace {
  readonly root: string
  readonly clones: string
  readonly worktrees: string
  readonly clone: string
}

const gitIn = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', ['-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

/** The declaration a crew writes, in the shape the reader accepts: `soloDeclaration` is the writer's own. */
const declareTheLayout = (root: string, clones: string, worktrees: string): void => {
  mkdirSync(join(root, '.martha'), { recursive: true })
  writeFileSync(join(root, '.martha', 'martha.json'), JSON.stringify(soloDeclaration('the owner', { clones, worktrees }), null, 2))
}

/** A clean clone of one repository, on the default branch its origin starts on, with the layout declared around it. */
function aPlantedWorkspace(t: TestContext): APlantedWorkspace {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-562-entry-')))
  t.after(() => removeTheTree(root))
  const origin = join(root, 'origin.git')
  const clones = join(root, 'clones')
  const worktrees = join(root, 'worktrees')
  const seed = join(root, 'seed')
  mkdirSync(join(clones, 'acme'), { recursive: true })
  mkdirSync(worktrees)
  mkdirSync(seed)
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  gitIn(seed, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(seed, 'README.md'), '# widget\n')
  gitIn(seed, 'add', '-A')
  gitIn(seed, 'commit', '--quiet', '-m', 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  gitIn(clones, 'clone', '--quiet', origin, join('acme', 'widget'))
  const clone = join(clones, 'acme', 'widget')
  gitIn(clone, 'remote', 'set-head', 'origin', '--auto')
  declareTheLayout(root, clones, worktrees)
  return { root, clones, worktrees, clone }
}

/** The entry run over a workspace, as a runner runs it: the status and both streams, kept apart. */
const running = (workspace: string): { readonly status: number | null; readonly out: string; readonly err: string } => {
  const ended = spawnSync(process.execPath, [ENTRY, '--workspace', workspace], { encoding: 'utf8' })
  return { status: ended.status, out: ended.stdout ?? '', err: ended.stderr ?? '' }
}

test('a workspace that matches the layout its crew declared answers 0 with its own name', (t) => {
  const planted = aPlantedWorkspace(t)
  const { status, err } = running(planted.root)
  assert.equal(err, `${NAME}: the workspace matches its layout\n`)
  assert.equal(status, 0)
})

test('a clone off its default branch answers 1 with the exact line, and the summary that carries the check name', (t) => {
  const planted = aPlantedWorkspace(t)
  gitIn(planted.clone, 'checkout', '--quiet', '-b', 'a-branch')
  const { status, err } = running(planted.root)
  assert.equal(
    err,
    `${planted.clone} is on a-branch, and a clone stays on main: a branch's work belongs in a worktree.\n` +
      `${NAME}: 1 line(s) above: the workspace drifts from its layout\n`,
  )
  assert.equal(status, 1)
})

test('one repository cloned twice answers 1 with the exact line naming both clones', (t) => {
  const planted = aPlantedWorkspace(t)
  const second = join(planted.clones, 'acme', 'widget-again')
  gitIn(planted.clones, 'clone', '--quiet', gitIn(planted.clone, 'remote', 'get-url', 'origin'), second)
  // The pair is named by its repository, so both clones carry an origin that names one.
  for (const clone of [planted.clone, second]) gitIn(clone, 'remote', 'set-url', 'origin', 'https://example.invalid/acme/widget.git')
  const { status, err } = running(planted.root)
  assert.equal(
    err,
    `acme/widget is cloned 2 times (${planted.clone}, ${second}): one clone per repository.\n` +
      `${NAME}: 1 line(s) above: the workspace drifts from its layout\n`,
  )
  assert.equal(status, 1)
})

test('a directory that declares no layout answers 0 with the nothing-declared line, never a silent 0', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-562-entry-')))
  t.after(() => removeTheTree(root))
  const { status, err } = running(root)
  assert.equal(err, `${NAME}: no crew declared a workspace layout, so there is nothing to check\n`)
  assert.equal(status, 0)
})

test('a crew that turned the layout off answers the same nothing-declared line', (t) => {
  const planted = aPlantedWorkspace(t)
  writeFileSync(join(planted.root, '.martha', 'martha.json'), JSON.stringify(soloDeclaration('the owner'), null, 2))
  const { status, err } = running(planted.root)
  assert.equal(err, `${NAME}: no crew declared a workspace layout, so there is nothing to check\n`)
  assert.equal(status, 0)
})

test('a declaration that cannot be read answers 2, and says it could not be made', (t) => {
  const planted = aPlantedWorkspace(t)
  writeFileSync(join(planted.root, '.martha', 'martha.json'), '{ not json')
  const { status, err } = running(planted.root)
  assert.match(err, new RegExp(`^${NAME}: could not be made: .*martha\\.json`), `the words a reader sees: ${err}`)
  assert.equal(err.trimEnd().split('\n').length, 1, `one line, not a stack: ${err}`)
  assert.equal(status, 2)
})

test('the script the job runs names this entry, so a script pointed elsewhere fails here and not only in CI', () => {
  const manifest = JSON.parse(readFileSync(join(dirname(import.meta.dirname), '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  assert.match(manifest.scripts['check:workspace-layout'] ?? '', /src\/check_the_workspace_matches_its_layout\/main\.ts$/)
})
